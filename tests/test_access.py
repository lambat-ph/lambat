from pathlib import Path

import networkx as nx
import numpy as np
import pandas as pd
import pytest

from lambat import access


def _line(n=5, length=100.0):
    G = nx.Graph()
    for i in range(n):
        G.add_node(i, x=i * length, y=0.0, lon=120.3 + i * 1e-3, lat=16.04, elevation=float(n - i))
    for i in range(n - 1):
        G.add_edge(i, i + 1, length=length)
    access.set_walk_time(G)
    return G


def test_walk_time():
    G = _line(2, 75.0)
    assert G[0][1]["minutes"] == pytest.approx(1.0)  # 75 m/min at 4.5 km/h


def test_apply_flood_slows_and_closes():
    G = _line(5)
    classes = pd.Series({0: 0, 1: 1, 2: 2, 3: 3, 4: 3})
    F = access.apply_flood(G, classes)
    base = G[0][1]["minutes"]
    assert F[0][1]["minutes"] == pytest.approx(base)          # min(0,1)=dry
    assert F[1][2]["minutes"] == pytest.approx(base / 0.6)    # min(1,2)=low
    assert F[2][3]["minutes"] == pytest.approx(base / 0.25)   # min(2,3)=med
    assert not F.has_edge(3, 4)                               # high-high closed
    assert G.has_edge(3, 4)                                   # original untouched
    assert G[1][2]["minutes"] == pytest.approx(base)


def test_apply_flood_custom_factors():
    G = _line(3)
    F = access.apply_flood(G, pd.Series({0: 1, 1: 1, 2: 1}), {1: 0.0})
    assert F.number_of_edges() == 0


def test_reach_sets_cutoff_and_exclude():
    G = _line(5)  # 100 m = 1.333 min per edge
    demand = pd.DataFrame({"node": [0, 2, 4]}, index=["a", "b", "c"])
    sites = pd.DataFrame({"id": ["s0", "s4"], "node": [0, 4]})
    r = access.reach_sets(G, sites, demand, limit_min=3)
    assert r["s0"] == {"a", "b"}
    assert r["s4"] == {"b", "c"}
    assert "s0" not in access.reach_sets(G, sites, demand, 3, exclude={"s0"})
    F = access.apply_flood(G, pd.Series({0: 0, 1: 3, 2: 3, 3: 3, 4: 3}))
    assert access.reach_sets(F, sites, demand, 3)["s0"] == {"a"}


def _hazard(**kw):
    cols = {f"25yr_{k}": 0.0 for k in ("low", "med", "high")}
    cols.update({f"25yr_{k}": v for k, v in kw.items()})
    return pd.DataFrame([cols], index=["B1"])


def test_flood_classes_ranks_by_elevation(monkeypatch):
    G = _line(10)  # node 9 lowest, node 0 highest
    for n in G:
        G.nodes[n]["elevation"] = float(n)  # node 0 lowest now
    monkeypatch.setattr(access, "node_barangays", lambda G, b: pd.Series("B1", index=list(G.nodes)))
    c = access.flood_classes(G, None, _hazard(high=20, med=30, low=10))
    assert list(c[[0, 1]]) == [3, 3]
    assert list(c[[2, 3, 4]]) == [2, 2, 2]
    assert list(c[[5]]) == [1]
    assert list(c[[6, 7, 8, 9]]) == [0, 0, 0, 0]


def test_flood_classes_tie_break_deterministic(monkeypatch):
    G = _line(6)
    for n in G:
        G.nodes[n]["elevation"] = 1.0
    monkeypatch.setattr(access, "node_barangays", lambda G, b: pd.Series("B1", index=list(G.nodes)))
    c1 = access.flood_classes(G, None, _hazard(high=50))
    c2 = access.flood_classes(G, None, _hazard(high=50))
    assert c1.equals(c2)
    assert list(c1) == [3, 3, 3, 0, 0, 0]


def test_flood_classes_overshoot_clamped(monkeypatch):
    G = _line(4)
    monkeypatch.setattr(access, "node_barangays", lambda G, b: pd.Series("B1", index=list(G.nodes)))
    c = access.flood_classes(G, None, _hazard(high=80, med=80, low=80))
    assert (c > 0).all() and (c == 3).sum() == 3


def test_demand_points_and_access_gap(monkeypatch):
    G = _line(5)
    monkeypatch.setattr(access, "node_barangays", lambda G, b: pd.Series(["A", "A", "A", "B", "B"], index=list(G.nodes)))
    pop = pd.Series({"A": 30.0, "B": 20.0})
    classes = pd.Series({0: 0, 1: 0, 2: 3, 3: 3, 4: 3})
    d = access.demand_points(G, None, pop, classes, cell_m=1000.0)
    assert d.population.sum() == pytest.approx(50.0)
    assert d.exposed.sum() == pytest.approx(10 + 20)
    assert set(d.adm4) == {"A", "B"}
    F = access.apply_flood(G, classes)
    fac = pd.DataFrame({"id": ["f0"], "node": [0]})
    out = access.access_gap(G, F, fac, d, limit_min=3.0)
    # one cell per barangay; rep node of A is 1 (reached both), rep of B is 3/4 side
    assert out.loc["A", "gap"] == 0
    assert out.loc["A", "reach_dry"] == pytest.approx(30.0)
    assert out.loc["B", "reach_dry"] == 0  # 3+ edges away dry (4 min > 3)
    out2 = access.access_gap(G, F, fac, d, limit_min=6.0)
    assert out2.loc["B", "reach_dry"] == pytest.approx(20.0)
    assert out2.loc["B", "reach_flood"] == 0
    assert out2.loc["B", "gap"] == pytest.approx(20.0)
    assert out2.loc["B", "exposed_gap"] == pytest.approx(20.0)
    closed = access.access_gap(G, F, fac, d, limit_min=6.0, closed_sites={"f0"})
    assert closed.reach_flood.sum() == 0


def test_usable_sites():
    s = pd.DataFrame({"id": ["a", "b"], "node": [0, 1]})
    u = access.usable_sites(s, pd.Series({0: 3, 1: 2}))
    assert list(u.id) == ["b"]


def test_terrarium_decode():
    from lambat import elevation

    rgb = np.array([[[128, 5, 128]]])
    assert elevation.decode_terrarium(rgb)[0, 0] == pytest.approx(5.5)


_CACHE = Path(__file__).resolve().parents[1] / "data" / "raw" / "osm_cache"
_DEM = Path(__file__).resolve().parents[1] / "data" / "raw" / "dem_cache"


@pytest.mark.skipif(not (any(_CACHE.glob("*.json")) and _DEM.exists()), reason="OSM/DEM cache absent")
def test_real_data_smoke():
    from lambat import data

    b = data.barangays()
    G = access.road_graph(barangays=b)
    assert G.number_of_nodes() > 1000
    access.node_elevations(G)
    c = access.flood_classes(G, b, data.flood_hazard(), "25yr")
    assert set(c.unique()) <= {0, 1, 2, 3}


def test_demand_fallback_for_barangay_without_nodes(monkeypatch):
    import geopandas as gpd
    from shapely.geometry import box

    from lambat import data

    G = _line(3)  # nodes at x = 0,100,200 m, y = 0, all in barangay A
    monkeypatch.setattr(access, "node_barangays", lambda G, b: pd.Series("A", index=list(G.nodes)))
    # barangay C: 400 m x 400 m box about 1 km east of the line, no nodes
    brg = gpd.GeoDataFrame(
        {"adm4_pcode": ["A", "C"]}, geometry=[box(-10, -10, 250, 10), box(1200, -200, 1600, 200)], crs=data.CRS_METRIC
    ).to_crs("EPSG:4326")
    pop = pd.Series({"A": 30.0, "C": 80.0})
    hazard = pd.DataFrame({"25yr_low": [0.0, 10.0], "25yr_med": [0.0, 15.0], "25yr_high": [0.0, 5.0]}, index=["A", "C"])
    d = access.demand_points(G, brg, pop, pd.Series(0, index=list(G.nodes)), cell_m=200.0, hazard=hazard)
    assert d.population.sum() == pytest.approx(110.0)
    c = d[d.adm4 == "C"]
    assert len(c) == 4  # 2x2 grid of 200 m
    assert c.exposed.sum() == pytest.approx(80.0 * 0.30)
    assert (c.snap_m > 900).all() and (c.snap_min > 0).all()
    # snap walking time counts against the limit
    fac = pd.DataFrame({"id": ["f"], "node": [2]})
    assert not any(i.startswith("C_") for i in access.reach_sets(G, fac, d, limit_min=5.0)["f"])
    assert any(i.startswith("C_") for i in access.reach_sets(G, fac, d, limit_min=60.0)["f"])


def test_health_kinds_constant():
    allowed = access.HEALTH_KINDS["amenity"] + access.HEALTH_KINDS["healthcare"]
    assert "pharmacy" not in allowed and "dentist" not in allowed
    assert "health_post" in allowed and "hospital" in allowed
