"""Load and clean inputs from Project CCHAIN (Thinking Machines, CC BY 4.0).

All loaders take a city code (PSGC adm3 pcode). Dagupan City is PH015518000.
Raw tables live in data/raw/cchain/ (see data/README.md).
"""

from __future__ import annotations

from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely import wkt

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw" / "cchain"
PROCESSED = ROOT / "data" / "processed"

DAGUPAN = "PH015518000"
CRS_METRIC = "EPSG:32651"  # UTM zone 51N, metres


def _city_prefix(city: str) -> str:
    # adm4 codes share the first 8 characters of the city's adm3 code
    return city[:8]


def barangays(city: str = DAGUPAN, raw: Path = RAW) -> gpd.GeoDataFrame:
    """Barangay names, codes, boundaries and area (km2), in WGS84."""
    loc = pd.read_csv(raw / "location.csv")
    loc = loc[loc.adm3_pcode == city][["adm4_pcode", "adm4_en", "brgy_total_area"]]
    geo = pd.read_csv(raw / "brgy_geography.csv", usecols=["adm4_pcode", "brgy_is_coastal", "geometry"])
    df = loc.merge(geo, on="adm4_pcode", how="left")
    df["geometry"] = df.geometry.apply(wkt.loads)
    return gpd.GeoDataFrame(df, geometry="geometry", crs="EPSG:4326").reset_index(drop=True)


def population(city: str = DAGUPAN, year: int | None = None, raw: Path = RAW) -> pd.Series:
    """WorldPop residents per barangay for one year (latest available by default)."""
    wp = pd.read_csv(raw / "worldpop_population.csv", usecols=["adm4_pcode", "date", "pop_count_total"])
    wp = wp[wp.adm4_pcode.str.startswith(_city_prefix(city))]
    wp["year"] = wp.date.str[:4].astype(int)
    year = year or int(wp.year.max())
    return wp[wp.year == year].set_index("adm4_pcode").pop_count_total.rename("population")


def flood_hazard(city: str = DAGUPAN, raw: Path = RAW) -> pd.DataFrame:
    """UP NOAH flood hazard: percent of each barangay's area in each
    (return period, hazard level) class, e.g. column '25yr_med'."""
    hz = pd.read_csv(raw / "project_noah_hazards.csv")
    hz = hz[hz.adm4_pcode.str.startswith(_city_prefix(city))].set_index("adm4_pcode")
    cols = [c for c in hz.columns if c.startswith("pct_area_flood_hazard_")]
    return hz[cols].rename(columns=lambda c: c.replace("pct_area_flood_hazard_", ""))


def weekly_cases(city: str = DAGUPAN, disease: str = "LEPTOSPIROSIS", raw: Path = RAW) -> pd.Series:
    """Weekly PIDSR case counts for one city, indexed by week start (Monday).
    Missing weeks inside the reporting period are filled with 0."""
    df = pd.read_csv(raw / "disease_pidsr_totals.csv", usecols=["date", "adm3_pcode", "disease_common_name", "case_total"])
    df = df[(df.adm3_pcode == city) & df.disease_common_name.str.contains(disease, case=False)]
    s = df.groupby(pd.to_datetime(df.date)).case_total.sum()
    s.index = s.index.to_period("W-SUN").start_time
    s = s.groupby(level=0).sum()
    full = pd.date_range(s.index.min(), s.index.max(), freq="W-MON")
    return s.reindex(full, fill_value=0).rename("cases")


def weekly_rainfall(city: str = DAGUPAN, raw: Path = RAW, cache: Path = PROCESSED) -> pd.DataFrame:
    """Weekly total rainfall (mm) per barangay, plus a 'city' column (barangay mean).

    climate_atmosphere.csv is 570 MB, so the city's rows are read in chunks once
    and cached to data/processed/.
    """
    out = cache / f"rain_weekly_{city}.csv"
    if out.exists():
        return pd.read_csv(out, index_col=0, parse_dates=True)

    prefix = _city_prefix(city)
    parts = []
    for chunk in pd.read_csv(raw / "climate_atmosphere.csv", usecols=["adm4_pcode", "date", "pr"], chunksize=2_000_000):
        parts.append(chunk[chunk.adm4_pcode.str.startswith(prefix)])
    daily = pd.concat(parts)
    daily["week"] = pd.to_datetime(daily.date).dt.to_period("W-SUN").dt.start_time
    wide = daily.pivot_table(index="week", columns="adm4_pcode", values="pr", aggfunc="sum")
    wide["city"] = wide.mean(axis=1)
    cache.mkdir(parents=True, exist_ok=True)
    wide.to_csv(out)
    return wide
