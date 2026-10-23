# Web app notes

The site in `web/` is static: plain HTML, CSS and ES modules, no build step. GitHub Pages deploys `web/` once the repo is public (`.github/workflows/pages.yml`, Settings > Pages > Source = GitHub Actions).

## Run it locally

```bash
uv run python scripts/build_web.py          # copies results/ into web/data/
uv run python -m http.server 8765 -d web    # then open http://localhost:8765
```

On Windows PowerShell 5.1, `&&` does not work; use `;` or separate lines. If `python` is not found, use `py` or `uv run python`.

## Structure

| File | Role |
|---|---|
| `index.html` | Shell: sidebar (bottom tab bar under 768 px), skip link, `<main id="view">`, fonts, MapLibre 4.7.1 |
| `css/base.css` | All design tokens (colours, ramp, spacing, type, radii, shadows) and shared components (`.card`, `.seg`, `.tabs`, `.stat`, `.table`, `.btn`, `.switch`) |
| `css/<page>.css` | Page styles, linked by each page module through `useCss()` |
| `js/config.js` | `REPO_URL` (the only place the repo link lives), `COLORS`, `RAMP`, basemap and terrain URLs |
| `js/data.js` | `getCities()`, `getCity(code)`, `getNational()`; caches fetches; falls back to the old flat Dagupan files when `cities.json` is absent |
| `js/app.js` | Hash router: `#/`, `#/map[/code|/all]`, `#/city/<code>[/tab]`, `#/radar`, `#/method`; lazy-imports `js/pages/<name>.js`, which export `render(el, params)` and `destroy()` |
| `js/format.js` | `fmt`, `pct`, `compact`, `esc`, `useCss` |
| `js/pages/map.js` | Map page. 600 px and up: floating frosted cards on the left over a full-size map (answer with hazard band, tour link, 3/5/8 picker, coverage line, ranked expandable site rows, dose point footnote, legend) beside the map; under 600 px: the column is a two-height bottom sheet. On the map: controls, frosted More options button and drawer, barangay card, tour (`localStorage` key `lambat.tourSeen`). Rolling numbers, `?` popovers, branded loader removed on first `idle`, skeletons with `aria-busy`. National view lists cities in the column. `window.__lambatMap` for debugging; `ResizeObserver` keeps the canvas sized |
| `js/pages/city.js` | Tabs: Overview, Dose points, Barangays (search, sort, CSV), Alert |
| `js/pages/radar.js` | Satellite flood maps (nav label; route #/radar): short story plus collapsed Technical details. Radar explainer, USA and Spain example chips, "How it learned" and "How it works" GIFs, results, Egay card |
| `js/pages/method.js` | Problem, 5-step pipeline, definitions, validation forest plot, limits, APA references, run commands |
| `assets/radar/` | Example chips and the two GIFs; regenerate with `scripts/make_unet_gif.py` and `scripts/make_training_gif.py` (`--render-only` reuses `checkpoints/training_replay.npz`) |

## Data contract (`web/data/`, written by `scripts/build_web.py`)

- `cities.json`: one entry per city: `code, name, region, province, lon, lat, bbox, barangays, population, exposed, exposed_share, weekly_capsules, lepto_cases_2008_2022, access_gap, coverage_after {"3","5","8"}, alert {status, correlation, caught, false_alerts, baseline_correlation}, steps`.
- `<code>/barangays.geojson`, `<code>/dose_points.geojson` (every site of every plan, with `plans` and `rank_in_plan`), `<code>/summary.json`, `<code>/alert_scores.json`, `<code>/alert_predictions.csv`, optional `PH015518000/s1_flood.geojson`.
- `national.json`: totals and the pooled alert.

## Known issues to fix next

1. GIF labels are about 4 px on phones; the "Show as diagram" version is the readable fallback.
2. Design fork `design-apple` was not chosen (23 Oct); only its frosted glass panels were ported. Branch kept for reference.
3. Ideas not yet built (Cult UI survey): direction-aware city tabs, progress bars and tier badges in tables, edge-fade on scroll lists, copy-citation buttons.

## Words (one term per concept, everywhere: pages, tables, legends, popovers, URL labels shown to users)

| Concept | Say | Definition to show on first use |
|---|---|---|
| 25-year flood | 25-year flood | A flood big enough that it has about a 4% chance of happening in any year (UP NOAH hazard map) |
| exposed | exposed residents | People who live where a 25-year flood reaches |
| cannot reach care | cut off from care | Exposed residents more than a 30-minute walk from a clinic while the flood is on |
| access gap | lose access in the flood | Residents who can walk to a clinic on a dry day but not during the flood (estimated) |
| site, k | dose point; plan size (3, 5 or 8 dose points) | A temporary spot, such as a school or barangay hall, where a nurse hands out doxycycline for a few weeks after the flood |
| barangay rank | rank (most people cut off from care first) | Shown only in the city table, never next to dose point order |
| site rank | dose point order (1 opens first) | Order that covers the most cut-off residents first |
| alert | rain warning (test on past data, 2017 to 2019) | A two-week-ahead warning from rainfall, tested on past data, not live |

Facility types are shown in plain words (Barangay hall, School, Health centre), never raw OSM values like `townhall`.

## Conventions

Colours only from `base.css` tokens; gold only for dose points and highlights, never small text on light backgrounds; text contrast at least 4.5:1; plain language, no em dashes; no team, school or person names. Test at 1440x900 and 375 or 390 px wide, with no horizontal scroll and no console errors other than the optional `s1_flood.geojson` 404.
