import { getCities, getCity, cityHref, barangayHref, tierOf } from "../data.js";
import { TERRARIUM, BASEMAP, BASEMAP_ATTR, BASE_STYLE_URL, SATELLITE, SATELLITE_ATTR, COLORS, RAMP, RISK, WALK_MIN } from "../config.js";
import { fmt, pct, compact, esc, reducedMotion, useCss } from "../format.js";
import { mountSearch } from "../search.js";

const METRICS = [
  { key: "exposed", prop: "exposed", short: "Exposed", label: "Exposed residents", unit: "residents", f: fmt, ramp: RISK },
  { key: "unreached", prop: "exposed_unreached_flood", short: "Cut off", label: "Out of reach in a flood", unit: "residents", f: fmt, ramp: RISK },
  { key: "share", prop: "flooded_share", short: "Flooded", label: "Share of area flooded", unit: "of area", f: (v) => pct(v, 0), ramp: RAMP },
];
const SEEN_KEY = "lambat.tourSeen";

const TEMPLATE = `
<div class="mapwrap">
  <div id="map" role="region" aria-label="Map of flood exposure by barangay. The dashboard shows the same data as tables."></div>
  <div class="loading" id="loading" role="status">Loading the map</div>
  <p class="scenario map-scn" id="scn">Model estimate, screening tool</p>
  <aside class="panel closed" id="dock" aria-label="Map controls">
    <button class="sheet-handle" id="handle" type="button" aria-expanded="false" aria-label="Show map controls"></button>
    <section class="p-sec p-head" id="caption" aria-live="polite">
      <div class="p-title"><h1 id="pickTitle">Choose a city</h1><button class="linkbtn" id="pickBack" type="button" hidden>All cities</button></div>
      <p class="cap-text" id="capText"></p>
      <button class="linkbtn" id="tourBtn" type="button" hidden>How to read this map</button>
    </section>
    <section class="p-sec" id="picker" aria-label="Find a place">
      <div id="pickList">
        <label class="sr-only" for="cityPick">Search cities</label>
        <input class="field" id="cityPick" type="search" placeholder="Search a city" autocomplete="off">
        <ul class="citylist" id="cityList" style="margin-top:8px"></ul>
      </div>
      <div id="pickCity" hidden><div id="brgySearch"></div></div>
    </section>
    <section class="p-sec info" id="info" aria-label="Barangay details" hidden aria-live="polite"></section>
    <section class="p-sec" id="wMetric" aria-label="Colour barangays by" hidden>
      <h2 id="metricH">Colour barangays by</h2>
      <div class="seg" id="metricSeg" role="group" aria-labelledby="metricH"></div>
      <div class="w-legend" id="legend" aria-label="Legend"></div>
    </section>
    <section class="p-sec opt" id="wView" aria-label="Dose points" hidden>
      <h2 id="planH">Temporary dose points</h2>
      <div class="seg" id="planSeg" role="group" aria-labelledby="planH"></div>
      <p class="map-note" id="planNote" style="margin-top:8px" aria-live="polite"></p>
    </section>
    <section class="p-sec opt" id="wLayers" aria-label="Layers" hidden>
      <h2>Layers</h2>
      <label class="switch"><span>Dose points</span><input type="checkbox" role="switch" id="lyDose" checked></label>
      <label class="range"><span>Shading opacity</span><input type="range" id="lyOp" min="20" max="100" value="85"></label>
      <label class="switch"><span>Satellite imagery</span><input type="checkbox" role="switch" id="lySat"></label>
      <label class="switch"><span>3D columns</span><input type="checkbox" role="switch" id="ly3d"></label>
      <label class="switch"><span>Terrain relief</span><input type="checkbox" role="switch" id="lyRelief"></label>
      <label class="switch" id="lyS1wrap" hidden><span>Radar flood share</span><input type="checkbox" role="switch" id="lyS1"></label>
      <p class="map-note" id="reliefNote" hidden></p>
    </section>
    <p class="p-sec p-foot opt"><a id="dashLink" href="#/city">Same data as a table</a> · <a href="#/method">How it works</a></p>
  </aside>
</div>`;

let map, tip, host, S, mobile, ro, onKey;
const $ = (s) => host.querySelector(s);
const dur = (n) => (reducedMotion() ? 0 : n);
const cityName = () => { const c = S.cities.find((x) => x.code === S.city); return c ? c.name : ""; };
const years = () => { const m = S.data && S.data.summary && /(\d+)/.exec(S.data.summary.scenario || ""); return m ? +m[1] : 25; };

export async function render(el, params) {
  useCss("map");
  host = el;
  mobile = window.matchMedia("(max-width:767px)");
  S = { opacity: 0.85, cities: [], city: null, data: null, metric: METRICS[0], view: "2d", plan: "8", sel: null, reliefOn: false, reliefOK: null, breaks: [], min: 0, max: 1, scaleH: 1000, markers: [], cityMarkers: [], tour: null, params, dead: false };
  el.innerHTML = TEMPLATE;
  try { S.cities = await getCities(); } catch { S.cities = []; }
  if (!S.cities.length) { $("#loading").textContent = "No city data found."; return; }
  wire();
  boot();
}

export function destroy() {
  if (S) { S.dead = true; endTour(false, true); }
  if (ro) { ro.disconnect(); ro = null; }
  try { if (map) map.remove(); } catch {}
  map = null;
}

function syncUrl() {
  if (S.dead) return;
  let h = "#/map/all";
  if (S.city) {
    const p = new URLSearchParams({ metric: S.metric.key, plan: S.plan });
    if (S.view === "3d") p.set("view", "3d");
    if (S.sel) p.set("b", S.sel);
    h = "#/map/" + encodeURIComponent(S.city) + "?" + p;
  }
  history.replaceState(null, "", h);
}

/* ---------- map setup ---------- */
async function baseStyle() {
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch(BASE_STYLE_URL, { signal: ctl.signal }); clearTimeout(t);
    if (r.ok) return BASE_STYLE_URL;
  } catch {}
  return { version: 8, sources: { base: { type: "raster", tiles: [BASEMAP], tileSize: 256, maxzoom: 19, attribution: BASEMAP_ATTR } }, layers: [{ id: "base", type: "raster", source: "base" }] };
}

async function boot() {
  const style = await baseStyle();
  if (S.dead) return;
  try {
    map = new maplibregl.Map({
      container: $("#map"),
      style,
      center: [121.8, 12.6], zoom: 5, pitch: 0, maxPitch: 75, attributionControl: false,
    });
  } catch (e) {
    $("#loading").innerHTML = 'This browser could not start the map. <a href="#/city">Open the city dashboard</a> for the same data as tables.';
    $("#loading").style.pointerEvents = "auto";
    return;
  }
  map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showCompass: true }), "bottom-right");
  tip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: "tip", maxWidth: "260px" });
  window.__lambatMap = map;
  // The container can still be settling when the map starts; keep the canvas in step with it.
  ro = new ResizeObserver(() => { if (map) map.resize(); });
  ro.observe($("#map"));
  map.on("error", (e) => console.warn("map error:", e.error && e.error.message));
  map.on("load", onLoad);
  map.once("idle", () => { const l = $("#loading"); if (l) l.hidden = true; });
}

async function onLoad() {
  const sym = map.getStyle().layers.find((l) => l.type === "symbol");
  S.before = sym ? sym.id : undefined;
  map.addSource("dem", { type: "raster-dem", tiles: [TERRARIUM], encoding: "terrarium", tileSize: 256, maxzoom: 15, attribution: "Terrain: Mapzen, AWS Open Data" });
  map.addSource("sat", { type: "raster", tiles: [SATELLITE], tileSize: 256, maxzoom: 18, attribution: SATELLITE_ATTR });
  map.addLayer({ id: "sat", type: "raster", source: "sat", layout: { visibility: "none" } }, S.before);
  map.addLayer({ id: "hill", type: "hillshade", source: "dem", layout: { visibility: "none" }, paint: { "hillshade-exaggeration": 0.5, "hillshade-shadow-color": "#3B4A78", "hillshade-highlight-color": "#FFFFFF", "hillshade-accent-color": "#6F7FB0" } }, S.before);
  buildNational();
  const code = S.params.code;
  const q = S.params.query;
  const m = METRICS.find((x) => x.key === q.get("metric"));
  if (m) S.metric = m;
  if (["3", "5", "8"].includes(q.get("plan"))) S.plan = q.get("plan");
  if (q.get("view") === "3d") S.view = "3d";
  if (code === "all") {
    showNational(true);
  } else if (code && S.cities.some((c) => c.code === code)) {
    await selectCity(code, true);
    if (q.get("b") && S.data && S.data.rows.some((r) => r.id === q.get("b"))) selectBrgy(q.get("b"), true);
    else maybeTour();
  } else {
    // No city in the address: open the biggest city straight in its barangay map.
    await selectCity(S.cities[0].code, true);
    maybeTour();
  }
}

/* ---------- national view: flat circles sized by exposed residents ---------- */
const natRadius = (e, mx) => Math.min(34, Math.max(9, 9 + Math.sqrt((e || 0) / mx) * 25));
function buildNational() {
  const mx = Math.max(...S.cities.map((c) => c.exposed || 0), 1);
  const gj = { type: "FeatureCollection", features: S.cities.map((c) => ({ type: "Feature", properties: { code: c.code, r: natRadius(c.exposed, mx) }, geometry: { type: "Point", coordinates: [c.lon, c.lat] } })) };
  map.addSource("nat", { type: "geojson", data: gj });
  map.addLayer({ id: "nat-dot", type: "circle", source: "nat", layout: { visibility: "none" }, paint: { "circle-radius": ["get", "r"], "circle-color": COLORS.blue, "circle-opacity": 0.55, "circle-stroke-color": "#FFFFFF", "circle-stroke-width": 2 } });
  map.on("click", "nat-dot", (e) => selectCity(e.features[0].properties.code));
  map.on("mouseenter", "nat-dot", () => { map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", "nat-dot", () => { map.getCanvas().style.cursor = ""; });
  S.cities.forEach((c) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "city-pin";
    b.innerHTML = `<b>${esc(c.name)}</b><span>${fmt(c.exposed)} exposed</span>`;
    b.setAttribute("aria-label", `${c.name}, ${fmt(c.exposed)} residents exposed. Open this city.`);
    b.addEventListener("click", () => selectCity(c.code));
    b.style.display = "none";
    S.cityMarkers.push(new maplibregl.Marker({ element: b, anchor: "left", offset: [natRadius(c.exposed, mx) + 6, 0] }).setLngLat([c.lon, c.lat]).addTo(map));
  });
}
function pad() {
  if (mobile.matches) return { top: 56, left: 24, right: 24, bottom: 200 };
  // Leave room for the side panel on the left.
  const pw = host.querySelector("#dock").offsetWidth || 0;
  return { top: 64, bottom: 48, left: pw + 40, right: 64 };
}
function showNational(first) {
  endTour(false);
  S.city = null; S.data = null; clearSel();
  setCityLayers(false);
  map.setTerrain(null);
  map.setLayoutProperty("hill", "visibility", "none");
  map.setLayoutProperty("nat-dot", "visibility", "visible");
  if (map.getLayer("s1-fill")) map.setLayoutProperty("s1-fill", "visibility", "none");
  S.cityMarkers.forEach((m) => { m.getElement().style.display = ""; });
  clearDose();
  $("#pickTitle").textContent = "Choose a city";
  $("#pickBack").hidden = true; $("#pickList").hidden = false; $("#pickCity").hidden = true;
  ["#wMetric", "#wView", "#wLayers"].forEach((s) => { $(s).hidden = true; });
  $("#info").hidden = true;
  $("#tourBtn").hidden = true;
  renderLegend();
  updateCaption();
  if (S.cities.length === 1) {
    const c = S.cities[0];
    const o = { center: [c.lon, c.lat], zoom: 7.2, pitch: 0, bearing: 0 };
    if (first) map.jumpTo(o); else map.flyTo({ ...o, duration: dur(1400) });
  } else {
    const pts = S.cities.map((c) => [c.lon, c.lat]);
    const b = pts.reduce((bb, p) => bb.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0]));
    map.fitBounds(b, { padding: pad(), maxZoom: 7.5, pitch: 0, bearing: 0, duration: first ? 0 : dur(1400) });
  }
  highlightList(null);
  syncUrl();
}

/* ---------- city view ---------- */
function breaksFor(m, feats) {
  const v = feats.map((f) => +f.properties[m.prop] || 0).sort((a, b) => a - b);
  const out = [];
  for (let i = 1; i < 5; i++) {
    const b = v[Math.floor((i * v.length) / 5)];
    if (b > (out.length ? out[out.length - 1] : v[0])) out.push(b);
  }
  return { breaks: out, min: v[0], max: v[v.length - 1] || 1 };
}
function colorExpr(withSel) {
  const R = S.metric.ramp;
  const base = ["step", ["coalesce", ["get", S.metric.prop], 0], R[0]];
  S.breaks.forEach((b, i) => base.push(b, R[i + 1]));
  return withSel ? ["case", ["boolean", ["feature-state", "sel"], false], COLORS.ink, base] : base;
}
const heightExpr = () => ["*", ["coalesce", ["get", S.metric.prop], 0], S.scaleH / S.max];
function setCityLayers(on) {
  ["b-ext", "b-flat", "b-line", "b-sel"].forEach((id) => { if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none"); });
  if (on) applyView();
}
function applyView() {
  const d3 = S.view === "3d";
  map.setLayoutProperty("b-ext", "visibility", d3 ? "visible" : "none");
  map.setLayoutProperty("b-flat", "visibility", d3 ? "none" : "visible");
  map.setLayoutProperty("b-line", "visibility", d3 ? "none" : "visible");
  map.setLayoutProperty("b-sel", "visibility", d3 ? "none" : "visible");
  $("#ly3d").checked = d3;
}
function paintMetric() {
  const b = breaksFor(S.metric, S.data.barangays.features);
  S.breaks = b.breaks; S.max = b.max || 1; S.min = b.min;
  map.setPaintProperty("b-ext", "fill-extrusion-color", colorExpr(true));
  map.setPaintProperty("b-ext", "fill-extrusion-height", heightExpr());
  map.setPaintProperty("b-flat", "fill-color", colorExpr(false));
  renderLegend();
  updateCaption();
}
function setMetric(m) {
  S.metric = m;
  [...$("#metricSeg").children].forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.k === m.key)));
  paintMetric(); syncUrl();
}
function ensureCityLayers() {
  if (map.getSource("brgy")) { map.getSource("brgy").setData(S.data.barangays); return; }
  map.addSource("brgy", { type: "geojson", data: S.data.barangays, promoteId: "adm4_pcode" });
  map.addLayer({ id: "b-ext", type: "fill-extrusion", source: "brgy", layout: { visibility: "none" }, paint: { "fill-extrusion-color": RAMP[0], "fill-extrusion-height": 0, "fill-extrusion-base": 0, "fill-extrusion-opacity": 0.94 } });
  map.addLayer({ id: "b-flat", type: "fill", source: "brgy", layout: { visibility: "none" }, paint: { "fill-color": RAMP[0], "fill-opacity": S.opacity } }, S.before);
  map.addLayer({ id: "b-line", type: "line", source: "brgy", layout: { visibility: "none" }, paint: { "line-color": "#FFFFFF", "line-width": 1.2 } }, S.before);
  map.addLayer({ id: "b-sel", type: "line", source: "brgy", layout: { visibility: "none" }, filter: ["==", ["get", "adm4_pcode"], ""], paint: { "line-color": COLORS.ink, "line-width": 3 } }, S.before);
  // Intro highlight: a dark casing under a gold line, visible in both 2D and 3D.
  const none = ["==", ["get", "adm4_pcode"], ""];
  map.addLayer({ id: "b-tour-c", type: "line", source: "brgy", filter: none, paint: { "line-color": "#FFFFFF", "line-width": 8 } }, S.before);
  map.addLayer({ id: "b-tour", type: "line", source: "brgy", filter: none, paint: { "line-color": COLORS.blue, "line-width": 4 } }, S.before);
  const pick = (e) => { const f = map.queryRenderedFeatures(e.point, { layers: [S.view === "3d" ? "b-ext" : "b-flat"] })[0]; return f ? f.properties.adm4_pcode : null; };
  map.on("click", (e) => {
    if (!S.city) return;
    if (e.originalEvent && e.originalEvent.target.closest && e.originalEvent.target.closest(".rank,.tour-tag")) return;
    const code = pick(e);
    if (code) selectBrgy(code, false); else clearSel();
  });
  map.on("mousemove", (e) => {
    if (!S.city) return;
    const code = pick(e);
    map.getCanvas().style.cursor = code ? "pointer" : "";
    if (!code) { tip.remove(); return; }
    const r = S.data.rows.find((x) => x.id === code);
    const v = S.metric.key === "share" ? r.share : S.metric.key === "unreached" ? r.unreached : r.exposed;
    tip.setLngLat(e.lngLat).setHTML(`${esc(r.name)}<span>${S.metric.label}: ${S.metric.f(v)}</span>`).addTo(map);
  });
  map.getCanvas().addEventListener("mouseleave", () => tip.remove());
}

async function probeTerrain(c) {
  if (S.reliefOK != null) return S.reliefOK;
  const z = 10, x = Math.floor(((c.lon + 180) / 360) * 2 ** z);
  const lat = (c.lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * 2 ** z);
  try {
    const r = await fetch(TERRARIUM.replace("{z}", z).replace("{x}", x).replace("{y}", y), { mode: "cors" });
    S.reliefOK = r.ok;
  } catch { S.reliefOK = false; }
  return S.reliefOK;
}
function applyRelief() {
  if (!map) return;
  const on = S.reliefOn && S.reliefOK;
  map.setTerrain(on ? { source: "dem", exaggeration: 1.5 } : null);
  map.setLayoutProperty("hill", "visibility", on ? "visible" : "none");
}

async function selectCity(code, first) {
  const c = S.cities.find((x) => x.code === code);
  if (!c) return;
  endTour(false);
  const ld = $("#loading"); ld.hidden = false; ld.textContent = "Loading " + c.name;
  let data;
  try { data = await getCity(code); } catch (e) { data = { error: e.message }; }
  if (S.dead || !map) return;
  ld.hidden = true;
  if (!data || data.error || !data.barangays) {
    const n = $("#info"); n.hidden = false; n.innerHTML = `<p class="notice">Could not load ${esc(c.name)}: ${esc((data && data.error) || "no data")}</p>`;
    return;
  }
  S.data = data; S.city = code; clearSel();
  const hasUnreached = data.rows.some((r) => r.unreached != null);
  const ub = $("#metricSeg").children[1];
  ub.disabled = !hasUnreached; ub.title = hasUnreached ? "" : "Not computed for this city yet";
  if (!hasUnreached && S.metric.key === "unreached") S.metric = METRICS[0];
  [...$("#metricSeg").children].forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.k === S.metric.key)));
  const bb = data.bbox;
  const diag = Math.hypot((bb[2] - bb[0]) * 111.32 * Math.cos((c.lat * Math.PI) / 180), (bb[3] - bb[1]) * 110.57) * 1000;
  S.scaleH = Math.max(300, diag * 0.06);
  ensureCityLayers();
  S.cityMarkers.forEach((m) => { m.getElement().style.display = "none"; });
  map.setLayoutProperty("nat-dot", "visibility", "none");
  paintMetric();
  setCityLayers(true);
  $("#pickTitle").textContent = c.name;
  $("#pickBack").hidden = false; $("#pickList").hidden = true; $("#pickCity").hidden = false;
  $("#tourBtn").hidden = false;
  $("#dashLink").href = cityHref(code, "barangays");
  $("#scn").textContent = `${years()}-year flood scenario · model estimate, not a case forecast`;
  ["#wMetric", "#wView", "#wLayers"].forEach((s) => { $(s).hidden = false; });
  buildPlanSeg();
  drawDose();
  const d3 = S.view === "3d";
  map.resize();
  map.fitBounds(bb, { padding: pad(), maxZoom: 14.5, pitch: d3 ? 50 : 0, bearing: d3 ? -12 : 0, duration: first ? 0 : dur(2200) });
  highlightList(code);
  syncUrl();
  await probeTerrain(c);
  if (S.dead || !map) return;
  $("#lyRelief").disabled = !S.reliefOK;
  $("#reliefNote").hidden = !!S.reliefOK;
  $("#reliefNote").textContent = S.reliefOK ? "" : "Terrain tiles could not be loaded.";
  applyRelief();
  loadS1();
}

function loadS1() {
  const s1 = S.data.s1Flood, lw = $("#lyS1wrap");
  if (map.getLayer("s1-fill")) map.setLayoutProperty("s1-fill", "visibility", "none");
  $("#lyS1").checked = false;
  if (!s1 || !s1.features || !s1.features.length) { lw.hidden = true; return; }
  const p = s1.features[0].properties || {};
  const keys = Object.keys(p).filter((k) => typeof p[k] === "number" && /share|flood/i.test(k) && !/noah/i.test(k));
  const key = keys.find((k) => /change/i.test(k)) || keys.find((k) => /s1/i.test(k)) || keys[0];
  if (!key) { lw.hidden = true; return; }
  if (map.getSource("s1")) map.getSource("s1").setData(s1);
  else map.addSource("s1", { type: "geojson", data: s1 });
  if (!map.getLayer("s1-fill")) map.addLayer({ id: "s1-fill", type: "fill", source: "s1", layout: { visibility: "none" }, paint: { "fill-color": ["interpolate", ["linear"], ["get", key], 0, RAMP[0], 1, RAMP[4]], "fill-opacity": 0.7 } }, "b-line");
  lw.hidden = false;
}

/* ---------- selection and info card ---------- */
function clearSel() {
  if (S.sel && map && map.getSource("brgy")) map.setFeatureState({ source: "brgy", id: S.sel }, { sel: false });
  S.sel = null;
  if (map && map.getLayer("b-sel")) map.setFilter("b-sel", ["==", ["get", "adm4_pcode"], ""]);
  $("#info").hidden = true;
  syncUrl();
}
function selectBrgy(code, fly) {
  if (S.sel) map.setFeatureState({ source: "brgy", id: S.sel }, { sel: false });
  S.sel = code;
  map.setFeatureState({ source: "brgy", id: code }, { sel: true });
  map.setFilter("b-sel", ["==", ["get", "adm4_pcode"], code]);
  const r = S.data.rows.find((x) => x.id === code);
  const info = $("#info");
  info.hidden = false;
  const t = tierOf(r.priority, S.data.rows.length);
  const said = [];
  if (r.pop) said.push(`${fmt(r.exposed)} of ${fmt(r.pop)} residents (${pct(r.exposed / r.pop, 0)}) live where the flood reaches.`);
  else said.push(`${fmt(r.exposed)} residents live where the flood reaches.`);
  if (r.unreached != null && r.exposed) said.push(`${fmt(r.unreached)} of them cannot walk to a clinic within ${WALK_MIN} minutes while the flood is on.`);
  info.innerHTML = `<button class="close" type="button" aria-label="Close details">&times;</button>
    <p class="eyebrow" style="margin:0">Barangay</p>
    <h2>${esc(r.name)}</h2>
    <p class="info-tier">${t ? `<span class="tier ${t.key}">${t.label}</span>` : ""}<span>Rank ${r.priority} of ${S.data.rows.length}</span></p>
    <p class="said">${said.join(" ")}</p>
    <dl><dt>Exposed</dt><dd>${fmt(r.exposed)}</dd>
    ${r.unreached != null ? `<dt>Cut off in a flood</dt><dd>${fmt(r.unreached)}</dd>` : ""}
    <dt>Area under water</dt><dd>${pct(r.share, 0)}</dd>
    <dt>Capsules per flood week</dt><dd>${fmt(r.capsules)}</dd></dl>
    <a class="btn sm" href="${barangayHref(r.id)}">Open barangay report</a>`;
  if (mobile.matches) openSheet(true);
  info.scrollIntoView({ block: "nearest" });
  syncUrl();
  info.querySelector(".close").addEventListener("click", clearSel);
  if (fly) {
    const f = S.data.barangays.features.find((x) => x.properties.adm4_pcode === code);
    map.fitBounds(boundsOf(f), { padding: pad(), maxZoom: S.view === "3d" ? 13 : 15, duration: dur(900), pitch: S.view === "3d" ? 45 : 0 });
  }
}
function boundsOf(f) {
  const b = new maplibregl.LngLatBounds();
  (function walk(c) { if (typeof c[0] === "number") b.extend(c); else c.forEach(walk); })(f.geometry.coordinates);
  return b;
}

/* ---------- dose points ---------- */
function planSites() {
  const plans = S.data.summary && S.data.summary.dose_point_plans;
  const feats = S.data.dosePoints.features;
  if (plans && plans[S.plan]) {
    const ids = new Set(plans[S.plan].sites);
    return { shown: feats.filter((f) => ids.has(f.properties.id)), total: plans[S.plan].sites.length };
  }
  const k = +S.plan;
  return { shown: feats.filter((f) => f.properties.rank == null || f.properties.rank <= k), total: k };
}
function clearDose() { S.markers.forEach((m) => m.remove()); S.markers = []; }
function drawDose() {
  clearDose();
  if (!S.data) return;
  const { shown, total } = planSites();
  shown.forEach((f) => {
    const p = f.properties;
    const b = document.createElement("button");
    b.type = "button"; b.className = "rank"; b.textContent = p.rank ?? "";
    const label = `Dose point ${p.rank ?? ""}: ${p.name}`;
    b.setAttribute("aria-label", label); b.title = label;
    const mk = new maplibregl.Marker({ element: b }).setLngLat(f.geometry.coordinates)
      .setPopup(new maplibregl.Popup({ offset: 20, closeButton: false, className: "tip" }).setHTML(`${esc(p.name)}<span>${esc(p.kind || "site")}${p.rank != null ? ", rank " + p.rank : ""}</span>`));
    if ($("#lyDose").checked) mk.addTo(map);
    S.markers.push(mk);
  });
  $("#planNote").textContent = shown.length < total ? `${shown.length} of ${total} sites of this plan are on the map.` : `${total} sites. Numbers show rank.`;
}
function setPlan(k) {
  S.plan = k;
  [...$("#planSeg").children].forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.k === k)));
  drawDose(); syncUrl();
}
function buildPlanSeg() {
  const seg = $("#planSeg");
  seg.innerHTML = "";
  ["3", "5", "8"].forEach((k) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = k; b.dataset.k = k; b.setAttribute("aria-pressed", String(k === S.plan));
    b.setAttribute("aria-label", k + " dose points");
    b.addEventListener("click", () => setPlan(k));
    seg.appendChild(b);
  });
}

/* ---------- caption and legend ---------- */
function captionText() {
  if (!S.city) {
    return `Each circle is a city. A bigger circle means more residents were exposed to floodwater in a ${years()}-year flood. Click a city to see its barangays.`;
  }
  const lead = `${esc(cityName())} after a ${years()}-year flood.`;
  const k = S.metric.key;
  if (k === "unreached") return `${lead} Darker barangays have more exposed residents who cannot walk to a clinic within ${WALK_MIN} minutes during the flood.`;
  if (k === "share") return `${lead} Darker barangays had more of their area under water in the flood map.`;
  return `${lead} Darker barangays have more residents who waded through floodwater. Blue numbers show where to open temporary dose points first (1 = most people helped).`;
}
function updateCaption() { $("#capText").innerHTML = captionText(); }
function renderLegend() {
  const lg = $("#legend");
  if (!S.city) {
    lg.innerHTML = `<p class="map-note" style="margin:0">Bigger circle = more residents exposed to floodwater in a ${years()}-year flood.</p>`;
    return;
  }
  const m = S.metric, edges = [S.min, ...S.breaks, S.max], n = Math.max(1, S.breaks.length + 1);
  const ticks = edges.map((v, i) => `<span style="left:${(i / n) * 100}%">${m.key === "share" ? pct(v, 0) : compact(v)}</span>`).join("");
  const lo = m.key === "share" ? "Little flooded" : "Fewer residents", hi = m.key === "share" ? "Mostly flooded" : "More residents";
  lg.innerHTML = `<div class="ramp" aria-hidden="true">${m.ramp.slice(0, n).map((c) => `<i style="background:${c}"></i>`).join("")}</div>
    <div class="ticks" aria-hidden="true">${ticks}</div>
    <div class="lg-words"><span>${lo}</span><span>${hi}</span></div>
    <p class="sr-only">${m.label}, from ${m.f(S.min)} to ${m.f(S.max)} ${m.unit}, darker is higher.</p>
    <div class="key"><span class="dot-dose">1</span>Dose point. 1 helps the most people.${S.view === "3d" ? " Column height follows the colour." : ""}</div>`;
}
function highlightList(code) {
  host.querySelectorAll("#cityList button").forEach((b) => b.setAttribute("aria-current", String(b.dataset.c === code)));
}

/* ---------- guided intro ---------- */
function topRow(key) {
  return S.data.rows.reduce((a, r) => ((r[key] ?? -1) > (a ? a[key] ?? -1 : -2) ? r : a), null);
}
function tourSteps() {
  const rows = S.data.rows, sum = S.data.summary || {}, name = cityName();
  const steps = [];
  const topE = topRow("exposed");
  steps.push({
    title: "Who was in the water",
    metric: "exposed", plan: null, hi: topE, val: fmt(topE.exposed),
    body: `The map starts with exposure. Darker barangays have more residents who waded through floodwater. ${esc(topE.name)} has the most: ${fmt(topE.exposed)} of ${fmt(topE.pop)} residents.`,
  });
  if (rows.some((r) => r.unreached != null)) {
    const topU = topRow("unreached");
    const total = sum.exposed_unreached_in_flood != null ? sum.exposed_unreached_in_flood : rows.reduce((t, r) => t + (r.unreached || 0), 0);
    steps.push({
      title: "Who cannot reach care",
      metric: "unreached", plan: null, hi: topU, val: fmt(topU.unreached),
      body: `In ${esc(name)}, ${fmt(total)} exposed residents cannot walk to a clinic within ${WALK_MIN} minutes while the flood is on. The most are in ${esc(topU.name)}: ${fmt(topU.unreached)}.`,
    });
  }
  const p3 = sum.dose_point_plans && sum.dose_point_plans["3"];
  const share = S.data.coverage && S.data.coverage.plans && S.data.coverage.plans["3"];
  const n3 = Math.min(3, S.data.dosePoints.features.length) || 3;
  const more = p3 && p3.exposed_newly_covered != null ? `${fmt(p3.exposed_newly_covered)} more exposed residents within a ${WALK_MIN}-minute walk of a dose point` : `more exposed residents within a ${WALK_MIN}-minute walk of a dose point`;
  // The map only has the markers it has data for. If the 3-point plan's sites are not all there, show the top 3 ranked instead.
  const onMap = p3 && p3.sites.every((id) => S.data.dosePoints.features.some((f) => f.properties.id === id));
  steps.push({
    title: "Where to set up dose points",
    metric: "exposed", plan: onMap ? "3" : "8", top: n3, hi: null,
    body: `Blue numbers 1 to ${n3} are the first dose points to open. A plan of 3 dose points brings ${more}${share != null ? `, so ${pct(share, 0)} of exposed residents are within reach` : ""}.`,
    last: true,
  });
  return steps;
}
function tourSeen() { try { return localStorage.getItem(SEEN_KEY) === "1"; } catch { return false; } }
function markSeen() { try { localStorage.setItem(SEEN_KEY, "1"); } catch {} }
function maybeTour() { if (!tourSeen() && S.city && !S.dead) startTour(false); }

function startTour(user) {
  if (!S.city || !S.data) return;
  endTour(false, true);
  S.tour = { i: 0, steps: tourSteps(), restore: { metric: S.metric, plan: S.plan }, tag: null, user, from: user ? document.activeElement : null };
  const card = document.createElement("div");
  card.className = "tour"; card.id = "tour";
  card.setAttribute("role", "dialog"); card.setAttribute("aria-labelledby", "tourT");
  $(".mapwrap").appendChild(card);
  onKey = (e) => { if (e.key === "Escape" && S.tour) { e.preventDefault(); endTour(true); } };
  document.addEventListener("keydown", onKey);
  tourStep(0);
}
function tourStep(i) {
  const t = S.tour; if (!t) return;
  t.i = i;
  const st = t.steps[i], n = t.steps.length;
  const k = METRICS.find((m) => m.key === st.metric);
  if (S.metric !== k) setMetric(k);
  if (st.plan && S.plan !== st.plan) setPlan(st.plan);
  if (!$("#lyDose").checked) { $("#lyDose").checked = true; drawDose(); }
  S.markers.forEach((m) => { const e = m.getElement(), r = +e.textContent; e.classList.toggle("hl", !!st.top && r <= st.top); e.classList.toggle("dim", !!st.top && !(r <= st.top)); });
  tourClearHi();
  if (st.hi) {
    const f = S.data.barangays.features.find((x) => x.properties.adm4_pcode === st.hi.id);
    const flt = ["==", ["get", "adm4_pcode"], st.hi.id];
    map.setFilter("b-tour-c", flt); map.setFilter("b-tour", flt);
    const el = document.createElement("div");
    el.className = "tour-tag"; el.innerHTML = `<b>${esc(st.hi.name)}</b><span>${st.val} ${k.key === "unreached" ? "cut off" : "exposed"}</span>`;
    t.tag = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat(boundsOf(f).getCenter()).addTo(map);
  }
  const dots = t.steps.map((_, j) => `<i${j === i ? ' class="on"' : ""}></i>`).join("");
  const card = $("#tour");
  card.innerHTML = `<div class="tour-top"><span class="tour-step">Step ${i + 1} of ${n}</span><button class="linkbtn" type="button" data-a="skip">Skip intro</button></div>
    <h2 id="tourT" tabindex="-1">${st.title}</h2>
    <p id="tourB">${st.body}</p>
    <div class="tour-foot"><span class="dots" aria-hidden="true">${dots}</span>
    <span class="tour-btns">${st.last
      ? `<button class="btn sm" type="button" data-a="done">Explore the map</button><a class="btn sm ghost" href="${cityHref(S.city, "barangays")}" data-a="dash">See the priority list</a>`
      : `${i > 0 ? '<button class="btn sm ghost" type="button" data-a="back">Back</button>' : ""}<button class="btn sm" type="button" data-a="next">Next</button>`}</span></div>`;
  card.setAttribute("aria-describedby", "tourB");
  card.onclick = (e) => {
    const a = e.target.closest("[data-a]"); if (!a) return;
    const act = a.dataset.a;
    if (act === "next") tourStep(i + 1);
    else if (act === "back") tourStep(i - 1);
    else if (act === "skip") endTour(true);
    else if (act === "done") endTour(true, false, true);
    else if (act === "dash") endTour(false, false, true);
  };
  card.querySelector("#tourT").focus({ preventScroll: true });
}
function tourClearHi(tt) {
  const t = tt || S.tour;
  if (t && t.tag) { t.tag.remove(); t.tag = null; }
  if (map && map.getLayer("b-tour")) {
    const none = ["==", ["get", "adm4_pcode"], ""];
    map.setFilter("b-tour-c", none); map.setFilter("b-tour", none);
  }
}
// restoreView: put metric and plan back as they were. quiet: skip focus handling (page teardown).
function endTour(refocus, quiet, keepView) {
  const t = S && S.tour;
  if (!t) return;
  S.tour = null;
  tourClearHi(t);
  document.removeEventListener("keydown", onKey);
  const card = host && host.querySelector("#tour"); if (card) card.remove();
  if (quiet) return;
  markSeen();
  S.markers.forEach((m) => m.getElement().classList.remove("hl", "dim"));
  if (!keepView) {
    if (S.metric !== t.restore.metric) setMetric(t.restore.metric);
    if (S.plan !== t.restore.plan) setPlan(t.restore.plan);
  }
  if (refocus) { const b = $("#tourBtn"); if (b && !b.hidden) b.focus({ preventScroll: true }); }
}

/* ---------- widgets ---------- */
function wire() {
  const list = $("#cityList");
  const draw = (q = "") => {
    const t = q.trim().toLowerCase();
    const rows = S.cities.filter((c) => !t || `${c.name} ${c.province} ${c.region}`.toLowerCase().includes(t));
    list.innerHTML = rows.length ? rows.map((c) => `<li><button type="button" data-c="${esc(c.code)}"><span class="n">${esc(c.name)}<span class="p">${esc(c.province || "")}${c.region ? ", " + esc(c.region) : ""}</span></span><span class="v" aria-label="${fmt(c.exposed)} residents exposed">${compact(c.exposed)}</span></button></li>`).join("") : '<li class="muted sm" style="padding:8px">No city matches.</li>';
  };
  draw();
  $("#cityPick").addEventListener("input", (e) => draw(e.target.value));
  list.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) selectCity(b.dataset.c); });
  $("#pickBack").addEventListener("click", () => showNational(false));
  mountSearch($("#brgySearch"), { onPick: (it) => { if (it.cityCode !== S.city) selectCity(it.cityCode).then(() => selectBrgy(it.id, true)); else selectBrgy(it.id, true); } });
  $("#tourBtn").addEventListener("click", () => startTour(true));

  const seg = $("#metricSeg");
  METRICS.forEach((m) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = m.short; b.dataset.k = m.key; b.setAttribute("aria-pressed", String(m === S.metric));
    b.addEventListener("click", () => { if (!b.disabled) setMetric(m); });
    seg.appendChild(b);
  });
  $("#ly3d").addEventListener("change", (e) => {
    S.view = e.target.checked ? "3d" : "2d"; applyView(); renderLegend();
    map.easeTo({ pitch: S.view === "3d" ? 50 : 0, bearing: S.view === "3d" ? -12 : 0, duration: dur(900) });
    syncUrl();
  });
  $("#lyDose").addEventListener("change", (e) => S.markers.forEach((m) => (e.target.checked ? m.addTo(map) : m.remove())));
  $("#lyRelief").addEventListener("change", (e) => { S.reliefOn = e.target.checked; applyRelief(); });
  $("#lyS1").addEventListener("change", (e) => map.setLayoutProperty("s1-fill", "visibility", e.target.checked ? "visible" : "none"));
  $("#lyOp").addEventListener("input", (e) => {
    S.opacity = +e.target.value / 100;
    if (map.getLayer("b-flat")) map.setPaintProperty("b-flat", "fill-opacity", S.opacity);
    if (map.getLayer("b-ext")) map.setPaintProperty("b-ext", "fill-extrusion-opacity", Math.max(0.3, S.opacity));
  });
  $("#lySat").addEventListener("change", (e) => map.setLayoutProperty("sat", "visibility", e.target.checked ? "visible" : "none"));
  $("#handle").addEventListener("click", () => openSheet($("#dock").classList.contains("closed")));
}
function openSheet(open) {
  const dock = $("#dock"), h = $("#handle");
  dock.classList.toggle("closed", !open);
  h.setAttribute("aria-expanded", String(open));
  h.setAttribute("aria-label", open ? "Hide map controls" : "Show map controls");
}
