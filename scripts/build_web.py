"""Publish results into web/data/ (GitHub Pages serves web/ only).

    uv run python scripts/build_web.py               # build web/data/ from results/
    uv run python scripts/build_web.py --prune-flat  # also remove old flat web/data files the page no longer mentions

Contract (the web page reads exactly this):
  web/data/cities.json      list of per-city summary rows
  web/data/national.json    totals across cities, pooled alert result
  web/data/manifest.json    {"files": [paths relative to web/data]}
  web/data/<code>/barangays.geojson, dose_points.geojson, summary.json, alert_scores.json,
                  alert_predictions.csv (evaluated cities only), s1_flood.geojson (Dagupan, only if present)
"""

import argparse
import json
import shutil
from pathlib import Path

import geopandas as gpd
import pandas as pd

from lambat import cities, data

ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT / "results"
DATA = ROOT / "web" / "data"
SCENARIO = "25yr"  # preferred; cities.effective_scenario may pick the 100yr map instead
BARANGAY_PROPS = ["adm4_pcode", "adm4_en", "population", "exposed", "flooded_share", "exposed_unreached_flood",
                  "weekly_capsules", "priority", "exposed_low", "exposed_med", "exposed_high",
                  "reach_after_3", "reach_after_5", "reach_after_8", "cut_off_after_3", "cut_off_after_5", "cut_off_after_8"]
LEGACY_FLAT = ["alert_predictions_dagupan.csv", "alert_scores_dagupan.json", "barangays_25yr.geojson",
               "dose_points_25yr.geojson", "summary_25yr.json", "s1_egay_flood.geojson"]


def _write_json(path: Path, obj) -> None:
    path.write_text(json.dumps(obj, indent=2, allow_nan=False))


def build_city(code: str, loc: pd.DataFrame) -> dict | None:
    src = RESULTS / code
    scen = cities.effective_scenario(data.flood_hazard(code), SCENARIO)
    summ_path = src / f"summary_{scen}.json"
    if not summ_path.exists():
        print(f"{code}: no results, skipped")
        return None
    out = DATA / code
    out.mkdir(parents=True, exist_ok=True)
    summary = json.loads(summ_path.read_text())

    gdf = gpd.read_file(src / f"barangays_{scen}.geojson")
    fc, tol = cities.fit_size(gdf, BARANGAY_PROPS)
    (out / "barangays.geojson").write_text(json.dumps(fc, separators=(",", ":")))
    shutil.copyfile(src / f"dose_points_{scen}.geojson", out / "dose_points.geojson")  # every site in the 3, 5 and 8 plans
    summary["scenario"] = scen
    summary["scenario_note"] = cities.SCENARIO_NOTE_100YR if scen != SCENARIO else None
    _write_json(out / "summary.json", cities.sanitize(summary))

    alert_path = src / "alert_scores.json"
    scores = json.loads(alert_path.read_text()) if alert_path.exists() else None
    if scores is not None:
        _write_json(out / "alert_scores.json", cities.sanitize(scores))
    pred_path = src / "alert_predictions.csv"
    if pred_path.exists():
        pd.read_csv(pred_path)[["week", "actual", "rain_model", "seasonal"]].round(4).to_csv(
            out / "alert_predictions.csv", index=False)
    if code == data.DAGUPAN and (RESULTS / "s1_egay_flood.geojson").exists():
        shutil.copyfile(RESULTS / "s1_egay_flood.geojson", out / "s1_flood.geojson")

    lon, lat, bbox = cities.centroid_bbox(data.barangays(code))
    row = loc[loc.adm3_pcode == code].iloc[0]
    pop = summary["population"]
    gap = summary["exposed_access_gap"]
    row_out = {
        "code": code,
        "name": cities.CITIES[code],
        "region": row.adm1_en,
        "province": row.adm2_en,
        "lon": lon,
        "lat": lat,
        "bbox": bbox,
        "barangays": summary["barangays"],
        "population": round(pop),
        "exposed": round(summary["exposed"]),
        "exposed_share": round(summary["exposed"] / pop, 4) if pop else None,
        "weekly_capsules": round(summary["weekly_capsules"]),
        "lepto_cases_2008_2022": int(data.weekly_cases(code).sum()),
        "access_gap": round(gap) if gap is not None else None,
        "coverage_after": cities.coverage_after(summary),
        "alert": cities.alert_block(scores),
        "scenario": scen,
        "scenario_note": summary["scenario_note"],
        "steps": summary["steps"],
    }
    size = (out / "barangays.geojson").stat().st_size / 1e6
    print(f"{code} {row_out['name']}: simplify={tol}, barangays.geojson {size:.2f} MB")
    return row_out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--prune-flat", action="store_true",
                    help="remove the old flat web/data files that web/index.html no longer mentions")
    args = ap.parse_args()
    DATA.mkdir(parents=True, exist_ok=True)
    loc = pd.read_csv(data.RAW / "location.csv", usecols=["adm1_en", "adm2_en", "adm3_pcode"]).drop_duplicates("adm3_pcode")
    rows = [r for r in (build_city(c, loc) for c in cities.CITIES) if r]
    _write_json(DATA / "cities.json", rows)

    pooled_path = RESULTS / "pooled_alert_scores.json"
    pooled = cities.sanitize(json.loads(pooled_path.read_text())) if pooled_path.exists() else None

    def totals(rs: list[dict]) -> dict:
        with_access = [r for r in rs if r["access_gap"] is not None]
        return {
            "cities": len(rs),
            "city_codes": [r["code"] for r in rs],
            "barangays": sum(r["barangays"] for r in rs),
            "population": sum(r["population"] for r in rs),
            "exposed": sum(r["exposed"] for r in rs),
            "weekly_capsules": sum(r["weekly_capsules"] for r in rs),
            "lepto_cases_2008_2022": sum(r["lepto_cases_2008_2022"] for r in rs),
            "cities_with_access": len(with_access),
            "access_gap": sum(r["access_gap"] for r in with_access),
            "alert_cities_evaluated": sum(r["alert"]["status"] == "evaluated" for r in rs),
        }

    # Never add two flood sizes together: 25-year cities and 100-year fallback cities are totalled apart.
    r25 = [r for r in rows if r["scenario"] == SCENARIO]
    r100 = [r for r in rows if r["scenario"] != SCENARIO]
    national = {
        "scenario": SCENARIO,
        **totals(r25),
        "cities_100yr": {"scenario": "100yr", "note": cities.SCENARIO_NOTE_100YR, **totals(r100)},
        "pooled_alert": pooled,
        "note": "Totals cover the 25-year cities only. Cities with no 25-year flood map are listed under "
                "cities_100yr and use the larger 100-year flood, so the two are never summed. "
                "Access figures cover only cities where the access step ran (see each city's steps). "
                "News-report validation exists for Dagupan only.",
    }
    _write_json(DATA / "national.json", national)

    if args.prune_flat:
        page = (ROOT / "web" / "index.html").read_text(encoding="utf-8")
        for name in cities.unreferenced(page, LEGACY_FLAT):
            (DATA / name).unlink(missing_ok=True)
            print(f"removed flat {name}")
    files = sorted(p.relative_to(DATA).as_posix() for p in DATA.rglob("*") if p.is_file() and p.name != "manifest.json")
    _write_json(DATA / "manifest.json", {"files": files})
    print(f"wrote cities.json ({len(rows)} cities), national.json, manifest.json ({len(files)} files)")


if __name__ == "__main__":
    main()
