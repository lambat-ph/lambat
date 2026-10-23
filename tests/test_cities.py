"""Multi-city helpers: scope selection, web GeoJSON, alert blocks, pooled alert. No network."""

import json

import geopandas as gpd
import numpy as np
import pandas as pd
import pytest
from shapely.geometry import Polygon, box

from lambat import alert, cities


def _grid(n=5, size=0.01, lon0=121.0, lat0=14.0):
    codes = [f"B{i}" for i in range(n)]
    geoms = [box(lon0 + i * size, lat0, lon0 + (i + 1) * size, lat0 + size) for i in range(n)]
    return gpd.GeoDataFrame({"adm4_pcode": codes, "adm4_en": codes}, geometry=geoms, crs="EPSG:4326")


def _hazard(codes, flooded):
    h = pd.DataFrame(0.0, index=codes, columns=[f"25yr_{k}" for k in ("low", "med", "high")])
    for c in flooded:
        h.loc[c, "25yr_low"] = 40.0
    return h


def test_resolve_and_utm():
    assert len(cities.resolve("all")) == 12
    assert cities.resolve("PH015518000") == ["PH015518000"]
    with pytest.raises(SystemExit):
        cities.resolve("PH000000000")
    assert cities.in_utm51((120.31, 16.0, 120.39, 16.1))
    assert not cities.in_utm51((119.5, 10.0, 121.0, 11.0))


def test_flooded_scope_keeps_flooded_and_nearby_only():
    g = _grid(5)  # each cell ~1.1 km wide
    hz = _hazard(g.adm4_pcode, ["B0"])
    near = cities.flooded_scope(g, hz, buffer_m=1500)
    assert set(near.adm4_pcode) == {"B0", "B1", "B2"}  # B2 starts ~1.1 km from B0, inside 1.5 km; B3 is outside
    tight = cities.flooded_scope(g, hz, buffer_m=100)
    assert set(tight.adm4_pcode) == {"B0", "B1"}  # B1 touches B0, so it intersects any buffer
    assert cities.flooded_scope(g, _hazard(g.adm4_pcode, []), buffer_m=1500).empty


def test_flooded_scope_far_barangay_excluded():
    g = _grid(5, size=0.05)  # ~5.4 km cells
    hz = _hazard(g.adm4_pcode, ["B0"])
    assert set(cities.flooded_scope(g, hz, buffer_m=2000).adm4_pcode) == {"B0", "B1"}


def test_centroid_bbox():
    lon, lat, bbox = cities.centroid_bbox(_grid(2))
    assert 121.0 < lon < 121.02 and 14.0 < lat < 14.01
    assert bbox == [121.0, 14.0, 121.02, 14.01]


def test_web_geojson_rounds_and_nulls():
    poly = Polygon([(121.123456789, 14.0), (121.2, 14.0), (121.2, 14.1), (121.123456789, 14.1)])
    g = gpd.GeoDataFrame({"a": [1.23456], "b": [np.nan], "c": [np.int64(3)], "x": ["skip"]}, geometry=[poly], crs="EPSG:4326")
    fc = cities.web_geojson(g, ["a", "b", "c", "missing"])
    f = fc["features"][0]
    assert f["properties"] == {"a": 1.23, "b": None, "c": 3, "missing": None}
    assert f["geometry"]["coordinates"][0][0] == [121.12346, 14.0]
    json.dumps(fc, allow_nan=False)  # must be valid JSON


def test_web_geojson_simplify_drops_vertices():
    xs = np.linspace(0, 0.1, 200)
    ring = [(121 + x, 14 + 1e-6 * np.sin(x * 500)) for x in xs] + [(121.1, 14.1), (121, 14.1)]
    g = gpd.GeoDataFrame({"a": [1]}, geometry=[Polygon(ring)], crs="EPSG:4326")
    full = cities.web_geojson(g, ["a"])
    small = cities.web_geojson(g, ["a"], simplify_deg=0.0002)
    assert len(small["features"][0]["geometry"]["coordinates"][0]) < len(full["features"][0]["geometry"]["coordinates"][0])


def test_fit_size_only_simplifies_when_over_limit():
    g = _grid(3)
    fc, tol = cities.fit_size(g, ["adm4_pcode"], limit_bytes=10**6)
    assert tol is None and len(fc["features"]) == 3
    _, tol = cities.fit_size(g, ["adm4_pcode"], limit_bytes=10)
    assert tol == 0.001  # nothing fits, so the last tolerance is used


def test_sanitize_and_clean_value():
    assert cities.sanitize({"a": [float("nan"), 1.5, np.float64("inf")], "b": np.int64(2)}) == {"a": [None, 1.5, None], "b": 2}


def test_alert_block():
    scores = {"status": "evaluated", "scores": [
        {"method": "seasonal", "correlation": 0.5, "sensitivity": 0.2, "false_alert_rate": 0.07},
        {"method": "rain_model", "correlation": 0.65, "sensitivity": float("nan"), "false_alert_rate": 0.02},
    ]}
    b = cities.alert_block(scores)
    assert b == {"status": "evaluated", "correlation": 0.65, "caught": None, "false_alerts": 0.02, "baseline_correlation": 0.5}
    few = cities.alert_block({"status": "too_few_cases", "total_cases": 12})
    assert few["status"] == "too_few_cases" and few["correlation"] is None
    assert cities.alert_block(None)["status"] == "too_few_cases"


def test_coverage_after():
    s = {"steps": {"access": True}, "dose_point_plans": {
        "3": {"share_of_exposed_within_reach_after": 0.9}, "5": {"share_of_exposed_within_reach_after": 0.95},
        "8": {"share_of_exposed_within_reach_after": 0.97}}}
    assert cities.coverage_after(s) == {"3": 0.9, "5": 0.95, "8": 0.97}
    assert cities.coverage_after({**s, "steps": {"access": False}}) is None
    assert cities.coverage_after({"steps": {"access": True}, "dose_point_plans": {}}) is None


def test_unreferenced():
    assert cities.unreferenced("fetch('data/a.json')", ["a.json", "b.json"]) == ["b.json"]


def _weekly(seed, scale, n_years=12):
    rng = np.random.default_rng(seed)
    idx = pd.date_range("2008-01-07", periods=52 * n_years, freq="W-MON")
    rain = pd.Series(rng.gamma(2.0, 20.0, len(idx)), index=idx)
    mu = scale * np.exp(0.02 * np.log1p(rain.shift(3).fillna(0)) * 10 - 1)
    return pd.Series(rng.poisson(mu), index=idx, name="cases"), rain


def test_evaluate_pooled_shapes():
    cases, rain = {}, {}
    for i, c in enumerate(["A", "B", "C"]):
        cases[c], rain[c] = _weekly(i, 1 + 2 * i)
    res = alert.evaluate_pooled(cases, rain)
    assert res["cities"] == ["A", "B", "C"]
    assert {s["method"] for s in res["scores"]} == {"seasonal", "last_week", "rain_model"}
    preds = res["predictions"]
    assert set(preds.city) == {"A", "B", "C"}
    assert preds.index.year.min() >= 2017 and preds.index.year.max() <= 2019
    for s in res["scores"]:
        assert -1 <= s["correlation"] <= 1 and s["outbreak_weeks"] > 0


def test_dose_point_collection_has_every_plan_site():
    from types import SimpleNamespace as NS

    sites = gpd.GeoDataFrame(
        {"id": ["a", "b", "c", "d"], "name": list("ABCD"), "kind": ["school"] * 4},
        geometry=gpd.points_from_xy([121.0, 121.1, 121.2, 121.3], [14.0] * 4), crs="EPSG:4326")
    plans = {3: NS(sites=["b", "a", "c"]), 5: NS(sites=["b", "a", "c", "d"]), 8: NS(sites=["d", "b", "a", "c"])}
    fc = cities.dose_point_collection(sites, plans)
    props = {f["properties"]["id"]: f["properties"] for f in fc["features"]}
    assert set(props) == {"a", "b", "c", "d"}
    assert props["d"]["plans"] == [5, 8] and props["d"]["rank_in_plan"] == {"5": 4, "8": 1}
    assert props["b"]["plans"] == [3, 5, 8] and props["b"]["rank_in_plan"] == {"3": 1, "5": 1, "8": 2}
    assert props["a"]["rank"] == 3
    assert cities.dose_point_collection(sites, {})["features"] == []
    only3 = cities.dose_point_collection(sites, {3: NS(sites=["a"])})
    assert only3["features"][0]["properties"]["rank"] == 1
