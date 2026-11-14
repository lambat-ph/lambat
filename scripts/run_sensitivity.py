"""Sensitivity and uncertainty checks for the Dagupan 25-year LAMBAT result.

    uv run python scripts/run_sensitivity.py                 # 200 random flood placements
    uv run python scripts/run_sensitivity.py --n 50 --seed 1

Reuses the pipeline's own steps (see scripts/run_pipeline.py `_access`): walk graph,
node elevations, facilities, candidate sites, demand cells, reach sets, exact MCLP.
Shares use the pipeline's denominator: exposed residents on the road network.

Checks (written to results/sensitivity_dagupan_25yr.json):
  a. placement: N random within-barangay flood placements (same NOAH counts per class)
  b. parameter grid: walk limit x speed x speed factors x edge rule, elevation placement
  c. coverage ceiling: every usable candidate site open, plus clinics
  d. dry-day plan: k=3 solved with no flood, compared with the flood plan

The published run is rebuilt first and compared with results/summary_25yr.json.
"""

from __future__ import annotations

import argparse
import itertools
import json
import time
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd

from lambat import access, data, siting

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "results" / "sensitivity_dagupan_25yr.json"
PUBLISHED = ROOT / "results" / "summary_25yr.json"
SCENARIO = "25yr"
KS = (3, 5, 8)
HARSH_FACTORS = {1: 0.4, 2: 0.1, 3: 0.0}


class Context:
    """Everything that does not change between runs."""

    def __init__(self) -> None:
        self.brgy = data.barangays(data.DAGUPAN)
        self.pop = data.population(data.DAGUPAN)
        self.hazard = data.flood_hazard(data.DAGUPAN)
        self.G = access.road_graph(barangays=self.brgy)
        access.node_elevations(self.G)
        self.facilities = access.health_facilities(self.G, barangays=self.brgy)
        self.candidates_all = access.candidate_sites(self.G, barangays=self.brgy)
        self.kmh = access.WALK_KMH
        self._dry_cache: dict = {}
        self.names = self.candidates_all.set_index("id")[["name", "kind"]]

    def set_speed(self, kmh: float) -> None:
        if kmh != self.kmh:
            access.set_walk_time(self.G, kmh)
            self.kmh = kmh

    def elevation_classes(self) -> pd.Series:
        return access.flood_classes(self.G, self.brgy, self.hazard, scenario=SCENARIO)

    def random_classes(self, rng: np.random.Generator) -> pd.Series:
        return access.flood_classes(self.G, self.brgy, self.hazard, scenario=SCENARIO, rng=rng)

    def demand(self, classes: pd.Series) -> pd.DataFrame:
        return access.demand_points(self.G, self.brgy, self.pop, classes, hazard=self.hazard,
                                    scenario=SCENARIO, walk_kmh=self.kmh)

    def dry_facility_reach(self, demand: pd.DataFrame, limit: float) -> set[str]:
        """Demand ids within reach of a clinic on the dry graph. Cell ids do not depend on the flood."""
        key = (self.kmh, limit)
        if key not in self._dry_cache:
            r = access.reach_sets(self.G, self.facilities, demand, limit)
            self._dry_cache[key] = set().union(*r.values())
        return self._dry_cache[key]


def evaluate(ctx: Context, classes: pd.Series, *, limit: float = access.WALK_LIMIT_MIN,
             kmh: float = access.WALK_KMH, factors: dict | None = None, edge_rule: str = "min",
             ks=KS, ceiling: bool = False) -> dict:
    """One scenario, mirroring run_pipeline._access. Returns shares of exposed-on-network."""
    ctx.set_speed(kmh)
    G_flood = access.apply_flood(ctx.G, classes, factors, edge_rule)
    candidates = access.usable_sites(ctx.candidates_all, classes)
    closed = set(ctx.facilities.id) - set(access.usable_sites(ctx.facilities, classes).id)
    demand = ctx.demand(classes)
    total = float(demand.exposed.sum())

    dry = ctx.dry_facility_reach(demand, limit)
    wet_reach = access.reach_sets(G_flood, ctx.facilities, demand, limit, exclude=closed)
    wet = set().union(*wet_reach.values()) if wet_reach else set()
    idx = demand.index
    reach_flood = float(demand.exposed[idx.isin(wet)].sum())
    gap = float(demand.exposed[idx.isin(dry) & ~idx.isin(wet)].sum())

    missed = demand[~idx.isin(wet) & (demand.exposed > 0)]
    reach = access.reach_sets(G_flood, candidates, missed, limit)
    weights = missed.exposed.to_dict()
    out: dict = {
        "exposed_on_network": total,
        "clinics_only_share": reach_flood / total,
        "access_gap": gap,
        "plans": {},
    }
    for k in ks:
        if weights and reach:
            r = siting.exact_mclp(weights, reach, k)
            out["plans"][k] = {"share": (reach_flood + r.covered) / total, "sites": sorted(r.sites)}
        else:
            out["plans"][k] = {"share": reach_flood / total, "sites": []}
    if ceiling:
        everything = set().union(*reach.values()) if reach else set()
        covered = float(missed.exposed[missed.index.isin(everything)].sum())
        out["ceiling"] = {
            "usable_candidate_sites": len(candidates),
            "share": (reach_flood + covered) / total,
            "unreachable_exposed": total - reach_flood - covered,
        }
        out["_flood_state"] = (G_flood, candidates, demand, wet, closed)
    return out


def pct(a, q):
    return float(np.percentile(np.asarray(a, dtype=float), q))


def summarise(values) -> dict:
    return {"median": pct(values, 50), "p05": pct(values, 5), "p95": pct(values, 95),
            "min": float(np.min(values)), "max": float(np.max(values))}


def site_label(ctx: Context, sid: str) -> str:
    if sid in ctx.names.index:
        r = ctx.names.loc[sid]
        return f"{r['name']} ({r['kind']}, {sid})"
    return sid


def check_published(pub: dict, res: dict) -> None:
    exp = pub["exposed_on_road_network"]
    tol = 1e-6 * exp
    assert abs(res["exposed_on_network"] - exp) < tol, (res["exposed_on_network"], exp)
    assert abs(res["access_gap"] - pub["exposed_access_gap"]) < tol, (res["access_gap"], pub["exposed_access_gap"])
    for k in KS:
        p = pub["dose_point_plans"][str(k)]
        assert abs(res["plans"][k]["share"] - p["share_of_exposed_within_reach_after"]) < 1e-9
        assert sorted(res["plans"][k]["sites"]) == sorted(p["sites"]), (k, res["plans"][k]["sites"], p["sites"])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=200, help="random flood placements")
    ap.add_argument("--seed", type=int, default=20261114)
    args = ap.parse_args()
    t0 = time.time()
    pub = json.loads(PUBLISHED.read_text())
    ctx = Context()
    print(f"graph {ctx.G.number_of_nodes()} nodes, {len(ctx.facilities)} clinics, "
          f"{len(ctx.candidates_all)} candidate sites; setup {time.time() - t0:.0f} s", flush=True)

    # Published run, rebuilt and checked against results/summary_25yr.json
    classes0 = ctx.elevation_classes()
    base = evaluate(ctx, classes0, ceiling=True)
    check_published(pub, base)
    print("published run reproduced from summary_25yr.json (gap, shares, sites all match)", flush=True)
    G_flood, cand0, demand0, wet0, _ = base.pop("_flood_state")

    # c. ceiling (published settings)
    ceiling = base["ceiling"]

    # d. dry-day plan: no flood, same exposed residents as weights
    ctx.set_speed(access.WALK_KMH)
    dry_reach_fac = access.reach_sets(ctx.G, ctx.facilities, demand0, access.WALK_LIMIT_MIN)
    dry_cov = set().union(*dry_reach_fac.values())
    miss_dry = demand0[~demand0.index.isin(dry_cov) & (demand0.exposed > 0)]
    reach_dry = access.reach_sets(ctx.G, ctx.candidates_all, miss_dry, access.WALK_LIMIT_MIN)
    w_dry = miss_dry.exposed.to_dict()
    dry_plan = siting.exact_mclp(w_dry, reach_dry, 3)
    flood_sites = base["plans"][3]["sites"]
    overlap = sorted(set(dry_plan.sites) & set(flood_sites))
    # how the dry-day plan does if the flood happens (closed sites drop out)
    usable_ids = set(cand0.id)
    dry_sites_open = [s for s in dry_plan.sites if s in usable_ids]
    miss_flood = demand0[~demand0.index.isin(wet0) & (demand0.exposed > 0)]
    reach_flood_dry_sites = access.reach_sets(G_flood, ctx.candidates_all[ctx.candidates_all.id.isin(dry_sites_open)],
                                              miss_flood, access.WALK_LIMIT_MIN)
    cov_dry_plan = set().union(*reach_flood_dry_sites.values()) if reach_flood_dry_sites else set()
    total = base["exposed_on_network"]
    reach_flood_exposed = base["clinics_only_share"] * total
    dry_plan_share_in_flood = (reach_flood_exposed + float(miss_flood.exposed[miss_flood.index.isin(cov_dry_plan)].sum())) / total
    dry_block = {
        "dry_plan_sites": sorted(dry_plan.sites),
        "flood_plan_sites": sorted(flood_sites),
        "overlap_count": len(overlap),
        "overlap_sites": overlap,
        "dry_plan_sites_unusable_in_flood": sorted(set(dry_plan.sites) - usable_ids),
        "share_within_reach_if_dry_plan_used_in_flood": dry_plan_share_in_flood,
        "share_within_reach_flood_plan": base["plans"][3]["share"],
    }

    # a. placement uncertainty
    print(f"running {args.n} random flood placements (seed {args.seed}) ...", flush=True)
    rng = np.random.default_rng(args.seed)
    draws = []
    ta = time.time()
    for i in range(args.n):
        draws.append(evaluate(ctx, ctx.random_classes(rng)))
        if (i + 1) % 25 == 0:
            print(f"  {i + 1}/{args.n}  {time.time() - ta:.0f} s", flush=True)
    placement = {
        "n": args.n,
        "seed": args.seed,
        "access_gap": summarise([d["access_gap"] for d in draws]),
        "clinics_only_share": summarise([d["clinics_only_share"] for d in draws]),
        "exposed_on_network": summarise([d["exposed_on_network"] for d in draws]),
        "plan_share": {str(k): summarise([d["plans"][k]["share"] for d in draws]) for k in KS},
    }
    freq = Counter(s for d in draws for s in d["plans"][3]["sites"])
    placement["k3_site_frequency"] = [
        {"site": s, "name": site_label(ctx, s), "share_of_draws": c / args.n, "published_plan": s in flood_sites}
        for s, c in freq.most_common()
    ]
    # same-set frequency of the published 3-site plan
    placement["k3_exact_published_set_share"] = sum(sorted(d["plans"][3]["sites"]) == sorted(flood_sites) for d in draws) / args.n
    placement["published_elevation_run"] = {
        "access_gap": base["access_gap"],
        "clinics_only_share": base["clinics_only_share"],
        "plan_share": {str(k): base["plans"][k]["share"] for k in KS},
    }
    # where the published run sits in the random distribution
    placement["published_percentile_in_random"] = {
        "access_gap": float(np.mean([d["access_gap"] <= base["access_gap"] for d in draws]) * 100),
        "plan_share_3": float(np.mean([d["plans"][3]["share"] <= base["plans"][3]["share"] for d in draws]) * 100),
    }

    # b. parameter grid (elevation-based placement as published)
    print("parameter grid ...", flush=True)
    grid = []
    factor_sets = {"published": dict(access.SPEED_FACTORS), "harsh": HARSH_FACTORS}
    for limit, kmh, (fname, fac), rule in itertools.product((15, 20, 30), (3.0, 4.5), factor_sets.items(), ("min", "max")):
        r = evaluate(ctx, classes0, limit=limit, kmh=kmh, factors=fac, edge_rule=rule)
        grid.append({
            "walk_limit_min": limit, "speed_kmh": kmh, "speed_factors": fname, "edge_rule": rule,
            "clinics_only_share": r["clinics_only_share"], "access_gap": r["access_gap"],
            "plan_share": {str(k): r["plans"][k]["share"] for k in KS},
            "k3_sites": r["plans"][3]["sites"],
        })
    ctx.set_speed(access.WALK_KMH)

    runtime = time.time() - t0
    result = {
        "city": data.DAGUPAN, "scenario": SCENARIO, "seed": args.seed,
        "published_checked_against": str(PUBLISHED.relative_to(ROOT)),
        "published": {"exposed_on_network": total, "clinics_only_share": base["clinics_only_share"],
                      "access_gap": base["access_gap"], "plan_share": {str(k): base["plans"][k]["share"] for k in KS},
                      "k3_sites": flood_sites},
        "a_placement": placement,
        "b_parameter_grid": {"harsh_factors": {str(k): v for k, v in HARSH_FACTORS.items()}, "rows": grid},
        "c_ceiling": ceiling,
        "d_dry_plan": dry_block,
        "runtime_s": round(runtime, 1),
    }
    OUT.write_text(json.dumps(result, indent=2))

    # Short tables
    def p(x):
        return f"{x:.1%}"

    print(f"\nPublished (elevation placement): clinics only {p(base['clinics_only_share'])}, gap {base['access_gap']:,.0f}, "
          + ", ".join(f"k={k} {p(base['plans'][k]['share'])}" for k in KS))
    print(f"\nPlacement uncertainty, {args.n} draws (median [5%, 95%])")
    g = placement["access_gap"]
    print(f"  access gap        {g['median']:,.0f} [{g['p05']:,.0f}, {g['p95']:,.0f}]")
    c = placement["clinics_only_share"]
    print(f"  clinics only      {p(c['median'])} [{p(c['p05'])}, {p(c['p95'])}]")
    for k in KS:
        s = placement["plan_share"][str(k)]
        print(f"  {k} dose points     {p(s['median'])} [{p(s['p05'])}, {p(s['p95'])}]")
    print("  k=3 site frequency:")
    for row in placement["k3_site_frequency"][:8]:
        print(f"    {row['share_of_draws']:6.1%}  {row['name']}{'  <- published' if row['published_plan'] else ''}")
    print(f"  same 3 sites as published in {p(placement['k3_exact_published_set_share'])} of draws")
    print("\nParameter grid (elevation placement)")
    print("  limit speed factors   rule  clinics   gap     k3     k5     k8")
    for r in grid:
        ps = r["plan_share"]
        print(f"  {r['walk_limit_min']:>4}  {r['speed_kmh']:>4}  {r['speed_factors']:<9} {r['edge_rule']:<4} "
              f"{p(r['clinics_only_share']):>7} {r['access_gap']:>7,.0f} {p(ps['3']):>6} {p(ps['5']):>6} {p(ps['8']):>6}")
    print(f"\nCeiling (clinics + all {ceiling['usable_candidate_sites']} usable candidate sites): {p(ceiling['share'])} reachable; "
          f"{ceiling['unreachable_exposed']:,.0f} exposed residents unreachable (need outreach, not a fixed site)")
    print(f"\nDry-day k=3 plan shares {len(overlap)} of 3 sites with the flood plan; "
          f"used in the flood it reaches {p(dry_plan_share_in_flood)} (flood plan {p(base['plans'][3]['share'])})")
    print(f"\nWrote {OUT.relative_to(ROOT)}; runtime {runtime:.0f} s")


if __name__ == "__main__":
    main()
