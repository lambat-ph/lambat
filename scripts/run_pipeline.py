"""Run LAMBAT end to end for one flood scenario and write the results.

    uv run python scripts/run_pipeline.py --scenario 25yr

Steps: exposure per barangay (NOAH x WorldPop), walking access to existing
health facilities on dry vs flooded roads, then temporary dose points chosen to
cover the exposed residents that facilities miss during the flood. Finally the
barangay ranking is compared with news reports of flooding (data/validation/).

Outputs in results/: barangays_<scenario>.csv and .geojson, dose_points_<scenario>.geojson,
summary_<scenario>.json.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import geopandas as gpd
import pandas as pd

from lambat import access, data, exposure, siting

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "results"
REPORTS = ROOT / "data" / "validation" / "dagupan_flood_reports.csv"


def spearman(a: pd.Series, b: pd.Series) -> float:
    a, b = a.align(b, join="inner")
    return float(a.rank().corr(b.rank()))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenario", default="25yr", choices=["5yr", "25yr", "100yr"])
    ap.add_argument("--k", type=int, nargs="+", default=[3, 5, 8])
    ap.add_argument("--limit-min", type=float, default=access.WALK_LIMIT_MIN)
    args = ap.parse_args()
    t0 = time.time()

    brgy = data.barangays()
    pop = data.population()
    hazard = data.flood_hazard()

    # Step 2: who was in the water
    exp = exposure.exposed_by_barangay(scenario=args.scenario)

    # Step 3: who can still reach care
    G = access.road_graph(barangays=brgy)
    access.node_elevations(G)
    classes = access.flood_classes(G, brgy, hazard, scenario=args.scenario)
    G_flood = access.apply_flood(G, classes)
    facilities = access.health_facilities(G, barangays=brgy)
    candidates = access.usable_sites(access.candidate_sites(G, barangays=brgy), classes)
    closed = set(facilities.id) - set(access.usable_sites(facilities, classes).id)
    demand = access.demand_points(G, brgy, pop, classes, hazard=hazard, scenario=args.scenario)
    gap = access.access_gap(G, G_flood, facilities, demand, args.limit_min, closed_sites=closed)

    # Step 4: where temporary dose points should go
    wet_reach = access.reach_sets(G_flood, facilities, demand, args.limit_min, exclude=closed)
    covered_by_facilities = set().union(*wet_reach.values()) if wet_reach else set()
    missed = demand[~demand.index.isin(covered_by_facilities) & (demand.exposed > 0)]
    reach = access.reach_sets(G_flood, candidates, missed, args.limit_min)
    weights = missed.exposed.to_dict()

    plans = {}
    for k in args.k:
        res = siting.exact_mclp(weights, reach, k)
        plans[k] = res
    best = plans[max(args.k)]
    chosen = candidates[candidates.id.isin(best.sites)].copy()
    chosen["rank"] = chosen.id.map({s: i + 1 for i, s in enumerate(best.sites)})
    covered_by_k: set[str] = set().union(*(reach[s] for s in best.sites)) if best.sites else set()

    # Barangay table and priority ranking
    # exposure.py counts exposed residents by area share; access counts them at flooded
    # road nodes. Reach figures use the second, so the unreached count does too.
    tab = exp.join(gap.drop(columns=["population"]).rename(columns={"exposed": "exposed_network"}), how="left").fillna(0.0)
    tab["exposed_unreached_flood"] = tab.exposed_network - tab.exposed_reach_flood
    newly = missed[missed.index.isin(covered_by_k)].groupby("adm4").exposed.sum()
    tab["exposed_covered_by_dose_points"] = newly.reindex(tab.index).fillna(0.0)
    tab = tab.sort_values(["exposed_unreached_flood", "exposed"], ascending=False)
    tab["priority"] = range(1, len(tab) + 1)

    # Validation against news reports
    validation = None
    if REPORTS.exists():
        rep = pd.read_csv(REPORTS)
        events = rep.groupby("barangay").event_name.nunique()
        names = tab.set_index("adm4_en")
        events = events.reindex(names.index).fillna(0)
        validation = {
            "barangays_reported": int((events > 0).sum()),
            "events": int(rep.event_name.nunique()),
            "spearman_events_vs_flooded_share": spearman(names.flooded_share, events),
            "spearman_events_vs_exposed": spearman(names.exposed, events),
            "note": "News coverage is biased toward downtown and river barangays; treat as a rough check.",
        }

    total_exposed = float(tab.exposed.sum())
    network_exposed = float(tab.exposed_network.sum())
    summary = {
        "scenario": args.scenario,
        "walk_limit_min": args.limit_min,
        "population": float(pop.sum()),
        "exposed": total_exposed,
        "weekly_capsules": float(tab.weekly_capsules.sum()),
        "health_facilities": len(facilities),
        "facilities_closed_by_flood": len(closed),
        "candidate_sites_usable": len(candidates),
        "exposed_on_road_network": network_exposed,
        "exposed_within_reach_dry": float(tab.exposed_reach_dry.sum()),
        "exposed_within_reach_flood": float(tab.exposed_reach_flood.sum()),
        "exposed_access_gap": float(tab.exposed_gap.sum()),
        "exposed_unreached_in_flood": float(tab.exposed_unreached_flood.sum()),
        "dose_point_plans": {
            str(k): {
                "sites": r.sites,
                "exposed_newly_covered": r.covered,
                "exposed_within_reach_after": float(tab.exposed_reach_flood.sum()) + r.covered,
                "share_of_exposed_within_reach_after": (float(tab.exposed_reach_flood.sum()) + r.covered) / network_exposed,
            }
            for k, r in plans.items()
        },
        "validation": validation,
        "runtime_s": round(time.time() - t0, 1),
    }

    OUT.mkdir(exist_ok=True)
    tab.to_csv(OUT / f"barangays_{args.scenario}.csv", index_label="adm4_pcode")
    geo = brgy.set_index("adm4_pcode")[["geometry"]].join(tab, how="inner")
    gpd.GeoDataFrame(geo, geometry="geometry", crs=brgy.crs).reset_index().to_file(
        OUT / f"barangays_{args.scenario}.geojson", driver="GeoJSON")
    chosen.to_crs("EPSG:4326")[["id", "name", "kind", "rank", "geometry"]].to_file(
        OUT / f"dose_points_{args.scenario}.geojson", driver="GeoJSON")
    (OUT / f"summary_{args.scenario}.json").write_text(json.dumps(summary, indent=2))

    print(f"Scenario {args.scenario}: {total_exposed:,.0f} exposed of {pop.sum():,.0f} residents; "
          f"{summary['weekly_capsules']:,.0f} capsules per flood week")
    print(f"Exposed within {args.limit_min:.0f} min of a facility: dry {summary['exposed_within_reach_dry']:,.0f}, "
          f"flood {summary['exposed_within_reach_flood']:,.0f} (gap {summary['exposed_access_gap']:,.0f})")
    for k, p in summary["dose_point_plans"].items():
        print(f"  {k} dose points: +{p['exposed_newly_covered']:,.0f} exposed covered, "
              f"{p['share_of_exposed_within_reach_after']:.1%} of exposed within reach")
    if validation:
        print(f"Validation vs {validation['events']} reported events: Spearman(flooded share, events) = "
              f"{validation['spearman_events_vs_flooded_share']:.2f}")
    print("Top 5 priority barangays:", ", ".join(tab.adm4_en.head(5)))
    print(f"Done in {summary['runtime_s']} s; outputs in {OUT}")


if __name__ == "__main__":
    main()
