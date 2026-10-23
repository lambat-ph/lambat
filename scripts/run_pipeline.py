"""Run LAMBAT end to end for one flood scenario and write the results.

    uv run python scripts/run_pipeline.py --scenario 25yr                 # Dagupan
    uv run python scripts/run_pipeline.py --city PH063022000              # one city
    uv run python scripts/run_pipeline.py --city all                      # 12 cities in sequence
    uv run python scripts/run_pipeline.py --scenario egay                 # Dagupan, Typhoon Egay as seen by radar

Steps: exposure per barangay (flood hazard x WorldPop), walking access to existing
health facilities on dry vs flooded roads, then temporary dose points chosen to
cover the exposed residents that facilities miss during the flood. For Dagupan the
barangay ranking is also compared with news reports of flooding (data/validation/).

Outputs in results/<city_code>/: barangays_<scenario>.csv and .geojson,
dose_points_<scenario>.geojson, summary_<scenario>.json. Dagupan is also written to
results/ (legacy flat paths). summary["steps"] records which steps ran and
summary["step_notes"] why a step did not.

Flood hazard is a UP NOAH return period (5yr, 25yr, 100yr) or an observed flood
mapped from Sentinel-1 radar (egay: run scripts/run_s1_flood.py first). Radar has
no depth, so its flooded share enters as one hazard level (--radar-level).
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import geopandas as gpd
import pandas as pd

from lambat import access, cities, data, exposure, flood, siting
from lambat import validation as V

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "results"
REPORTS = ROOT / "data" / "validation" / "dagupan_flood_reports.csv"
BIG_CITY_KM2 = 400  # above this, start with the flooded-barangays-plus-buffer walk graph
NOAH_SCENARIOS = ["5yr", "25yr", "100yr"]
# Observed floods mapped from radar: scenario -> run_s1_flood.py output and the matching news-report event.
RADAR_SCENARIOS = {
    "egay": {"city": data.DAGUPAN, "table": "s1_egay_barangays.csv", "event": "Typhoon Egay / habagat 2023",
             "label": "Typhoon Egay, Sentinel-1 radar pass of 28 July 2023", "date": "2023-07-28"},
}


def scenario_hazard(city: str, scenario: str, method: str = "threshold", level: str = "med"):
    """NOAH hazard for the city, plus the radar scenario's columns when scenario is one of RADAR_SCENARIOS.

    Returns (hazard, source) where source describes where the flood extent came from.
    """
    hazard = data.flood_hazard(city)
    if scenario not in RADAR_SCENARIOS:
        return hazard, {"kind": "noah", "label": f"UP NOAH {scenario} flood hazard map"}
    r = RADAR_SCENARIOS[scenario]
    if city != r["city"]:
        raise SystemExit(f"scenario {scenario} is a radar map of {cities.CITIES[r['city']]} only")
    path = OUT / r["table"]
    if not path.exists():
        raise SystemExit(f"{path} not found: run scripts/run_s1_flood.py first (needs the Sentinel-1 scenes in data/raw/s1/)")
    radar = flood.radar_hazard(pd.read_csv(path), scenario=scenario, method=method, level=level)
    hazard = hazard.join(radar, how="left")
    hazard[radar.columns] = hazard[radar.columns].fillna(0.0)
    return hazard, {"kind": "radar", "label": r["label"], "date": r["date"], "event": r["event"],
                    "method": method, "level": level, "table": f"results/{r['table']}"}


def _access(brgy, pop, hazard, scenario, ks, limit_min):
    """Steps 3 and 4 on one barangay set."""
    G = access.road_graph(barangays=brgy)
    access.node_elevations(G)
    classes = access.flood_classes(G, brgy, hazard, scenario=scenario)
    G_flood = access.apply_flood(G, classes)
    facilities = access.health_facilities(G, barangays=brgy)
    candidates = access.usable_sites(access.candidate_sites(G, barangays=brgy), classes)
    closed = set(facilities.id) - set(access.usable_sites(facilities, classes).id)
    demand = access.demand_points(G, brgy, pop, classes, hazard=hazard, scenario=scenario)
    gap = access.access_gap(G, G_flood, facilities, demand, limit_min, closed_sites=closed)

    wet_reach = access.reach_sets(G_flood, facilities, demand, limit_min, exclude=closed)
    covered_by_facilities = set().union(*wet_reach.values()) if wet_reach else set()
    missed = demand[~demand.index.isin(covered_by_facilities) & (demand.exposed > 0)]
    reach = access.reach_sets(G_flood, candidates, missed, limit_min)
    weights = missed.exposed.to_dict()
    plans = {k: siting.exact_mclp(weights, reach, k) for k in ks} if weights and reach else {}
    best = plans.get(max(ks))
    covered_by_k = set().union(*(reach[s] for s in best.sites)) if best and best.sites else set()
    newly = missed[missed.index.isin(covered_by_k)].groupby("adm4").exposed.sum()
    return gap, facilities, closed, candidates, plans, newly


def run_city(city: str, scenario: str, ks: list[int], limit_min: float, scope: str = "auto",
             radar_method: str = "threshold", radar_level: str = "med") -> dict:
    t0 = time.time()
    out = OUT / city
    out.mkdir(parents=True, exist_ok=True)
    brgy = data.barangays(city)
    pop = data.population(city)
    hazard, source = scenario_hazard(city, scenario, radar_method, radar_level)
    steps: dict = {"exposure": False, "access": False, "siting": False}
    notes: dict = {}
    if not cities.in_utm51(brgy.total_bounds):
        raise SystemExit(f"{city} lies outside UTM zone 51N; choose another metric CRS")

    # Step 2: who was in the water
    exp = exposure.exposed_by_barangay(scenario=scenario, city=city, hazard=hazard)
    steps["exposure"] = True
    n_flooded = int((access.flooded_share(hazard, scenario) > 0).sum())

    # Steps 3 and 4: access and dose points
    acc = None
    scope_used = None
    scope_codes: set[str] = set()
    if n_flooded == 0:
        notes["access"] = f"skipped: the {source['label']} floods no barangay, so nobody is exposed"
        notes["siting"] = "skipped: nobody is exposed"
    else:
        area = float(brgy.to_crs(data.CRS_METRIC).area.sum() / 1e6)
        if scope in ("full", "flooded"):
            order = [scope]
        elif area > BIG_CITY_KM2:
            order = ["flooded", "full"]
        else:
            order = ["full", "flooded"]
        errors = []
        for sc in order:
            sub = brgy if sc == "full" else cities.flooded_scope(brgy, hazard, scenario)
            try:
                print(f"[{city}] access on {sc} scope: {len(sub)} of {len(brgy)} barangays ({area:,.0f} km2 city)", flush=True)
                acc = _access(sub, pop[pop.index.isin(sub.adm4_pcode)], hazard, scenario, ks, limit_min)
                scope_used, scope_codes = sc, set(sub.adm4_pcode)
                steps["access"] = True
                steps["siting"] = bool(acc[4])
                if sc == "flooded":
                    notes["access_scope"] = (f"walk graph limited to {len(sub)} of {len(brgy)} barangays: those flooded in the "
                                             f"{source['label']} plus any touching a 2 km buffer around them")
                break
            except Exception as e:  # noqa: BLE001  Overpass, memory and graph errors vary
                errors.append(f"{sc} scope failed: {type(e).__name__}: {str(e)[:200]}")
                print(f"[{city}] {errors[-1]}", flush=True)
        if acc is None:
            notes["access"] = "unavailable: " + "; ".join(errors)
            notes["siting"] = "skipped: needs access step"
        else:
            if errors:
                notes["access_retry"] = "; ".join(errors)
            if not acc[4]:
                notes["siting"] = "no exposed residents outside facility reach, or no usable candidate sites"

    # Barangay table and priority ranking
    if acc is not None:
        gap, facilities, closed, candidates, plans, newly = acc
        tab = exp.join(gap.drop(columns=["population"]).rename(columns={"exposed": "exposed_network"}), how="left")
        acols = [c for c in tab.columns if c not in exp.columns]
        in_scope = tab.index.isin(scope_codes)
        tab.loc[in_scope, acols] = tab.loc[in_scope, acols].fillna(0.0)
        tab["exposed_unreached_flood"] = tab.exposed_network - tab.exposed_reach_flood
        tab["exposed_covered_by_dose_points"] = newly.reindex(tab.index).fillna(0.0).where(in_scope)
        tab = tab.sort_values(["exposed_unreached_flood", "exposed"], ascending=False, na_position="last")
    else:
        facilities = candidates = None
        closed, plans = set(), {}
        tab = exp.sort_values("exposed", ascending=False)
    tab["priority"] = range(1, len(tab) + 1)

    # Validation against news reports (Dagupan only: reports exist for no other city)
    validation = None
    if city == data.DAGUPAN and REPORTS.exists():
        rep = pd.read_csv(REPORTS)
        events = rep.groupby("barangay").event_name.nunique()
        names = tab.set_index("adm4_en")
        events = events.reindex(names.index).fillna(0)
        ci = V.bootstrap_ci(names.flooded_share, events)
        validation = {
            "barangays_reported": int((events > 0).sum()),
            "events": int(rep.event_name.nunique()),
            "spearman_events_vs_flooded_share": V.spearman(names.flooded_share, events),
            "spearman_events_vs_flooded_share_ci95": list(ci),
            "spearman_events_vs_flooded_share_perm_p": V.permutation_p(names.flooded_share, events),
            "spearman_events_vs_exposed": V.spearman(names.exposed, events),
            "see": "scripts/run_validation.py and docs/validation.md for all candidates, CIs and the population control",
            "note": "News coverage is biased toward downtown and river barangays; treat as a rough check.",
        }
        if source["kind"] == "radar":
            # Same flood, same dates: were the barangays the radar calls flooded the ones the news named?
            named = names.index.isin(rep[rep.event_name == source["event"]].barangay)
            validation["event"] = {
                "name": source["event"],
                "barangays_reported": int(named.sum()),
                "auc_flooded_share": V.auc(names.flooded_share.to_numpy(), named),
                "note": "AUC 0.5 is chance; 1 means every reported barangay has a larger radar flooded share than every unreported one.",
            }

    have = acc is not None
    total_exposed = float(tab.exposed.sum())
    network_exposed = float(tab.exposed_network.sum()) if have else None
    reach_flood = float(tab.exposed_reach_flood.sum()) if have else None
    summary = {
        "city": city,
        "city_name": cities.CITIES[city],
        "scenario": scenario,
        "hazard_source": source,
        "walk_limit_min": limit_min,
        "steps": steps,
        "step_notes": notes,
        "access_scope": scope_used,
        "population": float(pop.sum()),
        "barangays": int(len(brgy)),
        "barangays_flooded": n_flooded,
        "exposed": total_exposed,
        "weekly_capsules": float(tab.weekly_capsules.sum()),
        "health_facilities": len(facilities) if have else None,
        "facilities_closed_by_flood": len(closed) if have else None,
        "candidate_sites_usable": len(candidates) if have else None,
        "exposed_on_road_network": network_exposed,
        "exposed_within_reach_dry": float(tab.exposed_reach_dry.sum()) if have else None,
        "exposed_within_reach_flood": reach_flood,
        "exposed_access_gap": float(tab.exposed_gap.sum()) if have else None,
        "exposed_unreached_in_flood": float(tab.exposed_unreached_flood.sum()) if have else None,
        "dose_point_plans": {
            str(k): {
                "sites": r.sites,
                "exposed_newly_covered": r.covered,
                "exposed_within_reach_after": reach_flood + r.covered,
                "share_of_exposed_within_reach_after": (reach_flood + r.covered) / network_exposed if network_exposed else None,
            }
            for k, r in plans.items()
        },
        "validation": validation,
        "validation_note": None if city == data.DAGUPAN else "News-report validation exists for Dagupan only.",
        "runtime_s": round(time.time() - t0, 1),
    }

    geo = brgy.set_index("adm4_pcode")[["geometry"]].join(tab, how="inner")
    geo_json = gpd.GeoDataFrame(geo, geometry="geometry", crs=brgy.crs).reset_index().to_json(na="null")
    dose_json = json.dumps(cities.dose_point_collection(candidates, plans))
    targets = [out] + ([OUT] if city == data.DAGUPAN else [])  # Dagupan keeps its flat legacy paths
    for d in targets:
        tab.to_csv(d / f"barangays_{scenario}.csv", index_label="adm4_pcode")
        (d / f"barangays_{scenario}.geojson").write_text(geo_json)
        (d / f"dose_points_{scenario}.geojson").write_text(dose_json)
        (d / f"summary_{scenario}.json").write_text(json.dumps(summary, indent=2))

    print(f"[{city}] {total_exposed:,.0f} exposed of {pop.sum():,.0f} residents; "
          f"{summary['weekly_capsules']:,.0f} capsules per flood week; steps {steps}")
    if have:
        print(f"  within {limit_min:.0f} min of a facility: dry {summary['exposed_within_reach_dry']:,.0f}, "
              f"flood {summary['exposed_within_reach_flood']:,.0f} (gap {summary['exposed_access_gap']:,.0f})")
        for k, p in summary["dose_point_plans"].items():
            print(f"  {k} dose points: +{p['exposed_newly_covered']:,.0f} exposed covered, "
                  f"{p['share_of_exposed_within_reach_after']:.1%} of exposed within reach")
    if validation:
        print(f"  validation vs {validation['events']} reported events: Spearman(flooded share, events) = "
              f"{validation['spearman_events_vs_flooded_share']:.2f}; all candidates: scripts/run_validation.py")
    print(f"  top 5 priority: {', '.join(tab.adm4_en.head(5))}; done in {summary['runtime_s']} s", flush=True)
    return summary


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--city", default=data.DAGUPAN, help="adm3 pcode (default Dagupan), or 'all' to run the 12 cities in sequence")
    ap.add_argument("--scenario", default="25yr", choices=NOAH_SCENARIOS + list(RADAR_SCENARIOS),
                    help="NOAH return period, or a radar-observed flood (egay, Dagupan only)")
    ap.add_argument("--radar-method", default="threshold", choices=["threshold", "otsu", "unet"],
                    help="which run_s1_flood.py mask to use for a radar scenario (default: before/after change threshold)")
    ap.add_argument("--radar-level", default="med", choices=list(flood.RADAR_LEVELS),
                    help="hazard level given to radar-flooded area, which has no depth (med: roads slowed, not closed)")
    ap.add_argument("--k", type=int, nargs="+", default=[3, 5, 8])
    ap.add_argument("--limit-min", type=float, default=access.WALK_LIMIT_MIN)
    ap.add_argument("--scope", default="auto", choices=["auto", "full", "flooded"],
                    help="walk-graph extent: whole city, or flooded barangays plus a 2 km buffer; "
                         "auto starts with the flooded scope for cities over 400 km2 and falls back to the other on failure")
    args = ap.parse_args()
    for c in cities.resolve(args.city):
        try:
            run_city(c, args.scenario, args.k, args.limit_min, args.scope, args.radar_method, args.radar_level)
        except Exception as e:  # noqa: BLE001  one city must not block the others
            print(f"[{c}] FAILED: {type(e).__name__}: {e}", flush=True)
            if args.city.lower() != "all":
                raise


if __name__ == "__main__":
    main()
