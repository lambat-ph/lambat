import { getCities, getCity, cityHref } from "../data.js";
import { TERRARIUM, BASEMAP, BASEMAP_ATTR, BASE_STYLE_URL, COLORS, RAMP } from "../config.js";
import { fmt, pct, compact, esc, reducedMotion, useCss } from "../format.js";

const METRICS = [
  { key: "exposed", prop: "exposed", short: "Exposed", label: "Exposed residents", unit: "residents", f: fmt },
  { key: "unreached", prop: "exposed_unreached_flood", short: "Cut off", label: "Out of reach in a flood", unit: "residents", f: fmt },
  { key: "share", prop: "flooded_share", short: "Flooded", label: "Share of area flooded", unit: "of area", f: (v) => pct(v, 0) },
];

const TEMPLATE = `
<div class="mapwrap">
  <div id="map" role="region" aria-label="Map of flood exposure. The city dashboard shows the same data as tables."></div>
  <div class="loading" id="loading" role="status">Loading the map</div>
  <div class="dock closed" id="dock">
    <button class="sheet-handle" id="handle" type="button" aria-expanded="false" aria-label="Show map controls"></button>
    <section class="w w-legend" id="legend" aria-label="Legend"></section>
    <section class="w w-picker" id="picker" aria-label="City">
      <div class="head"><strong id="pickTitle">Choose a city</strong><button class="linkbtn" id="pickBack" type="button" hidden>All cities</button></div>
      <div id="pickList">
        <label class="sr-only" for="cityPick">Search cities</label>
        <input class="field" id="cityPick" type="search" placeholder="Search a city" autocomplete="off">
        <ul class="citylist" id="cityList" style="margin-top:8px"></ul>
      </div>
      <div id="pickCity" hidden>
        <label class="wt" for="brgyPick" style="display:block">Find a barangay</label>
        <select class="field" id="brgyPick"><option value="">Choose a barangay</option></select>
        <p style="margin:8px 0 0"><a id="dashLink" href="#/city">Open city dashboard</a> <span class="muted xs">(the same data as a table)</span></p>
      </div>
    </section>
    <div class="col-right">
      <section class="w w-metric opt" id="wMetric" aria-label="Measure" hidden>
        <h2 id="metricH">Show</h2>
        <div class="seg" id="metricSeg" role="group" aria-labelledby="metricH"></div>
      </section>
      <section class="w w-view opt" id="wView" aria-label="View" hidden>
        <div class="w-row">
          <div><h2 id="viewH">View</h2>
            <div class="seg" id="viewSeg" role="group" aria-labelledby="viewH"><button type="button" data-v="3d" aria-pressed="true">3D</button><button type="button" data-v="2d" aria-pressed="false">2D</button></div></div>
          <div><h2 id="planH">Dose points</h2>
            <div class="seg" id="planSeg" role="group" aria-labelledby="planH"></div>
            <p class="map-note" id="planNote" style="margin-top:8px" aria-live="polite"></p></div>
        </div>
      </section>
      <section class="w w-layers opt" id="wLayers" aria-label="Layers" hidden>
        <h2>Layers</h2>
        <label class="switch"><span>Dose points</span><input type="checkbox" role="switch" id="lyDose" checked></label>
        <label class="switch"><span>Terrain relief</span><input type="checkbox" role="switch" id="lyRelief" checked></label>
        <label class="switch" id="lyS1wrap" hidden><span>Radar flood share</span><input type="checkbox" role="switch" id="lyS1"></label>
        <p class="map-note" id="reliefNote" hidden></p>
      </section>
      <section class="w info" id="info" aria-label="Barangay details" hidden aria-live="polite"></section>
    </div>
  </div>
</div>`;

let map, tip, host, S, mobile, ro;
const $ = (s) => host.querySelector(s);
const dur = (n) => (reducedMotion() ? 0 : n);

export async function render(el, params) {
  useCss("map");
  host = el;
  mobile = window.matchMedia("(max-width:767px)");
  S = { cities: [], city: null, data: null, metric: METRICS[0], view: "3d", plan: "8", sel: null, reliefOn: true, reliefOK: null, breaks: [], min: 0, max: 1, scaleH: 1000, markers: [], cityMarkers: [], params, dead: false };
  el.innerHTML = TEMPLATE;
  try { S.cities = await getCities(); } catch { S.cities = []; }
  if (!S.cities.length) { $("#loading").textContent = "No city data found."; return; }
  wire();
  boot();
}

export function destroy() {
  if (S) S.dead = true;
  if (ro) { ro.disconnect(); ro = null; }
  try { if (map) map.remove(); } catch {}
  map = null;
}

function syncUrl() {
  if (S.dead) return;
  let h = "#/map";
  if (S.city) {
    const p = new URLSearchParams({ metric: S.metric.key, plan: S.plan });
    if (S.view === "2d") p.set("view", "2d");
    h += "/" + encodeURIComponent(S.city) + "?" + p;
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
      center: [121.8, 12.6], zoom: 4.6, pitch: 40, maxPitch: 75, attributionControl: false,
    });
  } catch (e) {
    $("#loading").innerHTML = 'This browser could not start the 3D map. <a href="#/city">Open the city dashboard</a> for the same data as tables.';
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
  map.addLayer({ id: "hill", type: "hillshade", source: "dem", layout: { visibility: "none" }, paint: { "hillshade-exaggeration": 0.5, "hillshade-shadow-color": "#3B4A78", "hillshade-highlight-color": "#FFFFFF", "hillshade-accent-color": "#6F7FB0" } }, S.before);
  buildNational();
  const code = S.params.code;
  if (code && S.cities.some((c) => c.code === code)) {
    const q = S.params.query;
    const m = METRICS.find((x) => x.key === q.get("metric"));
    if (m) S.metric = m;
    if (["3", "5", "8"].includes(q.get("plan"))) S.plan = q.get("plan");
    if (q.get("view") === "2d") S.view = "2d";
    await selectCity(code, true);
  } else {
    showNational(true);
  }
}

/* ---------- national view ---------- */
function circle(lon, lat, rKm, n = 32) {
  const ring = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * 2 * Math.PI;
    ring.push([lon + (rKm / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.cos(a), lat + (rKm / 110.57) * Math.sin(a)]);
  }
  return [ring];
}
function buildNational() {
  const mx = Math.max(...S.cities.map((c) => c.exposed || 0), 1);
  const gj = { type: "FeatureCollection", features: S.cities.map((c) => ({ type: "Feature", properties: { code: c.code, h: Math.max(12000, ((c.exposed || 0) / mx) * 170000) }, geometry: { type: "Polygon", coordinates: circle(c.lon, c.lat, 16) } })) };
  map.addSource("nat", { type: "geojson", data: gj });
  map.addLayer({ id: "nat-col", type: "fill-extrusion", source: "nat", paint: { "fill-extrusion-color": COLORS.blue, "fill-extrusion-height": ["get", "h"], "fill-extrusion-opacity": 0.92 } });
  map.on("click", "nat-col", (e) => selectCity(e.features[0].properties.code));
  map.on("mouseenter", "nat-col", () => { map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", "nat-col", () => { map.getCanvas().style.cursor = ""; });
  S.cities.forEach((c) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "city-pin";
    b.innerHTML = `<i></i>${esc(c.name)}`;
    b.setAttribute("aria-label", `${c.name}, ${fmt(c.exposed)} residents exposed. Open this city.`);
    b.addEventListener("click", () => selectCity(c.code));
    S.cityMarkers.push(new maplibregl.Marker({ element: b, anchor: "left", offset: [14, 0] }).setLngLat([c.lon, c.lat]).addTo(map));
  });
}
function pad() {
  if (mobile.matches) return { top: 40, left: 24, right: 24, bottom: 200 };
  // Leave room for the floating widgets, but never more than about half the map width.
  const w = map ? map.getContainer().clientWidth : window.innerWidth;
  const side = Math.min(320, Math.round(w * 0.22));
  return { top: 72, bottom: 72, left: side, right: side };
}
function showNational(first) {
  S.city = null; S.data = null; clearSel();
  setCityLayers(false);
  map.setTerrain(null);
  map.setLayoutProperty("hill", "visibility", "none");
  map.setLayoutProperty("nat-col", "visibility", "visible");
  if (map.getLayer("s1-fill")) map.setLayoutProperty("s1-fill", "visibility", "none");
  S.cityMarkers.forEach((m) => { m.getElement().style.display = ""; });
  clearDose();
  $("#pickTitle").textContent = "Choose a city";
  $("#pickBack").hidden = true; $("#pickList").hidden = false; $("#pickCity").hidden = true;
  ["#wMetric", "#wView", "#wLayers"].forEach((s) => { $(s).hidden = true; });
  $("#info").hidden = true;
  renderLegend();
  const pts = S.cities.map((c) => [c.lon, c.lat]);
  const b = pts.reduce((bb, p) => bb.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0]));
  map.fitBounds(b, { padding: pad(), maxZoom: S.cities.length > 1 ? 6 : 6.4, pitch: 40, bearing: 0, duration: first ? 0 : dur(1600) });
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
  const base = ["step", ["coalesce", ["get", S.metric.prop], 0], RAMP[0]];
  S.breaks.forEach((b, i) => base.push(b, RAMP[i + 1]));
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
  [...$("#viewSeg").children].forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.v === "3d") === d3)));
}
function paintMetric() {
  const b = breaksFor(S.metric, S.data.barangays.features);
  S.breaks = b.breaks; S.max = b.max || 1; S.min = b.min;
  map.setPaintProperty("b-ext", "fill-extrusion-color", colorExpr(true));
  map.setPaintProperty("b-ext", "fill-extrusion-height", heightExpr());
  map.setPaintProperty("b-flat", "fill-color", colorExpr(false));
  renderLegend();
}
function ensureCityLayers() {
  if (map.getSource("brgy")) { map.getSource("brgy").setData(S.data.barangays); return; }
  map.addSource("brgy", { type: "geojson", data: S.data.barangays, promoteId: "adm4_pcode" });
  map.addLayer({ id: "b-ext", type: "fill-extrusion", source: "brgy", paint: { "fill-extrusion-color": RAMP[0], "fill-extrusion-height": 0, "fill-extrusion-base": 0, "fill-extrusion-opacity": 0.94 } });
  map.addLayer({ id: "b-flat", type: "fill", source: "brgy", layout: { visibility: "none" }, paint: { "fill-color": RAMP[0], "fill-opacity": 0.88 } }, S.before);
  map.addLayer({ id: "b-line", type: "line", source: "brgy", layout: { visibility: "none" }, paint: { "line-color": "#FFFFFF", "line-width": 1 } }, S.before);
  map.addLayer({ id: "b-sel", type: "line", source: "brgy", layout: { visibility: "none" }, filter: ["==", ["get", "adm4_pcode"], ""], paint: { "line-color": COLORS.ink, "line-width": 3 } }, S.before);
  const pick = (e) => { const f = map.queryRenderedFeatures(e.point, { layers: [S.view === "3d" ? "b-ext" : "b-flat"] })[0]; return f ? f.properties.adm4_pcode : null; };
  map.on("click", (e) => {
    if (!S.city) return;
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
  map.setLayoutProperty("nat-col", "visibility", "none");
  paintMetric();
  setCityLayers(true);
  $("#pickTitle").textContent = c.name;
  $("#pickBack").hidden = false; $("#pickList").hidden = true; $("#pickCity").hidden = false;
  $("#dashLink").href = cityHref(code);
  $("#brgyPick").innerHTML = '<option value="">Choose a barangay</option>' + [...data.rows].sort((a, b) => a.name.localeCompare(b.name)).map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join("");
  ["#wMetric", "#wView", "#wLayers"].forEach((s) => { $(s).hidden = false; });
  buildPlanSeg();
  drawDose();
  await probeTerrain(c);
  if (S.dead || !map) return;
  $("#lyRelief").disabled = !S.reliefOK;
  $("#reliefNote").hidden = !!S.reliefOK;
  $("#reliefNote").textContent = S.reliefOK ? "" : "Terrain tiles could not be loaded, so the map is flat.";
  applyRelief();
  loadS1();
  highlightList(code);
  const d3 = S.view === "3d";
  map.resize();
  map.fitBounds(bb, { padding: pad(), maxZoom: 14.5, pitch: d3 ? 50 : 0, bearing: d3 ? -12 : 0, duration: first ? 0 : dur(2200) });
  syncUrl();
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
  const bp = $("#brgyPick"); if (bp) bp.value = "";
}
function selectBrgy(code, fly) {
  if (S.sel) map.setFeatureState({ source: "brgy", id: S.sel }, { sel: false });
  S.sel = code;
  map.setFeatureState({ source: "brgy", id: code }, { sel: true });
  map.setFilter("b-sel", ["==", ["get", "adm4_pcode"], code]);
  $("#brgyPick").value = code;
  const r = S.data.rows.find((x) => x.id === code);
  const info = $("#info");
  info.hidden = false;
  info.innerHTML = `<button class="close" type="button" aria-label="Close details">&times;</button>
    <h2>${esc(r.name)}</h2><p class="muted xs" style="margin:0">Priority ${r.priority} of ${S.data.rows.length}. 1 is highest.</p>
    <dl><dt>Residents</dt><dd>${fmt(r.pop)}</dd>
    <dt>Exposed</dt><dd>${fmt(r.exposed)}${r.pop ? " (" + pct(r.exposed / r.pop, 0) + ")" : ""}</dd>
    ${r.unreached != null ? `<dt>Out of reach in a flood</dt><dd>${fmt(r.unreached)}</dd>` : ""}
    <dt>Area flooded</dt><dd>${pct(r.share, 0)}</dd>
    <dt>Capsules per flood week</dt><dd>${fmt(r.capsules)}</dd></dl>
    <a href="${cityHref(S.city, "barangays")}">Open city dashboard</a>`;
  info.querySelector(".close").addEventListener("click", clearSel);
  if (fly) {
    const f = S.data.barangays.features.find((x) => x.properties.adm4_pcode === code);
    const b = new maplibregl.LngLatBounds();
    (function walk(c) { if (typeof c[0] === "number") b.extend(c); else c.forEach(walk); })(f.geometry.coordinates);
    map.fitBounds(b, { padding: pad(), maxZoom: S.view === "3d" ? 13 : 15, duration: dur(900), pitch: S.view === "3d" ? 45 : 0 });
  }
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
function buildPlanSeg() {
  const seg = $("#planSeg");
  seg.innerHTML = "";
  ["3", "5", "8"].forEach((k) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = k; b.setAttribute("aria-pressed", String(k === S.plan));
    b.setAttribute("aria-label", k + " dose points");
    b.addEventListener("click", () => { S.plan = k; [...seg.children].forEach((x) => x.setAttribute("aria-pressed", String(x === b))); drawDose(); syncUrl(); });
    seg.appendChild(b);
  });
}

/* ---------- legend ---------- */
function renderLegend() {
  const lg = $("#legend");
  if (!S.city) {
    lg.innerHTML = `<div class="metric-name">Column height: exposed residents</div><p class="map-note" style="margin:0">Taller means more residents live in areas a 25-year flood covers. Choose a city to see its barangays.</p>`;
    return;
  }
  const m = S.metric, edges = [S.min, ...S.breaks, S.max], n = Math.max(1, S.breaks.length + 1);
  const ticks = edges.map((v, i) => `<span style="left:${(i / n) * 100}%">${m.key === "share" ? pct(v, 0) : compact(v)}</span>`).join("");
  lg.innerHTML = `<div class="metric-name">${m.label}</div>
    <div class="ramp" aria-hidden="true">${RAMP.slice(0, n).map((c) => `<i style="background:${c}"></i>`).join("")}</div>
    <div class="ticks" aria-hidden="true">${ticks}</div>
    <p class="sr-only">${m.label}, from ${m.f(S.min)} to ${m.f(S.max)} ${m.unit}, darker is higher.</p>
    <div class="key"><span class="dot-gold"></span>Dose point, number is its rank. Height follows the colour.</div>`;
}
function highlightList(code) {
  host.querySelectorAll("#cityList button").forEach((b) => b.setAttribute("aria-current", String(b.dataset.c === code)));
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
  $("#brgyPick").addEventListener("change", (e) => { if (e.target.value) selectBrgy(e.target.value, true); else clearSel(); });

  const seg = $("#metricSeg");
  METRICS.forEach((m) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = m.short; b.dataset.k = m.key; b.setAttribute("aria-pressed", String(m === S.metric));
    b.addEventListener("click", () => {
      if (b.disabled) return;
      S.metric = m; [...seg.children].forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      paintMetric(); syncUrl();
    });
    seg.appendChild(b);
  });
  $("#viewSeg").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    S.view = b.dataset.v; applyView();
    map.easeTo({ pitch: S.view === "3d" ? 50 : 0, bearing: S.view === "3d" ? -12 : 0, duration: dur(900) });
    syncUrl();
  });
  $("#lyDose").addEventListener("change", (e) => S.markers.forEach((m) => (e.target.checked ? m.addTo(map) : m.remove())));
  $("#lyRelief").addEventListener("change", (e) => { S.reliefOn = e.target.checked; applyRelief(); });
  $("#lyS1").addEventListener("change", (e) => map.setLayoutProperty("s1-fill", "visibility", e.target.checked ? "visible" : "none"));
  const dock = $("#dock"), h = $("#handle");
  h.addEventListener("click", () => {
    const closed = dock.classList.toggle("closed");
    h.setAttribute("aria-expanded", String(!closed));
    h.setAttribute("aria-label", closed ? "Show map controls" : "Hide map controls");
  });
}
