"""Input tables for cities outside Project CCHAIN (first: the rest of Metro Manila).

    uv run python scripts/build_extra_cities.py            # build data/raw/extra/*.csv
    uv run python scripts/build_extra_cities.py --check    # same method on 3 CCHAIN NCR cities vs CCHAIN

Writes data/raw/extra/{location,brgy_geography,worldpop_population,project_noah_hazards}.csv in
Project CCHAIN's own columns, so the pipeline reads them like CCHAIN's tables:
- barangays: PSA / OCHA administrative boundaries (HDX cod-ab-phl, CC BY-IGO), codes converted
  to CCHAIN's format (PH1307503001 -> PH137503001);
- population: WorldPop 2020 100 m (phl_ppp_2020.tif, CC BY 4.0) summed per barangay, the same
  source and year as CCHAIN's worldpop_population table;
- flood hazard: UP NOAH 5/25/100-year polygons (ODbL) as percent of barangay area per level,
  the same as CCHAIN's project_noah_hazards (CCHAIN's shares match the polygons exactly; see
  scripts/check_noah_polygons.py).
No case or rainfall data exists for these cities, so they get no outbreak forecast.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio
from rasterio.mask import mask
from shapely import make_valid

from lambat import cities, data

ROOT = Path(__file__).resolve().parents[1]
EXTRA = ROOT / "data" / "raw" / "extra"
GDB = EXTRA / "codab" / "phl_admin_boundaries.gdb"
TIF = EXTRA / "worldpop" / "phl_ppp_2020.tif"
NOAH = ROOT / "data" / "raw" / "noah_polygons"
SCN = ("5yr", "25yr", "100yr")
LEVELS = {1: "low", 2: "med", 3: "high"}


def cchain_code(p: str) -> str:
    """PSA/HDX pcode -> CCHAIN pcode: drop the leading zero of the 3-digit province part."""
    return "PH" + p[2:4] + p[5:]


def hdx_barangays(hdx_adm3: list[str]) -> gpd.GeoDataFrame:
    q = "adm3_pcode IN (" + ",".join(f"'{c}'" for c in hdx_adm3) + ")"
    g = gpd.read_file(GDB, layer="phl_admin4", where=q).to_crs(4326)
    g["geometry"] = g.geometry.apply(make_valid)
    g["adm4_cchain"] = g.adm4_pcode.map(cchain_code)
    g["adm3_cchain"] = g.adm3_pcode.map(lambda p: cchain_code(p) + "000")
    return g


def population(g: gpd.GeoDataFrame) -> pd.Series:
    out = {}
    with rasterio.open(TIF) as src:
        for code, geom in zip(g.adm4_cchain, g.geometry, strict=True):
            arr, _ = mask(src, [geom.__geo_interface__], crop=True, filled=True, nodata=0)
            a = arr[0].astype("float64")
            a[a < 0] = 0
            out[code] = float(a.sum())
    return pd.Series(out, name="pop_count_total")


def hazard(g: gpd.GeoDataFrame) -> pd.DataFrame:
    b = g[["adm4_cchain", "geometry"]].to_crs(data.CRS_METRIC)
    area = b.set_index("adm4_cchain").area
    cols = {}
    bounds = tuple(g.total_bounds)
    for scn in SCN:
        shps = sorted((NOAH / f"metromanila_{scn}").rglob("*.shp"))
        parts = [gpd.read_file(s, bbox=bounds) for s in shps]
        fh = gpd.GeoDataFrame(pd.concat(parts, ignore_index=True), crs=parts[0].crs).to_crs(data.CRS_METRIC)
        fh["geometry"] = fh.geometry.apply(make_valid)
        fh = fh[fh.geom_type.isin(["Polygon", "MultiPolygon", "GeometryCollection"])]
        inter = gpd.overlay(b, fh[["Var", "geometry"]], how="intersection", keep_geom_type=True)
        inter["a"] = inter.area
        for v, name in LEVELS.items():
            s = inter[inter.Var.astype(int) == v].groupby("adm4_cchain").a.sum()
            cols[f"pct_area_flood_hazard_{scn}_{name}"] = (s.reindex(area.index).fillna(0) / area * 100).round(4)
    return pd.DataFrame(cols)


def build(hdx_adm3: dict[str, str]) -> None:
    g = hdx_barangays(list(hdx_adm3))
    a1 = gpd.read_file(GDB, layer="phl_admin3", read_geometry=False)
    meta = a1.set_index("adm3_pcode")[["adm1_name", "adm2_name"]]
    g["adm1_en"] = g.adm3_pcode.map(meta.adm1_name)
    g["adm2_en"] = g.adm3_pcode.map(meta.adm2_name)
    g["brgy_total_area"] = g.to_crs(data.CRS_METRIC).area / 1e6
    loc = pd.DataFrame({"adm1_en": g.adm1_en, "adm2_en": g.adm2_en, "adm3_en": g.adm3_name,
                        "adm3_pcode": g.adm3_cchain, "adm4_en": g.adm4_name, "adm4_pcode": g.adm4_cchain,
                        "brgy_total_area": g.brgy_total_area.round(6)})
    geo = pd.DataFrame({"adm4_pcode": g.adm4_cchain, "brgy_is_coastal": np.nan, "geometry": g.geometry.to_wkt()})
    pop = population(g)
    wp = pd.DataFrame({"adm4_pcode": pop.index, "date": "2020-01-01", "freq": "Y", "pop_count_total": pop.values.round(4)})
    hz = hazard(g).reset_index().rename(columns={"index": "adm4_pcode", "adm4_cchain": "adm4_pcode"})
    EXTRA.mkdir(parents=True, exist_ok=True)
    loc.to_csv(EXTRA / "location.csv", index=False)
    geo.to_csv(EXTRA / "brgy_geography.csv", index=False)
    wp.to_csv(EXTRA / "worldpop_population.csv", index=False)
    hz.to_csv(EXTRA / "project_noah_hazards.csv", index=False)
    by = loc.assign(pop=loc.adm4_pcode.map(pop)).groupby("adm3_en").agg(barangays=("adm4_pcode", "size"), population=("pop", "sum"))
    print(by.round(0).to_string())


def check() -> None:
    """Same method on the three NCR cities CCHAIN covers; compare city totals with CCHAIN."""
    trio = {"PH1307401": "PH137401000", "PH1307503": "PH137503000", "PH1307603": "PH137603000"}
    g = hdx_barangays(list(trio))
    pop = population(g)
    hz = hazard(g)
    for h, c in trio.items():
        sel = g[g.adm3_pcode == h]
        mine_pop = float(pop.reindex(sel.adm4_cchain).sum())
        cc_pop = float(data.population(c).sum())
        a = sel.to_crs(data.CRS_METRIC).set_index("adm4_cchain").area
        mine_flood = float((hz.reindex(a.index)[[f"pct_area_flood_hazard_25yr_{v}" for v in LEVELS.values()]].sum(axis=1) * a).sum() / a.sum())
        ch = data.flood_hazard(c)
        cb = data.barangays(c).set_index("adm4_pcode").to_crs(data.CRS_METRIC).area
        cc_flood = float((ch.reindex(cb.index)[["25yr_low", "25yr_med", "25yr_high"]].fillna(0).sum(axis=1) * cb).sum() / cb.sum())
        print(f"{cities.CITIES[c]}: barangays PSA {len(sel)} vs CCHAIN {len(cb)} | population {mine_pop:,.0f} vs {cc_pop:,.0f} "
              f"({(mine_pop / cc_pop - 1) * 100:+.1f}%) | 25-year flooded area {mine_flood:.1f}% vs {cc_flood:.1f}%")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    if args.check:
        check()
    else:
        build({h: n for h, n in cities.NCR_EXTRA_HDX.items()})
