"""Step 4: choose temporary dose points with a maximal covering location model.

Church, R., & ReVelle, C. (1974). The maximal covering location problem.
Papers of the Regional Science Association, 32(1), 101-118.

Given demand points (exposed residents per cell or barangay), candidate sites
(barangay halls, evacuation centres) and which candidates can reach which demand
points within the walking limit, pick k sites that cover the most residents.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass


@dataclass(frozen=True)
class SitingResult:
    sites: list[str]
    covered: float
    total: float

    @property
    def share(self) -> float:
        return self.covered / self.total if self.total else 0.0


def _covered_weight(
    sites: Sequence[str],
    demand: Mapping[str, float],
    reach: Mapping[str, set[str]],
) -> float:
    covered: set[str] = set()
    for s in sites:
        covered |= reach.get(s, set())
    return sum(demand.get(d, 0.0) for d in covered)


def greedy_mclp(
    demand: Mapping[str, float],
    reach: Mapping[str, set[str]],
    k: int,
) -> SitingResult:
    """Pick k sites one at a time, each time taking the site that adds the most
    newly covered residents. Fast and within (1 - 1/e) of the optimum.

    demand: demand point id -> residents
    reach: candidate site id -> demand point ids within the walking limit
    """
    chosen: list[str] = []
    covered: set[str] = set()
    for _ in range(min(k, len(reach))):
        best, best_gain = None, 0.0
        for site, points in reach.items():
            if site in chosen:
                continue
            gain = sum(demand.get(d, 0.0) for d in points - covered)
            if gain > best_gain:
                best, best_gain = site, gain
        if best is None:
            break
        chosen.append(best)
        covered |= reach[best]
    return SitingResult(chosen, _covered_weight(chosen, demand, reach), sum(demand.values()))


def exact_mclp(
    demand: Mapping[str, float],
    reach: Mapping[str, set[str]],
    k: int,
) -> SitingResult:
    """Solve the MCLP exactly as an integer program with PuLP and CBC."""
    import pulp

    sites = list(reach)
    points = list(demand)
    covers = {d: [s for s in sites if d in reach[s]] for d in points}

    prob = pulp.LpProblem("mclp", pulp.LpMaximize)
    x = pulp.LpVariable.dicts("site", sites, cat="Binary")
    y = pulp.LpVariable.dicts("covered", points, cat="Binary")

    prob += pulp.lpSum(demand[d] * y[d] for d in points)
    prob += pulp.lpSum(x[s] for s in sites) <= k
    for d in points:
        prob += y[d] <= pulp.lpSum(x[s] for s in covers[d])

    prob.solve(pulp.PULP_CBC_CMD(msg=False))
    chosen = [s for s in sites if x[s].value() and x[s].value() > 0.5]
    return SitingResult(chosen, _covered_weight(chosen, demand, reach), sum(demand.values()))


def attribute_new_coverage(
    sites: Sequence[str],
    reach: Mapping[str, set[str]],
    already: set[str],
    demand: Mapping[str, float],
    point_barangay: Mapping[str, str],
) -> dict[str, dict[str, float]]:
    """Split a plan's newly covered residents over its sites.

    Each demand point that is not in `already` (reached by a clinic) and is reached by
    at least one site goes to the first site in `sites` order that reaches it. Returns
    site id -> {barangay pcode: residents}. Sums over all sites equal the plan's covered
    weight, so per-site numbers add up to the plan total.
    """
    taken = set(already)
    out: dict[str, dict[str, float]] = {}
    for s in sites:
        mine: dict[str, float] = {}
        for d in sorted(reach.get(s, set()) - taken):
            w = demand.get(d, 0.0)
            if w > 0:
                b = point_barangay[d]
                mine[b] = mine.get(b, 0.0) + w
        taken |= reach.get(s, set())
        out[s] = mine
    return out


def reach_by_barangay(
    exposed: Mapping[str, float],
    point_barangay: Mapping[str, str],
    covered: set[str],
) -> dict[str, tuple[float, float]]:
    """Per barangay: (exposed residents within reach, exposed residents cut off).

    exposed: demand point id -> exposed residents (all points, not only unserved ones).
    covered: demand point ids within reach of a clinic or a chosen dose point.
    """
    out: dict[str, list[float]] = {}
    for d, w in exposed.items():
        r = out.setdefault(point_barangay[d], [0.0, 0.0])
        r[0 if d in covered else 1] += w
    return {b: (r[0], r[1]) for b, r in out.items()}
