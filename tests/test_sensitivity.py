"""The sensitivity options on access.flood_classes and access.apply_flood."""

import networkx as nx
import numpy as np
import pandas as pd
import pytest

from lambat import access


def _line(n=6, length=100.0):
    G = nx.Graph()
    for i in range(n):
        G.add_node(i, x=i * length, y=0.0, lon=120.3 + i * 1e-3, lat=16.04, elevation=float(i))
    for i in range(n - 1):
        G.add_edge(i, i + 1, length=length)
    access.set_walk_time(G)
    return G


def _hazard(**kw):
    cols = {f"25yr_{k}": 0.0 for k in ("low", "med", "high")}
    cols.update({f"25yr_{k}": v for k, v in kw.items()})
    return pd.DataFrame([cols], index=["B1"])


@pytest.fixture
def one_barangay(monkeypatch):
    monkeypatch.setattr(access, "node_barangays", lambda G, b: pd.Series("B1", index=list(G.nodes)))


def test_rng_preserves_class_counts(one_barangay):
    G = _line(12)
    h = _hazard(high=25, med=25, low=17)
    base = access.flood_classes(G, None, h)
    for seed in range(5):
        c = access.flood_classes(G, None, h, rng=np.random.default_rng(seed))
        assert sorted(c.value_counts().items()) == sorted(base.value_counts().items())


def test_rng_changes_placement_but_is_reproducible(one_barangay):
    G = _line(40)
    h = _hazard(high=30)
    base = access.flood_classes(G, None, h)
    a = access.flood_classes(G, None, h, rng=np.random.default_rng(1))
    b = access.flood_classes(G, None, h, rng=np.random.default_rng(1))
    c = access.flood_classes(G, None, h, rng=np.random.default_rng(2))
    assert a.equals(b)
    assert not a.equals(c)
    assert not a.equals(base)  # elevation order floods nodes 0-11 only


def test_rng_default_is_unchanged(one_barangay):
    G = _line(10)
    c = access.flood_classes(G, None, _hazard(high=20, med=30, low=10), rng=None)
    assert list(c[[0, 1]]) == [3, 3] and list(c[[2, 3, 4]]) == [2, 2, 2] and c[5] == 1


def test_max_rule_closes_edge_min_rule_keeps():
    G = _line(3)
    classes = pd.Series({0: 0, 1: 3, 2: 3})
    assert access.apply_flood(G, classes).has_edge(0, 1)                      # min: dry endpoint keeps it
    assert not access.apply_flood(G, classes, edge_rule="max").has_edge(0, 1)  # max: high endpoint closes it
    assert not access.apply_flood(G, classes, edge_rule="max").has_edge(1, 2)


def test_edge_rule_default_matches_min():
    G = _line(5)
    classes = pd.Series({0: 0, 1: 1, 2: 2, 3: 3, 4: 3})
    d = access.apply_flood(G, classes)
    m = access.apply_flood(G, classes, edge_rule="min")
    assert sorted(d.edges) == sorted(m.edges)
    for u, v in d.edges:
        assert d[u][v]["minutes"] == m[u][v]["minutes"]
        assert d[u][v]["severity"] == m[u][v]["severity"]


def test_max_rule_slows_more():
    G = _line(3)
    classes = pd.Series({0: 1, 1: 2, 2: 2})
    base = G[0][1]["minutes"]
    assert access.apply_flood(G, classes)[0][1]["minutes"] == pytest.approx(base / 0.6)
    assert access.apply_flood(G, classes, edge_rule="max")[0][1]["minutes"] == pytest.approx(base / 0.25)


def test_bad_edge_rule():
    with pytest.raises(ValueError):
        access.apply_flood(_line(3), pd.Series({0: 0, 1: 0, 2: 0}), edge_rule="mean")
