"""Step 3: who can still reach care?

Walking time over the OpenStreetMap walk graph from each demand cell to open dose
points, on a dry day and during a flood. Output feeds siting.py as:
candidate site -> set of demand cells within reach.

Method
1. Walk graph for the city, projected to metres (EPSG:32651), simplified to an
   undirected graph with one edge per node pair. Dry speed 4.5 km/h; edge weight
   ``minutes`` = length / speed.
2. Elevation per node from AWS Terrarium tiles at zoom 14 (see elevation.py).
   The source is ~30 m SRTM-class data and is coarse in flat Dagupan, so it is
   used only to RANK nodes within a barangay.
3. Flood calibrated to UP NOAH, per barangay: rank its nodes by elevation (ties
   broken by node id). The lowest ``high%`` of nodes get class high, the next
   ``med%`` med, the next ``low%`` low, for the chosen return period. Flooded node
   shares therefore equal NOAH area shares per barangay (area share used as a
   proxy for node share; nodes are denser in built-up areas).
4. An edge takes the LESS severe class of its two endpoints. Speed factors:
   low x0.6, med x0.25, high closed (edge removed).
5. Candidate temporary sites: OSM amenity townhall, community_centre, school.
   Existing health facilities: amenity clinic/hospital/doctors or any healthcare=*.
   A site whose node is in class high is unusable in that scenario.
6. Demand: each barangay's population is spread EVENLY over its graph nodes
   (a simplification: it ignores where buildings really are). Exposed residents are
   those at flooded nodes (any class). Nodes are aggregated to ~200 m grid cells,
   one demand point per (cell, barangay), represented by the member node nearest
   the members' centre.
7. ``reach_sets`` runs Dijkstra with a cutoff from each site's node.

Severity codes: 0 dry, 1 low (<0.5 m), 2 med (0.5-1.5 m), 3 high (>1.5 m).
"""

from __future__ import annotations

import time

import geopandas as gpd
import networkx as nx
import numpy as np
import pandas as pd
from shapely.geometry import Point

from . import data, elevation

WALK_LIMIT_MIN = 30
WALK_KMH = 4.5
SPEED_FACTORS = {1: 0.6, 2: 0.25, 3: 0.0}  # 0.0 means closed
OVERPASS_MIRRORS = [
    None,  # osmnx default (overpass-api.de)
    "https://overpass.kumi.systems/api",
    "https://maps.mail.ru/osm/tools/overpass/api",
]

CANDIDATE_TAGS = {"amenity": ["townhall", "community_centre", "school"]}
HEALTH_TAGS = {"amenity": ["clinic", "hospital", "doctors"], "healthcare": True}
# Only these count as open dose points; pharmacies, labs, dentists, optometrists,
# psychotherapists, alternative medicine etc. are dropped.
HEALTH_AMENITY_KINDS = ("clinic", "hospital", "doctors")
HEALTH_HEALTHCARE_KINDS = ("clinic", "hospital", "doctor", "centre", "health_post", "community_health_worker")
HEALTH_KINDS = {"amenity": HEALTH_AMENITY_KINDS, "healthcare": HEALTH_HEALTHCARE_KINDS}


def _ox():
    import osmnx as ox

    ox.settings.cache_folder = str(data.ROOT / "data" / "raw" / "osm_cache")
    ox.settings.use_cache = True
    return ox


def _with_retries(fn, attempts_per_mirror: int = 3):
    """Call fn(), retrying with backoff, then falling through Overpass mirrors."""
    ox = _ox()
    default_url = ox.settings.overpass_url
    last = None
    try:
        for mirror in OVERPASS_MIRRORS:
            ox.settings.overpass_url = mirror or default_url
            for i in range(attempts_per_mirror):
                try:
                    return fn()
                except Exception as e:  # noqa: BLE001  network and HTTP errors vary
                    last = e
                    time.sleep(2 * (i + 1))
        raise last
    finally:
        ox.settings.overpass_url = default_url


def _city_polygon(city: str = data.DAGUPAN, barangays: gpd.GeoDataFrame | None = None):
    b = barangays if barangays is not None else data.barangays(city)
    return b.union_all()


def road_graph(city: str = data.DAGUPAN, barangays: gpd.GeoDataFrame | None = None, walk_kmh: float = WALK_KMH) -> nx.Graph:
    """Undirected walk graph in metres. Edge attrs: length (m), minutes. Node attrs: x, y (metres), lon, lat."""
    ox = _ox()
    poly = _city_polygon(city, barangays)
    Gd = _with_retries(lambda: ox.graph_from_polygon(poly, network_type="walk"))
    lonlat = {n: (d["x"], d["y"]) for n, d in Gd.nodes(data=True)}
    Gp = ox.project_graph(Gd, to_crs=data.CRS_METRIC)
    G = nx.Graph()
    for n, d in Gp.nodes(data=True):
        G.add_node(n, x=d["x"], y=d["y"], lon=lonlat[n][0], lat=lonlat[n][1])
    for u, v, d in Gp.edges(data=True):
        if u == v:
            continue
        length = float(d["length"])
        if G.has_edge(u, v) and G[u][v]["length"] <= length:
            continue
        G.add_edge(u, v, length=length)
    set_walk_time(G, walk_kmh)
    return G


def set_walk_time(G: nx.Graph, walk_kmh: float = WALK_KMH) -> None:
    m_per_min = walk_kmh * 1000.0 / 60.0
    for _, _, d in G.edges(data=True):
        d["minutes"] = d["length"] / m_per_min


def node_elevations(G: nx.Graph) -> pd.Series:
    """Elevation (m) per node from Terrarium tiles; also stored as node attr 'elevation'."""
    nodes = list(G.nodes)
    lon = np.array([G.nodes[n]["lon"] for n in nodes])
    lat = np.array([G.nodes[n]["lat"] for n in nodes])
    z = elevation.sample(lon, lat)
    for n, e in zip(nodes, z):
        G.nodes[n]["elevation"] = float(e)
    return pd.Series(z, index=nodes, name="elevation")


def node_barangays(G: nx.Graph, barangays: gpd.GeoDataFrame) -> pd.Series:
    """Barangay code per node (point in polygon, else nearest barangay)."""
    nodes = list(G.nodes)
    pts = gpd.GeoDataFrame(
        {"node": nodes},
        geometry=[Point(G.nodes[n]["lon"], G.nodes[n]["lat"]) for n in nodes],
        crs="EPSG:4326",
    )
    b = barangays[["adm4_pcode", "geometry"]].to_crs(data.CRS_METRIC)
    pts = pts.to_crs(data.CRS_METRIC)
    j = gpd.sjoin_nearest(pts, b, how="left", distance_col="_d")
    j = j.sort_values(["node", "_d", "adm4_pcode"]).drop_duplicates("node")
    return j.set_index("node").adm4_pcode.reindex(nodes).rename("adm4_pcode")


def flood_classes(G: nx.Graph, barangays: gpd.GeoDataFrame, hazard: pd.DataFrame, scenario: str = "25yr") -> pd.Series:
    """Severity code (0-3) per node, calibrated to NOAH area shares per barangay.

    Needs node attr 'elevation' (run node_elevations first). Also sets node attr 'adm4'.
    """
    brgy = node_barangays(G, barangays)
    elev = pd.Series({n: G.nodes[n]["elevation"] for n in G.nodes})
    df = pd.DataFrame({"adm4": brgy, "elev": elev})
    df["node"] = df.index
    out = pd.Series(0, index=df.index, dtype=int, name="severity")
    for code, grp in df.groupby("adm4"):
        if code not in hazard.index:
            continue
        pct = {k: float(np.nan_to_num(hazard.at[code, f"{scenario}_{k}"])) for k in ("high", "med", "low")}
        n = len(grp)
        order = grp.sort_values(["elev", "node"], kind="mergesort").index.tolist()
        n_high = round(pct["high"] / 100.0 * n)
        n_med = round(pct["med"] / 100.0 * n)
        n_low = round(pct["low"] / 100.0 * n)
        n_high = min(n_high, n)
        n_med = min(n_med, n - n_high)
        n_low = min(n_low, n - n_high - n_med)
        out[order[:n_high]] = 3
        out[order[n_high : n_high + n_med]] = 2
        out[order[n_high + n_med : n_high + n_med + n_low]] = 1
    for n in G.nodes:
        G.nodes[n]["adm4"] = df.at[n, "adm4"]
    return out


def apply_flood(G: nx.Graph, classes: pd.Series, factors: dict[int, float] | None = None) -> nx.Graph:
    """Copy of G with flooded edges slowed or closed. Edge severity = less severe endpoint.

    factors maps severity -> speed multiplier; 0 closes the edge (removed).
    """
    factors = {**SPEED_FACTORS, **(factors or {})}
    F = G.copy()
    for u, v, d in list(F.edges(data=True)):
        sev = min(int(classes.get(u, 0)), int(classes.get(v, 0)))
        d["severity"] = sev
        if sev == 0:
            continue
        f = factors.get(sev, 1.0)
        if f <= 0:
            F.remove_edge(u, v)
        else:
            d["minutes"] = d["minutes"] / f
    return F


def _nearest_nodes(G: nx.Graph, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    from scipy.spatial import cKDTree

    ids = list(G.nodes)
    xy = np.array([(G.nodes[n]["x"], G.nodes[n]["y"]) for n in ids])
    _, idx = cKDTree(xy).query(np.column_stack([x, y]))
    return np.array(ids)[idx]


def _fetch_sites(G: nx.Graph, city: str, tags: dict, kind_cols: list[str], barangays=None,
                 allowed: dict[str, tuple[str, ...]] | None = None) -> gpd.GeoDataFrame:
    ox = _ox()
    poly = _city_polygon(city, barangays)
    # full polygon triggers HTTP 413; query the convex hull and clip afterwards
    feats = _with_retries(lambda: ox.features_from_polygon(poly.convex_hull, tags=tags))
    cols = ["id", "name", "kind", "node", "geometry"]
    empty = gpd.GeoDataFrame(columns=cols, geometry="geometry", crs="EPSG:4326")
    if feats is None or len(feats) == 0:
        return empty
    feats = feats.reset_index()
    feats["geometry"] = feats.geometry.representative_point()
    feats = feats[feats.geometry.within(poly)].copy()
    if feats.empty:
        return empty
    feats["id"] = feats["element"].astype(str).str[0] + feats["id"].astype(str)
    feats = feats.drop_duplicates("id")

    def kind(row):
        for c in kind_cols:
            v = row.get(c)
            if isinstance(v, str) and v and (allowed is None or v in allowed.get(c, ())):
                return v
        return None if allowed is not None else "other"

    feats["kind"] = feats.apply(kind, axis=1)
    feats = feats[feats["kind"].notna()].copy()
    if feats.empty:
        return empty
    nm = feats["name"] if "name" in feats else pd.Series(None, index=feats.index)
    feats["name"] = [n if isinstance(n, str) and n else f"(unnamed {k})" for n, k in zip(nm, feats["kind"])]
    proj = feats.to_crs(data.CRS_METRIC)
    feats["node"] = _nearest_nodes(G, proj.geometry.x.values, proj.geometry.y.values)
    return gpd.GeoDataFrame(feats[cols], geometry="geometry", crs="EPSG:4326").reset_index(drop=True)


def candidate_sites(G: nx.Graph, city: str = data.DAGUPAN, barangays=None) -> gpd.GeoDataFrame:
    """Temporary dose-point candidates: townhall, community centre, school."""
    return _fetch_sites(G, city, CANDIDATE_TAGS, ["amenity"], barangays)


def health_facilities(G: nx.Graph, city: str = data.DAGUPAN, barangays=None) -> gpd.GeoDataFrame:
    """Existing facilities (open dose points for the clinic-only baseline), limited to HEALTH_KINDS."""
    return _fetch_sites(G, city, HEALTH_TAGS, ["amenity", "healthcare"], barangays, allowed=HEALTH_KINDS)


def usable_sites(sites: gpd.GeoDataFrame, classes: pd.Series) -> gpd.GeoDataFrame:
    """Drop sites whose node is in class high (3)."""
    sev = sites["node"].map(lambda n: int(classes.get(n, 0)))
    return sites[sev < 3]


def flooded_share(hazard: pd.DataFrame, scenario: str = "25yr") -> pd.Series:
    """Share (0-1) of each barangay's area in any NOAH hazard class for the scenario."""
    cols = [f"{scenario}_{k}" for k in ("low", "med", "high")]
    return (hazard[cols].fillna(0.0).sum(axis=1) / 100.0).clip(0.0, 1.0)


def _grid_points(geom, cell_m: float):
    """~cell_m grid of points inside a metric-CRS polygon; one interior point if none fall inside."""
    from shapely import contains_xy

    minx, miny, maxx, maxy = geom.bounds
    gx, gy = np.meshgrid(np.arange(minx + cell_m / 2, maxx, cell_m), np.arange(miny + cell_m / 2, maxy, cell_m))
    gx, gy = gx.ravel(), gy.ravel()
    m = contains_xy(geom, gx, gy)
    if not m.any():
        p = geom.representative_point()
        return np.array([p.x]), np.array([p.y])
    return gx[m], gy[m]


def demand_points(
    G: nx.Graph,
    barangays: gpd.GeoDataFrame | None,
    population: pd.Series,
    classes: pd.Series,
    cell_m: float = 200.0,
    hazard: pd.DataFrame | None = None,
    scenario: str = "25yr",
    walk_kmh: float = WALK_KMH,
) -> pd.DataFrame:
    """Demand cells indexed by id '<adm4>_<ix>_<iy>' (fallback ids '<adm4>_g<i>').

    Columns: adm4, node (representative), population, exposed, x, y, snap_m, snap_min.
    Population is split evenly over each barangay's graph nodes; exposed = residents at
    nodes with severity > 0.

    Fallback: a barangay with population but no graph node gets a ~cell_m grid of points
    inside its polygon (population split evenly), each snapped to its nearest node.
    snap_m is the snap distance and snap_min its walking time; reach_sets adds snap_min
    to the route time. Exposed = population x NOAH flooded share (low+med+high), which
    needs `hazard`; without it fallback cells get exposed = 0, so always pass it.
    """
    brgy = node_barangays(G, barangays)
    rows = pd.DataFrame(
        {
            "node": list(G.nodes),
            "x": [G.nodes[n]["x"] for n in G.nodes],
            "y": [G.nodes[n]["y"] for n in G.nodes],
        }
    )
    rows["adm4"] = brgy.reindex(rows.node).values
    counts = rows.groupby("adm4").node.transform("size")
    rows["pop"] = rows.adm4.map(population).fillna(0.0) / counts
    rows["flooded"] = rows.node.map(lambda n: int(classes.get(n, 0)) > 0)
    rows["exposed"] = rows["pop"].where(rows.flooded, 0.0)
    rows["ix"] = np.floor(rows.x / cell_m).astype(int)
    rows["iy"] = np.floor(rows.y / cell_m).astype(int)
    out = []
    for (adm4, ix, iy), g in rows.groupby(["adm4", "ix", "iy"], sort=True):
        cx, cy = g.x.mean(), g.y.mean()
        d = (g.x - cx) ** 2 + (g.y - cy) ** 2
        rep = g.loc[d.sort_values(kind="mergesort").index[0], "node"]
        out.append(
            {"id": f"{adm4}_{ix}_{iy}", "adm4": adm4, "node": rep, "population": g["pop"].sum(),
             "exposed": g.exposed.sum(), "x": cx, "y": cy, "snap_m": 0.0, "snap_min": 0.0}
        )

    if barangays is not None:
        have = set(rows.adm4.dropna())
        share = flooded_share(hazard, scenario) if hazard is not None else pd.Series(dtype=float)
        bm = barangays.set_index("adm4_pcode").to_crs(data.CRS_METRIC)
        m_per_min = walk_kmh * 1000.0 / 60.0
        for code in sorted(set(population.index) - have):
            pop = float(population.get(code, 0.0) or 0.0)
            if pop <= 0 or code not in bm.index:
                continue
            gx, gy = _grid_points(bm.geometry[code], cell_m)
            nodes = _nearest_nodes(G, gx, gy)
            snap = [float(np.hypot(G.nodes[n]["x"] - x, G.nodes[n]["y"] - y)) for n, x, y in zip(nodes, gx, gy)]
            per = pop / len(gx)
            f = float(share.get(code, 0.0))
            for i, (x, y, n, sm) in enumerate(zip(gx, gy, nodes, snap)):
                out.append(
                    {"id": f"{code}_g{i}", "adm4": code, "node": n, "population": per,
                     "exposed": per * f, "x": float(x), "y": float(y),
                     "snap_m": sm, "snap_min": sm / m_per_min}
                )
    return pd.DataFrame(out).set_index("id")


def reach_sets(
    G: nx.Graph,
    sites: gpd.GeoDataFrame | pd.DataFrame,
    demand: pd.DataFrame,
    limit_min: float = WALK_LIMIT_MIN,
    exclude: set[str] | None = None,
) -> dict[str, set[str]]:
    """site id -> set of demand ids whose representative node is within limit_min
    walking minutes of the site's node on graph G. Sites in `exclude` get no entry."""
    by_node: dict = {}
    snap = demand["snap_min"] if "snap_min" in demand else pd.Series(0.0, index=demand.index)
    for did, node in demand["node"].items():
        by_node.setdefault(node, []).append((did, float(snap[did])))
    out: dict[str, set[str]] = {}
    for sid, snode in zip(sites["id"], sites["node"]):
        if exclude and sid in exclude:
            continue
        if snode not in G:
            out[sid] = set()
            continue
        dist = nx.single_source_dijkstra_path_length(G, snode, cutoff=limit_min, weight="minutes")
        reached: set[str] = set()
        for n, t in dist.items():
            for did, extra in by_node.get(n, ()):
                if t + extra <= limit_min:
                    reached.add(did)
        out[sid] = reached
    return out


def access_gap(
    G_dry: nx.Graph,
    G_flood: nx.Graph,
    facilities: gpd.GeoDataFrame | pd.DataFrame,
    demand: pd.DataFrame,
    limit_min: float = WALK_LIMIT_MIN,
    closed_sites: set[str] | None = None,
) -> pd.DataFrame:
    """Per barangay: residents and exposed residents within reach of an existing
    facility dry vs during the flood, and the access gap (reach dry, not in flood).

    closed_sites: facility ids unusable in the flood (node in class high).
    Columns: population, exposed, reach_dry, reach_flood, gap, exposed_reach_dry,
    exposed_reach_flood, exposed_gap.
    """
    dry = set().union(*reach_sets(G_dry, facilities, demand, limit_min).values()) if len(facilities) else set()
    wet = set().union(*reach_sets(G_flood, facilities, demand, limit_min, exclude=closed_sites).values()) if len(facilities) else set()
    d = demand.copy()
    in_dry = d.index.isin(dry)
    in_wet = d.index.isin(wet)
    gap = in_dry & ~in_wet
    d["reach_dry"] = d.population.where(in_dry, 0.0)
    d["reach_flood"] = d.population.where(in_wet, 0.0)
    d["gap"] = d.population.where(gap, 0.0)
    d["exposed_reach_dry"] = d.exposed.where(in_dry, 0.0)
    d["exposed_reach_flood"] = d.exposed.where(in_wet, 0.0)
    d["exposed_gap"] = d.exposed.where(gap, 0.0)
    cols = ["population", "exposed", "reach_dry", "reach_flood", "gap",
            "exposed_reach_dry", "exposed_reach_flood", "exposed_gap"]
    return d.groupby("adm4")[cols].sum()
