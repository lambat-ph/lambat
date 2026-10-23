from lambat.siting import exact_mclp, greedy_mclp

# Four barangays, three candidate halls. Hall B reaches the two biggest barangays.
DEMAND = {"brgy1": 500.0, "brgy2": 300.0, "brgy3": 200.0, "brgy4": 100.0}
REACH = {
    "hallA": {"brgy1"},
    "hallB": {"brgy1", "brgy2"},
    "hallC": {"brgy3", "brgy4"},
}


def test_greedy_picks_largest_gain_first():
    result = greedy_mclp(DEMAND, REACH, k=1)
    assert result.sites == ["hallB"]
    assert result.covered == 800.0


def test_greedy_covers_everything_with_two_sites():
    result = greedy_mclp(DEMAND, REACH, k=2)
    assert set(result.sites) == {"hallB", "hallC"}
    assert result.share == 1.0


def test_greedy_stops_when_nothing_left_to_gain():
    result = greedy_mclp(DEMAND, REACH, k=3)
    assert len(result.sites) == 2


def test_exact_matches_known_optimum():
    result = exact_mclp(DEMAND, REACH, k=2)
    assert set(result.sites) == {"hallB", "hallC"}
    assert result.covered == 1100.0


def test_exact_beats_greedy_where_greedy_is_myopic():
    # The middle site looks best alone (7), but it overlaps both sides.
    # Greedy: mid + one side = 10. Optimum: left + right = 12.
    demand = {"L1": 3.0, "L2": 3.0, "R1": 3.0, "R2": 3.0, "m": 1.0}
    reach = {
        "left": {"L1", "L2"},
        "right": {"R1", "R2"},
        "mid": {"L1", "R1", "m"},
    }
    assert greedy_mclp(demand, reach, k=2).covered == 10.0
    exact = exact_mclp(demand, reach, k=2)
    assert set(exact.sites) == {"left", "right"}
    assert exact.covered == 12.0


def test_attribution_first_site_in_plan_order_and_sums_to_total():
    from lambat.siting import attribute_new_coverage

    demand = {"p1": 10.0, "p2": 20.0, "p3": 5.0, "p4": 7.0, "clinic": 100.0}
    brgy = {"p1": "A", "p2": "A", "p3": "B", "p4": "B", "clinic": "A"}
    reach = {"s1": {"p1", "p2", "clinic"}, "s2": {"p2", "p3"}, "s3": {"p4"}}
    already = {"clinic"}
    out = attribute_new_coverage(["s2", "s1", "s3"], reach, already, demand, brgy)
    assert out["s2"] == {"A": 20.0, "B": 5.0}  # s2 listed first, takes p2 and p3
    assert out["s1"] == {"A": 10.0}  # p2 already taken; clinic point excluded
    assert out["s3"] == {"B": 7.0}
    total = sum(v for m in out.values() for v in m.values())
    assert total == 10 + 20 + 5 + 7
    # a different plan order moves p2 to s1
    out2 = attribute_new_coverage(["s1", "s2"], reach, already, demand, brgy)
    assert out2["s1"] == {"A": 30.0} and out2["s2"] == {"B": 5.0}


def test_reach_by_barangay_splits_exposed_into_reached_and_cut_off():
    from lambat.siting import reach_by_barangay

    exposed = {"a1": 10.0, "a2": 30.0, "b1": 5.0}
    brgy = {"a1": "A", "a2": "A", "b1": "B"}
    assert reach_by_barangay(exposed, brgy, {"a1"}) == {"A": (10.0, 30.0), "B": (0.0, 5.0)}
    assert reach_by_barangay(exposed, brgy, {"a1", "a2", "b1"}) == {"A": (40.0, 0.0), "B": (5.0, 0.0)}
