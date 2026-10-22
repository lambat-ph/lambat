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
