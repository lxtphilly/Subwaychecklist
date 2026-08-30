# NYC Subway Station Checklist

A map-based checklist for visiting every station in the NYC subway. Every
station is a clickable dot on a real map of the city; the subway lines start
out gray and take on their official MTA colors segment by segment as you
check off the stations at both ends — so the map literally fills in with
color as you complete the system.

## Features

- **All 496 stations** (475 subway + 21 Staten Island Railway) from the
  MTA's official GTFS feed, with real track geometry.
- **Click a station** on the map (or its checkbox in the sidebar) to mark it
  visited; the visit date is recorded.
- **Lines fill in with color**: each stretch of track is colored only once
  both of its end stations are visited.
- **Per-line progress bars** — click a line to focus it and dim the rest of
  the system (handy for working one line at a time).
- **Search** the full station list; click a result to fly to it on the map.
- **Progress lives in your browser** (localStorage) with JSON
  export/import for backups or moving between devices, plus an optional
  toggle to include/exclude the Staten Island Railway from your total.
- No backend, no build step, no accounts — a fully static site.

A note on counting: station complexes (e.g. 14 St–Union Sq) appear as their
component stations (4/5/6, L, and N/Q/R/W are three separate check-offs
there), matching how the MTA officially counts its stations.

## Running it

It's a static site — serve the folder any way you like:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Or host it for free with **GitHub Pages**: repo Settings → Pages → deploy
from your default branch, root folder. Done.

Your checklist progress is stored per-browser/per-site, so once you settle
on a URL, stick with it (or use Export/Import to move your progress).

## Updating the station data

The dataset in `data/subway_data.js` is generated from the MTA's static
GTFS feed. To refresh it (e.g. when a new station opens):

```sh
curl -sSL https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip -o gtfs_subway.zip
python3 scripts/build_data.py gtfs_subway.zip
```

The build script picks out parent stations, cuts each route's track shape
into station-to-station segments (so the app can color each stretch
independently), merges express variants (6X/7X/FX) into their parent lines,
and writes everything as one compact JS file. Station IDs are the MTA's own
GTFS stop IDs, so your saved progress survives data refreshes.

## Tech

- Plain HTML/CSS/JS — no framework, no bundler.
- [Leaflet](https://leafletjs.com/) 1.9.4 (vendored in `vendor/leaflet/`)
  with CARTO basemap tiles.
- Station/route/geometry data © [MTA](https://www.mta.info/developers),
  via their public GTFS feed.
