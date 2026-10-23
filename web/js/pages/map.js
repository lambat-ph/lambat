import { getCities, getCity, cityHref, scenarioOf } from "../data.js";
import { TERRARIUM, BASEMAP, BASEMAP_ATTR, BASE_STYLE_URL, COLORS, RAMP, WALK_MIN } from "../config.js";
import { fmt, pct, esc, reducedMotion, useCss, skel, moreBelow } from "../format.js";

const METRICS = [
  { key: "exposed", seg: "Exposed", prop: "exposed", short: "Exposed residents", desc: "People who live where a {Y}-year flood reaches.",
    legend: "Exposed residents, per barangay", unit: "residents", lo: "fewer", hi: "more", f: fmt },
  { key: "unreached", seg: "Cut off", prop: "exposed_unreached_flood", short: "Residents cut off from care", desc: `Exposed residents more than a ${WALK_MIN}-minute walk from a clinic while the flood is on.`,
    legend: `Residents cut off from care, per barangay`, unit: "residents", lo: "fewer", hi: "more", f: fmt },
  { key: "share", seg: "Area flooded", prop: "flooded_share", short: "Area flooded", desc: "How much of each barangay's land a {Y}-year flood covers.",
    legend: "Share of each barangay's area flooded", unit: "of the area", lo: "less", hi: "more", f: (v) => pct(v, 0) },
];
const KINDS = {
  school: "School", townhall: "Barangay hall", town_hall: "Barangay hall", community_centre: "Community centre", community_center: "Community centre",
  hospital: "Hospital", clinic: "Health centre", doctors: "Health centre", health_post: "Health centre", healthcare: "Health centre", rural_health_unit: "Health centre", pharmacy: "Pharmacy", place_of_worship: "Place of worship", church: "Church",
  fire_station: "Fire station", police: "Police station", library: "Library", marketplace: "Market", sports_centre: "Sports centre",
  social_facility: "Social facility", kindergarten: "Kindergarten", college: "College", university: "University", government: "Government office",
};
const kindLabel = (k) => { if (!k) return "Dose point"; if (KINDS[k]) return KINDS[k]; const t = String(k).replace(/_/g, " "); return t.charAt(0).toUpperCase() + t.slice(1); };
const SEEN_KEY = "lambat.tourSeen";
const PLANS = ["3", "5", "8"];
// Optional plan-aware fields (cut_off_after_3/5/8). When the data has them, "Cut off from care" follows the plan.
const cutProp = (k) => "cut_off_after_" + k;
const hasCut = (k) => !!(S && S.data && S.data.barangays.features.some((f) => Number.isFinite(+f.properties[cutProp(k)]) && f.properties[cutProp(k)] != null));
function mprop(m) {
  m = m || S.metric;
  return m.key === "unreached" && S.dynCut ? cutProp(S.plan) : m.prop;
}
const YEARS_DEFAULT = 25;

const CHEV = '<svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const TEMPLATE = `
<div class="mapwrap" id="mapwrap">
  <aside class="col closed" id="col" aria-label="The answer and the ranked sites">
    <button class="handle" id="handle" type="button" aria-expanded="false" aria-controls="colMore"><span class="handle-t" id="handleT">Show the plan</span></button>
    <header class="col-top" id="colTop" hidden>
      <button class="col-collapse" id="colCollapse" type="button" aria-expanded="true" aria-controls="col" aria-label="Hide the panel">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>
      </button>
      <p class="eyebrow" id="eyebrow"></p>
      <p class="scn" id="scnNote" hidden></p>
      <h1 class="q" id="stripQ"></h1>
      <div class="a" id="answer"></div>
      <div class="col-foot"><button class="linkbtn" id="tourBtn" type="button" hidden>New here? Take the tour</button></div>
    </header>
    <div class="col-more" id="colMore">
      <section class="sec sec-sites" id="sites" aria-labelledby="sitesH" hidden>
        <div class="plan-h">
          <h2 id="sitesH">Where to open first</h2>
          <button class="sec-tog" id="sitesTog" type="button" aria-expanded="true" aria-controls="sitesBody" aria-label="Hide the dose point list">${CHEV}</button>
          <div class="plan-pick" id="planPick"><div class="pseg" id="planSeg" role="radiogroup" aria-label="Plan size: how many dose points to open"></div><span class="plan-u" aria-hidden="true">dose points</span></div>
        </div>
        <div class="sites-body" id="sitesBody"><div>
        <p class="cov" id="planCov"></p>
        <ol class="sitelist" id="siteList"></ol>
        <p class="map-note" id="siteNote" hidden></p>
        <p class="map-note order" id="orderNote">1 opens first. Not yet checked against flood reports. <a href="#/method">See Method</a></p>
        <div class="acts" id="acts"><button class="act" id="copyLink" type="button">Copy link</button><button class="act" id="dlPlan" type="button">Download plan (CSV)</button><span class="sr-only" id="actLive" role="status" aria-live="polite"></span></div>
        </div></div>
      </section>
      <section class="sec sec-cities" id="cities" aria-labelledby="citiesH" hidden>
        <h2 id="citiesH">Pick a city</h2>
        <label class="sr-only" for="cityPick">Search cities</label>
        <input class="field" id="cityPick" type="search" placeholder="Search a city" autocomplete="off">
        <ul class="citylist" id="cityList"></ul>
      </section>
      <section class="sec sec-legend" id="legend" aria-label="Legend"></section>
    </div>
  </aside>

  <div class="mapside">
    <div id="map" role="region" aria-label="Map of flood exposure by barangay, with numbered dose points. The list in the side panel and the city dashboard give the same information as text."></div>
    <div class="loading" id="loading" role="status" hidden></div>
    <div class="island" id="island" hidden><div class="isl" id="isl" aria-hidden="true"></div></div>
    <p class="sr-only" id="islLive" role="status" aria-live="polite"></p>
    <button class="show-panel" id="showPanel" type="button" aria-label="Show the panel" hidden>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg><span>Show panel</span>
    </button>
    <div class="loader" id="loader" role="status" aria-live="polite">
      <div class="loader-box">
        <img class="loader-logo" src="assets/logo-mark.svg" alt="" width="72" height="72">
        <h2 class="loader-title">Loading the flood map</h2>
        <p class="loader-step" id="loaderStep"></p>
        <div class="loader-bar" id="loaderBar" aria-hidden="true"></div>
      </div>
    </div>
    <button class="opt-btn" id="optBtn" type="button" aria-expanded="false" aria-controls="opts" aria-label="More options" hidden>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>
      <span>More options</span>
    </button>
    <div class="scrim" id="optScrim"></div>
    <aside class="drawer" id="opts" role="dialog" aria-modal="true" aria-labelledby="optsT" inert>
      <div class="drawer-head"><h2 id="optsT">More options</h2><button class="x" id="optClose" type="button" aria-label="Close more options">&times;</button></div>
      <div class="drawer-body" id="optsBody">
        <h3 class="opts-h" id="measureH">Colour the map by</h3>
        <div class="mseg" id="measures" role="radiogroup" aria-labelledby="measureH"></div>
        <p class="map-note mdesc" id="measureDesc"></p>
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
      </div>
    </aside>
    <div class="col-right" id="colRight">
      <section class="w info" id="info" aria-label="Barangay details" hidden aria-live="polite"></section>
    </div>
  </div>
</div>`;

const POP = typeof HTMLElement !== "undefined" && typeof HTMLElement.prototype.showPopover === "function";
const SHEET_Q = "(max-width:599px)";
// Status island state (one island per page; reset in render()).
const I = { key: null, kind: null, stage: null, chip: null, chipT: 0, cur: null, hover: null, rolled: null, live: "" };

let map, host, S, mobile, ro, ro2, ro3, onKey, tipEl, onDown, onTipKey, onOptKey, onTourResize, onColScroll, onTipResize;
let moreOff = [], moreDrawer = null;
let loaderOn = false, loaderT, loaderFade;

/* ---------- loading screen ---------- */
// The step text lives in the status island now; the overlay only shows the logo and a calm bar.
const loaderStep = (n, t) => stage(n, t);
function hideLoader() {
  if (!loaderOn) return;
  loaderOn = false; clearTimeout(loaderT);
  sitesAutoFit();
  const l = host && host.querySelector("#loader");
  if (!l) return;
  l.classList.add("loader-out");
  if (reducedMotion()) l.remove(); else loaderFade = setTimeout(() => l.remove(), 400);
}
// A stuck load gets a plain retry hint instead of spinning forever.
function loaderStuck(html) {
  const e = loaderOn && host.querySelector("#loaderStep");
  if (!e) return;
  clearTimeout(loaderT);
  e.innerHTML = html || 'This is taking longer than usual. Check your connection, then <button class="btn sm loader-retry" type="button" id="loaderRetry">Try again</button>';
  const bar = host.querySelector("#loaderBar"); if (bar) bar.hidden = true;
  stage(I.stage ? I.stage.n : 1, "Taking longer than usual");
  const b = host.querySelector("#loaderRetry"); if (b) b.addEventListener("click", () => location.reload());
}
const $ = (s) => host.querySelector(s);
const dur = (n) => (reducedMotion() ? 0 : n);
const cityName = () => { const c = S.cities.find((x) => x.code === S.city); return c ? c.name : ""; };
const metaOf = (code) => S && S.cities.find((x) => x.code === code);
// The flood the current city's numbers are for: 25 or 100.
const years = () => { const c = metaOf(S.city || S.pre); return c ? scenarioOf(c).yrs : YEARS_DEFAULT; };
const nat25 = () => S.cities.filter((c) => !scenarioOf(c).is100);
const nat100 = () => S.cities.filter((c) => scenarioOf(c).is100);
// The quiet badge under the eyebrow, and the year in the source line.
function setScn(c) {
  const sc = c ? scenarioOf(c) : null, n = $("#scnNote");
  if (n) { n.hidden = !(sc && sc.is100); n.textContent = sc && sc.is100 ? sc.note : ""; }
  host.querySelectorAll(".src .yr").forEach((e) => { e.textContent = sc ? sc.yrs : YEARS_DEFAULT; });
}
const sig2 = (v) => { if (v == null) return 0; if (Math.abs(v) < 100) return Math.round(v); const p = 10 ** (Math.floor(Math.log10(Math.abs(v))) - 1); return Math.round(v / p) * p; };

export async function render(el, params) {
  useCss("map");
  host = el;
  mobile = window.matchMedia(SHEET_Q);
  S = { cities: [], city: null, pre: null, data: null, metric: METRICS[0], view: "2d", plan: "3", sel: null, reliefOn: false, reliefOK: null, breaks: [], min: 0, max: 1, scaleH: 1000, markers: [], sites: [], active: null, hover: null, open: null, rollKey: null, peek: 320, cityMarkers: [], tour: null, params, dead: false, ready: false, colHidden: false };
  clearTimeout(I.chipT);
  Object.assign(I, { key: null, kind: null, stage: null, chip: null, cur: null, hover: null, rolled: null, live: "" });
  el.innerHTML = TEMPLATE;
  tipEl = document.createElement("div");
  tipEl.id = "tipPop"; tipEl.className = "tipbox"; tipEl.setAttribute("role", "note");
  if (POP) tipEl.setAttribute("popover", "manual"); else tipEl.hidden = true;
  $("#mapwrap").appendChild(tipEl);
  loaderOn = true; clearTimeout(loaderT); clearTimeout(loaderFade);
  loaderT = setTimeout(() => loaderStuck(), 45000);
  stage(1, "Getting the basemap");
  try { S.cities = await getCities(); } catch { S.cities = []; }
  if (!S.cities.length) { loaderStuck("No city data found. Reload the page to try again."); return; }
  wire();
  preStrip(params);
  boot();
}

export function destroy() {
  if (S) { S.dead = true; endTour(false, true); }
  loaderOn = false; clearTimeout(loaderT); clearTimeout(loaderFade);
  if (host) { const l = host.querySelector("#loader"); if (l) l.remove(); }
  if (ro) { ro.disconnect(); ro = null; }
  if (ro2) { ro2.disconnect(); ro2 = null; }
  if (ro3) { ro3.disconnect(); ro3 = null; }
  if (I.ro) { I.ro.disconnect(); I.ro = null; }
  clearTimeout(I.chipT); if (S) { clearTimeout(S.refitT); clearTimeout(S.readyT); }
  window.removeEventListener("resize", onTipResize);
  if (mobile) mobile.removeEventListener("change", syncSheet);
  document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onTipKey); document.removeEventListener("keydown", onOptKey);
  moreOff.forEach((f) => f()); moreOff = [];
  if (moreDrawer) { moreDrawer(); moreDrawer = null; }
  if (tipEl) { hideTip(); tipEl = null; }
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
    loaderStuck('This browser could not start the map. <a href="#/city">Open the city dashboard</a> for the same data as tables.');
    return;
  }
  map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showCompass: true }), "bottom-right");
  window.__lambatMap = map;
  // The container can still be settling when the map starts; keep the canvas in step with it.
  ro = new ResizeObserver(() => { if (map) map.resize(); });
  ro.observe($("#map"));
  // On phones the sheet peeks up by the height of the question and answer; keep that in step with the text.
  ro2 = new ResizeObserver(setPeek);
  ro2.observe($("#colTop"));
  setPeek();
  // The island measures its free area; refit when that area changes.
  ro3 = new ResizeObserver(() => islRefit());
  ro3.observe($("#island"));
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

async function onLoad() {
  loaderStep(2, "Loading barangay outlines");
  quietBasemap();
  addHatch();
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
    loaderStep(3, "Placing the cities");
    mapReady();
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
const NAT_IDS = ["nat-dot", "nat-dot100", "nat-ring100"];
const setNat = (on) => NAT_IDS.forEach((id) => { if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none"); });
// A dashed circle drawn once on a canvas, in the brand blue.
function dashRing(n) {
  const cv = document.createElement("canvas"); cv.width = cv.height = n;
  const g = cv.getContext("2d"); g.strokeStyle = COLORS.blue; g.lineWidth = 5; g.setLineDash([14, 10]); g.lineCap = "butt";
  g.beginPath(); g.arc(n / 2, n / 2, n / 2 - 4, 0, Math.PI * 2); g.stroke();
  return g.getImageData(0, 0, n, n);
}
const natRadius = (e, mx) => Math.min(34, Math.max(9, 9 + Math.sqrt((e || 0) / mx) * 25));
function buildNational() {
  const mx = Math.max(...S.cities.map((c) => c.exposed || 0), 1);
  const gj = { type: "FeatureCollection", features: S.cities.map((c) => ({ type: "Feature", properties: { code: c.code, r: natRadius(c.exposed, mx), s100: scenarioOf(c).is100 ? 1 : 0 }, geometry: { type: "Point", coordinates: [c.lon, c.lat] } })) };
  map.addSource("nat", { type: "geojson", data: gj });
  const f100 = ["==", ["get", "s100"], 1], f25 = ["!=", ["get", "s100"], 1];
  map.addLayer({ id: "nat-dot", type: "circle", source: "nat", filter: f25, layout: { visibility: "none" }, paint: { "circle-radius": ["get", "r"], "circle-color": COLORS.blue, "circle-opacity": 0.55, "circle-stroke-color": "#FFFFFF", "circle-stroke-width": 2 } });
  // 100-year cities: a pale fill and a dashed ring, so they are not read against the 25-year circles
  if (!map.hasImage("dash-ring")) map.addImage("dash-ring", dashRing(128), { pixelRatio: 1 });
  map.addLayer({ id: "nat-dot100", type: "circle", source: "nat", filter: f100, layout: { visibility: "none" }, paint: { "circle-radius": ["get", "r"], "circle-color": COLORS.blue, "circle-opacity": 0.14 } });
  map.addLayer({ id: "nat-ring100", type: "symbol", source: "nat", filter: f100, layout: { visibility: "none", "icon-image": "dash-ring", "icon-size": ["/", ["*", ["get", "r"], 2.3], 128], "icon-allow-overlap": true, "icon-ignore-placement": true } });
  NAT_IDS.forEach((id) => {
    map.on("click", id, (e) => selectCity(e.features[0].properties.code));
    map.on("mouseenter", id, () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", id, () => { map.getCanvas().style.cursor = ""; });
  });
  S.cities.forEach((c) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "city-pin";
    const c100 = scenarioOf(c).is100;
    b.innerHTML = `<b>${esc(c.name)}</b><span>${fmt(c.exposed)} exposed residents${c100 ? ", 100-year flood" : ""}</span>`;
    b.setAttribute("aria-label", `${c.name}, ${fmt(c.exposed)} residents exposed${c100 ? " to a 100-year flood, which is larger than a 25-year flood" : ""}. Open this city.`);
    if (c100) b.classList.add("p100");
    b.addEventListener("click", () => selectCity(c.code));
    b.style.display = "none";
    S.cityMarkers.push(new maplibregl.Marker({ element: b, anchor: "left", offset: [natRadius(c.exposed, mx) + 6, 0] }).setLngLat([c.lon, c.lat]).addTo(map));
  });
}
// The side column no longer covers the map on desktop, so the padding is small. On phones the sheet covers the bottom.
function pad() {
  const col = document.getElementById("col"), ms = document.querySelector(".mapside");
  if (mobile.matches) {
    // The visible part of the map is what the sheet leaves above it, at whatever height the sheet has now.
    const H = (ms && ms.clientHeight) || window.innerHeight;
    const sheet = col && !col.classList.contains("closed") ? col.offsetHeight : S.peek;
    const bottom = sheet + 16;
    return { top: Math.min(72, Math.max(16, H - bottom - 88)), left: 24, right: 24, bottom };
  }
  return { top: 72, left: (col && !S.colHidden ? col.offsetWidth + 16 : 0) + 40, right: 40, bottom: 48 };
}
// The map is ready (first idle): hide the loader and let the island show the answer.
function mapReady() {
  clearTimeout(S.readyT);
  const done = () => { if (!S || S.dead) return; clearTimeout(S.readyT); hideLoader(); S.ready = true; islRender(); if (S.tourPending) { S.tourPending = false; setTimeout(() => { if (S && !S.dead && S.city && !S.tour) maybeTour(); }, 350); } };
  map.once("idle", done);
  S.readyT = setTimeout(done, 15000);
}
function showNational(first) {
  endTour(false);
  S.city = null; S.pre = null; S.data = null; S.active = null; S.hover = null; clearSel();
  setCityLayers(false);
  if (map.getLayer("b-hov")) { map.setLayoutProperty("b-hov", "visibility", "none"); S.hovB = null; }
  I.hover = null; if (!first) S.ready = true;
  map.setTerrain(null);
  map.setLayoutProperty("hill", "visibility", "none");
  setNat(true);
  if (map.getLayer("s1-fill")) map.setLayoutProperty("s1-fill", "visibility", "none");
  S.cityMarkers.forEach((m) => { m.getElement().style.display = ""; });
  clearDose(); S.rollKey = null;
  $("#sites").hidden = true; $("#cities").hidden = false; unbusy();
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
  const stepped = ["step", ["coalesce", ["get", mprop()], 0], RAMP[0]];
  S.breaks.forEach((b, i) => stepped.push(b, RAMP[i + 1]));
  // zero has its own class, so "none" is never confused with the palest band or the basemap
  const base = S.hasZero ? ["case", ["<=", valExpr(), 0], ZERO, stepped] : stepped;
  if (!withSel) return base;
  // 3D: neighbours in the palest band alternate between two near-identical tints so their edges still show without lines
  const first = S.breaks.length ? S.breaks[0] : Infinity;
  return ["case", ["boolean", ["feature-state", "sel"], false], COLORS.ink, ["all", [">", valExpr(), 0], ["<", valExpr(), first], ["==", ["%", codeNum, 2], 1]], TOP_ALT, base];
}
const codeNum = ["to-number", ["slice", ["get", "adm4_pcode"], 8], 0];
const LOW = 0.15, TOP_ALT = "#DAE1EE", ZERO = "#F7F8FB";
// Diagonal hatch for barangays at exactly zero, drawn over the 2D fill.
function addHatch() {
  if (map.hasImage("zero-hatch")) return;
  const n = 16, d = new Uint8ClampedArray(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if ((x - y + n) % n < 3) { const i = (y * n + x) * 4; d[i] = 120; d[i + 1] = 128; d[i + 2] = 152; d[i + 3] = 215; }
  }
  map.addImage("zero-hatch", { width: n, height: n, data: d }, { pixelRatio: 2 });
}
const valExpr = () => ["coalesce", ["get", mprop()], 0];
// a very low plinth under every barangay, stepped by code (3 levels), so neighbours with the same value still show an edge in 3D
const heightExpr = () => ["+", ["*", S.scaleH * 0.003, ["+", 1, ["%", codeNum, 3]]], ["*", ["coalesce", ["get", mprop()], 0], S.scaleH / S.max]];
function setCityLayers(on) {
  ["b-ext", "b-flat", "b-zero", "b-case", "b-line", "b-sel-c", "b-sel", "b-case3", "b-line3"].forEach((id) => { if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none"); });
  if (on) applyView();
}
function applyView() {
  const d3 = S.view === "3d";
  map.setLayoutProperty("b-ext", "visibility", d3 ? "visible" : "none");
  map.setLayoutProperty("b-flat", "visibility", d3 ? "none" : "visible");
  map.setLayoutProperty("b-case", "visibility", d3 ? "none" : "visible");
  map.setLayoutProperty("b-line", "visibility", d3 ? "none" : "visible");
  if (map.getLayer("b-zero")) map.setLayoutProperty("b-zero", "visibility", d3 || !S.hasZero ? "none" : "visible");
  map.setLayoutProperty("b-sel", "visibility", d3 ? "none" : "visible");
  map.setLayoutProperty("b-sel-c", "visibility", d3 ? "none" : "visible");
  map.setLayoutProperty("b-case3", "visibility", d3 ? "visible" : "none");
  map.setLayoutProperty("b-line3", "visibility", d3 ? "visible" : "none");
  map.setLayoutProperty("b-hov", "visibility", "visible");
  $("#ly3d").checked = d3;
}
function paintMetric() {
  const b = breaksFor(S.metric, S.data.barangays.features);
  S.breaks = b.breaks; S.max = b.max || 1; S.min = b.min;
  const vals = S.data.barangays.features.map((f) => +f.properties[mprop()] || 0);
  const base = S.data.barangays.features.map((f) => +f.properties[S.metric.prop] || 0);
  S.hasZero = vals.some((v) => v <= 0);
  S.minPos = Math.min(...base.filter((v) => v > 0), S.max);
  if (map.getLayer("b-zero")) {
    map.setLayoutProperty("b-zero", "visibility", S.view === "3d" || !S.hasZero ? "none" : "visible");
    map.setFilter("b-zero", ["<=", valExpr(), 0]);
  }
  map.setPaintProperty("b-ext", "fill-extrusion-color", colorExpr(true));
  map.setPaintProperty("b-ext", "fill-extrusion-height", heightExpr());
  map.setPaintProperty("b-flat", "fill-color", colorExpr(false));
  // 3D line overlays sit above the columns, but only for the low barangays; tall ones keep their walls
  const low = ["<", valExpr(), S.max * LOW];
  map.setFilter("b-case3", low); map.setFilter("b-line3", low);
  renderLegend();
}
function setMetric(m) {
  S.metric = m;
  syncMeasure();
  paintMetric(); syncUrl(); islRender();
}
// "Colour the map by": a sliding thumb under the chosen measure, and its one-line description.
function syncMeasure() {
  const ms = $("#measures"), i = METRICS.indexOf(S.metric), inp = ms.querySelectorAll("input");
  if (inp[i]) inp[i].checked = true;
  ms.style.setProperty("--i", Math.max(0, i));
  $("#measureDesc").textContent = S.metric.desc.replace("{Y}", years());
}
function ensureCityLayers() {
  if (map.getSource("brgy")) { map.getSource("brgy").setData(S.data.barangays); return; }
  map.addSource("brgy", { type: "geojson", data: S.data.barangays, promoteId: "adm4_pcode" });
  map.addLayer({ id: "b-ext", type: "fill-extrusion", source: "brgy", layout: { visibility: "none" }, paint: { "fill-extrusion-color": RAMP[0], "fill-extrusion-height": 0, "fill-extrusion-base": 0, "fill-extrusion-opacity": 0.94 } });
  map.addLayer({ id: "b-flat", type: "fill", source: "brgy", layout: { visibility: "none" }, paint: { "fill-color": RAMP[0], "fill-opacity": 0.88 } }, S.before);
  map.addLayer({ id: "b-zero", type: "fill", source: "brgy", layout: { visibility: "none" }, filter: ["==", ["get", "adm4_pcode"], ""], paint: { "fill-pattern": "zero-hatch" } }, S.before);
  // dark casing under a white line: the border reads on both the palest and the darkest fills
  map.addLayer({ id: "b-case", type: "line", source: "brgy", layout: { visibility: "none", "line-join": "round" }, paint: { "line-color": COLORS.ink, "line-opacity": 0.6, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.5, 14, 4] } }, S.before);
  map.addLayer({ id: "b-line", type: "line", source: "brgy", layout: { visibility: "none", "line-join": "round" }, paint: { "line-color": "#FFFFFF", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.6, 14, 1.75] } }, S.before);
  // 3D: the same casing and white line drawn above the columns for low barangays (filter set in paintMetric)
  map.addLayer({ id: "b-case3", type: "line", source: "brgy", layout: { visibility: "none", "line-join": "round" }, paint: { "line-color": COLORS.ink, "line-opacity": 0.6, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.5, 14, 4] } });
  map.addLayer({ id: "b-line3", type: "line", source: "brgy", layout: { visibility: "none", "line-join": "round" }, paint: { "line-color": "#FFFFFF", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.6, 14, 1.75] } });
  // selected shape: white halo under a dark outline, so it stands out on every fill
  map.addLayer({ id: "b-sel-c", type: "line", source: "brgy", layout: { visibility: "none", "line-join": "round" }, filter: ["==", ["get", "adm4_pcode"], ""], paint: { "line-color": "#FFFFFF", "line-width": 8 } }, S.before);
  map.addLayer({ id: "b-sel", type: "line", source: "brgy", layout: { visibility: "none", "line-join": "round" }, filter: ["==", ["get", "adm4_pcode"], ""], paint: { "line-color": COLORS.ink, "line-width": 3.5 } }, S.before);
  // Intro highlight: a dark casing under a gold line, visible in both 2D and 3D.
  const none = ["==", ["get", "adm4_pcode"], ""];
  map.addLayer({ id: "b-tour-c", type: "line", source: "brgy", filter: none, paint: { "line-color": COLORS.ink, "line-width": 7 } }, S.before);
  map.addLayer({ id: "b-tour", type: "line", source: "brgy", filter: none, paint: { "line-color": COLORS.gold, "line-width": 3.5 } }, S.before);
  // Dynamic plan data: pulse for barangays that lose cut-off residents, outline for the barangays a dose point serves.
  map.addLayer({ id: "b-pulse", type: "fill", source: "brgy", layout: { visibility: "none" }, filter: none, paint: { "fill-color": COLORS.gold, "fill-opacity": 0 } }, "b-case");
  map.addLayer({ id: "b-serve-c", type: "line", source: "brgy", layout: { "line-join": "round" }, filter: none, paint: { "line-color": "#FFFFFF", "line-width": 7 } });
  map.addLayer({ id: "b-serve", type: "line", source: "brgy", layout: { "line-join": "round" }, filter: none, paint: { "line-color": COLORS.ink, "line-width": 3, "line-dasharray": [2, 1.5] } });
  // Hover outline, on top of everything so it works in 2D and 3D.
  map.addLayer({ id: "b-hov", type: "line", source: "brgy", layout: { "line-join": "round" }, filter: none, paint: { "line-color": COLORS.ink, "line-width": 2 } });
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
    if (S.hovB !== code) { S.hovB = code; map.setFilter("b-hov", ["==", ["get", "adm4_pcode"], code || ""]); }
    if (I.hover !== code) { I.hover = code; islRender(); }
  });
  map.getCanvas().addEventListener("mouseleave", () => { S.hovB = null; map.setFilter("b-hov", ["==", ["get", "adm4_pcode"], ""]); if (I.hover) { I.hover = null; islRender(); } });
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
  S.ready = false; I.hover = null; clearTimeout(S.readyT);
  stage(loaderOn ? 2 : 1, loaderOn ? "Loading barangay outlines" : "Loading " + c.name);
  const ld = $("#loading"); if (!loaderOn) { ld.hidden = false; ld.textContent = "Loading " + c.name; }
  let data;
  try { data = await getCity(code); } catch (e) { data = { error: e.message }; }
  if (S.dead || !map) return;
  ld.hidden = true;
  if (!data || data.error || !data.barangays) {
    hideLoader(); unbusy(); $("#sites").hidden = true; S.ready = true; islRender();
    $("#answer").removeAttribute("aria-busy"); $("#answer").textContent = "The numbers could not be loaded.";
    const n = $("#info"); n.hidden = false; n.innerHTML = `<p class="notice">Could not load ${esc(c.name)}: ${esc((data && data.error) || "no data")}</p>`;
    return;
  }
  loaderStep(3, "Placing dose points");
  S.data = data; S.city = code; S.active = null; S.hover = null; clearSel();
  const hasUnreached = data.rows.some((r) => r.unreached != null);
  const ui = $('#measures input[value="unreached"]');
  ui.disabled = !hasUnreached; ui.parentNode.title = hasUnreached ? "" : "Not computed for this city yet";
  if (!hasUnreached && S.metric.key === "unreached") S.metric = METRICS[0];
  syncMeasure();
  const bb = data.bbox;
  const diag = Math.hypot((bb[2] - bb[0]) * 111.32 * Math.cos((c.lat * Math.PI) / 180), (bb[3] - bb[1]) * 110.57) * 1000;
  S.scaleH = Math.max(300, diag * 0.06);
  ensureCityLayers();
  S.cityMarkers.forEach((m) => { m.getElement().style.display = "none"; });
  setNat(false);
  // Pick a plan this city actually has.
  const avail = availPlans();
  if (!avail.includes(S.plan)) S.plan = avail.includes("3") ? "3" : avail[0] || "3";
  S.dynCut = hasCut(S.plan);
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
  loaderStep(4, "Drawing the map");
  mapReady();
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
  if (map && map.getLayer("b-sel")) { const none = ["==", ["get", "adm4_pcode"], ""]; map.setFilter("b-sel", none); map.setFilter("b-sel-c", none); }
  const inf = $("#info"); if (inf) inf.hidden = true;
  const bp = $("#brgyPick"); if (bp) bp.value = "";
  islRender();
}
function selectBrgy(code, fly) {
  if (S.sel) map.setFeatureState({ source: "brgy", id: S.sel }, { sel: false });
  S.sel = code;
  map.setFeatureState({ source: "brgy", id: code }, { sel: true });
  map.setFilter("b-sel", ["==", ["get", "adm4_pcode"], code]);
  map.setFilter("b-sel-c", ["==", ["get", "adm4_pcode"], code]);
  $("#brgyPick").value = code;
  const r = S.data.rows.find((x) => x.id === code);
  const info = $("#info");
  info.hidden = false;
  const said = [];
  if (r.pop) said.push(`${fmt(r.exposed)} of ${fmt(r.pop)} residents in ${esc(r.name)} live where a ${years()}-year flood reaches.`);
  else said.push(`${fmt(r.exposed)} residents in ${esc(r.name)} live where a ${years()}-year flood reaches.`);
  if (r.unreached != null && r.exposed) said.push(`${fmt(r.unreached)} of them are cut off from care: more than a ${WALK_MIN}-minute walk from a clinic while the flood is on.`);
  if (r.share != null) said.push(`${pct(r.share, 0)} of the barangay's area is flooded.`);
  info.innerHTML = `<button class="close" type="button" aria-label="Close details">&times;</button>
    <h2>${esc(r.name)}</h2><p class="said">${said.join(" ")}</p>
    <dl><dt>Residents</dt><dd>${fmt(r.pop)}</dd>
    <dt>Exposed residents</dt><dd>${fmt(r.exposed)}${r.pop ? " (" + pct(r.exposed / r.pop, 0) + ")" : ""}</dd>
    ${r.unreached != null ? `<dt>Cut off from care</dt><dd>${fmt(r.unreached)}</dd>` : ""}
    ${S.dynCut ? `<dt>Cut off after opening ${S.plan} dose points</dt><dd>${fmt(cutAfter(code))}</dd>` : ""}
    <dt>Area flooded</dt><dd>${pct(r.share, 0)}</dd>
    <dt>Capsules per flood week</dt><dd>${fmt(r.capsules)}</dd></dl>
    <a href="${cityHref(S.city, "barangays")}">Open city dashboard</a>`;
  info.querySelector(".close").addEventListener("click", clearSel);
  const feat = S.data.barangays.features.find((x) => x.properties.adm4_pcode === code);
  if (fly) map.fitBounds(boundsOf(feat), { padding: pad(), maxZoom: S.view === "3d" ? 13 : 15, duration: dur(900), pitch: S.view === "3d" ? 45 : 0 });
  placeInfo(feat);
  if (fly && !reducedMotion()) map.once("moveend", () => { if (S.sel === code) placeInfo(feat); });
  islRender();
}
// Keep the details card away from the selected shape: it goes on the side of the free map area the shape is not on.
function placeInfo(feat) {
  const info = $("#info"), ms = $(".mapside");
  if (!info || info.hidden || !feat || !map) return;
  const mw = ms.clientWidth, p = map.project(boundsOf(feat).getCenter());
  if (!mobile.matches) {
    const col = $("#col"), left = col && !S.colHidden ? col.offsetWidth + 16 : 0;
    $("#colRight").classList.toggle("on-left", p.x > left + (mw - left) / 2);
    return;
  }
  // phones: the card sits at the top; slide the map so the shape is below it
  const need = info.getBoundingClientRect().bottom - ms.getBoundingClientRect().top + 24 - p.y;
  const room = ms.clientHeight - S.peek - 24 - p.y;
  if (need > 0 && need < room + 40 && !S.tour) {
    const c = map.project(map.getCenter());
    map.easeTo({ center: map.unproject([c.x, c.y - need]), duration: dur(350) });
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
  return f ? f.properties : null;
}
const planVal = (v, k) => (v != null && typeof v === "object" ? v[k] : v);
// The sites of the current plan, in rank order, with plain-language names.
// Cut-off residents a dose point reaches in plan k (newly_reached, else the sum over its serves list), or null.
function servedCount(p, k) {
  const nr = p.newly_reached != null ? planVal(p.newly_reached, k) : null;
  if (nr != null && Number.isFinite(+nr)) return +nr;
  const sv = planVal(p.serves, k);
  return Array.isArray(sv) ? sv.reduce((t, x) => t + (+x.residents || 0), 0) : null;
}
const reachLine = (s) => (s.cutN != null ? `Reaches ${fmt(s.cutN)} cut-off residents${s.serves ? ` in ${s.serves.length} ${s.serves.length === 1 ? "barangay" : "barangays"}` : ""}` : null);
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
    const p = f.properties, kl = kindLabel(p.kind), bp = barangayAt(f.geometry.coordinates), where = bp ? bp.adm4_en : null;
    const row = bp ? S.data.rows.find((r) => r.id === bp.adm4_pcode) : null;
    const named = p.name && String(p.name).trim();
    const reach = planVal(p.newly_covered, k) ?? planVal(p.exposed_newly_covered, k);
    return {
      id: p.id, rank: rankOf(p), coords: f.geometry.coordinates, kind: kl, where, row,
      name: named ? String(p.name).trim() : `Unnamed ${kl.toLowerCase()}${where ? " in " + where : ""}`,
      sub: named ? kl + (where ? ", " + where : "") : kl,
      reach: reach != null && !Number.isNaN(+reach) ? +reach : null,
      serves: Array.isArray(planVal(p.serves, k)) ? planVal(p.serves, k) : null,
      cutN: servedCount(p, k),
    };
  }).sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
  return { sites, total };
}
function clearDose() { S.markers.forEach((m) => m.remove()); S.markers = []; S.sites = []; S.open = null; }
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
      .setPopup(new maplibregl.Popup({ offset: 22, closeButton: false, className: "tip", maxWidth: "280px" }).setHTML(sitePopup(s, s.rank ?? i + 1)));
    if (show) mk.addTo(map);
    s.marker = mk; s.el = b;
    S.markers.push(mk);
  });
  renderSites(total);
  renderSentence();
  paintMarkers();
}
// What the marker popup says: the same numbers as the row, in plain words.
function sitePopup(s, n) {
  const r = s.row, l = [`Dose point order: ${n} (1 opens first)`];
  if (reachLine(s)) l.push(reachLine(s));
  if (s.reach != null) l.push(`Brings ${fmt(s.reach)} more exposed residents within a ${WALK_MIN}-minute walk`);
  if (r) {
    const b = [];
    if (r.exposed != null) b.push(`${fmt(r.exposed)} exposed residents here`);
    if (r.unreached != null) b.push(`cut off from care: ${fmt(r.unreached)}`);
    if (b.length) l.push(b.join(" · "));
  }
  return `<b>${esc(s.name)}</b><span>${esc(s.sub)}</span>${l.map((t) => `<span class="pn">${esc(t)}</span>`).join("")}`;
}
// One row per site. The row expands in place to show what the data says about the site; nothing is estimated here.
function siteDetail(s) {
  // Only what the row header does not already say (name, type and barangay are above).
  const r = s.row, d = [];
  if (s.reach != null) d.push([fmt(s.reach), "more exposed residents within reach"]);
  if (s.cutN != null) d.push([fmt(s.cutN), "cut-off residents reached"]);
  if (r && r.exposed != null) d.push([fmt(r.exposed), `exposed in ${esc(s.where || "this barangay")}`]);
  if (r && r.unreached != null) d.push([fmt(r.unreached), "cut off from care"]);
  return d.length ? `<dl>${d.map(([v, k]) => `<div><dd>${v}</dd><dt>${k}</dt></div>`).join("")}</dl>` : "";
}
function renderSites(total) {
  $("#sites").hidden = false; unbusy();
  const ol = $("#siteList");
  ol.innerHTML = S.sites.map((s, i) => {
    const n = s.rank ?? i + 1, id = esc(s.id), did = "sd-" + i;
    return `<li class="srow"><button type="button" class="site" data-id="${id}" aria-expanded="false" aria-controls="${did}" aria-label="Dose point ${n}: ${esc(s.name)}, ${esc(s.sub)}${s.reach != null ? ", brings " + fmt(s.reach) + " more exposed residents within reach" : ""}">
      <span class="badge-n" aria-hidden="true">${n}</span>
      <span class="site-t"><span class="site-name">${esc(s.name)}</span><span class="site-sub">${esc(s.sub)}</span></span>${CHEV}
    </button><div class="sdet" id="${did}"><div>${siteDetail(s)}</div></div></li>`;
  }).join("");
  const n = $("#siteNote");
  const missing = total - S.sites.length;
  n.hidden = missing <= 0;
  n.textContent = missing > 0 ? `Showing ${S.sites.length} of the ${total} dose points in this plan so far.` : "";
  paintList();
}
function toggleOpen(id) { S.open = S.open === id ? null : id; paintList(); }
function setHover(id) { S.hover = id; paintMarkers(); syncServe(); islRender(); }
const siteOf = (id) => S.sites.find((x) => x.id === id);
// The outline follows the hovered dose point, else the tapped one.
function syncServe() { showServe(siteOf(S.hover) || siteOf(S.active)); }
function setActive(id, o = {}) {
  S.active = id; if (o.scroll) S.open = id;
  paintMarkers(); syncServe(); islRender();
  const s = S.sites.find((x) => x.id === id);
  if (!s) return;
  if (o.scroll && !(mobile.matches && $("#col").classList.contains("closed"))) { const b = $(`#siteList button[data-id="${CSS.escape(id)}"]`); if (b) b.scrollIntoView({ block: "nearest" }); }
  if (o.pan && map) map.easeTo({ center: s.coords, padding: pad(), duration: dur(700) });
}
function paintMarkers() {
  S.sites.forEach((s) => { if (s.el) s.el.classList.toggle("on", s.id === S.active || s.id === S.hover); });
  paintList();
}
function paintList() {
  host.querySelectorAll("#siteList button.site").forEach((b) => {
    const open = b.dataset.id === S.open;
    b.classList.toggle("on", b.dataset.id === S.active || b.dataset.id === S.hover);
    b.setAttribute("aria-expanded", String(open));
    b.parentNode.classList.toggle("open", open);
    if (b.dataset.id === S.active) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
  });
}
function setPlan(k) {
  const prevPlan = S.plan, before = cutNow();
  S.plan = k; S.active = null; clearServe();
  const wasDyn = S.dynCut; S.dynCut = hasCut(k);
  if (S.metric.key === "unreached" && (wasDyn || S.dynCut)) { paintMetric(); pulseDrops(before); }
  const seg = $("#planSeg"), i = $(`#planSeg input[value="${k}"]`);
  if (i) { i.checked = true; seg.style.setProperty("--i", [...seg.querySelectorAll("input")].indexOf(i)); }
  drawDose(); syncUrl();
  islRender();
}
// cut-off residents per barangay under the current numbers, before a plan change
function cutNow() {
  const o = {};
  if (S.data) S.data.barangays.features.forEach((f) => { o[f.properties.adm4_pcode] = +f.properties[mprop(METRICS[1])] || 0; });
  return o;
}
// briefly pulse the barangays whose cut-off count dropped
function pulseDrops(before) {
  if (!map || !map.getLayer("b-pulse") || !S.dynCut || !S.ready) return;
  const dropped = S.data.barangays.features.filter((f) => (+f.properties[cutProp(S.plan)] || 0) < (before[f.properties.adm4_pcode] || 0)).map((f) => f.properties.adm4_pcode);
  if (!dropped.length) return;
  S.pulsed = dropped.length;
  map.setFilter("b-pulse", ["in", ["get", "adm4_pcode"], ["literal", dropped]]);
  map.setLayoutProperty("b-pulse", "visibility", "visible");
  clearTimeout(S.pulseT); cancelAnimationFrame(S.pulseF);
  if (reducedMotion()) { map.setPaintProperty("b-pulse", "fill-opacity", 0.35); S.pulseT = setTimeout(() => map.setLayoutProperty("b-pulse", "visibility", "none"), 900); return; }
  const t0 = performance.now(), D = 1400;
  const step = (t) => {
    if (S.dead || !map || !map.getLayer("b-pulse")) return;
    const k = (t - t0) / D;
    if (k >= 1) { map.setLayoutProperty("b-pulse", "visibility", "none"); return; }
    map.setPaintProperty("b-pulse", "fill-opacity", 0.6 * Math.abs(Math.sin(k * Math.PI * 2)) * (1 - k * 0.3));
    S.pulseF = requestAnimationFrame(step);
  };
  S.pulseF = requestAnimationFrame(step);
}
// outline the barangays a dose point serves in the current plan
function showServe(s) {
  if (!map || !map.getLayer("b-serve")) return;
  const codes = s && s.serves ? s.serves.map((x) => x.pcode) : [];
  const f = ["in", ["get", "adm4_pcode"], ["literal", codes]];
  map.setFilter("b-serve", f); map.setFilter("b-serve-c", f);
}
function clearServe() { showServe(null); }
function buildPlanSeg() {
  const seg = $("#planSeg"), av = availPlans();
  seg.style.setProperty("--n", av.length);
  seg.style.setProperty("--i", Math.max(0, av.indexOf(S.plan)));
  seg.innerHTML = `<span class="thumb" aria-hidden="true"></span>` + av.map((k) => `<label><input type="radio" name="plan" value="${k}"${k === S.plan ? " checked" : ""}><span>${k}<span class="sr-only"> dose points</span></span></label>`).join("");
}

/* ---------- headline strip, answer sentence, legend ---------- */
// Show the question while the map and numbers load, so the page is never blank.
function preStrip(params) {
  if (params.code === "all") return;
  const c = S.cities.find((x) => x.code === params.code) || S.cities[0];
  S.pre = c.code;
  $("#eyebrow").innerHTML = eyebrowHtml(c.name, false);
  setScn(c);
  $("#stripQ").textContent = "Where should the city hand out free leptospirosis medicine?";
  const a = $("#answer");
  a.setAttribute("aria-busy", "true");
  a.innerHTML = `<span class="sr-only">Loading the numbers.</span>${skel(3)}`;
  $("#colTop").hidden = false;
  // The ranked list shows placeholder rows until the dose sites arrive.
  $("#sites").hidden = false; $("#sites").setAttribute("aria-busy", "true"); busyParts(true);
  $("#siteList").innerHTML = `<li>${skel("list", { n: 3 })}</li>`;
}
function busyParts(on) { ["#planPick", "#planCov", "#siteNote"].forEach((s) => { const e = $(s); if (e && (on || s !== "#siteNote")) e.hidden = on; }); }
// Placeholders in the answer and the site list give way to real content.
function unbusy() {
  $("#sites").removeAttribute("aria-busy"); busyParts(false);
}
const SRC = () => `<p class="src">Modelled from the UP NOAH <span class="yr">${years()}</span>-year flood map, WorldPop and OpenStreetMap. Not checked on the ground.</p>`;
const nb = (t) => `<span class="nb">${t}</span>`;
// Two short lines: where, then the flood the numbers are for (with its definition one tap away).
const eyebrowHtml = (name, canChange) => `<span class="eb-l eb-city"><span class="cn">${esc(name)}</span>${canChange ? `<button class="eb-change" id="changeCity" type="button">Change</button>` : ""}</span><span class="eb-l eb-fl">After a ${nb(tipBtn("flood25", `${years()}-year flood`, `What is a ${years()}-year flood?`))}</span>`;
// One stat block: the number on its own line, a short label under it, an optional quiet sub-line.
const statBlock = (num, label, sub) => `<div class="st"><span class="st-n">${num}</span><span class="st-l">${label}</span>${sub ? `<span class="st-s">${sub}</span>` : ""}</div>`;
const WALK = nb(`${WALK_MIN}-minute walk`);
// A small "?" next to a term opens a one-line definition.
// The term itself is the button: dotted blue underline plus a small solid "?" glyph.
const tipBtn = (k, term, label) => `<button class="tip-q" type="button" data-tip="${k}" aria-label="${label}" aria-expanded="false" aria-controls="tipPop"><span class="tip-t">${term}</span><span class="tip-g" aria-hidden="true">?</span></button>`;
const TIPS = () => ({
  flood25: { t: `${years()}-year flood`, b: `A flood big enough that it has about a ${Math.round(100 / years())}% chance of happening in any year${years() === 100 ? ". It is larger than a 25-year flood" : ""} (UP NOAH hazard map).` },
  exposed: { t: "Exposed residents", b: `People who live where a ${years()}-year flood reaches.` },
  dose: { t: "Dose point", b: "A temporary spot, like a school or barangay hall, where a nurse hands out doxycycline for a few weeks after the flood." },
});
// A number that counts up once. The final value is already in the text, so reduced motion and screen readers get it at once.
const rollNum = (v, f) => `<b class="n" aria-hidden="true" data-to="${v}" data-f="${f}">${f === "p" ? v.toFixed(0) + "%" : fmt(v)}</b><span class="sr-only">${f === "p" ? v.toFixed(0) + "%" : fmt(v)}</span>`;
function roll(root) {
  if (reducedMotion()) return;
  root.querySelectorAll("[data-to]").forEach((e) => {
    const to = +e.dataset.to, p = e.dataset.f === "p", fin = e.textContent, t0 = performance.now();
    const step = (t) => {
      if (S.dead || !e.isConnected) return;
      const k = Math.min(1, (t - t0) / 600), v = to * (1 - (1 - k) ** 3);
      e.textContent = k >= 1 ? fin : p ? Math.round(v) + "%" : fmt(v);
      if (k < 1) requestAnimationFrame(step);
    };
    e.textContent = p ? "0%" : "0";
    requestAnimationFrame(step);
  });
}
function renderStrip() {
  $("#colTop").hidden = false;
  $("#answer").removeAttribute("aria-busy");
  const q = $("#stripQ"), eb = $("#eyebrow");
  if (!S.city) {
    eb.innerHTML = eyebrowHtml("Philippines", false);
    q.textContent = "Where does a flood put the most people at risk of leptospirosis?";
    setScn(null);
    const c25 = nat25(), k100 = nat100().length;
    const tot = c25.reduce((t, c) => t + (c.exposed || 0), 0);
    const more = k100 ? ` ${k100} more ${k100 === 1 ? "city is" : "cities are"} shown on the 100-year flood map. A 100-year flood is larger, so ${k100 === 1 ? "it is" : "they are"} not added in.` : "";
    $("#answer").innerHTML = `<div class="stats one">${statBlock(rollNum(tot, "n"), `${nb(tipBtn("exposed", "exposed residents", "What does exposed mean?"))} in ${c25.length} ${c25.length === 1 ? "city" : "cities"} with a ${nb(YEARS_DEFAULT + "-year")} flood map`)}</div><p class="a-main">Pick a city to see where to hand out free medicine first.${more}</p>`;
    roll($("#answer"));
    return;
  }
  eb.innerHTML = eyebrowHtml(cityName(), S.cities.length > 1);
  setScn(metaOf(S.city));
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
  a.removeAttribute("aria-busy");
  trackPlan(share);
  const exTip = nb(tipBtn("exposed", "exposed residents", "What does exposed mean?"));
  let html;
  if (exposed == null) html = `<p class="a-main">Flood exposure and dose point plans are not available for this city yet.</p>`;
  else if (share != null) {
    const dose = nb(tipBtn("dose", `${S.plan} dose points`, "What is a dose point?"));
    html = `<div class="stats">${statBlock(rollNum(exposed, "n"), `${exTip} live where a ${years()}-year flood reaches`)}${statBlock(rollNum(share * 100, "p"), `of them within a ${nb(WALK_MIN + "-minute")} walk of free medicine with ${dose}`)}</div><p class="a-do">Open these dose points first, listed below.</p>`;
  } else {
    html = `<div class="stats one">${statBlock(rollNum(exposed, "n"), `${exTip} live where a ${years()}-year flood reaches`)}</div><p class="a-main">Dose point plans are not computed for this city yet, so the map shows where the water reached.</p>`;
  }
  const next = html.trim();
  if (a.innerHTML !== next) {
    hideTip(); a.innerHTML = next;
    const key = `${S.city}|${S.plan}`;
    if (S.rollKey !== key) { S.rollKey = key; roll(a); }
  }
  const pc = $("#planCov");
  if (pc) {
    pc.innerHTML = share != null
      ? `<b>${pct(share, 0)}</b> of exposed residents within a ${WALK}${now != null ? `, up from ${pct(now, 0)}` : ""}.`
      : "Coverage is not computed for this plan yet.";
  }
  islRender();
}
// A plan change shows how many points of coverage it added or took away, for three seconds.
function trackPlan(share) {
  const prev = I.cur;
  I.cur = { city: S.city, plan: S.plan, share };
  if (!(S.ready && prev && prev.city === S.city && prev.plan !== S.plan && prev.share != null && share != null)) return;
  const d = Math.round(share * 100) - Math.round(prev.share * 100);
  clearTimeout(I.chipT);
  if (!d) { I.chip = null; return; }
  I.chip = `${d > 0 ? "+" : "\u2212"}${Math.abs(d)} points`;
  I.chipT = setTimeout(() => { I.chip = null; islRender(); }, 3000);
}

function renderLegend() {
  const lg = $("#legend");
  if (!S.city) {
    const has100 = nat100().length > 0;
    lg.innerHTML = `<div class="metric-name">Circle size: exposed residents</div><p class="map-note" style="margin:0">A bigger circle means more exposed residents: people who live where a ${YEARS_DEFAULT}-year flood reaches. Pick a city to open its map.</p>${has100 ? `<div class="lg-dash"><i class="dsh" aria-hidden="true"></i><span>100-year cities drawn with a dashed outline. A 100-year flood is larger, so do not compare these circles with the others.</span></div>` : ""}${SRC()}`;
    return;
  }
  const m = S.metric, edges = [S.hasZero ? S.minPos : S.min, ...S.breaks, S.max], n = Math.max(1, S.breaks.length + 1);
  const label = (v) => (m.key === "share" ? pct(v, 0) : fmt(sig2(v)));
  const labs = edges.map(label);
  const dyn = m.key === "unreached" && S.dynCut;
  const title = dyn ? `${m.legend}, after opening ${S.plan} dose points` : m.legend;
  const darker = m.key === "share" ? "Darker blue: more of the barangay is flooded" : m.key === "unreached" ? "Darker blue: more residents cut off from care" : "Darker blue: more residents in the floodwater";
  // Drop the second-to-last label when it would run into the last one.
  const ticks = labs.map((t, i) => (i === labs.length - 2 && labs.length > 3 && t.length + labs[i + 1].length > 9 ? "" : `<span style="left:${(i / n) * 100}%">${t}</span>`)).join("");
  const zero = S.hasZero ? `<div class="lg-zero"><i class="zsw${S.view === "3d" ? " flat" : ""}" aria-hidden="true"></i><span><b>0</b> ${m.key === "share" ? "none flooded" : "none"}</span></div>` : "";
  lg.innerHTML = `<div class="metric-name" id="lgT">${title}</div>
    ${zero}<div class="ramp" aria-hidden="true">${RAMP.slice(0, n).map((c) => `<i style="background:${c}"></i>`).join("")}</div>
    <div class="ticks" aria-hidden="true">${ticks}</div>
    <div class="lg-words" aria-hidden="true"><span>${m.lo}</span><span>${m.hi}</span></div>
    <p class="sr-only">${title}, from ${m.f(S.hasZero ? S.minPos : S.min)} to ${m.f(S.max)} ${m.unit}. Darker means more.${S.hasZero ? " Barangays with 0 are hatched." : ""}</p>
    <div class="howto" role="group" aria-label="How to read this map">
      <h3 class="howto-h">How to read this map</h3>
      <ul>
        <li><i class="hw-sw" aria-hidden="true"></i><span>${darker}</span></li>
        <li><i class="dot-gold" aria-hidden="true">1</i><span>Gold number: a dose point (1 opens first)</span></li>
        <li><i class="hw-seg" aria-hidden="true"><b>3</b><b>5</b><b>8</b></i><span>Pick 3, 5 or 8 to see how many dose points to open</span></li>
      </ul>${S.view === "3d" ? '<p class="map-note">Column height follows the colour.</p>' : ""}
    </div>${SRC()}`;
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
    metric: "exposed", plan: null, hi: null, spot: "#colTop", pref: ["right", "bottom", "top"],
    body: `This page shows where ${esc(name)} should hand out free leptospirosis medicine after a flood, and how many people each choice helps.`,
  });
  const topE = topRow("exposed");
  steps.push({
    title: "Who was in the water",
    metric: "exposed", plan: null, hi: topE, val: fmt(topE.exposed), spot: null, pref: ["right", "left", "top", "bottom"],
    body: `Darker barangays have more exposed residents: people who live where a ${years()}-year flood reaches. ${esc(topE.name)} has the most: ${fmt(topE.exposed)} of ${fmt(topE.pop)} residents.`,
  });
  const p3 = sum.dose_point_plans && sum.dose_point_plans["3"];
  const share = S.data.coverage && S.data.coverage.plans && S.data.coverage.plans["3"];
  const has3 = availPlans().includes("3");
  const n = has3 ? 3 : Math.min(3, S.data.dosePoints.features.length) || 3;
  steps.push({
    title: "Where to open first",
    metric: "exposed", plan: has3 ? "3" : null, top: n, hi: null, spot: "#sites", pref: ["right", "top"],
    body: `The panel lists the dose points in the order to open them. The gold numbers 1 to ${n} on the map match it. ${p3 && share != null ? `Opening these ${n} brings ${pct(share, 0)} of exposed residents within a ${WALK_MIN}-minute walk of free medicine. ` : ""}Tap a dose point to see more and find it on the map.`,
  });
  steps.push({
    title: "More options",
    metric: "exposed", plan: null, hi: null, spot: "#optBtn", pref: ["bottom", "left"],
    body: "Colour the map by another measure, turn on 3D or terrain, or jump to a barangay. Everything else on this page keeps working while you explore.",
    last: true,
  });
  return steps;
}
function tourSeen() { try { return localStorage.getItem(SEEN_KEY) === "1"; } catch { return false; } }
function markSeen() { try { localStorage.setItem(SEEN_KEY, "1"); } catch {} }
// The tour opens by itself once, on the very first visit. After that it is the chip in the strip.
function maybeTour() {
  if (tourSeen() || !S.city || S.dead) return;
  if (!S.ready) { S.tourPending = true; return; }
  startTour(false);
}

function startTour(user) {
  if (!S.city || !S.data) return;
  endTour(false, true);
  closeOpts();
  if (S.colHidden) setCollapsed(false);
  S.tour = { i: 0, steps: tourSteps(), restore: { metric: S.metric, plan: S.plan }, tag: null, user, from: user ? document.activeElement : null, timer: 0, tick: 0 };
  const side = $(".mapside");
  // The cut-out: a box over the described element whose huge shadow dims everything else.
  const hole = document.createElement("div");
  hole.className = "tour-hole off"; hole.id = "tourHole"; hole.setAttribute("aria-hidden", "true");
  const card = document.createElement("div");
  card.className = "tour"; card.id = "tour";
  card.setAttribute("role", "dialog"); card.setAttribute("aria-labelledby", "tourT");
  side.appendChild(hole); side.appendChild(card);
  onKey = (e) => {
    const t = S.tour; if (!t) return;
    if (e.key === "Escape") { e.preventDefault(); endTour(true); return; }
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.target && e.target.closest && e.target.closest("input,select,textarea")) return;
    if (e.key === "ArrowRight" && t.i < t.steps.length - 1) { e.preventDefault(); tourStep(t.i + 1); }
    else if (e.key === "ArrowLeft" && t.i > 0) { e.preventDefault(); tourStep(t.i - 1); }
  };
  onTourResize = () => tourPlace();
  onColScroll = () => tourPlace(true);
  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", onTourResize);
  $("#col").addEventListener("scroll", onColScroll, { passive: true });
  $("#colMore").addEventListener("scroll", onColScroll, { passive: true });
  tourStep(0);
}
// Rect of what the current step describes, in .mapside coordinates.
function tourAnchor(st, m) {
  const t = S.tour;
  if (st.spot) {
    const el = $(st.spot);
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.width) return { x: r.left - m.left, y: r.top - m.top, w: r.width, h: r.height, rad: parseFloat(getComputedStyle(el).borderTopLeftRadius) || 12, spot: true };
    }
  }
  if (t.tag) {
    const e = t.tag.getElement(), p = map.project(t.tag.getLngLat()), w = e.offsetWidth || 90, h = e.offsetHeight || 40;
    return { x: p.x - w / 2, y: p.y - h - 4, w, h, rad: 8, spot: false };
  }
  return null;
}
// Put the card next to what it describes, with an arrow pointing at it; cut the dimmed scrim out around the element.
function tourPlace(track) {
  const t = S && S.tour; if (!t || !map) return;
  const card = $("#tour"), hole = $("#tourHole"), ms = $(".mapside");
  if (!card || !hole || !ms) return;
  const st = t.steps[t.i], m = ms.getBoundingClientRect(), a = tourAnchor(st, m);
  const ready = card.classList.contains("ready");
  card.classList.toggle("track", !!track); hole.classList.toggle("track", !!track);
  const W = card.offsetWidth, H = card.offsetHeight, G = 14, E = 8;
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  let side = "none", left = (m.width - W) / 2, top = 56, ax = 0, ay = 0;
  if (a) {
    const fits = {
      right: a.x + a.w + G + W <= m.width - E, left: a.x - G - W >= E,
      bottom: a.y + a.h + G + H <= m.height - E, top: a.y - G - H >= E,
    };
    const pick = [...(st.pref || []), "right", "left", "bottom", "top"].find((s) => fits[s]);
    const cx = a.x + a.w / 2, cy = a.h > 160 ? a.y + 40 : a.y + a.h / 2;
    if (pick === "right" || pick === "left") {
      side = pick; left = pick === "right" ? a.x + a.w + G : a.x - G - W;
      top = clamp(cy - 36, 68, m.height - H - E); ay = clamp(cy - top, 22, H - 22);
    } else if (pick) {
      side = pick; top = pick === "bottom" ? a.y + a.h + G : a.y - G - H;
      left = clamp(cx - W / 2, E, m.width - W - E); ax = clamp(cx - left, 22, W - 22);
    } else {
      top = a.y > m.height / 2 ? 56 : m.height - H - 16;
    }
    hole.style.left = a.x - 6 + "px"; hole.style.top = a.y - 6 + "px";
    hole.style.width = a.w + 12 + "px"; hole.style.height = a.h + 12 + "px"; hole.style.borderRadius = a.rad + 6 + "px";
  }
  hole.classList.toggle("off", !(a && a.spot));
  card.dataset.side = side;
  card.style.setProperty("--ax", ax + "px"); card.style.setProperty("--ay", ay + "px");
  card.style.left = left + "px"; card.style.top = top + "px";
  if (!ready) { void card.offsetWidth; card.classList.add("ready"); hole.classList.add("ready"); }
  if (track) {
    clearTimeout(t.tick);
    t.tick = setTimeout(() => { card.classList.remove("track"); hole.classList.remove("track"); }, 140);
  }
}
function tourStep(i) {
  const t = S.tour; if (!t) return;
  t.i = i;
  const st = t.steps[i], n = t.steps.length;
  const k = METRICS.find((m) => m.key === st.metric);
  if (S.metric !== k) setMetric(k);
  if (st.plan && S.plan !== st.plan) setPlan(st.plan);
  if (!$("#lyDose").checked) { $("#lyDose").checked = true; drawDose(); }
  if (mobile.matches) openSheet(st.spot === "#sites");
  S.markers.forEach((m) => { const e = m.getElement(), r = +e.textContent; e.classList.toggle("hl", !!st.top && r <= st.top); e.classList.toggle("dim", !!st.top && !(r <= st.top)); });
  if (st.spot) { const e = $(st.spot); if (e && e.closest("#col")) e.scrollIntoView({ block: "nearest", behavior: "auto" }); }
  tourClearHi();
  if (st.hi) {
    const f = S.data.barangays.features.find((x) => x.properties.adm4_pcode === st.hi.id);
    const flt = ["==", ["get", "adm4_pcode"], st.hi.id];
    map.setFilter("b-tour-c", flt); map.setFilter("b-tour", flt);
    const el = document.createElement("div");
    el.className = "tour-tag"; el.innerHTML = `<b>${esc(st.hi.name)}</b><span>${st.val} exposed residents</span>`;
    t.tag = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat(boundsOf(f).getCenter()).addTo(map);
  }
  const dots = t.steps.map((_, j) => `<i${j === i ? ' class="on"' : ""}></i>`).join("");
  const card = $("#tour");
  card.innerHTML = `<i class="tour-arrow" aria-hidden="true"></i>
    <div class="tour-top"><span class="tour-step">Step ${i + 1} of ${n}</span><button class="linkbtn" type="button" data-a="skip">Skip tour</button></div>
    <div class="tour-body"><h2 id="tourT" tabindex="-1">${st.title}</h2>
    <p id="tourB">${st.body}</p>${st.last ? `<p class="tour-dash"><a href="${cityHref(S.city)}" data-a="dash">Open the city dashboard</a></p>` : ""}</div>
    <div class="tour-foot"><span class="dots" aria-hidden="true">${dots}</span>
    <span class="tour-btns">${i > 0 ? '<button class="linkbtn" type="button" data-a="back">Back</button>' : ""}<button class="tbtn" type="button" data-a="${st.last ? "done" : "next"}">${st.last ? "Explore the map" : "Next"}</button></span></div>`;
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
  tourPlace();
  // The sheet and the map settle after a moment; measure again.
  clearTimeout(t.timer); t.timer = setTimeout(() => tourPlace(), 380);
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
  clearTimeout(t.timer); clearTimeout(t.tick);
  tourClearHi(t);
  document.removeEventListener("keydown", onKey);
  window.removeEventListener("resize", onTourResize);
  if (host) {
    const c = host.querySelector("#col"), cm = host.querySelector("#colMore");
    if (c) c.removeEventListener("scroll", onColScroll);
    if (cm) cm.removeEventListener("scroll", onColScroll);
    ["#tour", "#tourHole"].forEach((s) => { const e = host.querySelector(s); if (e) e.remove(); });
  }
  if (quiet) return;
  markSeen();
  S.markers.forEach((m) => m.getElement().classList.remove("hl", "dim"));
  if (!keepView) {
    if (S.metric !== t.restore.metric) setMetric(t.restore.metric);
    if (S.plan !== t.restore.plan) setPlan(t.restore.plan);
  }
  if (refocus) { const b = $("#tourBtn"); if (b && !b.hidden) b.focus({ preventScroll: true }); }
}

/* ---------- status island ---------- */
// A navy pill at the top of the free map area. One line while loading and for the answer, two lines for a barangay.
// It is aria-hidden (rolling numbers and hover text are not for screen readers); #islLive carries the state changes.
const STAGE_N = 4;
function stage(n, text) { I.stage = { n, text }; islRender(); }
const loadHtml = (st) => `<svg class="isl-ring" viewBox="0 0 24 24" width="22" height="22"><circle class="trk" cx="12" cy="12" r="9"/><circle class="arc" cx="12" cy="12" r="9" pathLength="100" style="stroke-dashoffset:${100 - (st.n / STAGE_N) * 100}"/></svg><span class="isl-t"><b>Step ${st.n} of ${STAGE_N}</b><span class="isl-sep"> · </span><span class="isl-lt">${esc(st.text)}</span></span>`;
const cutAfter = (code) => { const f = S.data.barangays.features.find((x) => x.properties.adm4_pcode === code); return f ? +f.properties[cutProp(S.plan)] || 0 : null; };
function brgyHtml(r) {
  const ex = r.exposed != null ? `${fmt(r.exposed)} exposed residents` : null;
  const cut = r.unreached != null ? (S.dynCut ? `cut off from care after ${S.plan} dose points: ${fmt(cutAfter(r.id))}` : `cut off from care: ${fmt(r.unreached)}`) : null;
  const ar = r.share != null ? `${pct(r.share, 0)} of the area flooded` : null;
  const k = S.metric.key;
  const line = (k === "unreached" ? [cut, ex] : k === "share" ? [ar, ex, cut] : [ex, cut]).filter(Boolean).join(" · ");
  return `<span class="isl-2"><b>${esc(r.name)}</b>${line ? `<span>${line}</span>` : ""}</span>`;
}
function doseWant() {
  if (!S.ready || !S.city) return null;
  const s = siteOf(S.hover) || (!I.hover ? siteOf(S.active) : null);
  const line = s && reachLine(s);
  if (!s || !line) return null;
  return { kind: "dose", key: `d|${s.id}|${S.plan}`, html: `<span class="isl-2"><b>Dose point ${s.rank ?? ""}: ${esc(s.name)}</b><span>${esc(line)}</span></span>`, live: "" };
}
function islWant() {
  if (!S || !host) return null;
  const dw = doseWant();
  if (dw) return dw;
  const code = I.hover || S.sel;
  if (S.ready && S.city && S.data && code) {
    const r = S.data.rows.find((x) => x.id === code);
    if (r) return { kind: "brgy", key: `b|${code}|${S.metric.key}|${S.plan}`, html: brgyHtml(r) };
  }
  if (!S.ready) { const st = I.stage || { n: 1, text: "Getting the basemap" }; return { kind: "load", key: "load", st, html: loadHtml(st), live: "Loading the map." }; }
  if (!S.city || !S.data) {
    const c25 = nat25(), tot = c25.reduce((t, c) => t + (c.exposed || 0), 0), n = c25.length;
    const tail = `in ${n} ${n === 1 ? "city" : "cities"} with a 25-year flood map`;
    return { kind: "nat", key: "n|" + tot + "|" + n, html: `<span class="isl-t"><b class="n">${fmt(tot)}</b> exposed residents ${tail}</span>`, live: `${fmt(tot)} exposed residents ${tail}.` };
  }
  const sum = S.data.summary || {}, meta = S.data.meta || {}, cov = S.data.coverage || {};
  const exposed = sum.exposed != null ? sum.exposed : meta.exposed;
  const plan = sum.dose_point_plans && sum.dose_point_plans[S.plan];
  let share = cov.plans && cov.plans[S.plan] != null ? cov.plans[S.plan] : null;
  if (share == null && plan && plan.share_of_exposed_within_reach_after != null) { const v = +plan.share_of_exposed_within_reach_after; share = v > 1 ? v / 100 : v; }
  if (share != null) {
    const p = Math.round(share * 100), chip = I.chip;
    return { kind: "answer", key: `a|${S.city}|${S.plan}|${chip || ""}`, roll: `${S.city}|${S.plan}`,
      html: `<span class="isl-badge">${S.plan}</span><span class="isl-t"><b class="n" data-to="${share * 100}" data-f="p">${p}%</b> <span class="isl-xtra">of exposed residents </span>within a ${WALK_MIN}-minute walk</span>${chip ? `<span class="isl-chip">${chip}</span>` : ""}`,
      live: `Plan of ${S.plan} dose points. ${p}% of exposed residents within a ${WALK_MIN}-minute walk.` };
  }
  if (exposed != null) { const t = `${fmt(exposed)} exposed residents in ${cityName()}`; return { kind: "answer", key: "e|" + S.city, html: `<span class="isl-t"><b class="n">${fmt(exposed)}</b> exposed residents in ${esc(cityName())}</span>`, live: t + "." }; }
  return { kind: "answer", key: "x|" + S.city, html: `<span class="isl-t">No flood data for ${esc(cityName())} yet</span>`, live: "No flood data for this city yet." };
}
function islFit(pill, c) {
  const wrap = $("#island");
  if (!wrap || wrap.hidden || !pill || !c) return;
  // Centre on the whole map when the pill clears the cards; otherwise centre in the free area beside them.
  const side = wrap.parentNode, colR = S.colHidden || mobile.matches ? 0 : ($("#col").getBoundingClientRect().right - side.getBoundingClientRect().left);
  wrap.classList.remove("full");
  const want = Math.ceil(c.scrollWidth);
  if ((side.clientWidth - want) / 2 >= colR + 16) wrap.classList.add("full");
  const cs = getComputedStyle(wrap);
  const avail = Math.max(140, wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
  pill.style.setProperty("--avail", avail + "px");
  const w = Math.ceil(c.offsetWidth), h = Math.ceil(c.offsetHeight);
  pill.style.width = w + "px"; pill.style.height = h + "px"; pill.style.borderRadius = Math.min(h / 2, 28) + "px";
}
function islRefit() { const p = host && $("#isl"); if (p) islFit(p, p.querySelector(".isl-c:not(.out)")); }
// Old content blurs and scales out while the pill springs to the new size; new content fades in.
function islPut(html, key) {
  const wrap = $("#island"), pill = $("#isl");
  if (!wrap || I.key === key) return null;
  I.key = key;
  const first = wrap.hidden;
  wrap.hidden = false;
  const old = pill.querySelector(".isl-c:not(.out)");
  const c = document.createElement("div");
  c.className = "isl-c in"; c.innerHTML = html;
  pill.appendChild(c);
  if (first) pill.style.transition = "none";
  islFit(pill, c);
  // fonts arriving late change the natural width; follow it
  if (I.ro) I.ro.disconnect();
  I.ro = new ResizeObserver(() => islFit(pill, c));
  I.ro.observe(c);
  if (first) { void pill.offsetWidth; pill.style.transition = ""; }
  if (old) {
    if (reducedMotion()) old.remove();
    else { old.classList.add("out"); setTimeout(() => old.remove(), 260); }
  }
  return c;
}
function islRender() {
  if (!host || !S || S.dead || !$("#island")) return;
  const w = islWant();
  if (!w) return;
  const pill = $("#isl");
  if (w.kind === "load" && I.kind === "load") {
    // same state, next step: move the ring and swap the words in place
    const c = pill.querySelector(".isl-c:not(.out)");
    if (c) {
      const arc = c.querySelector(".arc"), t = c.querySelector(".isl-lt"), b = c.querySelector("b");
      if (arc) arc.style.strokeDashoffset = 100 - (w.st.n / STAGE_N) * 100;
      if (t) t.textContent = w.st.text;
      if (b) b.textContent = `Step ${w.st.n} of ${STAGE_N}`;
      islFit(pill, c);
      return;
    }
  }
  const c = islPut(w.html, w.key);
  I.kind = w.kind;
  if (c && w.roll && I.rolled !== w.roll) { I.rolled = w.roll; roll(c); }
  if (w.kind !== "brgy" && w.live && w.live !== I.live) { I.live = w.live; const l = $("#islLive"); if (l) l.textContent = w.live; }
}

/* ---------- dose point list: folds under its heading so the legend card stays in view ---------- */
function sitesOpen(on) {
  // Fold animates the row height, then the inner list is hidden so it stops adding scroll height to the column.
  const inner = $("#sitesBody").firstElementChild;
  clearTimeout(S.foldT);
  if (on) { inner.hidden = false; requestAnimationFrame(() => $("#sites").classList.remove("shut")); }
  else { $("#sites").classList.add("shut"); S.foldT = setTimeout(() => { inner.hidden = true; const c = host && $("#col"); if (c) c.dispatchEvent(new Event("scroll")); }, reducedMotion() ? 0 : 320); }
  const t = $("#sitesTog");
  t.setAttribute("aria-expanded", String(on));
  t.setAttribute("aria-label", on ? "Hide the dose point list" : "Show the dose point list");
  $("#sitesBody").inert = !on;
}
// On first show, fold the list if the card stack would otherwise need scrolling.
function sitesAutoFit() {
  const c = $("#col");
  if (!c || mobile.matches || S.sitesFitted) return;
  S.sitesFitted = true;
  if (c.scrollHeight > c.clientHeight + 4) sitesOpen(false);
}

/* ---------- collapsible panel ---------- */
function setCollapsed(on, focus) {
  S.colHidden = on;
  $("#mapwrap").classList.toggle("col-off", on);
  $("#col").inert = on;
  $("#colCollapse").setAttribute("aria-expanded", String(!on));
  $("#showPanel").hidden = !on;
  if (focus) (on ? $("#showPanel") : $("#colCollapse")).focus({ preventScroll: true });
  // the map stays where it is: panels slide over it, the camera does not follow
  if (S.sel && S.data) { const f = S.data.barangays.features.find((x) => x.properties.adm4_pcode === S.sel); if (f) setTimeout(() => placeInfo(f), dur(520)); }
}

/* ---------- share and download ---------- */
async function copyLink() {
  const b = $("#copyLink");
  let ok = false;
  try { await navigator.clipboard.writeText(location.href); ok = true; }
  catch {
    try { const t = document.createElement("textarea"); t.value = location.href; t.style.cssText = "position:fixed;opacity:0"; document.body.appendChild(t); t.select(); ok = document.execCommand("copy"); t.remove(); } catch {}
  }
  if (!b) return;
  b.textContent = ok ? "Link copied" : "Could not copy";
  $("#actLive").textContent = ok ? "Link copied to the clipboard." : "Could not copy the link.";
  clearTimeout(S.copyT); S.copyT = setTimeout(() => { b.textContent = "Copy link"; }, 2200);
}
// Text cells starting with = + - @ would run as formulas in a spreadsheet; a leading apostrophe stops that.
const csvCell = (v, text) => { let t = v == null ? "" : String(v); if (text && /^[=+\-@\t\r]/.test(t)) t = "'" + t; return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
function downloadPlan() {
  if (!S.data || !S.sites.length) return;
  const head = ["Name", "Type", "Barangay", "Order", "Longitude", "Latitude", "Exposed covered"];
  const rows = S.sites.map((s, i) => [csvCell(s.name, true), csvCell(s.kind, true), csvCell(s.where || "", true), s.rank ?? i + 1, (+s.coords[0]).toFixed(6), (+s.coords[1]).toFixed(6), s.reach == null ? "" : Math.round(s.reach)]);
  const csv = "\uFEFF" + [head.join(","), ...rows.map((r) => r.join(","))].join("\r\n") + "\r\n";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `lambat-${cityName().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "city"}-plan-${S.plan}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  $("#actLive").textContent = `Downloaded the plan of ${S.plan} dose points.`;
}

/* ---------- widgets ---------- */
// More options is a side panel over the right edge of the map. It does not block or blur the map, so changes show live; Esc or the close button shut it.
function openOpts(open) {
  const o = $("#opts"), b = $("#optBtn"), sc = $("#optScrim");
  if (!o || open === o.classList.contains("open")) return;
  o.classList.toggle("open", open); sc.classList.remove("on"); o.inert = !open; $("#mapwrap").classList.toggle("opts-on", open); setTimeout(islRefit, 380);
  b.setAttribute("aria-expanded", String(open));
  b.classList.toggle("on", open);
  if (open) { document.addEventListener("keydown", onOptKey); $("#optClose").focus({ preventScroll: true }); }
  else document.removeEventListener("keydown", onOptKey);
}
// refocus: give focus back to the More options button (user closed it)
function closeOpts(refocus) {
  if (!host || !$("#opts")) return;
  const was = $("#opts").classList.contains("open");
  openOpts(false);
  if (refocus && was) { const b = $("#optBtn"); if (!b.hidden) b.focus({ preventScroll: true }); }
}
function trapOpts(e) {
  const o = $("#opts");
  if (e.key === "Escape" && !S.tour) { e.preventDefault(); closeOpts(o.contains(document.activeElement)); }
}
// The "more below" badge goes on whatever scrolls: the whole column on desktop, the sheet body on phones.
function attachMore() {
  moreOff.forEach((x) => x()); moreOff = [];
  const box = mobile.matches ? $("#colMore") : $("#col");
  if (box) moreOff.push(moreBelow(box));
}
// Phone sheet: two snap heights. closed = peek (question and answer), open = everything.
function openSheet(open) {
  const col = $("#col"), h = $("#handle");
  col.classList.toggle("closed", !open);
  h.setAttribute("aria-expanded", String(open));
  $("#handleT").textContent = open ? "Hide the plan" : "Show the plan";
  $("#colMore").inert = mobile.matches && !open;
}
// After the sheet changes height, fit the city (or the selected barangay) into the map that is left above it.
function refit(ms) {
  if (!map || !S || !S.city || !S.data || S.tour) return;
  clearTimeout(S.refitT);
  S.refitT = setTimeout(() => {
    if (!map || !S.data || !mobile.matches || S.tour) return;
    const f = S.sel && S.data.barangays.features.find((x) => x.properties.adm4_pcode === S.sel);
    map.fitBounds(f ? boundsOf(f) : S.data.bbox, { padding: pad(), maxZoom: f ? 15 : 14.5, pitch: map.getPitch(), bearing: map.getBearing(), duration: dur(450) });
    if (f) placeInfo(f);
  }, ms == null ? 340 : ms);
}
function setPeek() {
  const t = $("#colTop");
  if (!t || !mobile.matches) return;
  const was = S.peek;
  S.peek = t.offsetTop + t.offsetHeight;
  $("#mapwrap").style.setProperty("--peek", S.peek + "px");
}
function syncSheet() {
  // On phones the plan picker joins the question and answer, so it shows in the peek state.
  const pp = $("#planPick"), ph = $(".plan-h");
  if (mobile.matches) { if (pp.parentNode !== $("#colTop")) $("#colTop").insertBefore(pp, $(".col-foot")); }
  else if (pp.parentNode !== ph) ph.appendChild(pp);
  setPeek(); attachMore();
  if (!mobile.matches) { $("#colMore").inert = false; $("#col").style.transform = ""; }
  else openSheet(!$("#col").classList.contains("closed"));
  if (map) map.resize();
}
function wireSheet() {
  const col = $("#col"), h = $("#handle");
  mobile.addEventListener("change", syncSheet);
  syncSheet();
  let y0 = 0, off0 = 0, moved = false, vy = 0, ly = 0, lt = 0, on = false;
  const maxOff = () => Math.max(0, col.offsetHeight - S.peek);
  h.addEventListener("click", () => { if (S.suppress) return; openSheet(col.classList.contains("closed")); });
  h.addEventListener("pointerdown", (e) => {
    if (!mobile.matches || e.button > 0) return;
    on = true; moved = false; vy = 0; y0 = ly = e.clientY; lt = e.timeStamp;
    off0 = col.classList.contains("closed") ? maxOff() : 0;
    h.setPointerCapture(e.pointerId);
  });
  h.addEventListener("pointermove", (e) => {
    if (!on) return;
    const dy = e.clientY - y0;
    if (Math.abs(dy) > 6) { moved = true; col.classList.add("drag"); }
    if (!moved) return;
    const dt = e.timeStamp - lt; if (dt > 0) vy = (e.clientY - ly) / dt;
    ly = e.clientY; lt = e.timeStamp;
    col.style.transform = `translateY(${Math.min(maxOff(), Math.max(0, off0 + dy))}px)`;
  });
  const end = (e) => {
    if (!on) return;
    on = false;
    if (!moved) return;
    const off = Math.min(maxOff(), Math.max(0, off0 + e.clientY - y0));
    col.classList.remove("drag"); col.style.transform = "";
    openSheet(Math.abs(vy) > 0.4 ? vy < 0 : off < maxOff() / 2);
    S.suppress = true; setTimeout(() => { S.suppress = false; }, 0);
  };
  h.addEventListener("pointerup", end);
  h.addEventListener("pointercancel", end);
}

/* ---------- "?" definitions: native popover with a positioned fallback ---------- */
function hideTip() {
  if (!tipEl) return;
  if (POP) { try { if (tipEl.matches(":popover-open")) tipEl.hidePopover(); } catch {} } else tipEl.hidden = true;
  if (S && S.tipBtn) { S.tipBtn.setAttribute("aria-expanded", "false"); S.tipBtn.removeAttribute("aria-describedby"); S.tipBtn = null; }
}
// The definition never sits on the sentence it explains. On desktop it opens beside the card, on the free map,
// level with the term. On phones, or when there is no room beside, it opens just below the paragraph (or above it).
function showTip(btn) {
  if (S.tipBtn === btn) { hideTip(); return; }
  hideTip();
  const tp = TIPS()[btn.dataset.tip] || { t: "", b: "" };
  tipEl.innerHTML = `<b class="tip-h">${esc(tp.t)}</b><span class="tip-b">${esc(tp.b)}</span><svg class="tip-arrow" width="16" height="9" viewBox="0 0 16 9" aria-hidden="true"><path class="tf" d="M0 9 8 1 16 9Z"/><path class="ts" d="M0 8.5 8 .5 16 8.5"/></svg>`;
  if (POP) tipEl.showPopover(); else tipEl.hidden = false;
  const r = btn.getBoundingClientRect(), w = tipEl.offsetWidth, h = tipEl.offsetHeight, vw = window.innerWidth, vh = window.innerHeight, G = 12, E = 8;
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  const card = btn.closest(".col-top, .sec");
  const cr = card ? card.getBoundingClientRect() : null;
  let side, left, top;
  if (!mobile.matches && cr && cr.right + G + w <= vw - E) {
    side = "right"; left = cr.right + G;
    top = clamp(r.top + r.height / 2 - 26, E, vh - h - E);
    tipEl.style.setProperty("--ay", clamp(r.top + r.height / 2 - top, 16, h - 16) + "px");
  } else {
    const blk = (btn.closest("p, h1, .eyebrow") || btn).getBoundingClientRect();
    const below = blk.bottom + G + h <= vh - E;
    side = below ? "bottom" : "top";
    top = below ? blk.bottom + G : Math.max(E, blk.top - h - G);
    left = clamp(r.left + r.width / 2 - w / 2, E, vw - w - E);
    tipEl.style.setProperty("--ax", clamp(r.left + r.width / 2 - left, 16, w - 16) + "px");
  }
  tipEl.style.left = left + "px"; tipEl.style.top = top + "px";
  tipEl.dataset.side = side;
  S.tipBtn = btn; btn.setAttribute("aria-expanded", "true"); btn.setAttribute("aria-describedby", "tipPop");
}
function wireTips() {
  host.addEventListener("click", (e) => { const b = e.target.closest && e.target.closest(".tip-q"); if (b) showTip(b); });
  onDown = (e) => { if (S.tipBtn && !(e.target.closest && (e.target.closest(".tip-q") || e.target.closest("#tipPop")))) hideTip(); };
  onTipKey = (e) => { if (e.key === "Escape" && S.tipBtn) { const b = S.tipBtn; hideTip(); b.focus(); } };
  document.addEventListener("pointerdown", onDown);
  document.addEventListener("keydown", onTipKey);
  onTipResize = () => hideTip();
  window.addEventListener("resize", onTipResize);
  $("#col").addEventListener("scroll", onTipResize, { passive: true });
}

function wire() {
  const list = $("#cityList");
  const draw = (q = "") => {
    const t = q.trim().toLowerCase();
    const rows = S.cities.filter((c) => !t || `${c.name} ${c.province} ${c.region}`.toLowerCase().includes(t));
    const item = (c) => { const h = scenarioOf(c).is100; return `<li><button type="button" data-c="${esc(c.code)}"><span class="n">${esc(c.name)}<span class="p">${esc(c.province || "")}${c.region ? ", " + esc(c.region) : ""}</span>${h ? '<span class="tag100">100-year map</span>' : ""}</span><span class="v" aria-label="${fmt(c.exposed)} residents exposed${h ? " to a 100-year flood" : ""}">${fmt(c.exposed)}</span></button></li>`; };
    const a = rows.filter((c) => !scenarioOf(c).is100), b = rows.filter((c) => scenarioOf(c).is100);
    list.innerHTML = rows.length ? a.map(item).join("") + (b.length ? `<li class="grp" role="presentation">100-year flood map. A larger flood, so not comparable with the cities above.</li>` + b.map(item).join("") : "") : '<li class="muted sm" style="padding:8px">No city matches.</li>';
  };
  draw();
  $("#cityPick").addEventListener("input", (e) => draw(e.target.value));
  list.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) selectCity(b.dataset.c); });
  $("#pickBack").addEventListener("click", () => showNational(false));
  $("#brgyPick").addEventListener("change", (e) => { if (e.target.value) { selectBrgy(e.target.value, true); closeOpts(true); } else clearSel(); });
  $("#tourBtn").addEventListener("click", () => startTour(true));
  $("#colCollapse").addEventListener("click", () => setCollapsed(true, true));
  $("#showPanel").addEventListener("click", () => setCollapsed(false, true));
  $("#eyebrow").addEventListener("click", (e) => { if (e.target.closest("#changeCity")) showNational(false); });
  $("#copyLink").addEventListener("click", copyLink);
  $("#dlPlan").addEventListener("click", downloadPlan);

  // site list: hover and focus light up the marker, click pans to it
  const sl = $("#siteList");
  $("#planSeg").addEventListener("change", (e) => { if (e.target.name === "plan") setPlan(e.target.value); });
  const idOf = (e) => { const b = e.target.closest && e.target.closest("button.site"); return b ? b.dataset.id : null; };
  sl.addEventListener("click", (e) => { const id = idOf(e); if (id) { toggleOpen(id); setActive(id, { pan: true }); } });
  sl.addEventListener("mouseover", (e) => { const id = idOf(e); if (id) setHover(id); });
  sl.addEventListener("mouseout", (e) => { if (idOf(e)) setHover(null); });
  sl.addEventListener("focusin", (e) => { const id = idOf(e); if (id) setHover(id); });
  sl.addEventListener("focusout", (e) => { if (idOf(e)) setHover(null); });

  // More options drawer
  onOptKey = trapOpts;
  $("#optBtn").addEventListener("click", () => openOpts(true));
  $("#optClose").addEventListener("click", () => closeOpts(true));
  $("#optScrim").addEventListener("click", () => closeOpts(true));
  moreDrawer = moreBelow($("#optsBody"));
  const ms = $("#measures");
  ms.style.setProperty("--n", METRICS.length);
  ms.innerHTML = '<span class="thumb" aria-hidden="true"></span>' + METRICS.map((m) => `<label><input type="radio" name="metric" value="${m.key}" aria-label="${esc(m.short)}"><span>${esc(m.seg)}</span></label>`).join("");
  ms.addEventListener("change", (e) => { const m = METRICS.find((x) => x.key === e.target.value); if (m) setMetric(m); });
  syncMeasure();
  $("#ly3d").addEventListener("change", (e) => {
    S.view = e.target.checked ? "3d" : "2d"; applyView(); renderLegend();
    map.easeTo({ pitch: S.view === "3d" ? 50 : 0, bearing: S.view === "3d" ? -12 : 0, duration: dur(900) });
    syncUrl();
  });
  $("#lyDose").addEventListener("change", (e) => S.markers.forEach((m) => (e.target.checked ? m.addTo(map) : m.remove())));
  $("#lyRelief").addEventListener("change", (e) => { S.reliefOn = e.target.checked; applyRelief(); });
  $("#lyS1").addEventListener("change", (e) => map.setLayoutProperty("s1-fill", "visibility", e.target.checked ? "visible" : "none"));
  wireSheet();
  $("#sitesTog").addEventListener("click", () => sitesOpen($("#sites").classList.contains("shut")));
  wireTips();
}
