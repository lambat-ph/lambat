import { getCities, getCity, cityHref } from "../data.js";
import { TERRARIUM, BASEMAP, BASEMAP_ATTR, BASE_STYLE_URL, COLORS, RAMP, WALK_MIN, isDark } from "../config.js";
import { fmt, pct, esc, reducedMotion, useCss } from "../format.js";

const METRICS = [
  { key: "exposed", prop: "exposed", short: "Residents in the floodwater", desc: "People who live where the flood reaches.",
    legend: "Residents in the floodwater, per barangay", unit: "residents", lo: "fewer", hi: "more", f: fmt },
  { key: "unreached", prop: "exposed_unreached_flood", short: "Residents who cannot reach a clinic", desc: `Exposed people more than a ${WALK_MIN}-minute walk from a clinic while the flood is on.`,
    legend: `Residents who cannot walk to a clinic in ${WALK_MIN} minutes, per barangay`, unit: "residents", lo: "fewer", hi: "more", f: fmt },
  { key: "share", prop: "flooded_share", short: "Area flooded", desc: "How much of each barangay's land is under water.",
    legend: "Share of each barangay's area under water", unit: "of the area", lo: "less", hi: "more", f: (v) => pct(v, 0) },
];
const KINDS = {
  school: "School", townhall: "Barangay hall", town_hall: "Barangay hall", community_centre: "Community centre", community_center: "Community centre",
  hospital: "Hospital", clinic: "Clinic", doctors: "Clinic", pharmacy: "Pharmacy", place_of_worship: "Place of worship", church: "Church",
  fire_station: "Fire station", police: "Police station", library: "Library", marketplace: "Market", sports_centre: "Sports centre",
  social_facility: "Social facility", kindergarten: "Kindergarten", college: "College", university: "University", government: "Government office",
};
const kindLabel = (k) => { if (!k) return "Site"; if (KINDS[k]) return KINDS[k]; const t = String(k).replace(/_/g, " "); return t.charAt(0).toUpperCase() + t.slice(1); };
const SEEN_KEY = "lambat.tourSeen";
const PLANS = ["3", "5", "8"];
const YEARS_DEFAULT = 25;

const TEMPLATE = `
<div class="mapwrap" id="mapwrap">
  <div id="map" role="region" aria-label="Map of flood exposure by barangay, with numbered dose points. The list on the left and the city dashboard give the same information as text."></div>
  <div class="loading" id="loading" role="status">Loading the map</div>

  <header class="strip" id="strip" hidden>
    <div class="strip-main">
      <p class="eyebrow" id="eyebrow"></p>
      <h1 class="strip-q" id="stripQ"></h1>
      <p class="strip-a" id="answer" role="status" aria-live="polite"></p>
    </div>
    <div class="strip-act">
      <button class="chip-btn" id="tourBtn" type="button" hidden>New here? Take a 30-second tour</button>
      <button class="opt-btn" id="optBtn" type="button" aria-expanded="false" aria-controls="opts" hidden>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>
        <span>More options</span>
      </button>
    </div>
  </header>

  <div class="col-right" id="colRight">
    <section class="w opts" id="opts" aria-label="More options" hidden>
      <div class="opts-head"><h2>More options</h2><button class="x" id="optClose" type="button" aria-label="Close more options">&times;</button></div>
      <h3 class="opts-h" id="measureH">Colour the map by</h3>
      <div class="measures" id="measures" role="group" aria-labelledby="measureH"></div>
      <h3 class="opts-h">View</h3>
      <label class="switch"><span>3D view</span><input type="checkbox" role="switch" id="ly3d"></label>
      <label class="switch"><span>Terrain relief</span><input type="checkbox" role="switch" id="lyRelief"></label>
      <label class="switch"><span>Show dose points on the map</span><input type="checkbox" role="switch" id="lyDose" checked></label>
      <label class="switch" id="lyS1wrap" hidden><span>Radar flood share</span><input type="checkbox" role="switch" id="lyS1"></label>
      <p class="map-note" id="reliefNote" hidden></p>
      <h3 class="opts-h">Go to</h3>
      <label class="wt" for="brgyPick">Find a barangay</label>
      <select class="field" id="brgyPick"><option value="">Choose a barangay</option></select>
      <p class="opts-links"><button class="linkbtn" id="pickBack" type="button">All cities</button>
        <a id="dashLink" href="#/city">Open city dashboard</a></p>
    </section>
    <section class="w info desk" id="info" aria-label="Barangay details" hidden aria-live="polite"></section>
  </div>

  <div class="dock closed" id="dock">
    <button class="sheet-handle" id="handle" type="button" aria-expanded="false" aria-label="Show more of the panel"></button>
    <div class="col-left">
      <section class="w info mob" id="infoM" aria-label="Barangay details" hidden aria-live="polite"></section>
      <section class="w w-sites" id="sites" aria-labelledby="sitesH" hidden>
        <h2 class="panel-title" id="sitesH">Where to set up first</h2>
        <ol class="sitelist" id="siteList"></ol>
        <p class="map-note" id="siteNote" hidden></p>
        <div class="plan" id="planBox">
          <div class="plan-row"><span id="planL">Show</span><div class="seg" id="planSeg" role="group" aria-labelledby="planL"></div><span>sites</span></div>
          <p class="plan-cov" id="planCov"></p>
        </div>
        <p class="what"><b>What is a dose point?</b> A temporary spot, such as a school or barangay hall, where a nurse hands out doxycycline capsules for a few weeks after the flood.</p>
      </section>
      <section class="w w-cities" id="cities" aria-labelledby="citiesH" hidden>
        <h2 class="panel-title" id="citiesH">Pick a city</h2>
        <label class="sr-only" for="cityPick">Search cities</label>
        <input class="field" id="cityPick" type="search" placeholder="Search a city" autocomplete="off">
        <ul class="citylist" id="cityList"></ul>
      </section>
      <section class="w w-legend" id="legend" aria-label="Legend"></section>
    </div>
  </div>
</div>`;

let map, tip, host, S, mobile, ro, ro2, onKey;
const $ = (s) => host.querySelector(s);
const dur = (n) => (reducedMotion() ? 0 : n);
const cityName = () => { const c = S.cities.find((x) => x.code === S.city); return c ? c.name : ""; };
const years = () => { const m = S.data && S.data.summary && /(\d+)/.exec(S.data.summary.scenario || ""); return m ? +m[1] : YEARS_DEFAULT; };
const sig2 = (v) => { if (v == null) return 0; if (Math.abs(v) < 100) return Math.round(v); const p = 10 ** (Math.floor(Math.log10(Math.abs(v))) - 1); return Math.round(v / p) * p; };

export async function render(el, params) {
  useCss("map");
  host = el;
  mobile = window.matchMedia("(max-width:767px)");
  S = { cities: [], city: null, data: null, metric: METRICS[0], view: "2d", plan: "3", sel: null, reliefOn: false, reliefOK: null, breaks: [], min: 0, max: 1, scaleH: 1000, markers: [], sites: [], active: null, hover: null, cityMarkers: [], tour: null, params, dead: false };
  el.innerHTML = TEMPLATE;
  try { S.cities = await getCities(); } catch { S.cities = []; }
  if (!S.cities.length) { $("#loading").textContent = "No city data found."; return; }
  wire();
  preStrip(params);
  boot();
}

export function destroy() {
  if (S) { S.dead = true; endTour(false, true); }
  if (ro) { ro.disconnect(); ro = null; }
  if (ro2) { ro2.disconnect(); ro2 = null; }
  try { if (map) map.remove(); } catch {}
  map = null;
}

function syncUrl() {
  if (S.dead) return;
  let h = "#/map/all";
  if (S.city) {
    const p = new URLSearchParams({ metric: S.metric.key, plan: S.plan });
    if (S.view === "3d") p.set("view", "3d");
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
  // The headline strip changes height with its text; the panels below it follow.
  const strip = $("#strip"), wrap = $("#mapwrap");
  const setH = () => wrap.style.setProperty("--strip-h", strip.offsetHeight + "px");
  setH();
  ro2 = new ResizeObserver(setH);
  ro2.observe(strip);
  map.on("error", (e) => console.warn("map error:", e.error && e.error.message));
  map.on("load", onLoad);
  map.once("idle", () => { const l = $("#loading"); if (l) l.hidden = true; });
}

// Turn the basemap down so the choropleth and the gold markers carry the page.
function quietBasemap() {
  const st = map.getStyle();
  if (!st || !st.layers) return;
  const seen = new Set();
  st.layers.forEach((l) => {
    try {
      if (l.type === "symbol") {
        // Neighbourhood names repeat the barangay names the choropleth already carries.
        if (l.id === "label_other") { map.setLayoutProperty(l.id, "visibility", "none"); return; }
        // Label layers that repeat the same source layer and filter draw every name twice.
        const key = JSON.stringify([l.source, l["source-layer"], l.filter, l.layout && l.layout["text-field"]]);
        if (seen.has(key)) { map.setLayoutProperty(l.id, "visibility", "none"); return; }
        seen.add(key);
        map.setPaintProperty(l.id, "text-opacity", 0.55);
        if (l.layout && l.layout["icon-image"]) map.setPaintProperty(l.id, "icon-opacity", 0.45);
      } else if (l.type === "line" && (l["source-layer"] === "transportation" || /road|highway|bridge|tunnel|rail|transit/i.test(l.id))) {
        map.setPaintProperty(l.id, "line-opacity", 0.5);
      }
    } catch {}
  });
}

// Dark appearance: recolour the light vector basemap by layer role so the choropleth still leads.
function darkBasemap() {
  const st = map.getStyle();
  if (!st || !st.layers) return;
  st.layers.forEach((l) => {
    try {
      const id = l.id;
      if (l.type === "background") map.setPaintProperty(id, "background-color", "#171B26");
      else if (l.type === "fill") map.setPaintProperty(id, "fill-color", /water/i.test(id) ? "#0E1420" : /park|wood|grass|landcover/i.test(id) ? "#1B2230" : /building/i.test(id) ? "#222838" : "#1C212E");
      else if (l.type === "line") map.setPaintProperty(id, "line-color", /water/i.test(id) ? "#0E1420" : /boundary/i.test(id) ? "#3A4258" : "#313950");
      else if (l.type === "symbol") { map.setPaintProperty(id, "text-color", "#AEB6CA"); map.setPaintProperty(id, "text-halo-color", "#171B26"); }
    } catch {}
  });
}

async function onLoad() {
  quietBasemap();
  if (isDark()) darkBasemap();
  const sym = map.getStyle().layers.find((l) => l.type === "symbol" && (!l.layout || l.layout.visibility !== "none"));
  S.before = sym ? sym.id : undefined;
  map.addSource("dem", { type: "raster-dem", tiles: [TERRARIUM], encoding: "terrarium", tileSize: 256, maxzoom: 15, attribution: "Terrain: Mapzen, AWS Open Data" });
  map.addLayer({ id: "hill", type: "hillshade", source: "dem", layout: { visibility: "none" }, paint: { "hillshade-exaggeration": 0.5, "hillshade-shadow-color": "#3B4A78", "hillshade-highlight-color": "#FFFFFF", "hillshade-accent-color": "#6F7FB0" } }, S.before);
  buildNational();
  const code = S.params.code;
  const q = S.params.query;
  const m = METRICS.find((x) => x.key === q.get("metric"));
  if (m) S.metric = m;
  if (PLANS.includes(q.get("plan"))) S.plan = q.get("plan");
  if (q.get("view") === "3d") S.view = "3d";
  if (code === "all") {
    showNational(true);
  } else if (code && S.cities.some((c) => c.code === code)) {
    await selectCity(code, true);
    maybeTour();
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
  const strip = $("#strip");
  const sh = strip ? strip.offsetHeight : 120;
  if (mobile.matches) {
    const d = $("#dock");
    return { top: sh + 24, left: 24, right: 24, bottom: (d ? d.offsetHeight : 260) + 24 };
  }
  // Leave room for the headline strip and the left panel, but never more than about 40% of the map width.
  const w = map ? map.getContainer().clientWidth : window.innerWidth;
  const side = Math.min(368, Math.round(w * 0.4));
  return { top: sh + 48, bottom: 48, left: side, right: 40 };
}
function showNational(first) {
  endTour(false);
  S.city = null; S.data = null; S.active = null; S.hover = null; clearSel();
  setCityLayers(false);
  map.setTerrain(null);
  map.setLayoutProperty("hill", "visibility", "none");
  map.setLayoutProperty("nat-dot", "visibility", "visible");
  if (map.getLayer("s1-fill")) map.setLayoutProperty("s1-fill", "visibility", "none");
  S.cityMarkers.forEach((m) => { m.getElement().style.display = ""; });
  clearDose();
  $("#sites").hidden = true; $("#cities").hidden = false;
  closeOpts();
  $("#optBtn").hidden = true; $("#tourBtn").hidden = true;
  renderStrip();
  renderLegend();
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
  $("#ly3d").checked = d3;
}
function paintMetric() {
  const b = breaksFor(S.metric, S.data.barangays.features);
  S.breaks = b.breaks; S.max = b.max || 1; S.min = b.min;
  map.setPaintProperty("b-ext", "fill-extrusion-color", colorExpr(true));
  map.setPaintProperty("b-ext", "fill-extrusion-height", heightExpr());
  map.setPaintProperty("b-flat", "fill-color", colorExpr(false));
  renderLegend();
}
function setMetric(m) {
  S.metric = m;
  [...$("#measures").children].forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.k === m.key)));
  paintMetric(); syncUrl();
}
function ensureCityLayers() {
  if (map.getSource("brgy")) { map.getSource("brgy").setData(S.data.barangays); return; }
  map.addSource("brgy", { type: "geojson", data: S.data.barangays, promoteId: "adm4_pcode" });
  map.addLayer({ id: "b-ext", type: "fill-extrusion", source: "brgy", layout: { visibility: "none" }, paint: { "fill-extrusion-color": RAMP[0], "fill-extrusion-height": 0, "fill-extrusion-base": 0, "fill-extrusion-opacity": 0.94 } });
  map.addLayer({ id: "b-flat", type: "fill", source: "brgy", layout: { visibility: "none" }, paint: { "fill-color": RAMP[0], "fill-opacity": 0.88 } }, S.before);
  map.addLayer({ id: "b-line", type: "line", source: "brgy", layout: { visibility: "none" }, paint: { "line-color": "#FFFFFF", "line-width": 1 } }, S.before);
  map.addLayer({ id: "b-sel", type: "line", source: "brgy", layout: { visibility: "none" }, filter: ["==", ["get", "adm4_pcode"], ""], paint: { "line-color": COLORS.ink, "line-width": 3 } }, S.before);
  // Intro highlight: a dark casing under a gold line, visible in both 2D and 3D.
  const none = ["==", ["get", "adm4_pcode"], ""];
  map.addLayer({ id: "b-tour-c", type: "line", source: "brgy", filter: none, paint: { "line-color": COLORS.ink, "line-width": 7 } }, S.before);
  map.addLayer({ id: "b-tour", type: "line", source: "brgy", filter: none, paint: { "line-color": COLORS.gold, "line-width": 3.5 } }, S.before);
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
    tip.setLngLat(e.lngLat).setHTML(`${esc(r.name)}<span>${esc(S.metric.short)}: ${S.metric.f(v)}</span>`).addTo(map);
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
    const n = infoEl(); n.hidden = false; n.innerHTML = `<p class="notice">Could not load ${esc(c.name)}: ${esc((data && data.error) || "no data")}</p>`;
    return;
  }
  S.data = data; S.city = code; S.active = null; S.hover = null; clearSel();
  const hasUnreached = data.rows.some((r) => r.unreached != null);
  const ub = $("#measures").children[1];
  ub.disabled = !hasUnreached; ub.title = hasUnreached ? "" : "Not computed for this city yet";
  if (!hasUnreached && S.metric.key === "unreached") S.metric = METRICS[0];
  [...$("#measures").children].forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.k === S.metric.key)));
  const bb = data.bbox;
  const diag = Math.hypot((bb[2] - bb[0]) * 111.32 * Math.cos((c.lat * Math.PI) / 180), (bb[3] - bb[1]) * 110.57) * 1000;
  S.scaleH = Math.max(300, diag * 0.06);
  ensureCityLayers();
  S.cityMarkers.forEach((m) => { m.getElement().style.display = "none"; });
  map.setLayoutProperty("nat-dot", "visibility", "none");
  // Pick a plan this city actually has.
  const avail = availPlans();
  if (!avail.includes(S.plan)) S.plan = avail.includes("3") ? "3" : avail[0] || "3";
  paintMetric();
  setCityLayers(true);
  $("#sites").hidden = true; $("#cities").hidden = true;
  $("#optBtn").hidden = false; $("#tourBtn").hidden = false;
  $("#dashLink").href = cityHref(code);
  $("#brgyPick").innerHTML = '<option value="">Choose a barangay</option>' + [...data.rows].sort((a, b) => a.name.localeCompare(b.name)).map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join("");
  buildPlanSeg();
  drawDose();
  renderStrip();
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
const infoEl = () => (mobile.matches ? $("#infoM") : $("#info"));
function clearSel() {
  if (S.sel && map && map.getSource("brgy")) map.setFeatureState({ source: "brgy", id: S.sel }, { sel: false });
  S.sel = null;
  if (map && map.getLayer("b-sel")) map.setFilter("b-sel", ["==", ["get", "adm4_pcode"], ""]);
  $("#info").hidden = true; $("#infoM").hidden = true;
  const bp = $("#brgyPick"); if (bp) bp.value = "";
}
function selectBrgy(code, fly) {
  if (S.sel) map.setFeatureState({ source: "brgy", id: S.sel }, { sel: false });
  S.sel = code;
  map.setFeatureState({ source: "brgy", id: code }, { sel: true });
  map.setFilter("b-sel", ["==", ["get", "adm4_pcode"], code]);
  $("#brgyPick").value = code;
  const r = S.data.rows.find((x) => x.id === code);
  $("#info").hidden = true; $("#infoM").hidden = true;
  const info = infoEl();
  info.hidden = false;
  const said = [];
  if (r.pop) said.push(`${fmt(r.exposed)} of ${fmt(r.pop)} residents in ${esc(r.name)} live where the flood reaches.`);
  else said.push(`${fmt(r.exposed)} residents in ${esc(r.name)} live where the flood reaches.`);
  if (r.unreached != null && r.exposed) said.push(`${fmt(r.unreached)} of them cannot walk to a clinic within ${WALK_MIN} minutes while the flood is on.`);
  if (r.share != null) said.push(`${pct(r.share, 0)} of the barangay's area is under water.`);
  info.innerHTML = `<button class="close" type="button" aria-label="Close details">&times;</button>
    <h2>${esc(r.name)}</h2><p class="said">${said.join(" ")}</p>
    <p class="muted xs" style="margin:0">Dose point priority ${r.priority} of ${S.data.rows.length} (1 is first).</p>
    <dl><dt>Residents</dt><dd>${fmt(r.pop)}</dd>
    <dt>Exposed</dt><dd>${fmt(r.exposed)}${r.pop ? " (" + pct(r.exposed / r.pop, 0) + ")" : ""}</dd>
    ${r.unreached != null ? `<dt>Cannot reach a clinic in the flood</dt><dd>${fmt(r.unreached)}</dd>` : ""}
    <dt>Area flooded</dt><dd>${pct(r.share, 0)}</dd>
    <dt>Capsules per flood week</dt><dd>${fmt(r.capsules)}</dd></dl>
    <a href="${cityHref(S.city, "barangays")}">Open city dashboard</a>`;
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
function availPlans() {
  const plans = S.data && S.data.summary && S.data.summary.dose_point_plans;
  if (plans) { const k = PLANS.filter((p) => plans[p]); if (k.length) return k; }
  return PLANS;
}
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inPoly(x, y, g) {
  const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
  return polys.some((p) => inRing(x, y, p[0]) && !p.slice(1).some((h) => inRing(x, y, h)));
}
function barangayAt(pt) {
  const f = S.data.barangays.features.find((b) => b.geometry && inPoly(pt[0], pt[1], b.geometry));
  return f ? f.properties.adm4_en : null;
}
const planVal = (v, k) => (v != null && typeof v === "object" ? v[k] : v);
// The sites of the current plan, in rank order, with plain-language names.
function planSites() {
  const k = S.plan;
  const feats = S.data.dosePoints.features;
  const plan = S.data.summary && S.data.summary.dose_point_plans && S.data.summary.dose_point_plans[k];
  const total = plan ? plan.sites.length : +k;
  let sel;
  if (feats.some((f) => Array.isArray(f.properties.plans))) sel = feats.filter((f) => (f.properties.plans || []).map(String).includes(k));
  else if (plan) { const ids = new Set(plan.sites); sel = feats.filter((f) => ids.has(f.properties.id)); }
  else sel = feats.filter((f) => f.properties.rank == null || f.properties.rank <= +k);
  const rankOf = (p) => { const v = planVal(p.rank_in_plan, k); const r = v != null ? +v : p.rank; return r == null ? null : +r; };
  const sites = sel.map((f) => {
    const p = f.properties, kl = kindLabel(p.kind), where = barangayAt(f.geometry.coordinates);
    const named = p.name && String(p.name).trim();
    const reach = planVal(p.newly_covered, k) ?? planVal(p.exposed_newly_covered, k);
    return {
      id: p.id, rank: rankOf(p), coords: f.geometry.coordinates, kind: kl, where,
      name: named ? String(p.name).trim() : `Unnamed ${kl.toLowerCase()}${where ? " in " + where : ""}`,
      sub: named ? kl + (where ? ", " + where : "") : kl,
      reach: reach != null && !Number.isNaN(+reach) ? +reach : null,
    };
  }).sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
  return { sites, total };
}
function clearDose() { S.markers.forEach((m) => m.remove()); S.markers = []; S.sites = []; }
function drawDose() {
  clearDose();
  if (!S.data) return;
  const { sites, total } = planSites();
  S.sites = sites;
  const show = $("#lyDose").checked;
  sites.forEach((s, i) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "rank"; b.textContent = s.rank ?? i + 1; b.dataset.id = s.id;
    const label = `Dose point ${s.rank ?? i + 1}: ${s.name}`;
    b.setAttribute("aria-label", label);
    b.addEventListener("click", () => setActive(s.id, { scroll: true }));
    b.addEventListener("mouseenter", () => setHover(s.id));
    b.addEventListener("mouseleave", () => setHover(null));
    const mk = new maplibregl.Marker({ element: b }).setLngLat(s.coords)
      .setPopup(new maplibregl.Popup({ offset: 20, closeButton: false, className: "tip" }).setHTML(`${esc(s.name)}<span>${esc(s.sub)}</span>`));
    if (show) mk.addTo(map);
    s.marker = mk; s.el = b;
    S.markers.push(mk);
  });
  renderSites(total);
  renderSentence();
  paintMarkers();
}
function renderSites(total) {
  $("#sites").hidden = false;
  const ol = $("#siteList");
  ol.innerHTML = S.sites.map((s, i) => `<li><button type="button" class="site" data-id="${esc(s.id)}">
      <span class="badge-n" aria-hidden="true">${s.rank ?? i + 1}</span>
      <span class="site-t"><span class="site-name">${esc(s.name)}</span><span class="site-sub">${esc(s.sub)}</span>${s.reach != null ? `<span class="site-reach">reaches ${fmt(s.reach)} more residents</span>` : ""}</span>
    </button></li>`).join("");
  ol.querySelectorAll("button").forEach((b, i) => b.setAttribute("aria-label", `Number ${S.sites[i].rank ?? i + 1}: ${S.sites[i].name}, ${S.sites[i].sub}${S.sites[i].reach != null ? ", reaches " + fmt(S.sites[i].reach) + " more residents" : ""}`));
  const n = $("#siteNote");
  const missing = total - S.sites.length;
  n.hidden = missing <= 0;
  n.textContent = missing > 0 ? `${S.sites.length} of the ${total} sites in this plan are on the map so far.` : "";
  paintList();
}
function setHover(id) { S.hover = id; paintMarkers(); }
function setActive(id, o = {}) {
  S.active = id; paintMarkers();
  const s = S.sites.find((x) => x.id === id);
  if (!s) return;
  if (o.scroll) { const b = $(`#siteList button[data-id="${CSS.escape(id)}"]`); if (b) b.scrollIntoView({ block: "nearest" }); }
  if (o.pan && map) map.easeTo({ center: s.coords, padding: pad(), duration: dur(700) });
}
function paintMarkers() {
  S.sites.forEach((s) => { if (s.el) s.el.classList.toggle("on", s.id === S.active || s.id === S.hover); });
  paintList();
}
function paintList() {
  host.querySelectorAll("#siteList button").forEach((b) => {
    b.classList.toggle("on", b.dataset.id === S.active || b.dataset.id === S.hover);
    if (b.dataset.id === S.active) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
  });
}
function setPlan(k) {
  S.plan = k; S.active = null;
  [...$("#planSeg").children].forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.k === k)));
  drawDose(); syncUrl();
}
function buildPlanSeg() {
  const seg = $("#planSeg");
  seg.innerHTML = "";
  availPlans().forEach((k) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = k; b.dataset.k = k; b.setAttribute("aria-pressed", String(k === S.plan));
    b.setAttribute("aria-label", k + " sites");
    b.addEventListener("click", () => setPlan(k));
    seg.appendChild(b);
  });
}

/* ---------- headline strip, answer sentence, legend ---------- */
// Show the question while the map and numbers load, so the page is never blank.
function preStrip(params) {
  if (params.code === "all") return;
  const c = S.cities.find((x) => x.code === params.code) || S.cities[0];
  $("#eyebrow").textContent = `${c.name} · after a ${YEARS_DEFAULT}-year flood`;
  $("#stripQ").textContent = "Where should the city hand out free leptospirosis medicine?";
  $("#answer").textContent = "Loading the numbers.";
  $("#strip").hidden = false;
}
function renderStrip() {
  $("#strip").hidden = false;
  const q = $("#stripQ"), eb = $("#eyebrow");
  if (!S.city) {
    eb.textContent = `Philippines · after a ${YEARS_DEFAULT}-year flood`;
    q.textContent = "Where does a flood put the most people at risk of leptospirosis?";
    const tot = S.cities.reduce((t, c) => t + (c.exposed || 0), 0);
    $("#answer").innerHTML = `<b>${fmt(tot)}</b> residents in ${S.cities.length} ${S.cities.length === 1 ? "city live" : "cities live"} where a ${YEARS_DEFAULT}-year flood reaches. Pick a city to see where to hand out free medicine first.`;
    return;
  }
  eb.textContent = `${cityName()} · after a ${years()}-year flood`;
  q.textContent = "Where should the city hand out free leptospirosis medicine?";
  renderSentence();
}
function renderSentence() {
  if (!S.city || !S.data) return;
  const sum = S.data.summary || {}, meta = S.data.meta || {};
  const exposed = sum.exposed != null ? sum.exposed : meta.exposed;
  const plan = sum.dose_point_plans && sum.dose_point_plans[S.plan];
  const cov = S.data.coverage || {};
  let share = cov.plans && cov.plans[S.plan] != null ? cov.plans[S.plan] : null;
  if (share == null && plan && plan.share_of_exposed_within_reach_after != null) { const v = +plan.share_of_exposed_within_reach_after; share = v > 1 ? v / 100 : v; }
  const now = cov.flood != null ? cov.flood : null;
  const a = $("#answer");
  const lead = exposed != null ? `<b>${fmt(exposed)}</b> residents waded through floodwater.` : "";
  let html;
  if (share != null) {
    html = `${lead} Opening <b>${S.plan}</b> temporary dose points brings <b class="big">${pct(share, 0)}</b> of them within a ${WALK_MIN}-minute walk of free doxycycline${now != null ? `<span class="now">, up from ${pct(now, 0)} now</span>` : ""}.`;
  } else if (exposed != null) {
    html = `${lead} Dose point plans are not computed for this city yet, so the map shows where the water reached.`;
  } else {
    html = "Flood exposure and dose point plans are not available for this city yet.";
  }
  const next = html.trim();
  if (a.innerHTML !== next) a.innerHTML = next;
  const pc = $("#planCov");
  if (pc) {
    pc.innerHTML = share != null
      ? `<b>${pct(share, 0)}</b> of exposed residents within a ${WALK_MIN}-minute walk of free medicine${now != null ? ` (${pct(now, 0)} with no dose points)` : ""}.`
      : "Coverage is not computed for this plan yet.";
  }
}
function renderLegend() {
  const lg = $("#legend");
  if (!S.city) {
    lg.innerHTML = `<div class="metric-name">Circle size: residents in the floodwater</div><p class="map-note" style="margin:0">A bigger circle means more residents live where a ${YEARS_DEFAULT}-year flood reaches. Pick a city to open its map.</p>`;
    return;
  }
  const m = S.metric, edges = [S.min, ...S.breaks, S.max], n = Math.max(1, S.breaks.length + 1);
  const label = (v) => (m.key === "share" ? pct(v, 0) : fmt(sig2(v)));
  const labs = edges.map(label);
  // Drop the second-to-last label when it would run into the last one.
  const ticks = labs.map((t, i) => (i === labs.length - 2 && labs.length > 3 && t.length + labs[i + 1].length > 9 ? "" : `<span style="left:${(i / n) * 100}%">${t}</span>`)).join("");
  lg.innerHTML = `<div class="metric-name" id="lgT">${m.legend}</div>
    <div class="ramp" aria-hidden="true">${RAMP.slice(0, n).map((c) => `<i style="background:${c}"></i>`).join("")}</div>
    <div class="ticks" aria-hidden="true">${ticks}</div>
    <div class="lg-words" aria-hidden="true"><span>${m.lo}</span><span>${m.hi}</span></div>
    <p class="sr-only">${m.legend}, from ${m.f(S.min)} to ${m.f(S.max)} ${m.unit}. Darker means more.</p>
    <div class="key"><span class="dot-gold"></span>Gold number: a dose point. 1 is the first to open.${S.view === "3d" ? " Column height follows the colour." : ""}</div>`;
}
function highlightList(code) {
  host.querySelectorAll("#cityList button").forEach((b) => b.setAttribute("aria-current", String(b.dataset.c === code)));
}

/* ---------- guided intro ---------- */
function topRow(key) {
  return S.data.rows.reduce((a, r) => ((r[key] ?? -1) > (a ? a[key] ?? -1 : -2) ? r : a), null);
}
function tourSteps() {
  const sum = S.data.summary || {}, name = cityName();
  const steps = [];
  steps.push({
    title: "The question and the answer",
    metric: "exposed", plan: null, hi: null, spot: "#strip",
    body: `This page answers one question: where should ${esc(name)} hand out free leptospirosis medicine after a flood? The sentence under the question gives the answer for the plan you pick.`,
  });
  const topE = topRow("exposed");
  steps.push({
    title: "Who was in the water",
    metric: "exposed", plan: null, hi: topE, val: fmt(topE.exposed), spot: null,
    body: `Darker barangays have more residents who waded through floodwater. ${esc(topE.name)} has the most: ${fmt(topE.exposed)} of ${fmt(topE.pop)} residents.`,
  });
  const p3 = sum.dose_point_plans && sum.dose_point_plans["3"];
  const share = S.data.coverage && S.data.coverage.plans && S.data.coverage.plans["3"];
  const has3 = availPlans().includes("3");
  const n = has3 ? 3 : Math.min(3, S.data.dosePoints.features.length) || 3;
  steps.push({
    title: "Where to set up first",
    metric: "exposed", plan: has3 ? "3" : null, top: n, hi: null, spot: "#sites",
    body: `The list on the left ranks the sites. The gold numbers 1 to ${n} on the map match it. ${p3 && share != null ? `Opening these ${n} brings ${pct(share, 0)} of exposed residents within a ${WALK_MIN}-minute walk of free medicine. ` : ""}Point at a list item to find it on the map.`,
    last: true,
  });
  return steps;
}
function tourSeen() { try { return localStorage.getItem(SEEN_KEY) === "1"; } catch { return false; } }
function markSeen() { try { localStorage.setItem(SEEN_KEY, "1"); } catch {} }
// The tour opens by itself once, on the very first visit. After that it is the chip in the strip.
function maybeTour() { if (!tourSeen() && S.city && !S.dead) startTour(false); }

function startTour(user) {
  if (!S.city || !S.data) return;
  endTour(false, true);
  closeOpts();
  S.tour = { i: 0, steps: tourSteps(), restore: { metric: S.metric, plan: S.plan }, tag: null, user, from: user ? document.activeElement : null };
  const card = document.createElement("div");
  card.className = "tour"; card.id = "tour";
  card.setAttribute("role", "dialog"); card.setAttribute("aria-labelledby", "tourT");
  $(".mapwrap").appendChild(card);
  onKey = (e) => { if (e.key === "Escape" && S.tour) { e.preventDefault(); endTour(true); } };
  document.addEventListener("keydown", onKey);
  tourStep(0);
}
function tourSpot(sel) {
  host.querySelectorAll(".spot").forEach((e) => e.classList.remove("spot"));
  if (sel) { const e = $(sel); if (e) e.classList.add("spot"); }
}
function tourStep(i) {
  const t = S.tour; if (!t) return;
  t.i = i;
  const st = t.steps[i], n = t.steps.length;
  const k = METRICS.find((m) => m.key === st.metric);
  if (S.metric !== k) setMetric(k);
  if (st.plan && S.plan !== st.plan) setPlan(st.plan);
  if (!$("#lyDose").checked) { $("#lyDose").checked = true; drawDose(); }
  if (st.spot === "#sites" && mobile.matches) openSheet(true);
  S.markers.forEach((m) => { const e = m.getElement(), r = +e.textContent; e.classList.toggle("hl", !!st.top && r <= st.top); e.classList.toggle("dim", !!st.top && !(r <= st.top)); });
  tourSpot(st.spot);
  tourClearHi();
  if (st.hi) {
    const f = S.data.barangays.features.find((x) => x.properties.adm4_pcode === st.hi.id);
    const flt = ["==", ["get", "adm4_pcode"], st.hi.id];
    map.setFilter("b-tour-c", flt); map.setFilter("b-tour", flt);
    const el = document.createElement("div");
    el.className = "tour-tag"; el.innerHTML = `<b>${esc(st.hi.name)}</b><span>${st.val} exposed</span>`;
    t.tag = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat(boundsOf(f).getCenter()).addTo(map);
  }
  const dots = t.steps.map((_, j) => `<i${j === i ? ' class="on"' : ""}></i>`).join("");
  const card = $("#tour");
  card.innerHTML = `<div class="tour-top"><span class="tour-step">Step ${i + 1} of ${n}</span><button class="linkbtn" type="button" data-a="skip">Skip tour</button></div>
    <h2 id="tourT" tabindex="-1">${st.title}</h2>
    <p id="tourB">${st.body}</p>
    <div class="tour-foot"><span class="dots" aria-hidden="true">${dots}</span>
    <span class="tour-btns">${st.last
      ? `<button class="btn sm" type="button" data-a="done">Explore the map</button><a class="btn sm ghost" href="${cityHref(S.city)}" data-a="dash">Open the city dashboard</a>`
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
// refocus: return focus to the chip. quiet: skip focus handling (page teardown). keepView: leave metric and plan as the tour set them.
function endTour(refocus, quiet, keepView) {
  const t = S && S.tour;
  if (!t) return;
  S.tour = null;
  tourClearHi(t);
  document.removeEventListener("keydown", onKey);
  const card = host && host.querySelector("#tour"); if (card) card.remove();
  if (host) tourSpot(null);
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
function openOpts(open) {
  const o = $("#opts"), b = $("#optBtn");
  o.hidden = !open;
  b.setAttribute("aria-expanded", String(open));
  b.classList.toggle("on", open);
}
function closeOpts() { if (host && $("#opts")) openOpts(false); }
function openSheet(open) {
  const dock = $("#dock"), h = $("#handle");
  dock.classList.toggle("closed", !open);
  h.setAttribute("aria-expanded", String(open));
  h.setAttribute("aria-label", open ? "Show less of the panel" : "Show more of the panel");
}

function wire() {
  const list = $("#cityList");
  const draw = (q = "") => {
    const t = q.trim().toLowerCase();
    const rows = S.cities.filter((c) => !t || `${c.name} ${c.province} ${c.region}`.toLowerCase().includes(t));
    list.innerHTML = rows.length ? rows.map((c) => `<li><button type="button" data-c="${esc(c.code)}"><span class="n">${esc(c.name)}<span class="p">${esc(c.province || "")}${c.region ? ", " + esc(c.region) : ""}</span></span><span class="v" aria-label="${fmt(c.exposed)} residents exposed">${fmt(c.exposed)}</span></button></li>`).join("") : '<li class="muted sm" style="padding:8px">No city matches.</li>';
  };
  draw();
  $("#cityPick").addEventListener("input", (e) => draw(e.target.value));
  list.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) selectCity(b.dataset.c); });
  $("#pickBack").addEventListener("click", () => showNational(false));
  $("#brgyPick").addEventListener("change", (e) => { if (e.target.value) { selectBrgy(e.target.value, true); openOpts(false); } else clearSel(); });
  $("#tourBtn").addEventListener("click", () => startTour(true));

  // site list: hover and focus light up the marker, click pans to it
  const sl = $("#siteList");
  const idOf = (e) => { const b = e.target.closest && e.target.closest("button.site"); return b ? b.dataset.id : null; };
  sl.addEventListener("click", (e) => { const id = idOf(e); if (id) setActive(id, { pan: true }); });
  sl.addEventListener("mouseover", (e) => { const id = idOf(e); if (id) setHover(id); });
  sl.addEventListener("mouseout", (e) => { if (idOf(e)) setHover(null); });
  sl.addEventListener("focusin", (e) => { const id = idOf(e); if (id) setHover(id); });
  sl.addEventListener("focusout", (e) => { if (idOf(e)) setHover(null); });

  // More options drawer
  $("#optBtn").addEventListener("click", () => openOpts($("#opts").hidden));
  $("#optClose").addEventListener("click", () => { openOpts(false); $("#optBtn").focus(); });
  host.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#opts").hidden && !S.tour) { openOpts(false); $("#optBtn").focus(); } });
  const ms = $("#measures");
  METRICS.forEach((m) => {
    const b = document.createElement("button");
    b.type = "button"; b.dataset.k = m.key; b.setAttribute("aria-pressed", String(m === S.metric));
    b.innerHTML = `<b>${esc(m.short)}</b><span>${esc(m.desc)}</span>`;
    b.addEventListener("click", () => { if (!b.disabled) setMetric(m); });
    ms.appendChild(b);
  });
  $("#ly3d").addEventListener("change", (e) => {
    S.view = e.target.checked ? "3d" : "2d"; applyView(); renderLegend();
    map.easeTo({ pitch: S.view === "3d" ? 50 : 0, bearing: S.view === "3d" ? -12 : 0, duration: dur(900) });
    syncUrl();
  });
  $("#lyDose").addEventListener("change", (e) => S.markers.forEach((m) => (e.target.checked ? m.addTo(map) : m.remove())));
  $("#lyRelief").addEventListener("change", (e) => { S.reliefOn = e.target.checked; applyRelief(); });
  $("#lyS1").addEventListener("change", (e) => map.setLayoutProperty("s1-fill", "visibility", e.target.checked ? "visible" : "none"));
  $("#handle").addEventListener("click", () => openSheet($("#dock").classList.contains("closed")));
}
