// City dashboard page. Exports render(el, {code, tab}) and destroy().
// Reads data through ../data.js. Accepts either the router-era shape
// ({meta, barangays, dosePoints, summary, alertScores, alertSeries}) or the
// loader shape ({meta, bar, rows, dose, summary, coverage, series, alert}).
import * as D from "../data.js";
import { skel } from "../format.js";

const TABS = [
  ["overview", "Overview"],
  ["dose-points", "Dose points"],
  ["barangays", "Barangays"],
  ["alert", "Alert"],
];
const TAB_ALIAS = { dose: "dose-points", doses: "dose-points", dosepoints: "dose-points", barangay: "barangays" };

let cleanup = [];

// ---------- helpers ----------
const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const isNum = (v) => v != null && v !== "" && Number.isFinite(+v);
const fmt = (v) => (isNum(v) ? nf.format(Math.round(+v)) : "n/a");
const pct = (v, d = 0) => (isNum(v) ? (+v * 100).toFixed(d) + "%" : "n/a");
const dec = (v, d = 2) => (isNum(v) ? (+v).toFixed(d) : "n/a");
const share01 = (v) => (isNum(v) ? (+v > 1 ? +v / 100 : +v) : null);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Placeholder page shown while the city data loads, shaped like the tab being opened.
function ghost(tab) {
  const head = `<header class="city-head"><div>${skel(1)}<span class="skel skel-big" style="--w:240px"></span>${skel(1)}</div></header>`;
  const tabs = `<div class="tabs" aria-hidden="true">${TABS.map(() => '<span class="skel skel-line" style="width:96px;height:20px;margin:14px 16px"></span>').join("")}</div>`;
  const table = (cols) => `<div class="card"><div class="table-wrap"><table class="table"><tbody>${skel("rows", { n: 8, cols })}</tbody></table></div></div>`;
  let body;
  if (tab === "barangays") body = table(6);
  else if (tab === "dose-points") body = `<div class="city-grid two"><div class="card">${skel(2)}${skel("chart", { h: 120 })}</div><div class="card">${skel("chart", { h: 220 })}</div></div>`;
  else if (tab === "alert") body = `<div class="city-grid">${skel("stat")}${skel("stat")}${skel("stat")}</div><div class="card" style="margin-top:var(--s2)">${skel("chart", { h: 300 })}</div>`;
  else body = `<div class="city-split"><div class="city-grid two">${[1, 2, 3, 4, 5].map(() => skel("stat")).join("")}</div><div class="card">${skel(2)}${skel("chart", { h: 280 })}</div></div>`;
  return `<div class="city" aria-busy="true"><span class="sr-only" role="status">Loading city data.</span>${head}${tabs}${body}</div>`;
}

function ensureCss() {
  if (document.querySelector('link[href="css/city.css"]')) return;
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = "css/city.css";
  document.head.appendChild(l);
}

async function loadAny(code) {
  const fn = D.getCity || D.loadCity;
  if (!fn) throw new Error("data.js has no city loader");
  return fn(code);
}

// Normalise whichever shape data.js returns into one model.
function model(raw) {
  const meta = raw.meta || {};
  const gj = raw.barangays || raw.bar || { features: [] };
  const dose = raw.dosePoints || raw.dose || { features: [] };
  const sum = raw.summary || null;
  const steps = (sum && sum.steps) || meta.steps || {};

  // barangay rows
  const rows = gj.features.map((f) => {
    const p = f.properties || {};
    return {
      id: p.adm4_pcode, name: p.adm4_en || p.adm4_pcode || "Unnamed",
      pop: isNum(p.population) ? +p.population : null,
      exposed: isNum(p.exposed) ? +p.exposed : 0,
      unreached: isNum(p.exposed_unreached_flood) ? +p.exposed_unreached_flood : null,
      fshare: share01(p.flooded_share),
      capsules: isNum(p.weekly_capsules) ? +p.weekly_capsules : null,
      priority: isNum(p.priority) ? +p.priority : null,
    };
  });
  if (rows.some((r) => r.priority == null)) {
    [...rows].sort((a, b) => b.exposed - a.exposed).forEach((r, i) => { r.priority = i + 1; });
  }

  // access gap and chart values
  let gap = isNum(meta.access_gap) ? +meta.access_gap : null;
  if (sum && isNum(sum.exposed_access_gap)) gap = +sum.exposed_access_gap;
  const accessOk = steps.access === false ? false : gap != null;
  let dry = null, flood = null;
  if (sum && isNum(sum.exposed_on_road_network) && sum.exposed_on_road_network > 0) {
    if (isNum(sum.exposed_within_reach_dry)) dry = sum.exposed_within_reach_dry / sum.exposed_on_road_network;
    if (isNum(sum.exposed_within_reach_flood)) flood = sum.exposed_within_reach_flood / sum.exposed_on_road_network;
  } else if (raw.coverage) { dry = raw.coverage.dry; flood = raw.coverage.flood; }

  // plans
  const plans = {};
  const sp = sum && sum.dose_point_plans;
  ["3", "5", "8"].forEach((k) => {
    const p = sp && sp[k];
    const metaShare = meta.coverage_after ? share01(meta.coverage_after[k]) : null;
    if (p) {
      plans[k] = {
        sites: Array.isArray(p.sites) ? p.sites : null,
        newly: isNum(p.exposed_newly_covered) ? +p.exposed_newly_covered : null,
        after: isNum(p.exposed_within_reach_after) ? +p.exposed_within_reach_after : null,
        share: share01(p.share_of_exposed_within_reach_after),
      };
    } else if (metaShare != null) {
      plans[k] = { sites: null, newly: null, after: null, share: metaShare };
    }
  });
  const sitingOk = steps.siting === false ? false : Object.keys(plans).length > 0;

  // alert
  const a = meta.alert || {};
  const scores = raw.alertScores || null;
  const byM = {};
  if (scores && Array.isArray(scores.scores)) scores.scores.forEach((s) => { byM[s.method] = s; });
  const ra = raw.alert || {};
  const rain = byM.rain_model || ra.rain || null;
  const seas = byM.seasonal || ra.seasonal || null;
  const alert = {
    status: a.status || ra.status || (rain ? "evaluated" : null),
    corr: isNum(a.correlation) ? +a.correlation : rain ? rain.correlation : null,
    caught: isNum(a.caught) ? share01(a.caught) : rain ? rain.sensitivity : null,
    falseA: isNum(a.false_alerts) ? share01(a.false_alerts) : rain ? rain.false_alert_rate : null,
    bCorr: isNum(a.baseline_correlation) ? +a.baseline_correlation : seas ? seas.correlation : null,
    bCaught: seas && isNum(seas.sensitivity) ? seas.sensitivity : null,
    bFalse: seas && isNum(seas.false_alert_rate) ? seas.false_alert_rate : null,
    years: (scores && scores.test_years) || ra.testYears || [2017, 2019],
  };
  const ser = raw.alertSeries || raw.series || null;
  const series = ser && ser.length
    ? ser.map((s) => ({ week: String(s.week), actual: +s.actual, rain: +(s.rain_model ?? s.rain), seasonal: +s.seasonal }))
    : null;

  return { meta, gj, dose, rows, gap, accessOk, dry, flood, plans, sitingOk, alert, series };
}

// ---------- locator map ----------
function ringsOf(g) {
  if (!g) return [];
  if (g.type === "Polygon") return [g.coordinates];
  if (g.type === "MultiPolygon") return g.coordinates;
  return [];
}
function locator(m) {
  const feats = m.gj.features;
  let w = 180, s = 90, e = -180, n = -90;
  feats.forEach((f) => ringsOf(f.geometry).forEach((poly) => poly[0].forEach(([x, y]) => { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); })));
  if (!(e > w)) return '<p class="empty">No outlines available.</p>';
  const k = Math.cos(((s + n) / 2) * Math.PI / 180);
  const W = 400, pad = 6;
  const sc = (W - 2 * pad) / ((e - w) * k);
  const H = Math.ceil((n - s) * sc + 2 * pad);
  const X = (x) => (pad + (x - w) * k * sc).toFixed(1);
  const Y = (y) => (pad + (n - y) * sc).toFixed(1);
  const sh = feats.map((f) => { const p = f.properties || {}; const pop = +p.population; return pop > 0 ? (+p.exposed || 0) / pop : 0; });
  const sorted = [...sh].sort((a, b) => a - b);
  const q = (t) => sorted[Math.min(sorted.length - 1, Math.floor(t * sorted.length))];
  const br = [q(0.2), q(0.4), q(0.6), q(0.8)];
  const cls = (v) => (v <= br[0] ? 1 : v <= br[1] ? 2 : v <= br[2] ? 3 : v <= br[3] ? 4 : 5);
  const lo = [sorted[0], ...br], hi = [...br, sorted[sorted.length - 1]];
  let paths = "";
  feats.forEach((f, i) => {
    const d = ringsOf(f.geometry).map((poly) => poly.map((r) => "M" + r.map(([x, y]) => X(x) + " " + Y(y)).join("L") + "Z").join("")).join("");
    const p = f.properties || {};
    paths += `<path d="${d}" style="fill:var(--ramp-${cls(sh[i])})" fill-rule="evenodd"><title>${esc(p.adm4_en)}: ${pct(sh[i])} of residents exposed</title></path>`;
  });
  const legend = [1, 2, 3, 4, 5].map((c) => `<li><span class="sw" style="background:var(--ramp-${c})"></span>${pct(lo[c - 1])} to ${pct(hi[c - 1])}</li>`).join("");
  const desc = `Outline map of ${feats.length} barangays shaded by the share of residents exposed to floodwater, from ${pct(sorted[0])} to ${pct(sorted[sorted.length - 1])}.`;
  return `<svg class="locator" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(desc)}">${paths}</svg>
    <ul class="legend" aria-label="Share of residents exposed, by shade">${legend}</ul>`;
}

// ---------- panels ----------
function statCard(label, value, caption, extra = "") {
  return `<div class="card stat"><span class="stat-label">${esc(label)}</span><span class="stat-value num">${value}</span>${extra}<p class="stat-caption">${caption}</p></div>`;
}

function overview(m) {
  const c = m.meta;
  const exposedShare = isNum(c.exposed_share) ? +c.exposed_share : isNum(c.population) && c.population > 0 ? c.exposed / c.population : null;
  const gapCard = m.accessOk
    ? statCard("Access gap", fmt(m.gap), "People who can reach care on a dry day but not in the flood.")
    : statCard("Access gap", "n/a", "Access not computed for this city: road data unavailable.");
  let cov;
  if (m.sitingOk) {
    const trio = ["3", "5", "8"].map((k) => `<div><span class="num">${m.plans[k] ? pct(m.plans[k].share) : "n/a"}</span><span class="lab">${k} points</span></div>`).join("");
    cov = `<div class="card stat"><span class="stat-label">Within reach after dose points</span><div class="stat-trio" style="margin-top:4px">${trio}</div><p class="stat-caption">Share of exposed residents within a 30-minute walk of care if 3, 5 or 8 dose points open.</p></div>`;
  } else {
    cov = statCard("Within reach after dose points", "n/a", "Dose point plans not computed for this city.");
  }
  const cases = isNum(c.lepto_cases_2008_2022)
    ? statCard("Leptospirosis cases", fmt(c.lepto_cases_2008_2022), "Reported cases, 2008 to 2022.")
    : statCard("Leptospirosis cases", "n/a", "No case history for this city.");
  return `<div class="city-split">
    <div class="city-grid two">
      ${statCard("Exposed residents", fmt(c.exposed), `${pct(exposedShare)} of ${fmt(c.population)} residents live where a 25-year flood reaches.`)}
      ${statCard("Capsules per flood week", fmt(c.weekly_capsules), "Doxycycline capsules needed each week the flood lasts.")}
      ${gapCard}
      ${cov}
      ${cases}
    </div>
    <div class="card"><h2 class="card-title">Where the exposure is</h2>
      <p class="caption">Each shape is a barangay, shaded by the share of its residents exposed.</p>${locator(m)}</div>
  </div>`;
}

function planRows(m) {
  return ["3", "5", "8"].filter((k) => m.plans[k]).map((k) => {
    const p = m.plans[k];
    return `<tr><td>${k}</td><td>${p.sites ? p.sites.length : "n/a"}</td><td>${fmt(p.newly)}</td><td>${pct(p.share, 1)}</td></tr>`;
  }).join("");
}
function covChart(m) {
  const bars = [];
  if (m.dry != null) bars.push({ k: "Dry day", sub: "no flood", v: m.dry, c: "b-dry" });
  if (m.flood != null) bars.push({ k: "In the flood", sub: "no dose points", v: m.flood, c: "b-flood" });
  ["3", "5", "8"].forEach((k) => { if (m.plans[k] && m.plans[k].share != null) bars.push({ k: "+" + k + " points", sub: "dose points open", v: m.plans[k].share, c: "b-plan" }); });
  if (!bars.length) return "";
  const W = 640, H = 320, L = 52, R = 12, T = 28, B = 62;
  const step = (W - L - R) / bars.length, bw = Math.min(72, step - 16);
  const Y = (v) => T + (H - T - B) * (1 - v);
  let s = "";
  [0, .25, .5, .75, 1].forEach((g) => { s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(g)}" y2="${Y(g)}"/><text x="${L - 8}" y="${Y(g) + 4}" text-anchor="end">${Math.round(g * 100)}%</text>`; });
  s += `<text class="axis-title" transform="translate(12 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle">Within a 30-minute walk</text>`;
  bars.forEach((b, i) => {
    const x = L + step * i + (step - bw) / 2, y = Y(b.v);
    s += `<rect class="${b.c}" x="${x}" y="${y}" width="${bw}" height="${Y(0) - y}" rx="4"/>`;
    s += `<text class="val" x="${x + bw / 2}" y="${y - 8}" text-anchor="middle">${pct(b.v)}</text>`;
    s += `<text class="b-lab" x="${x + bw / 2}" y="${H - 38}" text-anchor="middle">${esc(b.k)}</text><text x="${x + bw / 2}" y="${H - 22}" text-anchor="middle">${esc(b.sub)}</text>`;
  });
  const desc = "Share of exposed residents within a 30-minute walk of care. " + bars.map((b) => `${b.k}: ${pct(b.v)}`).join(". ") + ".";
  return `<svg class="chart-city" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(desc)}">${s}</svg>`;
}
function dosePanel(m) {
  if (!m.sitingOk) return `<div class="card"><h2 class="card-title">Dose points</h2><p class="empty">Dose point plans were not computed for this city${m.accessOk ? "" : ": road data unavailable"}.</p></div>`;
  const feats = (m.dose.features || []).map((f) => f.properties || {}).sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  const list = feats.length
    ? `<h3 class="card-title" style="margin-top:var(--s3)">Candidate sites, in order of rank</h3><div class="table-wrap"><table class="table"><caption class="sr-only">Dose point sites by rank</caption><thead><tr><th scope="col">Rank</th><th scope="col" class="l">Site</th><th scope="col" class="l">Type</th></tr></thead><tbody>${feats.map((p) => `<tr><td>${esc(p.rank ?? "")}</td><td class="l">${esc(p.name || p.id || "Unnamed")}</td><td class="l">${esc(p.kind || "")}</td></tr>`).join("")}</tbody></table></div>`
    : "";
  return `<div class="city-grid two">
    <div class="card"><h2 class="card-title">Plans</h2>
      <p class="caption">How many exposed residents each plan brings within reach.</p>
      <div class="table-wrap"><table class="table"><caption class="sr-only">Dose point plans</caption>
      <thead><tr><th scope="col">k</th><th scope="col">Sites</th><th scope="col">Newly covered</th><th scope="col">Within reach after</th></tr></thead>
      <tbody>${planRows(m)}</tbody></table></div>
      <p class="note">Each plan is optimised separately, so the 5-point plan is not the 3-point plan plus two.</p></div>
    <div class="card"><h2 class="card-title">Share within a 30-minute walk</h2>
      <p class="caption">Exposed residents who can walk to care or a dose point.</p>${covChart(m)}</div>
    ${list ? `<div class="card wide">${list}</div>` : ""}
  </div>`;
}

const COLS = [
  { key: "priority", label: "Priority", desc: "Rank for opening dose points. 1 is the most urgent.", num: true },
  { key: "name", label: "Barangay", desc: "Smallest administrative area.", text: true },
  { key: "pop", label: "Population", desc: "Residents living there.", num: true },
  { key: "exposed", label: "Exposed", desc: "Residents living where the flood reaches.", num: true },
  { key: "unreached", label: "Out of reach in flood", desc: "Exposed residents with no care within a 30-minute walk during the flood.", num: true },
  { key: "fshare", label: "Flooded share", desc: "Share of the barangay's area under water.", num: true },
  { key: "capsules", label: "Capsules/week", desc: "Capsules needed each flood week.", num: true },
];
function cell(c, r) {
  const v = r[c.key];
  if (c.key === "name") return `<td class="l">${esc(v)}</td>`;
  if (c.key === "fshare") return `<td>${pct(v)}</td>`;
  if (c.key === "priority") return `<td>${fmt(v)}</td>`;
  return `<td>${v == null ? '<span title="Not computed">n/a</span>' : fmt(v)}</td>`;
}
function barangayPanel(m, panel, code) {
  panel.innerHTML = `<div class="card"><h2 class="card-title">Barangays by priority</h2>
    <p class="caption">Sort any column. Search by barangay name.</p>
    <div class="table-tools"><div style="flex:1;min-width:200px"><label class="sr-only" for="brgy-q">Search barangays</label><input id="brgy-q" class="field" type="search" placeholder="Search barangays" autocomplete="off"></div>
    <button type="button" class="btn btn-primary sm" id="brgy-csv">Download CSV</button></div>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Barangay table, scrolls sideways on small screens"><table class="table" id="brgy-t"><caption class="sr-only">Barangays by priority</caption>
    <thead><tr>${COLS.map((c) => `<th scope="col" data-k="${c.key}" class="${c.text ? "l" : ""}" aria-sort="none" title="${esc(c.desc)}"><button type="button">${esc(c.label)}</button></th>`).join("")}</tr></thead><tbody></tbody></table></div>
    <p class="note" id="brgy-count" role="status"></p>
    <ul class="col-key">${COLS.map((c) => `<li><strong>${esc(c.label)}.</strong> ${esc(c.desc)}</li>`).join("")}</ul></div>`;
  const tbody = panel.querySelector("tbody"), q = panel.querySelector("#brgy-q"), count = panel.querySelector("#brgy-count");
  let sortKey = "priority", dir = 1;
  const view = () => {
    const term = q.value.trim().toLowerCase();
    const list = m.rows.filter((r) => !term || r.name.toLowerCase().includes(term));
    list.sort((a, b) => {
      const x = a[sortKey], y = b[sortKey];
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (typeof x === "string" ? x.localeCompare(y) : x - y) * dir;
    });
    return list;
  };
  const draw = () => {
    const list = view();
    tbody.innerHTML = list.length ? list.map((r) => `<tr>${COLS.map((c) => cell(c, r)).join("")}</tr>`).join("") : `<tr><td colspan="${COLS.length}" class="empty">No barangay matches.</td></tr>`;
    count.textContent = `Showing ${list.length} of ${m.rows.length} barangays.`;
    panel.querySelectorAll("th[data-k]").forEach((th) => th.setAttribute("aria-sort", th.dataset.k === sortKey ? (dir === 1 ? "ascending" : "descending") : "none"));
  };
  panel.querySelectorAll("th[data-k] button").forEach((b) => b.addEventListener("click", () => {
    const k = b.parentElement.dataset.k;
    if (k === sortKey) dir = -dir; else { sortKey = k; dir = k === "name" || k === "priority" ? 1 : -1; }
    draw();
  }));
  q.addEventListener("input", draw);
  panel.querySelector("#brgy-csv").addEventListener("click", () => {
    const head = ["priority", "barangay", "population", "exposed", "out_of_reach_in_flood", "flooded_share", "capsules_per_week"];
    const cs = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
    const lines = [head.join(",")].concat(view().map((r) => [r.priority, r.name, r.pop == null ? "" : Math.round(r.pop), Math.round(r.exposed), r.unreached == null ? "" : Math.round(r.unreached), r.fshare == null ? "" : r.fshare.toFixed(3), r.capsules == null ? "" : Math.round(r.capsules)].map(cs).join(",")));
    const url = URL.createObjectURL(new Blob([lines.join("\n") + "\n"], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `lambat-barangays-${code}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  draw();
}

function lineChart(series, years) {
  const W = 760, H = 340, L = 52, R = 16, T = 16, B = 62, n = series.length;
  const mx = Math.max(2, Math.ceil(Math.max(...series.map((d) => Math.max(d.actual, d.rain, d.seasonal)))));
  const X = (i) => L + ((W - L - R) * i) / Math.max(1, n - 1), Y = (v) => T + (H - T - B) * (1 - v / mx);
  let s = "";
  const stepY = mx > 10 ? 2 : 1;
  for (let g = 0; g <= mx; g += stepY) s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(g)}" y2="${Y(g)}"/><text x="${L - 8}" y="${Y(g) + 4}" text-anchor="end">${g}</text>`;
  const seen = {};
  series.forEach((d, i) => { const y = d.week.slice(0, 4); if (!seen[y]) { seen[y] = 1; s += `<line class="grid" x1="${X(i)}" x2="${X(i)}" y1="${T}" y2="${H - B}"/><text x="${X(i) + 4}" y="${H - B + 16}">${y}</text>`; } });
  const pl = (key, cls) => `<polyline class="${cls}" points="${series.map((d, i) => X(i).toFixed(1) + "," + Y(d[key]).toFixed(1)).join(" ")}"/>`;
  s += pl("seasonal", "l-seas") + pl("rain", "l-rain") + pl("actual", "l-actual");
  s += `<text class="axis-title" transform="translate(12 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle">Cases per week</text>`;
  s += `<text class="axis-title" x="${(L + W - R) / 2}" y="${H - 8}" text-anchor="middle">Week, ${years[0]} to ${years[1]}</text>`;
  const tot = series.reduce((t, d) => t + d.actual, 0);
  const peak = series.reduce((b, d) => (d.actual > b.actual ? d : b), series[0]);
  const desc = `Weekly leptospirosis cases from ${series[0].week} to ${series[n - 1].week}. Actual cases total ${tot}, peaking at ${peak.actual} in the week of ${peak.week}.`;
  return { desc, svg: `<svg class="chart-city" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(desc)}">${s}</svg>` };
}
function alertPanel(m) {
  const a = m.alert, c = m.meta;
  if (a.status !== "evaluated") {
    const n = c.lepto_cases_2008_2022;
    return `<div class="card"><h2 class="card-title">Alert</h2><p>${a.status === "too_few_cases" ? "Too few cases to test an alert for this city" : "The alert was not tested for this city"}${isNum(n) ? `: only ${fmt(n)} leptospirosis cases were reported from 2008 to 2022` : ""}. Any score would be noise, so none is shown.</p></div>`;
  }
  const base = (v, f) => (v == null ? "No baseline score" : `Seasonal baseline: ${f(v)}`);
  const card = (label, v, b, cap) => `<div class="card stat"><span class="stat-label">${label}</span><span class="stat-value num">${v}</span><p class="stat-note">${b}</p><p class="stat-caption">${cap}</p></div>`;
  const cards = `<div class="city-grid">
    ${card("Correlation with real cases", dec(a.corr), base(a.bCorr, (v) => dec(v)), "How closely the rain model follows weekly cases. 1 is a perfect match.")}
    ${card("Outbreak weeks caught", pct(a.caught), base(a.bCaught, (v) => pct(v)), "Share of outbreak weeks the alert warned about in advance.")}
    ${card("False alerts", pct(a.falseA), base(a.bFalse, (v) => pct(v)), "Share of quiet weeks that still raised an alert. Lower is better.")}
  </div>`;
  let chart = "";
  if (m.series && m.series.length > 1) {
    const ch = lineChart(m.series, a.years);
    chart = `<div class="card" style="margin-top:var(--s2)"><h2 class="card-title">Weekly cases, actual and predicted</h2>
      ${ch.svg}
      <ul class="legend"><li><span class="ln"></span>Actual cases</li><li><span class="ln rain"></span>Rain model</li><li><span class="ln seas"></span>Seasonal baseline (dashed)</li></ul>
      <p class="note">${esc(ch.desc)} The rain model is ${isNum(a.corr) ? "correlated " + dec(a.corr) : "scored"}${isNum(a.bCorr) ? ` against ${dec(a.bCorr)} for the seasonal baseline` : ""}.</p></div>`;
  } else {
    chart = `<div class="card" style="margin-top:var(--s2)"><span class="badge test-label">Test period ${a.years[0]} to ${a.years[1]}, not a live alert</span><p class="empty">The weekly series is not available for this city.</p></div>`;
  }
  return `<span class="badge test-label">Test period ${a.years[0]} to ${a.years[1]}, not a live alert</span>${cards}${chart}`;
}

// ---------- page ----------
export async function render(el, params = {}) {
  ensureCss();
  cleanup.forEach((f) => f()); cleanup = [];
  const code = params.code;
  let tab = String(params.tab || "overview").toLowerCase();
  tab = TAB_ALIAS[tab] || tab;
  if (!TABS.some((t) => t[0] === tab)) tab = "overview";
  el.innerHTML = ghost(tab);

  let cities = [], raw, m;
  try {
    cities = (await D.getCities()) || [];
    raw = await loadAny(code);
    if (!raw) throw new Error("Unknown city code.");
    if (!(raw.barangays || raw.bar)) throw new Error(raw.error || "No barangay data.");
    m = model(raw);
  } catch (err) {
    const known = cities.find((c) => c.code === code);
    el.innerHTML = `<div class="city city-error"><h1 class="page-title">${esc(known ? known.name : "City not found")}</h1><p class="notice" role="alert">${esc(known ? "No data could be loaded for this city. " : "We do not have a city with code " + code + ". ")}${esc(err.message)}</p><p><a class="btn ghost" href="#/city/${esc(cities[0] ? cities[0].code : "")}">Go to a city</a></p></div>`;
    return;
  }
  const c = m.meta;
  const opts = (cities.length ? cities : [c]).slice().sort((a, b) => a.name.localeCompare(b.name))
    .map((x) => `<option value="${esc(x.code)}"${x.code === c.code ? " selected" : ""}>${esc(x.name)}</option>`).join("");
  const place = [c.province, c.region].filter(Boolean).join(", ");

  el.innerHTML = `<div class="city">
    <header class="city-head">
      <div><p class="eyebrow">City dashboard</p><h1>${esc(c.name)}</h1><p class="sub">${esc(place)}</p></div>
      <div class="city-tools">
        <div class="city-switch"><label for="city-sel">Switch city</label><select id="city-sel" class="field">${opts}</select></div>
        <a class="btn ghost sm" href="#/map/${esc(c.code)}">Open on map</a>
      </div>
    </header>
    <div class="tabs" role="tablist" aria-label="City sections">${TABS.map(([id, label]) => `<button type="button" role="tab" id="tab-${id}" aria-controls="panel-${id}" aria-selected="false" tabindex="-1" data-tab="${id}">${label}</button>`).join("")}</div>
    ${TABS.map(([id]) => `<section role="tabpanel" id="panel-${id}" aria-labelledby="tab-${id}" tabindex="0" hidden></section>`).join("")}
  </div>`;

  const panels = {
    overview: overview(m),
    "dose-points": dosePanel(m),
    alert: alertPanel(m),
  };
  Object.entries(panels).forEach(([id, html]) => { el.querySelector("#panel-" + id).innerHTML = html; });
  barangayPanel(m, el.querySelector("#panel-barangays"), c.code);

  el.querySelector("#city-sel").addEventListener("change", (e) => { location.hash = "#/city/" + e.target.value; });

  const tabEls = [...el.querySelectorAll('[role="tab"]')];
  const show = (id, focus) => {
    tabEls.forEach((t) => { const on = t.dataset.tab === id; t.setAttribute("aria-selected", on); t.tabIndex = on ? 0 : -1; if (on && focus) t.focus(); });
    TABS.forEach(([pid]) => { el.querySelector("#panel-" + pid).hidden = pid !== id; });
  };
  tabEls.forEach((t, i) => {
    t.addEventListener("click", () => {
      show(t.dataset.tab);
      // Keep the URL deep-linkable without re-running the router.
      try { history.replaceState(null, "", `#/city/${encodeURIComponent(c.code)}/${t.dataset.tab}`); } catch { /* ignore */ }
    });
    t.addEventListener("keydown", (e) => {
      const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabEls.length - 1 }[e.key];
      if (to == null) return;
      e.preventDefault();
      const next = tabEls[(to + tabEls.length) % tabEls.length];
      next.click(); next.focus();
    });
  });
  show(tab);
}

export function destroy() {
  cleanup.forEach((f) => f()); cleanup = [];
}
