"""Export the data behind the in-browser dose-point planner.

    uv run python scripts/export_planner.py                  # 5yr, 25yr, 100yr
    uv run python scripts/export_planner.py --scenario 25yr --n 50

Writes web/data/PH015518000/planner_<scenario>.json. Reuses the pipeline's own steps
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

from lambat import access, data, siting

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web" / "data" / data.DAGUPAN
SCENARIOS = ("5yr", "25yr", "100yr")
KS = tuple(range(1, 11))
UNC_KS = (3, 5, 8)
SEED = 20261114
LIMIT = access.WALK_LIMIT_MIN


def r2(x) -> float:
    return round(float(x), 2)


class Ctx:
    """Everything that does not change between flood states."""

    def __init__(self) -> None:
        self.brgy = data.barangays(data.DAGUPAN)
        self.pop = data.population(data.DAGUPAN)
        self.hazard = data.flood_hazard(data.DAGUPAN)
        self.G = access.road_graph(barangays=self.brgy)
        access.node_elevations(self.G)
        self.facilities = access.health_facilities(self.G, barangays=self.brgy)
        self.cands = access.candidate_sites(self.G, barangays=self.brgy)


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
        "city": data.DAGUPAN, "scenario": scenario, "walk_limit_min": LIMIT,
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


def check_published(out: dict, st: dict) -> None:
    pub = json.loads((ROOT / "results" / "summary_25yr.json").read_text())
    tol = 1e-6 * pub["exposed_on_road_network"]
    assert abs(st["total"] - pub["exposed_on_road_network"]) < tol
    assert abs(st["gap"] - pub["exposed_access_gap"]) < tol
    for k in UNC_KS:
        pp = pub["dose_point_plans"][str(k)]
        mine = out["plans"][str(k)]
        assert sorted(mine["sites"]) == sorted(pp["sites"]), (k, mine["sites"], pp["sites"])
        assert abs(st["plans"][k].covered - pp["exposed_newly_covered"]) < tol
        assert round(mine["share"], 4) == round(pp["share_of_exposed_within_reach_after"], 4)
    print("CHECK 25yr plans k=3,5,8 match results/summary_25yr.json (sites, newly covered, shares)", flush=True)


def check_sensitivity(out: dict) -> None:
    sens = json.loads((ROOT / "results" / "sensitivity_dagupan_25yr.json").read_text())["a_placement"]
    u = out["uncertainty"]
    print(f"CHECK gap median {u['gap']['median']:,.2f} vs sensitivity file {sens['access_gap']['median']:,.2f}")
    print(f"CHECK clinic share median {u['clinic_share']['median']} vs {sens['clinics_only_share']['median']:.4f}")
    for k in UNC_KS:
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


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenario", nargs="+", default=list(SCENARIOS), choices=SCENARIOS)
    ap.add_argument("--n", type=int, default=200)
    args = ap.parse_args()
    t_all = time.time()
    block_network()
    ctx = Ctx()
    for sc in args.scenario:
        t0 = time.time()
        out, st = export(ctx, sc, args.n)
        if sc == "25yr":
            check_published(out, st)
            check_sensitivity(out)
        path = OUT / f"planner_{sc}.json"
        path.write_text(json.dumps(out, separators=(",", ":")))
        p = out["plans"]
        print(f"[{sc}] {path.relative_to(ROOT)} {path.stat().st_size / 1e6:.2f} MB, {time.time() - t0:.0f} s; "
              f"points {len(out['points']['w'])}, candidates {len(out['candidates'])}, gap {out['access_gap']:,.0f}, "
              f"k3/5/8 {p['3']['share']:.4f}/{p['5']['share']:.4f}/{p['8']['share']:.4f}", flush=True)
    print(f"total {time.time() - t_all:.0f} s")


if __name__ == "__main__":
    main()
