"""Step 3: who can still reach care?

Walking time over the OpenStreetMap road graph from each demand point to the
nearest open dose point. Flooded segments are slowed by depth and closed above a
threshold. Output feeds siting.py as: candidate site -> demand points in reach.
"""

WALK_LIMIT_MIN = 30


def road_graph(place="Dagupan, Pangasinan, Philippines"):
    raise NotImplementedError


def apply_flood(graph, flood_extent, close_above_m=0.5):
    raise NotImplementedError


def reach_sets(graph, demand_points, candidate_sites, limit_min=WALK_LIMIT_MIN):
    raise NotImplementedError
