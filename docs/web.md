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
| `js/pages/map.js` | Answer-first map: headline question and answer, ranked dose-site list, More options drawer (measure, 3D, terrain, find a barangay, all cities), legend with units, guided tour (`localStorage` key `lambat.tourSeen`), national view with sized city markers. `window.__lambatMap` is exposed for debugging. A `ResizeObserver` keeps the canvas sized; `pad()` adapts to the panels |
| `js/pages/city.js` | Tabs: Overview, Dose points, Barangays (search, sort, CSV), Alert |
| `js/pages/radar.js` | Radar explainer, USA and Spain example chips, "How it learned" and "How it works" GIFs, results, Egay card |
| `js/pages/method.js` | Problem, 5-step pipeline, definitions, validation forest plot, limits, APA references, run commands |
| `assets/radar/` | Example chips and the two GIFs; regenerate with `scripts/make_unet_gif.py` and `scripts/make_training_gif.py` (`--render-only` reuses `checkpoints/training_replay.npz`) |

## Data contract (`web/data/`, written by `scripts/build_web.py`)

- `cities.json`: one entry per city: `code, name, region, province, lon, lat, bbox, barangays, population, exposed, exposed_share, weekly_capsules, lepto_cases_2008_2022, access_gap, coverage_after {"3","5","8"}, alert {status, correlation, caught, false_alerts, baseline_correlation}, steps`.
- `<code>/barangays.geojson`, `<code>/dose_points.geojson` (every site of every plan, with `plans` and `rank_in_plan`), `<code>/summary.json`, `<code>/alert_scores.json`, `<code>/alert_predictions.csv`, optional `PH015518000/s1_flood.geojson`.
- `national.json`: totals and the pooled alert.

## Known issues to fix next

1. The "LAMBAT" wordmark in the sidebar is dark on blue and nearly invisible.
2. No skeleton loaders while data loads.
3. No loading screen over the map (it can take 10 to 30 s for the basemap style and data).
4. Home: the decorative waves behind the stats row are not continuous at the right edge.
5. Map headline and tour cards: the gold glow looks glitched and the gold top accent bends around the rounded corners. Replace it with a straight, extended, slanted gold stripe across the top.
6. GIF labels are about 4 px on phones; the "Show as diagram" version is the readable fallback.
7. Design fork on branch `design-apple` (worktree `../lambat-apple`, audit in its `web/DESIGN_AUDIT.md`) is pending a decision. Its dark mode flips the ramp so the worst-hit barangays read pale.

## Conventions

Colours only from `base.css` tokens; gold only for dose points and highlights, never small text on light backgrounds; text contrast at least 4.5:1; plain language, no em dashes; no team, school or person names. Test at 1440x900 and 375 or 390 px wide, with no horizontal scroll and no console errors other than the optional `s1_flood.geojson` 404.
