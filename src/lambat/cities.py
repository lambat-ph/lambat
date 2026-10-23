"""The 12 Project CCHAIN cities and helpers shared by the run and web-build scripts.

Codes are PSGC adm3 pcodes. All 12 cities lie between 120 and 126 degrees east, so
UTM zone 51N (EPSG:32651, see data.CRS_METRIC) is valid for every one of them.
"""

from __future__ import annotations

import geopandas as gpd
import numpy as np
import pandas as pd

from . import data

CITIES: dict[str, str] = {
    "PH015518000": "Dagupan City",
    "PH034919000": "Palayan City",
    "PH050506000": "Legazpi City",
    "PH063022000": "Iloilo City",
    "PH072230000": "Mandaue City",
    "PH083747000": "Tacloban City",
    "PH097332000": "Zamboanga City",
    "PH104305000": "Cagayan de Oro City",
    "PH112402000": "Davao City",
    "PH137401000": "City of Mandaluyong",
    "PH137503000": "City of Navotas",
    "PH137603000": "City of Muntinlupa",
}

MIN_CASES_FOR_ALERT = 100
UTM51_LON = (120.0, 126.0)


def resolve(arg: str) -> list[str]:
    """'all' -> every city code; otherwise one code (must be a known city)."""
    if arg.lower() == "all":
        return list(CITIES)
    if arg not in CITIES:
        raise SystemExit(f"unknown city {arg}; known: {', '.join(CITIES)}")
    return [arg]


def in_utm51(bounds) -> bool:
    """True if a (minx, miny, maxx, maxy) lon/lat box is inside the UTM 51N zone."""
    return bool(bounds[0] >= UTM51_LON[0] and bounds[2] <= UTM51_LON[1])


def flooded_scope(brgy: gpd.GeoDataFrame, hazard: pd.DataFrame, scenario: str = "25yr",
                  buffer_m: float = 2000.0) -> gpd.GeoDataFrame:
    """Barangays with NOAH flood hazard > 0, plus every barangay touching a buffer_m
    ring around them. Used to keep the walk graph small in very large cities.
    Returns an empty frame when nothing floods."""
    cols = [f"{scenario}_{k}" for k in ("low", "med", "high")]
    share = hazard[cols].fillna(0.0).sum(axis=1).reindex(brgy.adm4_pcode).fillna(0.0).to_numpy()
    flooded = share > 0
    if not flooded.any():
        return brgy.iloc[0:0]
    metric = brgy.to_crs(data.CRS_METRIC)
    ring = metric.geometry[flooded].union_all().buffer(buffer_m)
    keep = metric.geometry.intersects(ring).to_numpy() | flooded
    return brgy[keep].reset_index(drop=True)


def centroid_bbox(brgy: gpd.GeoDataFrame) -> tuple[float, float, list[float]]:
    """(lon, lat, [w, s, e, n]) of a barangay set; centroid taken in UTM 51N."""
    c = brgy.to_crs(data.CRS_METRIC).union_all().centroid
    pt = gpd.GeoSeries([c], crs=data.CRS_METRIC).to_crs("EPSG:4326").iloc[0]
    w, s, e, n = brgy.total_bounds
    return round(float(pt.x), 5), round(float(pt.y), 5), [round(float(v), 5) for v in (w, s, e, n)]


def _round_coords(obj, nd: int):
    if isinstance(obj, (list, tuple)):
        if obj and isinstance(obj[0], (int, float)):
            return [round(float(v), nd) for v in obj]
        return [_round_coords(o, nd) for o in obj]
    return obj


def clean_value(v):
    """JSON-safe scalar: NaN/inf -> None, numpy scalars -> python."""
    if v is None:
        return None
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating, float)):
        return None if not np.isfinite(v) else float(v)
    return v


def web_geojson(gdf: gpd.GeoDataFrame, props: list[str], simplify_deg: float | None = None,
                nd: int = 5, round_props: int | None = 2) -> dict:
    """GeoJSON dict (EPSG:4326) with only `props`, NaN as null, coordinates to `nd`
    decimals, geometries optionally simplified (topology preserved)."""
    g = gdf.to_crs("EPSG:4326")
    feats = []
    for _, row in g.iterrows():
        geom = row.geometry
        if simplify_deg:
            geom = geom.simplify(simplify_deg, preserve_topology=True)
        gj = geom.__geo_interface__
        gj = {"type": gj["type"], "coordinates": _round_coords(gj["coordinates"], nd)}
        p = {}
        for k in props:
            v = clean_value(row[k]) if k in row else None
            if isinstance(v, float) and round_props is not None:
                v = round(v, round_props)
            p[k] = v
        feats.append({"type": "Feature", "properties": p, "geometry": gj})
    return {"type": "FeatureCollection", "features": feats}


def alert_block(scores: dict | None) -> dict:
    """Alert entry for cities.json from a city's alert_scores.json content."""
    empty = {"correlation": None, "caught": None, "false_alerts": None, "baseline_correlation": None}
    if not scores or scores.get("status") != "evaluated":
        return {"status": "too_few_cases", **empty}
    by = {s["method"]: s for s in scores["scores"]}
    rain, seas = by["rain_model"], by["seasonal"]
    return {
        "status": "evaluated",
        "correlation": clean_value(rain["correlation"]),
        "caught": clean_value(rain["sensitivity"]),
        "false_alerts": clean_value(rain["false_alert_rate"]),
        "baseline_correlation": clean_value(seas["correlation"]),
    }


def coverage_after(summary: dict) -> dict | None:
    """{"3": share, "5": share, "8": share} of exposed within reach after k dose points, or None."""
    plans = summary.get("dose_point_plans") or {}
    if not summary.get("steps", {}).get("access") or not plans:
        return None
    return {k: clean_value(plans[k]["share_of_exposed_within_reach_after"]) for k in ("3", "5", "8") if k in plans}


def fit_size(gdf: gpd.GeoDataFrame, props: list[str], limit_bytes: int = 1_500_000,
             steps: tuple[float, ...] = (0.0002, 0.0005, 0.001)) -> tuple[dict, float | None]:
    """web_geojson, simplified only as far as needed to stay under limit_bytes.
    Returns (geojson dict, simplify tolerance used or None)."""
    import json

    fc = web_geojson(gdf, props)
    if len(json.dumps(fc, separators=(",", ":"))) <= limit_bytes:
        return fc, None
    for tol in steps:
        fc = web_geojson(gdf, props, simplify_deg=tol)
        if len(json.dumps(fc, separators=(",", ":"))) <= limit_bytes:
            return fc, tol
    return fc, steps[-1]


def unreferenced(index_text: str, names: list[str]) -> list[str]:
    """File names that the page text never mentions; safe to delete."""
    return [n for n in names if n not in index_text]


def sanitize(obj):
    """Recursively replace NaN/inf with None so the result is valid JSON for browsers."""
    if isinstance(obj, dict):
        return {k: sanitize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [sanitize(v) for v in obj]
    return clean_value(obj)


def dose_point_collection(candidates: gpd.GeoDataFrame | None, plans: dict) -> dict:
    """GeoJSON (EPSG:4326) of every site used by any plan.

    plans maps k -> an object with .sites (site ids in the order the solver listed them).
    Properties: id, name, kind, rank (position in the largest plan, else null),
    plans (sorted list of k values whose plan includes the site) and
    rank_in_plan ({"3": 1, ...}, keys only for plans that include it).
    """
    empty = {"type": "FeatureCollection", "features": []}
    if candidates is None or not plans:
        return empty
    ks = sorted(plans, key=int)
    used = {s for r in plans.values() for s in r.sites}
    sub = candidates[candidates.id.isin(used)]
    if sub.empty:
        return empty
    sub = sub.to_crs("EPSG:4326")
    feats = []
    for _, row in sub.iterrows():
        rip = {str(k): plans[k].sites.index(row.id) + 1 for k in ks if row.id in plans[k].sites}
        feats.append({
            "type": "Feature",
            "properties": {"id": row.id, "name": row["name"], "kind": row.kind,
                           "rank": rip.get(str(ks[-1])), "plans": sorted(int(k) for k in rip), "rank_in_plan": rip},
            "geometry": {"type": "Point", "coordinates": [round(float(row.geometry.x), 5), round(float(row.geometry.y), 5)]},
        })
    feats.sort(key=lambda f: (f["properties"]["rank"] is None, f["properties"]["rank"] or 0, f["properties"]["id"]))
    return {"type": "FeatureCollection", "features": feats}
