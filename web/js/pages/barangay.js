// Barangay report: one printable page per barangay, for the City Health Office.
import { barangayIndex, getCity, getCities, barangayHref, cityHref, tierOf, tiers } from "../data.js";
import { WALK_MIN } from "../config.js";
import { fmt, pct, esc, useCss } from "../format.js";

const num = (v) => (v == null || v === "" || Number.isNaN(+v) ? null : +v);

function centroid(g) {
  let x = 0, y = 0, n = 0;
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  polys.forEach((p) => p[0].forEach(([a, b]) => { x += a; y += b; n++; }));
  return [x / n, y / n];
}
const km = ([a, b], [c, d]) => {
  const R = 6371, r = Math.PI / 180;
  const h = Math.sin(((d - b) * r) / 2) ** 2 + Math.cos(b * r) * Math.cos(d * r) * Math.sin(((c - a) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
// Share of barangays this one is above, for "higher than X% of barangays".
const cmpWord = (a) => (a === 0 ? "among the lowest in the city" : `more than ${pct(a)} of barangays`);
const above = (rows, key, v) => (v == null ? null : rows.filter((r) => r[key] != null && r[key] < v).length / rows.length);

function locator(gj, id, dose) {
  const feats = gj.features;
  let w = 180, s = 90, e = -180, n = -90;
  const each = (g, fn) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates).forEach((p) => p.forEach((r) => r.forEach(fn)));
  feats.forEach((f) => each(f.geometry, ([x, y]) => { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }));
  const k = Math.cos(((s + n) / 2) * Math.PI / 180), W = 360, P = 8;
  const sc = (W - 2 * P) / ((e - w) * k), H = Math.ceil((n - s) * sc + 2 * P);
  const X = (x) => (P + (x - w) * k * sc).toFixed(1), Y = (y) => (P + (n - y) * sc).toFixed(1);
  const d = (g) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates).map((p) => p.map((r) => "M" + r.map(([x, y]) => X(x) + " " + Y(y)).join("L") + "Z").join("")).join("");
  const paths = feats.map((f) => `<path d="${d(f.geometry)}" class="${f.properties.adm4_pcode === id ? "on" : ""}" fill-rule="evenodd"/>`).join("");
  const pts = dose.map((p) => `<g transform="translate(${X(p.lon)} ${Y(p.lat)})"><circle r="8"/><text y="4" text-anchor="middle">${p.rank}</text></g>`).join("");
  return `<svg class="loc" viewBox="0 0 ${W} ${H}" role="img" aria-label="Map of the city with this barangay highlighted and the nearest dose points numbered.">${paths}${pts}</svg>`;
}

export async function render(el, params) {
  useCss("barangay");
  el.innerHTML = '<div class="page"><p class="muted" role="status">Loading barangay.</p></div>';
  const id = params.code;
  const idx = await barangayIndex().catch(() => []);
  const hit = idx.find((x) => x.id === id);
  if (!hit) {
    const cities = await getCities().catch(() => []);
    el.innerHTML = `<div class="page narrow"><h1 class="page-title">Barangay not found</h1><p class="muted">No barangay has the code ${esc(id)}.</p><a class="btn" href="${cities[0] ? cityHref(cities[0].code, "barangays") : "#/"}">See all barangays</a></div>`;
    return;
  }
  const city = await getCity(hit.cityCode);
  const rows = city.rows, n = rows.length;
  const r = rows.find((x) => x.id === id);
  const f = city.barangays.features.find((x) => x.properties.adm4_pcode === id);
  const p = f.properties;
  const t = tierOf(r.priority, n);
  const meta = city.meta;
  const yrs = (/(\d+)/.exec((city.summary && city.summary.scenario) || "") || [0, 25])[1];
  document.title = `${r.name}, ${meta.name}: LAMBAT`;

  // Nearest proposed dose points, straight line from the barangay's centre.
  const c = centroid(f.geometry);
  const dose = (city.dosePoints.features || []).filter((d) => d.properties.rank != null)
    .map((d) => ({ ...d.properties, lon: d.geometry.coordinates[0], lat: d.geometry.coordinates[1], km: km(c, d.geometry.coordinates) }))
    .sort((a, b) => a.km - b.km).slice(0, 3);

  const lo = num(p.exposed_low), md = num(p.exposed_med), hi = num(p.exposed_high);
  const depthTot = (lo || 0) + (md || 0) + (hi || 0);
  const depth = depthTot > 0 ? [["Low", lo, "d1"], ["Medium", md, "d2"], ["High", hi, "d3"]] : null;
  const eShare = r.pop ? r.exposed / r.pop : null;
  const aE = above(rows, "exposed", r.exposed), aU = above(rows, "unreached", r.unreached);
  const prev = rows.find((x) => x.priority === r.priority - 1), next = rows.find((x) => x.priority === r.priority + 1);

  el.innerHTML = `
  <article class="page brgy">
    <ol class="crumbs no-print"><li><a href="${cityHref(hit.cityCode)}">${esc(meta.name)}</a></li><li><a href="${cityHref(hit.cityCode, "barangays")}">Priority list</a></li><li aria-current="page">${esc(r.name)}</li></ol>
    <header class="b-head">
      <div>
        <p class="eyebrow">Barangay report · ${esc(meta.name)}${meta.province ? ", " + esc(meta.province) : ""}</p>
        <h1>${esc(r.name)}</h1>
        <p class="b-tier"><span class="tier lg ${t.key}">${t.label}</span><span>Rank <b>${r.priority}</b> of ${n} for dose points</span></p>
      </div>
      <div class="b-actions no-print">
        <a class="btn ghost sm" href="#/map/${encodeURIComponent(hit.cityCode)}?b=${encodeURIComponent(id)}">View on map</a>
        <button class="btn sm" type="button" id="print">Print this sheet</button>
      </div>
    </header>
    <p class="scenario">${yrs}-year flood scenario · model estimate for planning, not a forecast of cases</p>

    <section class="kpis" aria-label="Key figures">
      <div class="kpi"><span class="k-l">Residents exposed</span><span class="k-v num">${fmt(r.exposed)}</span><span class="k-s">${eShare != null ? `${pct(eShare)} of ${fmt(r.pop)} residents` : "live where the flood reaches"}</span></div>
      <div class="kpi hot"><span class="k-l">Cut off from care in a flood</span><span class="k-v num">${fmt(r.unreached)}</span><span class="k-s">exposed, no clinic within a ${WALK_MIN}-minute walk</span></div>
      <div class="kpi"><span class="k-l">Capsules per flood week</span><span class="k-v num">${fmt(r.capsules)}</span><span class="k-s">doxycycline 100 mg, 2 per person</span></div>
      <div class="kpi"><span class="k-l">Area under water</span><span class="k-v num">${pct(r.share)}</span><span class="k-s">of the barangay's land</span></div>
    </section>

    <div class="b-grid">
      <section class="card">
        <h2 class="card-title">What the health office can do</h2>
        <ol class="todo">
          <li><b>Give exposed residents doxycycline.</b> 200 mg (2 capsules of 100 mg) once a week while the flood lasts, for people with continued exposure. That is about <b>${fmt(r.capsules)} capsules</b> a week for ${esc(r.name)}.</li>
          <li><b>One wade, one dose.</b> People exposed once take a single 200 mg dose within 24 to 72 hours.</li>
          <li><b>Refer, do not dose,</b> pregnant and lactating women. LAMBAT does not count them; ask the barangay health worker.</li>
          <li><b>${r.unreached ? `Bring the capsules closer.</b> ${fmt(r.unreached)} exposed residents here cannot walk to a clinic in ${WALK_MIN} minutes during the flood. Open the nearest dose point below.` : `Clinics are within reach.</b> Exposed residents here can walk to a clinic within ${WALK_MIN} minutes even during the flood.`}</li>
        </ol>
        <p class="fine">Doses follow the PhilHealth 2012 leptospirosis guideline as summarised in the LAMBAT proposal. Follow DOH protocol and your medical officer. Each dose point needs a prescriber.</p>
      </section>

      <section class="card">
        <h2 class="card-title">Where it sits</h2>
        ${locator(city.barangays, id, dose)}
        <ul class="near">${dose.map((d) => `<li><span class="dn">${d.rank}</span><span><b>${esc(d.name)}</b><small>${esc(d.kind || "site")} · dose point ${d.rank} of ${city.dosePoints.features.length} · ${d.km.toFixed(1)} km away</small></span></li>`).join("")}</ul>
        <p class="fine">Distances are straight lines from the barangay centre. Walking routes are longer, and flooded roads may be closed.</p>
      </section>

      <section class="card">
        <h2 class="card-title">How it compares</h2>
        <ul class="cmp">
          ${aE != null ? `<li><span>Exposed residents</span><b>${cmpWord(aE)}</b><i style="--w:${(aE * 100).toFixed(0)}%"></i></li>` : ""}
          ${aU != null ? `<li><span>Cut off from care in a flood</span><b>${cmpWord(aU)}</b><i style="--w:${(aU * 100).toFixed(0)}%"></i></li>` : ""}
        </ul>
        ${depth ? `<h3 class="sub">Flood depth where people live</h3>
        <div class="depth" role="img" aria-label="${depth.map(([l, v]) => `${l} depth: ${fmt(v)} residents`).join(", ")}">${depth.map(([l, v, k]) => (v ? `<i class="${k}" style="flex:${v}"></i>` : "")).join("")}</div>
        <ul class="depth-key">${depth.map(([l, v, k]) => `<li><i class="${k}"></i>${l}: ${fmt(v)}</li>`).join("")}</ul>` : ""}
        <p class="fine">Rank orders barangays by exposed residents cut off from care in a flood, then by all exposed residents. Groups are quarters of that list: ${tiers().map((x) => x.short).join(", ")}.</p>
      </section>
    </div>

    <nav class="b-pager no-print" aria-label="Neighbouring ranks">
      ${prev ? `<a href="${barangayHref(prev.id)}"><small>Rank ${prev.priority}</small>← ${esc(prev.name)}</a>` : "<span></span>"}
      ${next ? `<a class="nx" href="${barangayHref(next.id)}"><small>Rank ${next.priority}</small>${esc(next.name)} →</a>` : "<span></span>"}
    </nav>
    <p class="print-only fine">Printed from LAMBAT (${location.origin}${location.pathname}). Data: UP NOAH, WorldPop, OpenStreetMap, Project CCHAIN. A planning aid, not an official advisory.</p>
  </article>`;
  el.querySelector("#print").addEventListener("click", () => window.print());
}
