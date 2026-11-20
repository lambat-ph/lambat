"""Export the data behind the in-browser dose-point planner.

    uv run python scripts/export_planner.py                         # Dagupan, 5yr, 25yr, 100yr
    uv run python scripts/export_planner.py --city PH112402000      # one city, every scenario it has
    uv run python scripts/export_planner.py --city all --scenario 25yr --n 50

Writes web/data/<city>/planner_<scenario>.json for each scenario with NOAH flood hazard in
at least one barangay. Large cities (over run_pipeline.BIG_CITY_KM2) use the same smaller
walk graph as the pipeline: flooded barangays plus a 2 km buffer, for that scenario. Reuses the pipeline's own steps
(scripts/run_pipeline.py `_access`) and the random within-barangay flood placement from
scripts/run_sensitivity.py. Uses the existing OSM cache only; if a download would be
needed the script stops (see OFFLINE below).
"""

from __future__ import annotations

import argparse
import json
import time
from collections import Counter
from pathlib import Path

import numpy as np

from lambat import access, cities, data, siting

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web" / "data"
BIG_CITY_KM2 = 400  # same rule as scripts/run_pipeline.py
SCENARIOS = ("5yr", "25yr", "100yr")
KS = tuple(range(1, 11))
UNC_KS = KS  # pick counts and ranges for every plan size the map offers
PUB_KS = (3, 5, 8)  # the plan sizes in results/summary_25yr.json and the sensitivity file
SEED = 20261114
LIMIT = access.WALK_LIMIT_MIN


def r2(x) -> float:
    return round(float(x), 2)


class Ctx:
    """Everything that does not change between flood states."""

    def __init__(self, city: str = data.DAGUPAN, scenario: str = "25yr") -> None:
        self.city = city
        brgy = data.barangays(city)
        self.hazard = data.flood_hazard(city)
        area = float(brgy.to_crs(data.CRS_METRIC).area.sum() / 1e6)
        self.scope = "flooded" if area > BIG_CITY_KM2 else "full"
        if self.scope == "flooded":
            brgy = cities.flooded_scope(brgy, self.hazard, scenario)
        self.brgy = brgy
        pop = data.population(city)
        self.pop = pop[pop.index.isin(brgy.adm4_pcode)]
        self.G = access.road_graph(city, barangays=self.brgy)
        access.node_elevations(self.G)
        self.facilities = access.health_facilities(self.G, city, barangays=self.brgy)
        self.cands = access.candidate_sites(self.G, city, barangays=self.brgy)


def solve(ctx: Ctx, scenario: str, classes, ks=KS) -> dict:
    """One flood state, mirroring run_pipeline._access."""
    G_flood = access.apply_flood(ctx.G, classes)
    candidates = access.usable_sites(ctx.cands, classes)
    closed = set(ctx.facilities.id) - set(access.usable_sites(ctx.facilities, classes).id)
    demand = access.demand_points(ctx.G, ctx.brgy, ctx.pop, classes, hazard=ctx.hazard, scenario=scenario)
    wet = access.reach_sets(G_flood, ctx.facilities, demand, LIMIT, exclude=closed)
    covered = set().union(*wet.values()) if wet else set()
    dry = access.reach_sets(ctx.G, ctx.facilities, demand, LIMIT)
    dry_cov = set().union(*dry.values()) if dry else set()
    idx = demand.index
    total = float(demand.exposed.sum())
    clinic = float(demand.exposed[idx.isin(covered)].sum())
    gap = float(demand.exposed[idx.isin(dry_cov) & ~idx.isin(covered)].sum())
    missed = demand[~idx.isin(covered) & (demand.exposed > 0)]
    reach = access.reach_sets(G_flood, candidates, missed, LIMIT)
    weights = missed.exposed.to_dict()
    plans = {k: siting.exact_mclp(weights, reach, k) for k in ks} if weights and reach else {}
    return {"demand": demand, "total": total, "clinic": clinic, "gap": gap,
            "missed": missed, "reach": reach, "plans": plans, "candidates": candidates}


def pcts(v, nd=2) -> dict:
    a = np.asarray(v, dtype=float)
    return {k: round(float(np.percentile(a, p)), nd) for k, p in (("median", 50), ("p05", 5), ("p95", 95))}


def export(ctx: Ctx, scenario: str, n: int) -> tuple[dict, dict]:
    t0 = time.time()
    classes = access.flood_classes(ctx.G, ctx.brgy, ctx.hazard, scenario=scenario)
    st = solve(ctx, scenario, classes)
    total, clinic, missed = st["total"], st["clinic"], st["missed"]
    pidx = {d: i for i, d in enumerate(missed.index)}
    cands = st["candidates"].set_index("id")
    cand_out = []
    for sid, rs in st["reach"].items():
        r = cands.loc[sid]
        cand_out.append({"id": sid, "name": str(r["name"]), "kind": str(r["kind"]),
                         "lon": round(float(r["geometry"].x), 5), "lat": round(float(r["geometry"].y), 5),
                         "reach": sorted(pidx[d] for d in rs if d in pidx)})
    plans = {str(k): {"sites": list(p.sites), "newly": r2(p.covered), "share": round((clinic + p.covered) / total, 4)}
             for k, p in st["plans"].items()}
    unreached = missed.groupby("adm4").exposed.sum()
    barangays = {b: {"exposed": r2(g.exposed.sum()), "unreached_flood": r2(unreached.get(b, 0.0)),
                     "pop": r2(g.population.sum())} for b, g in st["demand"].groupby("adm4")}

    # Uncertainty: random within-barangay placement, one generator, consecutive draws (as run_sensitivity.py)
    rng = np.random.default_rng(SEED)
    gaps, cshare = [], []
    shares = {k: [] for k in UNC_KS}
    picks = {k: Counter() for k in UNC_KS}
    for i in range(n):
        s = solve(ctx, scenario, access.flood_classes(ctx.G, ctx.brgy, ctx.hazard, scenario=scenario, rng=rng), UNC_KS)
        gaps.append(s["gap"])
        cshare.append(s["clinic"] / s["total"])
        for k in UNC_KS:
            p = s["plans"].get(k)
            shares[k].append((s["clinic"] + (p.covered if p else 0.0)) / s["total"])
            picks[k].update(p.sites if p else [])
        if (i + 1) % 50 == 0:
            print(f"  [{scenario}] {i + 1}/{n} draws, {time.time() - t0:.0f} s", flush=True)

    out = {
        "city": ctx.city, "scenario": scenario, "scope": ctx.scope, "walk_limit_min": LIMIT,
        "exposed_on_network": r2(total), "clinic_reach": r2(clinic), "access_gap": r2(st["gap"]),
        "points": {"w": [r2(w) for w in missed.exposed], "pcode": [str(a) for a in missed.adm4]},
        "candidates": cand_out,
        "plans": plans,
        "uncertainty": {
            "n": n, "seed": SEED,
            "gap": pcts(gaps), "clinic_share": pcts(cshare, 4),
            "share": {str(k): pcts(shares[k], 4) for k in UNC_KS},
            "pick": {str(k): dict(picks[k].most_common()) for k in UNC_KS},
        },
        "barangays": barangays,
    }
    return out, st


def check_published(out: dict, st: dict, city: str, scenario: str) -> bool:
    """Compare with results/<city>/summary_<scenario>.json when the pipeline wrote one. False if there is none."""
    f = ROOT / "results" / city / f"summary_{scenario}.json"
    if not f.exists():
        return False
    pub = json.loads(f.read_text())
    if not pub.get("dose_point_plans") or pub.get("exposed_on_road_network") is None:
        return False
    tol = 1e-6 * pub["exposed_on_road_network"]
    assert abs(st["total"] - pub["exposed_on_road_network"]) < tol, (city, scenario, "exposed")
    assert abs(st["gap"] - pub["exposed_access_gap"]) < tol, (city, scenario, "gap")
    for k in PUB_KS:
        pp = pub["dose_point_plans"].get(str(k))
        if not pp:
            continue
        mine = out["plans"][str(k)]
        assert abs(st["plans"][k].covered - pp["exposed_newly_covered"]) < tol, (city, scenario, k)
        assert round(mine["share"], 4) == round(pp["share_of_exposed_within_reach_after"], 4), (city, scenario, k)
        if sorted(mine["sites"]) != sorted(pp["sites"]):  # equal coverage, different tie: report, do not fail
            print(f"NOTE [{city} {scenario}] k={k}: same coverage, different tied sites", flush=True)
    print(f"CHECK [{city} {scenario}] plans k=3,5,8 match {f.relative_to(ROOT)} (newly covered, shares)", flush=True)
    return True


def check_sensitivity(out: dict) -> None:
    sens = json.loads((ROOT / "results" / "sensitivity_dagupan_25yr.json").read_text())["a_placement"]
    u = out["uncertainty"]
    print(f"CHECK gap median {u['gap']['median']:,.2f} vs sensitivity file {sens['access_gap']['median']:,.2f}")
    print(f"CHECK clinic share median {u['clinic_share']['median']} vs {sens['clinics_only_share']['median']:.4f}")
    for k in PUB_KS:
        print(f"CHECK k={k} share median {u['share'][str(k)]['median']} vs {sens['plan_share'][str(k)]['median']:.4f}")
    ref = {r["site"]: round(r["share_of_draws"] * sens["n"]) for r in sens["k3_site_frequency"]}
    print("CHECK k=3 pick counts identical to sensitivity file:", u["pick"]["3"] == ref)


def block_network() -> None:
    """OSM cache only: any request that would download raises, so the run stops."""
    import requests

    def _stop(*a, **k):
        raise SystemExit("STOP: this step needs an OSM download; the cache is incomplete")

    requests.post = _stop
    requests.get = _stop
    requests.Session.request = _stop


def scenarios_for(city: str) -> list[str]:
    hz = data.flood_hazard(city)
    return [sc for sc in SCENARIOS if (access.flooded_share(hz, sc) > 0).any()]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--city", default=data.DAGUPAN, help="adm3 pcode or 'all'")
    ap.add_argument("--scenario", nargs="+", default=list(SCENARIOS), choices=SCENARIOS)
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--allow-download", action="store_true", help="let OSM queries go to the network (default: cache only)")
    args = ap.parse_args()
    t_all = time.time()
    if not args.allow_download:
        block_network()
    for city in cities.resolve(args.city):
        ctx = None
        for sc in [x for x in args.scenario if x in scenarios_for(city)]:
            t0 = time.time()
            if ctx is None or ctx.scope == "flooded":  # the full-city graph is shared by every scenario
                ctx = Ctx(city, sc)
            out, st = export(ctx, sc, args.n)
            check_published(out, st, city, sc)
            if city == data.DAGUPAN and sc == "25yr":
                check_sensitivity(out)
            d = WEB / city
            d.mkdir(parents=True, exist_ok=True)
            path = d / f"planner_{sc}.json"
            path.write_text(json.dumps(out, separators=(",", ":")))
            p = out["plans"]
            print(f"[{city} {sc}] {path.relative_to(ROOT)} {path.stat().st_size / 1e6:.2f} MB, {time.time() - t0:.0f} s; "
                  f"scope {ctx.scope}, points {len(out['points']['w'])}, candidates {len(out['candidates'])}, "
                  f"gap {out['access_gap']:,.0f}, k3/5/8 {p['3']['share']:.4f}/{p['5']['share']:.4f}/{p['8']['share']:.4f}",
                  flush=True)
    write_index()
    print(f"total {time.time() - t_all:.0f} s")


def write_index() -> None:
    """web/data/planner_index.json: which planner scenarios exist per city (the map reads it)."""
    idx = {}
    for city in cities.CITIES:
        have = [sc.replace("yr", "") for sc in SCENARIOS if (WEB / city / f"planner_{sc}.json").exists()]
        if have:
            idx[city] = have
    (WEB / "planner_index.json").write_text(json.dumps(idx, indent=1))
    print("planner index:", idx, flush=True)


if __name__ == "__main__":
    main()
