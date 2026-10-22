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
