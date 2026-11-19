"""30-route walking-time check against Google Maps (proposal objective 3).

    uv run python scripts/run_route_check.py sample   # pick 30 routes, write our times + Google Maps links
    uv run python scripts/run_route_check.py fetch    # optional: fill Google times via the Routes API
    uv run python scripts/run_route_check.py score    # compare, write results/route_check.json

Routes: a random walk-graph node in each Dagupan barangay that has road nodes (26), then a
second node in 4 of them to make 30 (fixed seed), each to the
nearest health facility by dry-day walking time. Google Maps does not model floods, so this
checks the dry-day network and walking speed that every flood scenario is built on.

Google times come either from opening each link (walking mode) and typing the minutes and
km into results/route_check_routes.csv, or from `fetch` with GOOGLE_MAPS_API_KEY set in the
environment (Routes API, travelMode WALK). The key is read from the environment only.
"""

from __future__ import annotations

import argparse
import itertools
import json
import os
import urllib.request
from pathlib import Path

import networkx as nx
import numpy as np
import pandas as pd

from lambat import access, data

ROOT = Path(__file__).resolve().parents[1]
ROUTES = ROOT / "results" / "route_check_routes.csv"
OUT = ROOT / "results" / "route_check.json"
SEED = 20261119
N_ROUTES = 30
TARGET = 0.20  # proposal: median error within 20%
MIN_MIN = 4.0  # origins at least 4 walking minutes (300 m) from their clinic; tiny routes make % error meaningless


def sample() -> None:
    brgy = data.barangays(data.DAGUPAN)
    G = access.road_graph(barangays=brgy)
    fac = access.health_facilities(G, barangays=brgy)
    node_b = access.node_barangays(G, brgy)
    rng = np.random.default_rng(SEED)
    label = brgy.set_index("adm4_pcode")["adm4_en"]
    codes = list(rng.permutation(sorted(node_b.dropna().unique())))
    picked = [codes[i % len(codes)] for i in range(N_ROUTES)]  # every barangay once, then repeats
    fac_nodes = {}
    for _, f in fac.iterrows():
        fac_nodes.setdefault(f["node"], f)
    # one multi-source Dijkstra from all facilities gives each node its nearest facility
    dist, paths = nx.multi_source_dijkstra(G, set(fac_nodes), weight="minutes")
    rows, used = [], set()
    for k, b in enumerate(picked, 1):
        nodes = [n for n, v in node_b.items() if v == b and n in dist and n not in used]
        far = [n for n in nodes if dist[n] >= MIN_MIN] or [max(nodes, key=dist.get)]
        o = far[rng.integers(len(far))]
        used.add(o)
        path = paths[o]
        d_node = path[0]
        f = fac_nodes[d_node]
        km = sum(G[u][v]["length"] for u, v in itertools.pairwise(path)) / 1000
        on, dn = G.nodes[o], G.nodes[d_node]
        rows.append({
            "route": k, "barangay": label.get(b, b),
            "origin_lat": round(on["lat"], 6), "origin_lon": round(on["lon"], 6),
            "facility": f["name"], "facility_kind": f["kind"],
            "dest_lat": round(dn["lat"], 6), "dest_lon": round(dn["lon"], 6),
            "model_km": round(km, 3), "model_min": round(dist[o], 1),
            "google_km": "", "google_min": "",
            "google_maps_link": ("https://www.google.com/maps/dir/?api=1"
                                 f"&origin={on['lat']:.6f},{on['lon']:.6f}"
                                 f"&destination={dn['lat']:.6f},{dn['lon']:.6f}&travelmode=walking"),
        })
    pd.DataFrame(rows).to_csv(ROUTES, index=False)
    print(f"wrote {len(rows)} routes to {ROUTES}")


def fetch() -> None:
    key = os.environ.get("GOOGLE_MAPS_API_KEY")
    if not key:
        raise SystemExit("Set GOOGLE_MAPS_API_KEY in the environment first (or fill the CSV by hand).")
    df = pd.read_csv(ROUTES, dtype={"google_km": object, "google_min": object})
    for i, r in df.iterrows():
        body = {"origin": {"location": {"latLng": {"latitude": r.origin_lat, "longitude": r.origin_lon}}},
                "destination": {"location": {"latLng": {"latitude": r.dest_lat, "longitude": r.dest_lon}}},
                "travelMode": "WALK"}
        req = urllib.request.Request(
            "https://routes.googleapis.com/directions/v2:computeRoutes",
            data=json.dumps(body).encode(), method="POST",
            headers={"Content-Type": "application/json", "X-Goog-Api-Key": key,
                     "X-Goog-FieldMask": "routes.duration,routes.distanceMeters"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            route = json.load(resp)["routes"][0]
        df.loc[i, "google_km"] = round(route["distanceMeters"] / 1000, 3)
        df.loc[i, "google_min"] = round(int(route["duration"].rstrip("s")) / 60, 1)
    df.to_csv(ROUTES, index=False)
    print(f"filled {len(df)} routes from the Routes API")


def _stats(model: pd.Series, google: pd.Series) -> dict:
    rel = (model - google) / google
    return {"median_abs_error": round(float(rel.abs().median()), 3),
            "median_signed_error": round(float(rel.median()), 3),
            "within_20pct": int((rel.abs() <= TARGET).sum()),
            "correlation": round(float(np.corrcoef(model, google)[0, 1]), 3)}


def score() -> None:
    df = pd.read_csv(ROUTES)
    done = df.dropna(subset=["google_min", "google_km"])
    if done.empty:
        raise SystemExit("No Google times in the CSV yet.")
    res = {"routes_scored": len(done), "routes_total": len(df), "target_median_abs_error": TARGET,
           "walk_kmh_model": access.WALK_KMH,
           "minutes": _stats(done.model_min, done.google_min),
           "distance": _stats(done.model_km, done.google_km),
           "google_implied_kmh": round(float((done.google_km / (done.google_min / 60)).median()), 2)}
    res["passes"] = res["minutes"]["median_abs_error"] <= TARGET
    OUT.write_text(json.dumps(res, indent=2))
    print(json.dumps(res, indent=2))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("step", choices=["sample", "fetch", "score"])
    {"sample": sample, "fetch": fetch, "score": score}[ap.parse_args().step]()
