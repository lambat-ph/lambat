"""Export UP NOAH flood hazard polygons as a light map layer (visual only).

    uv run python scripts/export_noah_layer.py

For every city whose province shapefile is in data/raw/noah_polygons/<province>_<scn>/,
clips the polygons to the city, merges them by hazard level (Var 1/2/3), simplifies them
(about 5 m) and writes web/data/<city>/noah_flood_<scn>.geojson, plus
web/data/noah_index.json listing what exists. The numbers on the site are unchanged:
they come from the same NOAH maps summed per barangay (Project CCHAIN), see
scripts/check_noah_polygons.py. Data: UP NOAH flood hazard maps, ODbL.
"""

from __future__ import annotations

import json
from pathlib import Path

import geopandas as gpd
from shapely import make_valid

from lambat import cities, data

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "noah_polygons"
WEB = ROOT / "web" / "data"
# city -> NOAH province file prefix (only cities whose province files have been downloaded are exported)
PROVINCE = {"PH015518000": ("pangasinan", "PH015500000")}
SCENARIOS = ("5yr", "25yr", "100yr")
TOL_DEG = 0.0001  # about 10 m: NOAH polygons are built from raster cells, invisible at city zoom


def export(city: str, scn: str) -> Path | None:
    prov, code = PROVINCE[city]
    shp = RAW / f"{prov}_{scn}" / prov.capitalize() / f"{code}_FH_{scn}.shp"
    if not shp.exists():
        return None
    area = data.barangays(city).to_crs(4326).union_all()
    fh = gpd.read_file(shp, bbox=tuple(area.bounds)).to_crs(4326)
    fh["geometry"] = fh.geometry.apply(make_valid)
    fh = gpd.clip(fh[fh.geometry.notna() & ~fh.geometry.is_empty], area)
    fh["Var"] = fh["Var"].astype(int)
    out = fh.dissolve(by="Var").reset_index()[["Var", "geometry"]]
    out["geometry"] = out.geometry.simplify(TOL_DEG, preserve_topology=True)
    out = out.rename(columns={"Var": "level"})
    path = WEB / city / f"noah_flood_{scn}.geojson"
    path.write_text(out.to_json(drop_id=True, to_wgs84=True))
    # trim coordinates to 5 decimals (about 1 m) to keep the file small
    gj = json.loads(path.read_text())

    def rnd(c):
        return [round(c[0], 5), round(c[1], 5)] if isinstance(c[0], float) else [rnd(x) for x in c]

    for f in gj["features"]:
        f["geometry"]["coordinates"] = rnd(f["geometry"]["coordinates"])
    path.write_text(json.dumps(gj, separators=(",", ":")))
    print(f"[{city} {scn}] {path.relative_to(ROOT)} {path.stat().st_size / 1e6:.2f} MB")
    return path


def main() -> None:
    idx: dict[str, list[str]] = {}
    for city in cities.CITIES:
        if city not in PROVINCE:
            continue
        for scn in SCENARIOS:
            if export(city, scn):
                idx.setdefault(city, []).append(scn.replace("yr", ""))
    (WEB / "noah_index.json").write_text(json.dumps(idx, indent=1))
    print("noah index:", idx)


if __name__ == "__main__":
    main()
