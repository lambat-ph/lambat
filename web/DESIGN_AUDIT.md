# LAMBAT design audit (apple-design, web edition)

Scope: every page of the web app at 1440x900 and 390x844 before the redesign: `#/` home, `#/map`, `#/city/PH015518000` (all four tabs), `#/radar`, `#/method`.
This is a web app, so the review applies Apple's design principles and foundations (accessibility, color, typography, layout, writing) plus the component pages for navigation, controls, charts and tables, translated to the web. It does not apply Apple platform conventions that have no web equivalent.
Measured from the code and from rendered pages. Contrast is computed from hex values.

Thesis of the product: one screen answers one question for a city health officer, "where do we hand out medicine first?"
What it was remembered by before: a saturated blue sidebar and a gold left stripe. What it is remembered by now: calm neutral chrome so the blue choropleth and the gold numbered dose points are the only loud things on the page.

## Summary

Overall rating before: Needs work. Nothing was Critical (text contrast, focus rings, reduced motion and skip link were already sound). Several High findings: no dark appearance, two web fonts for a one-family job, heavy chrome competing with the data, controls that did not read as controls, and small type inside charts.

## Findings, ranked by impact

### 1. No dark appearance (High)
- What: single light palette. Every colour hard-coded to one appearance. The map JS also baked light colours (ink selection outline, light ramp, light basemap).
- Why: `dark-mode.md`, "support both light and dark appearances" and use semantic colors. `color.md`, "Colors ... work in light, dark, and increased contrast."
- Fix: semantic token layer in `base.css` (`--bg --surface --surface-2 --ink --ink-2 --ink-3 --line --fill --accent --accent-ink`), second set under `prefers-color-scheme: dark`, `color-scheme: light dark`, `theme-color` meta. The data ramp flips direction in dark (dim to bright, more = brighter). `config.js` makes `COLORS` and `RAMP` live so the map and SVG previews follow the system and redraw on change. The vector basemap is recoloured by layer role in dark. No in-app theme switch (HIG: follow the system).

### 2. Sidebar and tab bar were the loudest thing on every page (High)
- What: full-bleed saturated blue sidebar, white text, gold edge marker, 4 px bars. On mobile a blue tab bar with a gold top bar and 11 px labels at 64 px. The brand colour was spent on chrome, not on data.
- Why: `branding.md`, branding defers to content. `liquid-glass.md`, "functional layer ... controls float above content". `sidebars.md`, "Make sure any sidebar icon colors you choose serve a clear purpose." `tab-bars.md`, "Avoid applying a similar color to tab labels and content layer backgrounds."
- Fix: sidebar is a quiet translucent neutral with the accent used only for the selected item (tinted pill, accent text and icon). It collapses to a 72 px icon rail, and now collapses by default under 1024 px. Mobile gets a proper tab bar: glass material, 56 px plus the safe-area inset, 24 px icons with 12 px labels, selected item accent coloured, five single-word-ish labels, always visible. `viewport-fit=cover` added so the bar clears the home indicator.

### 3. Two display fonts from Google for a data tool (High)
- What: Space Grotesk for headings and numbers, Public Sans for text. Two families, two network fetches, and the display face added personality that was not rooted in the product.
- Why: `typography.md`, few typefaces and a clear scale, weight and size carry hierarchy. `cross-platform.md` and the skill, system type for navigation and controls.
- Fix: one family. System stack first (`-apple-system, SF Pro, Inter, Segoe UI`), Inter as the only web font so Windows and Android match. A six-step scale: 12, 14, 16, 20, 26 to 34, display 34 to 56. Tight tracking at display sizes, tabular numbers everywhere. Hierarchy comes from size and weight, not boxes.

### 4. Controls did not read as controls (High)
- What: segmented control selected state was a solid blue block; switches were 44x26; tabs were underline tabs with a thick gold bar; ghost buttons were outlined with a 2 px border; the measure picker was a stack of bordered radio cards.
- Why: `segmented-controls.md`, "segments ... preserve their grouping" and show selection state clearly. `toggles.md`. `buttons.md`, one clear primary, quieter secondary. `lists-and-tables.md`.
- Fix: segmented control with a raised white thumb on a tinted track (also used for the city tabs, which are one choice among related views). 51x31 switch with a shadowed knob and eased travel. Secondary buttons are tinted, not outlined. The measure picker is an inset grouped list with hairline separators and a check on the selected row. All keep their `aria-pressed`, `role="tab"` and `role="switch"` semantics.

### 5. Floating map layer was opaque white boxes with drop shadows and a gold stripe (Medium)
- What: headline strip, site list, legend, options drawer and tour card were separate white cards, each with a heavy shadow. The strip spanned the whole map width.
- Why: `liquid-glass.md`, glass on the floating functional layer only, regular variant for anything text-heavy, no glass in content; `materials.md`; `maps.md`, "make your map interactive ... non-interactive elements that obscure the map can interfere".
- Fix: `strip`, panels, options and tour use one regular translucent material (`--glass`, 24 px blur, 84% opacity, hairline edge). Map zoom and attribution use the thin variant. Solid fallback under `@supports not (backdrop-filter)` and `prefers-reduced-transparency`. On desktop the headline is capped at 760 px so more map shows. The gold stripe is gone: gold now means dose points and tour highlights only. The mobile bottom sheet stays solid (it carries a list).

### 6. Chart text rendered at 7 to 9 px and charts carried decoration (High on mobile)
- What: SVG charts had a fixed `viewBox` (640 to 760 wide) scaled down to a 326 px card, so 12 px labels drew at about 7 px. Five gridlines and a y axis sat behind bars that already had value labels. A vertical grid line per year on the weekly chart.
- Why: `charting-data.md`, "Keep a chart simple", resist packing in data; `charts.md`; `typography.md`, minimum 11 pt.
- Fix: the two live city charts redraw to the width they are shown at (`ResizeObserver`), so labels stay 12 px. Coverage chart: gridlines and axis removed, direct value labels only, a baseline, short labels on narrow screens. Weekly chart: about four horizontal rules, year ticks instead of vertical rules, axis title on top. Radar score chart: gridlines and y labels removed. Bar fills use tokens, so they work in dark.

### 7. Home page decoration and weak hierarchy (Medium)
- What: animated drifting diamonds and two animated waves behind the content, a logo repeated three times (sidebar, brand line, favicon-pin), the preview map half-hidden beside the steps, stats under the fold.
- Why: `design-principles.md`, Simplicity and "don't mistake delight for decoration"; `motion.md`, motion is optional and brief; `branding.md`, logos don't repeat.
- Fix: static two-column hero (display headline, plain lede, one primary action, the preview map as the signature). Steps are a three-column row. Stats are a hairline-separated row. Brand line only shows on phones where there is no sidebar. No ambient animation. Page content fades up 6 px in 280 ms, off under reduced motion.

### 8. Tables and cards leaned on borders (Medium)
- What: filled coloured header row, 1 px grid on every cell, card shadows on every surface, uppercase tracked eyebrows.
- Why: `lists-and-tables.md`; `layout.md`, hierarchy through grouping and spacing.
- Fix: quiet 12 px secondary header, hairline row separators, no vertical rules, numeric columns right aligned and tabular, sticky header on the surface colour, first and last cell flush with the card text edge, header cells wrap on phones. Cards use a half-pixel edge instead of a drop shadow. Eyebrows are sentence case 14 px, not uppercase.

### 9. Touch targets under 44 px (Medium)
- What on mobile: segmented buttons 40 px, tabs 40 to 48, switch rows 40, bottom-sheet handle 28, dose markers 32, close buttons 40, table sort buttons 32.
- Why: `accessibility.md`, "default 44x44 pt". 
- Fix: seg buttons and tabs are 44 on phones and coarse pointers, close buttons 44, sheet handle 44, dose markers keep their 32 px dot with a 44 px invisible hit area. Scripted check on the mobile pages now reports only the 36 px desktop plan buttons (44 on touch).

### 10. Copy and labels (Low)
- "k" as a column header on the dose plan table is jargon. Changed to "Plan". Page sub-copy uses plain sentence case consistently, which is kept (see not changed).

## What works (kept)
- Answer-first headline on the map, ranked dose-site list, More options drawer, guided tour that can be skipped at any step and ends in two actions.
- Hash router, `data.js` adapter, tab keyboard model, skip link, `aria-live` on the answer and details, radar reduced-motion image swap, text alternatives for every chart.
- Plain language, real numbers, direct "fewer / more" legend words.
- One hue for the data ramp, gold reserved for dose points.

## Craft notes
- Point of view: before, none beyond the brand colour on chrome. After, a quiet utility whose only loud elements are the choropleth and the gold rank dots. Deliberate.
- Template check: no cream and serif, no acid accent on black, no hairline broadsheet. The big-number-over-small-label hero was avoided; the numbers sit in a plain row.
- Remove one accessory: removed the animated home background, the gold stripe and the uppercase eyebrows.

## Contrast figures used (computed from hex)
Light: ink #141A2E on #EEEEEE 14.9:1; secondary #4A5168 on #EEEEEE 6.8:1; tertiary #5C637A on #EEEEEE 5.1:1; accent #0038BD on white 9.1:1; white on accent 9.1:1; ink on gold #EFBE01 9.9:1; field outline #8A91A6 on white 3.2:1.
Dark: ink #F1F3FA on #151A26 15.7:1; secondary #A8B0C6 8.0:1; tertiary #8D96AE 5.9:1; accent text #8FB0FF 8.1:1; white on button #3A66E8 4.95:1; gold on surface 10.0:1. Dark ramp steps are dim to bright so the lowest class is still distinguishable from the dark basemap.
Gold is never used as small text on light backgrounds.

## Not changed, and why
- Sentence-case labels. Apple uses title-style for buttons, but the whole app is consistently sentence case and web readers expect it. Consistency matters more than the convention.
- Information architecture, routes, data paths, map layers and every feature. This was a visual and interaction pass only.
- Brand colours. Blue #0038BD, gold #EFBE01 and light grey #EEEEEE are all still present as tokens. Blue is lightened only as a text and fill token in dark mode so it stays legible.
- Map hillshade and 3D extrusion. They are optional layers behind a switch and already work.
- `js/charts.js`. It is not imported anywhere (the live charts are in `city.js`, `radar.js`, `method.js`), so it was left as is.
- Method page forest plot and pipeline diagrams keep their SVG layouts. They only changed to token colours and a readable secondary text colour.
- Map data completeness. The "1 of the 3 sites ... on the map so far" line comes from the data files, not the design.
