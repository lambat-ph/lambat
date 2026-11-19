"""Schema check for web/data/PH015518000/planner_<scenario>.json (skipped when absent)."""

import json
from pathlib import Path

import pytest

DIR = Path(__file__).resolve().parents[1] / "web" / "data" / "PH015518000"
FILES = sorted(DIR.glob("planner_*.json"))
TOP = {"city", "scenario", "walk_limit_min", "exposed_on_network", "clinic_reach", "access_gap",
       "points", "candidates", "plans", "uncertainty", "barangays"}


@pytest.mark.skipif(not FILES, reason="planner files not written")
@pytest.mark.parametrize("path", FILES, ids=lambda p: p.name)
def test_planner_schema(path):
    d = json.loads(path.read_text())
    assert TOP <= set(d)
    n = len(d["points"]["w"])
    assert n == len(d["points"]["pcode"])
    ids = set()
    for c in d["candidates"]:
        assert {"id", "name", "kind", "lon", "lat", "reach"} <= set(c)
        assert all(0 <= i < n for i in c["reach"])
        ids.add(c["id"])
    assert set(d["plans"]) == {str(k) for k in range(1, 11)}
    for p in d["plans"].values():
        assert {"sites", "newly", "share"} <= set(p)
        assert set(p["sites"]) <= ids
    u = d["uncertainty"]
    assert {"n", "seed", "gap", "clinic_share", "share", "pick"} <= set(u)
    assert set(u["share"]) == set(u["pick"]) == {str(k) for k in range(1, 11)}  # every size the map slider offers
