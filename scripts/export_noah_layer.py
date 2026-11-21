"""Export UP NOAH flood hazard polygons as a light map layer (visual only).

    uv run python scripts/export_noah_layer.py                    # every city, every scenario on disk
    uv run python scripts/export_noah_layer.py --city PH015518000
    uv run python scripts/export_noah_layer.py --index-only       # rebuild web/data/noah_index.json

For each city, reads the province shapefile(s) in data/raw/noah_polygons/<province>_<scn>/,
clips them to the city, merges them by hazard level (Var 1/2/3), simplifies them (about
10 m; NOAH's polygons are built from raster cells) and writes
web/data/<city>/noah_flood_<scn>.geojson. web/data/noah_index.json lists what exists.
The numbers on the site are unchanged: they come from the same NOAH maps summed per
barangay (Project CCHAIN), see scripts/check_noah_polygons.py.
Data: UP NOAH flood hazard maps (ODbL), via huggingface.co/datasets/bettergovph/project-noah-hazard-maps.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely import make_valid
from shapely.ops import unary_union

from lambat import cities, data

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "noah_polygons"
WEB = ROOT / "web" / "data"
# city -> NOAH province folder keys (folders are <key>_<scenario>)
PROVINCE = {
    "PH015518000": ["pangasinan"], "PH034919000": ["nuevaecija"], "PH050506000": ["albay"],
    "PH063022000": ["iloilo"], "PH072230000": ["cebu"], "PH083747000": ["leyte"],
    "PH097332000": ["zamboangadelsur"], "PH104305000": ["misamisoriental_a", "misamisoriental_b"],
    "PH112402000": ["davaodelsur"], "PH137401000": ["metromanila"], "PH137503000": ["metromanila"],
    "PH137603000": ["metromanila"],
    **{c: ["metromanila"] for c in cities.EXTRA},
}
SCENARIOS = ("5yr", "25yr", "100yr")
TOLS = (0.0001, 0.0002, 0.0004, 0.0008)  # about 10 to 80 m; NOAH polygons are built from raster cells
MIN_M2 = 1000.0  # drop flood specks smaller than this
MAX_BYTES = 2_500_000


def rnd(c):
    return [round(c[0], 5), round(c[1], 5)] if isinstance(c[0], float) else [rnd(x) for x in c]


def export(city: str, scn: str) -> Path | None:
    shps = [p for key in PROVINCE[city] for p in sorted((RAW / f"{key}_{scn}").rglob("*.shp"))]
    if not shps:
        return None
    area = data.barangays(city).to_crs(4326).union_all()
    parts = []
    for shp in shps:
        fh = gpd.read_file(shp, bbox=tuple(area.bounds))
        if fh.empty:
            continue
        fh = fh.to_crs(4326)
        fh = fh[fh.geometry.notna() & ~fh.geometry.is_empty & fh.intersects(area)]
        if fh.empty:
            continue
        fh["geometry"] = fh.geometry.apply(make_valid)
        parts.append(gpd.clip(fh, area)[["Var", "geometry"]])
    if not parts:
        print(f"[{city} {scn}] no NOAH polygons inside the city in {[s.name for s in shps]}", flush=True)
        return None
    fh = gpd.GeoDataFrame(pd.concat(parts, ignore_index=True), crs=4326)
    fh["Var"] = fh["Var"].astype(int)
    # Clipping can leave lines and points beside the polygons: keep polygon parts only, and drop
    # specks under MIN_M2 (single raster cells), which are invisible at city zoom.
    fh = fh.explode(index_parts=False)
    fh = fh[fh.geom_type == "Polygon"]
    fh = fh[fh.to_crs(data.CRS_METRIC).area >= MIN_M2]
    merged = fh.dissolve(by="Var").reset_index()[["Var", "geometry"]].rename(columns={"Var": "level"})
    path = WEB / city / f"noah_flood_{scn}.geojson"
    path.parent.mkdir(parents=True, exist_ok=True)
    for tol in TOLS:  # simplify more strongly until the file is light enough for the browser
        out = merged.copy()
        out["geometry"] = out.geometry.simplify(tol, preserve_topology=True).apply(polygonal)
        out = out[out.geometry.notna() & ~out.geometry.is_empty]
        gj = json.loads(out.to_json(drop_id=True))
        for f in gj["features"]:
            f["geometry"]["coordinates"] = rnd(f["geometry"]["coordinates"])
        txt = json.dumps(gj, separators=(",", ":"))
        if len(txt) <= MAX_BYTES:
            break
    path.write_text(txt)
    print(f"[{city} {scn}] {path.relative_to(ROOT)} {path.stat().st_size / 1e6:.2f} MB, tolerance {tol}", flush=True)
    return path


def polygonal(g):
    """Polygon parts of a geometry as one (Multi)Polygon, or None."""
    parts = [p for p in getattr(g, "geoms", [g]) if p.geom_type in ("Polygon", "MultiPolygon")]
    if not parts:
        return None
    return parts[0] if len(parts) == 1 else unary_union(parts)


def write_index() -> dict:
    idx = {c: [s.replace("yr", "") for s in SCENARIOS if (WEB / c / f"noah_flood_{s}.geojson").exists()] for c in cities.MAP_CITIES}
    idx = {c: v for c, v in idx.items() if v}
    (WEB / "noah_index.json").write_text(json.dumps(idx, indent=1))
    print("noah index:", idx, flush=True)
    return idx


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--city", default="all")
    ap.add_argument("--index-only", action="store_true")
    args = ap.parse_args()
    if not args.index_only:
        for city in cities.resolve(args.city):
            for scn in SCENARIOS:
                export(city, scn)
    write_index()


if __name__ == "__main__":
    main()
