#!/usr/bin/env python3
"""Build the app's station/line dataset from the MTA's static GTFS feed.

Usage:
    curl -sSL https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip -o gtfs_subway.zip
    python3 scripts/build_data.py gtfs_subway.zip

Writes data/subway_data.js containing:
  - stations: id, name, lat/lon, routes served
  - routes: id, color
  - segments: per-route polylines cut at each station, so the app can
    color each inter-station stretch of track independently.
"""
import csv
import io
import json
import math
import sys
import zipfile
from collections import defaultdict

OUT_PATH = "data/subway_data.js"

# Express variants are the same physical line — fold them into the parent
# route so the app shows one entry per line.
ROUTE_MERGE = {"5X": "5", "6X": "6", "7X": "7", "FX": "F"}


def read_csv(zf, name):
    with zf.open(name) as f:
        return list(csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig")))


# ---------------------------------------------------------------------------
# geometry helpers (lat/lon treated as planar with a cos(lat) x-scale, which
# is plenty accurate at NYC's scale for projection/simplification purposes)

COS_LAT = math.cos(math.radians(40.72))


def dist2(ax, ay, bx, by):
    dx = (ax - bx) * COS_LAT
    dy = ay - by
    return dx * dx + dy * dy


def project_point_on_polyline(pt, line):
    """Return (best_index, t, dist2) of pt's closest position along line."""
    best = (0, 0.0, float("inf"))
    px, py = pt
    for i in range(len(line) - 1):
        ax, ay = line[i]
        bx, by = line[i + 1]
        vx, vy = (bx - ax) * COS_LAT, by - ay
        wx, wy = (px - ax) * COS_LAT, py - ay
        seg_len2 = vx * vx + vy * vy
        t = 0.0 if seg_len2 == 0 else max(0.0, min(1.0, (wx * vx + wy * vy) / seg_len2))
        cx, cy = ax + (bx - ax) * t, ay + (by - ay) * t
        d2 = dist2(px, py, cx, cy)
        if d2 < best[2]:
            best = (i, t, d2)
    return best


def slice_polyline(line, a, b):
    """Slice line between projected positions a=(i, t) and b=(i, t)."""
    (ia, ta), (ib, tb) = a, b
    if (ia, ta) > (ib, tb):
        (ia, ta), (ib, tb) = (ib, tb), (ia, ta)

    def interp(i, t):
        ax, ay = line[i]
        bx, by = line[i + 1]
        return (ax + (bx - ax) * t, ay + (by - ay) * t)

    pts = [interp(ia, ta)]
    pts.extend(line[ia + 1 : ib + 1])
    pts.append(interp(ib, tb))
    return pts


def simplify(points, tol=1.2e-4):
    """Douglas-Peucker simplification; tol in degrees (~13 m)."""
    if len(points) <= 2:
        return points

    def perp_dist(pt, a, b):
        i, t, d2 = project_point_on_polyline(pt, [a, b])
        return math.sqrt(d2)

    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        lo, hi = stack.pop()
        if hi - lo < 2:
            continue
        max_d, max_i = -1.0, -1
        for i in range(lo + 1, hi):
            d = perp_dist(points[i], points[lo], points[hi])
            if d > max_d:
                max_d, max_i = d, i
        if max_d > tol:
            keep[max_i] = True
            stack.append((lo, max_i))
            stack.append((max_i, hi))
    return [p for p, k in zip(points, keep) if k]


def main(gtfs_path):
    zf = zipfile.ZipFile(gtfs_path)

    stops = read_csv(zf, "stops.txt")
    routes = read_csv(zf, "routes.txt")
    trips = read_csv(zf, "trips.txt")

    parent_of = {}
    stations = {}
    for s in stops:
        if s["location_type"] == "1":
            stations[s["stop_id"]] = {
                "id": s["stop_id"],
                "name": s["stop_name"],
                "lat": round(float(s["stop_lat"]), 6),
                "lon": round(float(s["stop_lon"]), 6),
                "routes": set(),
            }
        else:
            parent_of[s["stop_id"]] = s["parent_station"] or s["stop_id"]

    route_info = {}
    for r in routes:
        if r["route_id"] in ROUTE_MERGE:
            continue
        route_info[r["route_id"]] = {
            "id": r["route_id"],
            "name": r["route_short_name"] or r["route_id"],
            "longName": r["route_long_name"],
            "color": "#" + (r["route_color"] or "6D6E71"),
            "textColor": "#" + (r["route_text_color"] or "FFFFFF"),
            "sort": int(r["route_sort_order"] or 999),
        }

    trip_route = {
        t["trip_id"]: ROUTE_MERGE.get(t["route_id"], t["route_id"]) for t in trips
    }
    trip_shape = {t["trip_id"]: t["shape_id"] for t in trips}

    # Ordered station sequence for every trip (streamed; stop_times is large).
    print("Reading stop_times...", file=sys.stderr)
    trip_seq = defaultdict(list)
    with zf.open("stop_times.txt") as f:
        reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"))
        for row in reader:
            trip_seq[row["trip_id"]].append(
                (int(row["stop_sequence"]), parent_of.get(row["stop_id"], row["stop_id"]))
            )

    # For each (route, shape) keep one representative trip: the one with the
    # most stops. Different shapes capture branches and short-turn patterns.
    rep = {}
    for trip_id, seq in trip_seq.items():
        rid = trip_route.get(trip_id)
        sid = trip_shape.get(trip_id)
        if not rid or not sid:
            continue
        key = (rid, sid)
        if key not in rep or len(seq) > len(trip_seq[rep[key]]):
            rep[key] = trip_id

    print("Reading shapes...", file=sys.stderr)
    shape_pts = defaultdict(list)
    with zf.open("shapes.txt") as f:
        reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"))
        for row in reader:
            shape_pts[row["shape_id"]].append(
                (int(row["shape_pt_sequence"]), float(row["shape_pt_lat"]), float(row["shape_pt_lon"]))
            )
    shapes = {
        sid: [(lat, lon) for _, lat, lon in sorted(pts)] for sid, pts in shape_pts.items()
    }

    # Cut each representative trip's shape at its stations' projections,
    # producing one geometry per adjacent-station pair per route.
    print("Cutting segments...", file=sys.stderr)
    segments = {}  # (route, a, b) -> polyline
    for (rid, sid), trip_id in sorted(rep.items()):
        line = shapes.get(sid)
        seq = [st for _, st in sorted(trip_seq[trip_id])]
        # record which routes serve each station regardless of geometry
        for st in seq:
            if st in stations:
                stations[st]["routes"].add(rid)
        if not line or len(seq) < 2:
            continue
        proj = []
        for st in seq:
            if st not in stations:
                proj.append(None)
                continue
            i, t, _ = project_point_on_polyline((stations[st]["lat"], stations[st]["lon"]), line)
            proj.append((i, t))
        for a in range(len(seq) - 1):
            b = a + 1
            st_a, st_b = seq[a], seq[b]
            if proj[a] is None or proj[b] is None:
                continue
            key = (rid, *sorted((st_a, st_b)))
            if key in segments:
                continue
            piece = simplify(slice_polyline(line, proj[a], proj[b]))
            segments[key] = piece

    used_routes = {rid for rid, _, _ in segments} | {
        r for st in stations.values() for r in st["routes"]
    }

    out = {
        "generated": "MTA static GTFS",
        "routes": [
            {k: v for k, v in info.items()}
            for rid, info in sorted(route_info.items(), key=lambda kv: kv[1]["sort"])
            if rid in used_routes
        ],
        "stations": sorted(
            (
                {
                    "id": st["id"],
                    "name": st["name"],
                    "lat": st["lat"],
                    "lon": st["lon"],
                    "routes": sorted(st["routes"]),
                }
                for st in stations.values()
                if st["routes"]
            ),
            key=lambda s: s["name"],
        ),
        "segments": [
            {
                "route": rid,
                "a": a,
                "b": b,
                "pts": [[round(lat, 5), round(lon, 5)] for lat, lon in pts],
            }
            for (rid, a, b), pts in sorted(segments.items())
        ],
    }

    js = "window.SUBWAY_DATA = " + json.dumps(out, separators=(",", ":")) + ";\n"
    with open(OUT_PATH, "w") as f:
        f.write(js)
    n_sub = sum(1 for s in out["stations"] if s["routes"] != ["SI"])
    print(
        f"Wrote {OUT_PATH}: {len(out['stations'])} stations "
        f"({n_sub} subway), {len(out['segments'])} segments, "
        f"{len(out['routes'])} routes, {len(js)//1024} KB",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "gtfs_subway.zip")
