// City dashboard page. Exports render(el, {code, tab}) and destroy().
// Reads data through ../data.js. Accepts either the router-era shape
// ({meta, barangays, dosePoints, summary, alertScores, alertSeries}) or the
// loader shape ({meta, bar, rows, dose, summary, coverage, series, alert}).
import * as D from "../data.js";
import { skel, reducedMotion } from "../format.js";

const TABS = [
  ["overview", "Overview"],
  ["dose-points", "Dose points"],
  ["barangays", "Barangays"],
  ["alert", "Rain warning"],
];
const TAB_ALIAS = { warning: "alert", "rain-warning": "alert", dose: "dose-points", doses: "dose-points", dosepoints: "dose-points", barangay: "barangays" };

let cleanup = [];

// ---------- helpers ----------
// The flood this city's numbers are for ("25-year" or "100-year").
const scn = (c) => D.scenarioOf(c);
const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const isNum = (v) => v != null && v !== "" && Number.isFinite(+v);
const fmt = (v) => (isNum(v) ? nf.format(Math.round(+v)) : "n/a");
const pct = (v, d = 0) => (isNum(v) ? (+v * 100).toFixed(d) + "%" : "n/a");
const dec = (v, d = 2) => (isNum(v) ? (+v).toFixed(d) : "n/a");
const share01 = (v) => (isNum(v) ? (+v > 1 ? +v / 100 : +v) : null);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const KINDS = {
  school: "School", townhall: "Barangay hall", town_hall: "Barangay hall", community_centre: "Community centre", community_center: "Community centre",
  hospital: "Hospital", clinic: "Clinic", doctors: "Clinic", pharmacy: "Pharmacy", place_of_worship: "Place of worship", church: "Church",
  fire_station: "Fire station", police: "Police station", library: "Library", marketplace: "Market", sports_centre: "Sports centre",
  social_facility: "Social facility", kindergarten: "Kindergarten", college: "College", university: "University", government: "Government office",
};
const kindLabel = (k) => { if (!k) return "Site"; if (KINDS[k]) return KINDS[k]; const t = String(k).replace(/_/g, " "); return t.charAt(0).toUpperCase() + t.slice(1); };
const planVal = (v, k) => (v != null && typeof v === "object" ? v[k] : v);
const GLOSS = "Order 1 opens first. It picks the places that bring the most cut-off residents within reach first.";
const RANK_NOTE = "Barangays are ranked by how many residents who live where the flood reaches would be cut off from care. Rank 1 is the barangay with the most people cut off.";

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
    alerts: rain && isNum(rain.alerts) ? +rain.alerts : null,
    outbreakWeeks: rain && isNum(rain.outbreak_weeks) ? +rain.outbreak_weeks : null,
    mae: rain && isNum(rain.mae) ? +rain.mae : null,
    bMae: seas && isNum(seas.mae) ? +seas.mae : null,
    all: scores && Array.isArray(scores.scores) ? scores.scores : null,
    years: (scores && scores.test_years) || ra.testYears || [2017, 2019],
    trainYears: (scores && scores.train_years) || ra.trainYears || [2008, 2016],
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
// Shaded by the count of exposed residents, the same metric the Map page opens with.
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
  const sh = feats.map((f) => { const p = f.properties || {}; return isNum(p.exposed) ? +p.exposed : 0; });
  const sorted = [...sh].sort((a, b) => a - b);
  const q = (t) => sorted[Math.min(sorted.length - 1, Math.floor(t * sorted.length))];
  const br = [q(0.2), q(0.4), q(0.6), q(0.8)];
  const cls = (v) => (v <= br[0] ? 1 : v <= br[1] ? 2 : v <= br[2] ? 3 : v <= br[3] ? 4 : 5);
  const lo = [sorted[0], ...br], hi = [...br, sorted[sorted.length - 1]];
  let paths = "";
  feats.forEach((f, i) => {
    const d = ringsOf(f.geometry).map((poly) => poly.map((r) => "M" + r.map(([x, y]) => X(x) + " " + Y(y)).join("L") + "Z").join("")).join("");
    const p = f.properties || {};
    paths += `<path d="${d}" style="fill:var(--ramp-${cls(sh[i])})" fill-rule="evenodd"><title>${esc(p.adm4_en)}: ${fmt(sh[i])} exposed residents</title></path>`;
  });
  const legend = [1, 2, 3, 4, 5].map((c) => `<li><span class="sw" style="background:var(--ramp-${c})"></span>${fmt(lo[c - 1])} to ${fmt(hi[c - 1])}</li>`).join("");
  const desc = `Outline map of ${feats.length} barangays shaded by the number of exposed residents, from ${fmt(sorted[0])} to ${fmt(sorted[sorted.length - 1])}.`;
  return `<svg class="locator" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(desc)}">${paths}</svg>
    <ul class="legend" aria-label="Exposed residents, by shade">${legend}</ul>`;
}

// ---------- panels ----------
function statCard(label, value, caption, extra = "", labelHtml = "") {
  return `<div class="card stat"><span class="stat-label">${labelHtml || esc(label)}</span><span class="stat-value num">${value}</span>${extra}<p class="stat-caption">${caption}</p></div>`;
}

// Sites of one plan size, in order (1 opens first).
function planOrder(m, k) {
  const feats = (m.dose.features || []).map((f) => f.properties || {});
  const ids = m.plans[k] && m.plans[k].sites;
  const rk = (p) => { const v = planVal(p.rank_in_plan, k); const r = v != null ? +v : p.rank; return isNum(r) ? +r : 99; };
  let list = ids ? feats.filter((p) => ids.includes(p.id)) : feats.slice();
  if (list.length < +k) list = feats.slice(); // plan sites missing from the file: first k by rank
  list.sort((a, b) => rk(a) - rk(b));
  return list.slice(0, +k).map((p) => ({ ...p, order: rk(p) }));
}
const joinNames = (a) => (a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]);

function answerCard(m) {
  const c = m.meta;
  const exposedShare = isNum(c.exposed_share) ? +c.exposed_share : isNum(c.population) && c.population > 0 ? c.exposed / c.population : null;
  const k = m.plans["3"] ? "3" : Object.keys(m.plans)[0];
  const top = k ? planOrder(m, k) : [];
  if (m.sitingOk && k && top.length && isNum(m.plans[k].share)) {
    const names = joinNames(top.map((p) => esc(p.name || kindLabel(p.kind))));
    return `<div class="card answer"><p class="answer-text">Open ${top.length} dose points first: <strong>${names}</strong>. They put <strong>${pct(m.plans[k].share)}</strong> of exposed residents within a 30-minute walk.</p>
      <a class="btn btn-primary" href="#/map/${esc(c.code)}?plan=${k}">See them on the map</a></div>`;
  }
  return `<div class="card answer"><p class="answer-text"><strong>${fmt(c.exposed)}</strong> of ${fmt(c.population)} residents (${pct(exposedShare)}) live where a ${scn(c).label} flood reaches. Dose point plans were not computed for this city.</p>
    <a class="btn btn-primary" href="#/map/${esc(c.code)}">Open on map</a></div>`;
}

function overview(m) {
  const c = m.meta;
  const exposedShare = isNum(c.exposed_share) ? +c.exposed_share : isNum(c.population) && c.population > 0 ? c.exposed / c.population : null;
  // Three cards by default; the rest sits under "More numbers".
  const cards = [statCard("Exposed residents", fmt(c.exposed), `${pct(exposedShare)} of ${fmt(c.population)} residents live where a ${scn(c).label} flood reaches.`)];
  const more = [statCard("Capsules per flood week", fmt(c.weekly_capsules), "Doxycycline capsules needed each week the flood lasts.")];
  const notes = [];
  if (m.accessOk) {
    cards.push(statCard("", fmt(m.gap), "Residents who can walk to a clinic on a dry day but not during the flood. Estimated from road maps.", "",
      `Lose access in the flood (estimated) <a class="help" href="#/method" title="How this is estimated" aria-label="How this is estimated, opens the Method page">?</a>`));
  } else notes.push("Access in the flood was not computed for this city: road data unavailable.");
  if (m.sitingOk) {
    const rows = ["3", "5", "8"].filter((k) => m.plans[k] && isNum(m.plans[k].share)).map((k) => `<div class="reach-row"><span class="lab">${k} dose points</span><span class="bar big" aria-hidden="true"><span class="bar-fill" style="width:${(m.plans[k].share * 100).toFixed(1)}%"></span></span><span class="num">${pct(m.plans[k].share)}</span></div>`).join("");
    cards.push(`<div class="card stat"><span class="stat-label">Exposed residents within a 30-minute walk of care after opening</span><div class="reach" style="margin-top:var(--s1)">${rows}</div></div>`);
  } else notes.push("Dose point plans were not computed for this city.");
  if (isNum(c.lepto_cases_2008_2022)) more.push(statCard("Leptospirosis cases", fmt(c.lepto_cases_2008_2022), "Reported cases, 2008 to 2022."));
  else notes.push("Case counts are not available for this city.");
  return `${answerCard(m)}
    <div class="city-grid">${cards.join("")}</div>
    ${notes.length ? `<p class="quiet">${notes.map(esc).join(" ")}</p>` : ""}
    <details class="rd-details city-tech more-nums"><summary>More numbers</summary>
      <div class="city-split">
        <div class="city-grid two">${more.join("")}</div>
        <div class="card"><h2 class="card-title">Where the exposure is</h2>
          <p class="caption">Each shape is a barangay, shaded by its number of exposed residents. The Map page opens with the same shading.</p>${locator(m)}</div>
      </div>
    </details>`;
}

// Thin share bar. v is 0..1.
const bar = (v) => `<span class="bar" aria-hidden="true"><span class="bar-fill" style="width:${(Math.max(0, Math.min(1, +v || 0)) * 100).toFixed(1)}%"></span></span>`;
function planRows(m) {
  return ["3", "5", "8"].filter((k) => m.plans[k]).map((k) => {
    const p = m.plans[k];
    return `<tr><td>${k}</td><td>${p.sites ? p.sites.length : "n/a"}</td><td>${fmt(p.newly)}</td><td class="has-bar"><span class="num">${pct(p.share, 1)}</span>${isNum(p.share) ? bar(p.share) : ""}</td></tr>`;
  }).join("");
}
// Coverage chart. W is the real pixel width of its box, so text stays 12px.
function covChart(m, W) {
  const bars = [];
  if (m.dry != null) bars.push({ k: ["Dry", "day"], v: m.dry, c: "b-dry" });
  if (m.flood != null) bars.push({ k: ["In the", "flood"], v: m.flood, c: "b-flood" });
  ["3", "5", "8"].forEach((k) => { if (m.plans[k] && m.plans[k].share != null) bars.push({ k: ["With " + k, "points"], v: m.plans[k].share, c: "b-plan" }); });
  if (!bars.length) return "";
  W = Math.max(280, Math.round(W));
  const wide = W >= 420;
  const H = 300, L = wide ? 56 : 42, R = 8, T = 28, B = 52;
  const step = (W - L - R) / bars.length, bw = Math.min(72, step - 10);
  const Y = (v) => T + (H - T - B) * (1 - v);
  let s = "";
  [0, .25, .5, .75, 1].forEach((g) => { s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(g)}" y2="${Y(g)}"/><text x="${L - 6}" y="${Y(g) + 4}" text-anchor="end">${Math.round(g * 100)}%</text>`; });
  if (wide) s += `<text class="axis-title" transform="translate(12 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle">Within a 30-minute walk</text>`;
  bars.forEach((b, i) => {
    const x = L + step * i + (step - bw) / 2, y = Y(b.v);
    s += `<rect class="${b.c}" x="${x}" y="${y}" width="${bw}" height="${Y(0) - y}" rx="4"/>`;
    s += `<text class="val" x="${x + bw / 2}" y="${y - 8}" text-anchor="middle">${pct(b.v)}</text>`;
    s += `<text class="b-lab" x="${x + bw / 2}" y="${H - 32}" text-anchor="middle">${esc(b.k[0])}</text><text class="b-lab" x="${x + bw / 2}" y="${H - 16}" text-anchor="middle">${esc(b.k[1])}</text>`;
  });
  const desc = "Share of exposed residents within a 30-minute walk of care. " + bars.map((b) => `${b.k.join(" ")}: ${pct(b.v)}`).join(". ") + ".";
  return `<svg class="chart-city" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(desc)}">${s}</svg>`;
}
function dosePanel(m) {
  if (!m.sitingOk) return `<div class="card"><h2 class="card-title">Dose points</h2><p class="empty">Dose point plans were not computed for this city${m.accessOk ? "" : ": road data unavailable"}.</p></div>`;
  const feats = (m.dose.features || []).map((f) => f.properties || {});
  const perPlan = feats.some((p) => p.rank_in_plan != null && typeof p.rank_in_plan === "object");
  const ks = ["3", "5", "8"].filter((k) => m.plans[k]);
  const base = (p) => { if (perPlan) { const v = Object.values(p.rank_in_plan || {}).map(Number).filter(Number.isFinite); return v.length ? Math.min(...v) : 99; } return isNum(p.rank) ? +p.rank : 99; };
  const sorted = feats.slice().sort((a, b) => base(a) - base(b));
  const inPlans = (p) => ks.filter((k) => m.plans[k].sites && m.plans[k].sites.includes(p.id));
  let list = "";
  if (sorted.length) {
    const head = perPlan
      ? `<th scope="col" class="l">Dose point</th><th scope="col" class="l">Type</th>${ks.map((k) => `<th scope="col" title="Order in the ${k}-point plan. 1 opens first.">Order, plan of ${k}</th>`).join("")}`
      : `<th scope="col">Order</th><th scope="col" class="l">Dose point</th><th scope="col" class="l">Type</th><th scope="col" class="l">In plan size</th>`;
    const body = sorted.map((p) => {
      const nm = esc(p.name || kindLabel(p.kind) || "Unnamed"), ty = esc(kindLabel(p.kind));
      if (perPlan) return `<tr><td class="l">${nm}</td><td class="l">${ty}</td>${ks.map((k) => { const v = planVal(p.rank_in_plan, k); return `<td>${v != null && isNum(v) ? esc(v) : "-"}</td>`; }).join("")}</tr>`;
      return `<tr><td>${esc(p.rank ?? "")}</td><td class="l">${nm}</td><td class="l">${ty}</td><td class="l">${esc(inPlans(p).join(", ") || "-")}</td></tr>`;
    }).join("");
    list = `<h3 class="card-title" style="margin-top:var(--s3)">Dose points, in order (1 opens first)</h3><p class="caption">${esc(GLOSS)}</p><div class="table-wrap wrapcols"><table class="table"><caption class="sr-only">Dose points in order</caption><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }
  return `<div class="city-grid two">
    <div class="card"><h2 class="card-title">Plans</h2>
      <p class="caption">How many exposed residents each plan size brings within reach.</p>
      <div class="table-wrap wrapcols"><table class="table"><caption class="sr-only">Dose point plans</caption>
      <thead><tr><th scope="col">Plan size</th><th scope="col">Dose points</th><th scope="col">Newly covered</th><th scope="col">Within reach after</th></tr></thead>
      <tbody>${planRows(m)}</tbody></table></div>
      <p class="note">Each plan is optimised separately, so the 5-point plan is not the 3-point plan plus two.</p></div>
    <div class="card"><h2 class="card-title">Share within a 30-minute walk</h2>
      <p class="caption">Exposed residents who can walk to care or a dose point.</p><div class="chart-host" data-chart="cov"></div></div>
    ${list ? `<div class="card wide">${list}</div>` : ""}
  </div>`;
}

const COLS = [
  { key: "priority", label: "Rank (most people cut off from care first)", desc: "Barangays ordered by how many exposed residents are cut off from care. 1 has the most people cut off. The top 10 are marked.", num: true },
  { key: "name", label: "Barangay", desc: "Smallest administrative area.", text: true },
  { key: "pop", label: "Population", desc: "Residents living there.", num: true, cls: "c-pop" },
  { key: "exposed", label: "Exposed residents", desc: "Residents living where a 25-year flood reaches. The bar compares each barangay with the largest one in the city.", num: true },
  { key: "unreached", label: "Cut off from care", desc: "Exposed residents more than a 30-minute walk from a clinic while the flood is on.", num: true },
  { key: "fshare", label: "Flooded share", desc: "Share of the barangay's area under water.", num: true, cls: "c-extra" },
  { key: "capsules", label: "Capsules per week", desc: "Doxycycline capsules needed each flood week.", num: true, cls: "c-extra" },
];
function cell(c, r, ctx) {
  const v = r[c.key], k = c.cls ? ` class="${c.cls}"` : "";
  if (c.key === "priority") return `<td><span class="num">${fmt(v)}</span>${ctx.n > 10 && v != null && v <= 10 ? '<span class="top10">Top 10</span>' : ""}</td>`;
  if (c.key === "exposed") return `<td class="has-bar"><span class="num">${fmt(v)}</span>${bar(ctx.maxExposed > 0 ? v / ctx.maxExposed : 0)}</td>`;
  if (c.key === "name") return `<td class="l">${esc(v)}</td>`;
  if (c.key === "fshare") return `<td${k}>${pct(v)}</td>`;
  return `<td${k}>${v == null ? '<span title="Not computed">n/a</span>' : fmt(v)}</td>`;
}
function barangayPanel(m, panel, code) {
  panel.innerHTML = `<div class="card"><h2 class="card-title">Barangays, most people cut off from care first</h2>
    <p class="caption">${esc(RANK_NOTE)} Sort any column. Search by barangay name.</p>
    <div class="table-tools"><div style="flex:1;min-width:200px"><label class="sr-only" for="brgy-q">Search barangays</label><input id="brgy-q" class="field" type="search" placeholder="Search barangays" autocomplete="off"></div>
    <button type="button" class="btn ghost sm" id="brgy-more" aria-expanded="false">More columns</button>
    <button type="button" class="btn btn-primary sm" id="brgy-csv">Download CSV</button></div>
    <div class="table-wrap flat" id="brgy-wrap"><table class="table brgy" id="brgy-t"><caption class="sr-only">Barangays ranked by residents cut off from care</caption>
    <thead><tr>${COLS.map((c) => ({ ...c, desc: c.desc.replace("25-year", scn(m.meta).label) })).map((c) => `<th scope="col" data-k="${c.key}" class="${[c.text ? "l" : "", c.cls || ""].join(" ").trim()}" aria-sort="none" title="${esc(c.desc)}"><button type="button">${esc(c.label)}</button></th>`).join("")}</tr></thead><tbody></tbody></table></div>
    <div class="empty-state" id="brgy-empty" hidden><p></p><button type="button" class="btn ghost sm" id="brgy-clear">Clear search</button></div>
    <p class="note" id="brgy-count" role="status"></p>
    <ul class="col-key">${COLS.map((c) => `<li><strong>${esc(c.label)}.</strong> ${esc(c.desc.replace("25-year", scn(m.meta).label))}</li>`).join("")}</ul></div>`;
  const tbody = panel.querySelector("tbody"), q = panel.querySelector("#brgy-q"), count = panel.querySelector("#brgy-count");
  const wrap = panel.querySelector("#brgy-wrap"), table = panel.querySelector("#brgy-t"), empty = panel.querySelector("#brgy-empty");
  let sortKey = "priority", dir = 1;
  const ctx = { n: m.rows.length, maxExposed: Math.max(0, ...m.rows.map((r) => r.exposed || 0)) };
  const moreBtn = panel.querySelector("#brgy-more");
  // Sideways scroll only when the extra columns do not fit; otherwise the page scrolls and the header stays sticky.
  const fit = () => { wrap.classList.remove("scroll-x"); if (table.scrollWidth > wrap.clientWidth + 1) wrap.classList.add("scroll-x"); };
  window.addEventListener("resize", fit);
  cleanup.push(() => window.removeEventListener("resize", fit));
  moreBtn.addEventListener("click", () => {
    const on = !table.classList.contains("show-more");
    table.classList.toggle("show-more", on);
    fit();
    moreBtn.setAttribute("aria-expanded", on);
    moreBtn.textContent = on ? "Fewer columns" : "More columns";
  });
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
    tbody.innerHTML = list.map((r) => `<tr>${COLS.map((c) => cell(c, r, ctx)).join("")}</tr>`).join("");
    wrap.hidden = !list.length;
    empty.hidden = !!list.length;
    if (!list.length) empty.querySelector("p").textContent = `No barangay matches "${q.value.trim()}". Check the spelling or clear the search.`;
    count.textContent = `Showing ${list.length} of ${m.rows.length} barangays.`;
    panel.querySelectorAll("th[data-k]").forEach((th) => th.setAttribute("aria-sort", th.dataset.k === sortKey ? (dir === 1 ? "ascending" : "descending") : "none"));
  };
  panel.querySelectorAll("th[data-k] button").forEach((b) => b.addEventListener("click", () => {
    const k = b.parentElement.dataset.k;
    if (k === sortKey) dir = -dir; else { sortKey = k; dir = k === "name" || k === "priority" ? 1 : -1; }
    draw();
  }));
  q.addEventListener("input", draw);
  panel.querySelector("#brgy-clear").addEventListener("click", () => { q.value = ""; draw(); q.focus(); });
  panel.querySelector("#brgy-csv").addEventListener("click", () => {
    const head = ["rank_most_cut_off_first", "barangay", "population", "exposed", "out_of_reach_in_flood", "flooded_share", "capsules_per_week"];
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

function lineChart(series, years, W) {
  W = Math.max(280, Math.round(W));
  const H = 320, L = 40, R = 12, T = 16, B = W >= 420 ? 56 : 40, n = series.length;
  const mx = Math.max(2, Math.ceil(Math.max(...series.map((d) => Math.max(d.actual, d.rain, d.seasonal)))));
  const X = (i) => L + ((W - L - R) * i) / Math.max(1, n - 1), Y = (v) => T + (H - T - B) * (1 - v / mx);
  let s = "";
  const stepY = mx > 10 ? 2 : 1;
  for (let g = 0; g <= mx; g += stepY) s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(g)}" y2="${Y(g)}"/><text x="${L - 8}" y="${Y(g) + 4}" text-anchor="end">${g}</text>`;
  const seen = {};
  series.forEach((d, i) => { const y = d.week.slice(0, 4); if (!seen[y]) { seen[y] = 1; s += `<line class="grid" x1="${X(i)}" x2="${X(i)}" y1="${T}" y2="${H - B}"/><text x="${X(i) + 4}" y="${H - B + 16}">${y}</text>`; } });
  const pl = (key, cls) => `<polyline class="${cls}" points="${series.map((d, i) => X(i).toFixed(1) + "," + Y(d[key]).toFixed(1)).join(" ")}"/>`;
  s += pl("seasonal", "l-seas") + pl("rain", "l-rain") + pl("actual", "l-actual");
  if (W >= 420) {
    s += `<text class="axis-title" transform="translate(12 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle">Cases per week</text>`;
    s += `<text class="axis-title" x="${(L + W - R) / 2}" y="${H - 8}" text-anchor="middle">Week, ${years[0]} to ${years[1]}</text>`;
  }
  return `<svg class="chart-city" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(lineDesc(series))}">${s}</svg>`;
}
function lineDesc(series) {
  const n = series.length;
  const tot = series.reduce((t, d) => t + d.actual, 0);
  const peak = series.reduce((b, d) => (d.actual > b.actual ? d : b), series[0]);
  return `Weekly leptospirosis cases from ${series[0].week} to ${series[n - 1].week}. Actual cases total ${tot}, peaking at ${peak.actual} in the week of ${peak.week}.`;
}
const oneIn = (v) => (isNum(v) && v > 0 ? Math.max(1, Math.round(1 / +v)) : null);
function verdict(a) {
  const n = oneIn(a.caught);
  if (!n || !isNum(a.falseA)) return "";
  const yrs = `${a.years[0]} to ${a.years[1]}`;
  const fa = a.falseA <= 0.1 ? "and rarely raised a false alarm" : `but ${pct(a.falseA)} of quiet weeks raised a false alarm`;
  const b = oneIn(a.bCaught);
  const base = b ? ` A simple seasonal guess caught about 1 in ${b}.` : "";
  return `In ${yrs} it caught about 1 in ${n} outbreak weeks ${fa}.${base}`;
}
// Gold-marked weeks: the weeks the rain model scored highest. The test reports how many alerts it raised, so that many.
function firedWeeks(series, a) {
  if (!a.alerts || !series) return new Set();
  const idx = series.map((d, i) => [d.rain, i]).sort((x, y) => y[0] - x[0]).slice(0, a.alerts).map((x) => x[1]);
  return new Set(idx);
}
function barChart(series, fired, years, W) {
  W = Math.max(280, Math.round(W));
  const H = 280, L = 36, R = 8, T = 18, B = 34, n = series.length;
  const mx = Math.max(2, Math.ceil(Math.max(...series.map((d) => d.actual))));
  const slot = (W - L - R) / n, bw = Math.max(1.5, slot * 0.7);
  const Y = (v) => T + (H - T - B) * (1 - v / mx);
  let s = "";
  const stepY = mx > 10 ? 2 : 1;
  for (let g = 0; g <= mx; g += stepY) s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(g)}" y2="${Y(g)}"/><text x="${L - 6}" y="${Y(g) + 4}" text-anchor="end">${g}</text>`;
  fired.forEach((i) => { s += `<rect class="band" x="${(L + slot * i - slot * 0.15).toFixed(1)}" y="${T}" width="${Math.max(3, slot).toFixed(1)}" height="${H - T - B}"/>`; });
  series.forEach((d, i) => { if (d.actual > 0) s += `<rect class="cbar" x="${(L + slot * i + (slot - bw) / 2).toFixed(1)}" y="${Y(d.actual).toFixed(1)}" width="${bw.toFixed(1)}" height="${(Y(0) - Y(d.actual)).toFixed(1)}"/>`; });
  fired.forEach((i) => { s += `<rect class="tick" x="${(L + slot * i - slot * 0.15).toFixed(1)}" y="${T - 12}" width="${Math.max(3, slot).toFixed(1)}" height="8" rx="1.5"/>`; });
  const seen = {};
  series.forEach((d, i) => { const y = d.week.slice(0, 4); if (!seen[y]) { seen[y] = 1; s += `<line class="grid" x1="${L + slot * i}" x2="${L + slot * i}" y1="${T}" y2="${H - B}"/><text x="${L + slot * i + 4}" y="${H - B + 16}">${y}</text>`; } });
  s += `<text class="axis-title" transform="translate(11 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle">Cases per week</text>`;
  const desc = `${lineDesc(series)} The warning went off in ${fired.size} of these weeks.`;
  return `<svg class="chart-city" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(desc)}">${s}</svg>`;
}
const METHOD_LABEL = { rain_model: "Rain warning", seasonal: "Seasonal average", last_week: "Last week's cases" };
function alertPanel(m) {
  const a = m.alert, c = m.meta;
  if (a.status !== "evaluated") {
    const n = c.lepto_cases_2008_2022;
    return `<div class="card"><h2 class="card-title">Rain warning</h2><p>${a.status === "too_few_cases" ? "Too few cases to test a rain warning for this city" : "The rain warning was not tested for this city"}${isNum(n) ? `: only ${fmt(n)} leptospirosis cases were reported from 2008 to 2022` : ""}. Any score would be noise, so none is shown.</p></div>`;
  }
  const yrs = `${a.years[0]} to ${a.years[1]}`;
  const hasSeries = m.series && m.series.length > 1;
  const v = verdict(a);
  const fired = hasSeries ? firedWeeks(m.series, a) : new Set();
  const chart = hasSeries
    ? `<div class="chart-host" data-chart="bars"></div>
       <ul class="legend"><li><span class="sw cases"></span>Blue bars: cases reported each week</li>${fired.size ? '<li><span class="sw gold"></span>Gold: weeks the warning went off</li>' : ""}</ul>`
    : `<p class="empty">The weekly series is not available for this city.</p>`;
  const rows = a.all
    ? a.all.map((r) => `<tr><th scope="row" class="l">${esc(METHOD_LABEL[r.method] || r.method)}</th><td>${dec(r.correlation)}</td><td>${dec(r.mae)}</td><td>${pct(r.sensitivity)}</td><td>${pct(r.false_alert_rate)}</td></tr>`).join("")
    : `<tr><th scope="row" class="l">Rain warning</th><td>${dec(a.corr)}</td><td>${dec(a.mae)}</td><td>${pct(a.caught)}</td><td>${pct(a.falseA)}</td></tr>${isNum(a.bCorr) ? `<tr><th scope="row" class="l">Seasonal average</th><td>${dec(a.bCorr)}</td><td>${dec(a.bMae)}</td><td>${pct(a.bCaught)}</td><td>${pct(a.bFalse)}</td></tr>` : ""}`;
  const tech = `<details class="rd-details city-tech"><summary>Technical details</summary>
    <div class="table-wrap"><table class="table"><caption class="sr-only">Rain warning compared with simple guesses, test years ${yrs}</caption>
      <thead><tr><th scope="col" class="l">Method</th><th scope="col">Correlation</th><th scope="col">MAE (cases per week)</th><th scope="col">Outbreak weeks caught</th><th scope="col">False alarms</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <p class="note">Correlation: how closely the forecast follows weekly cases, 1 is a perfect match. MAE: the average miss in cases per week, lower is better. False alarms: share of quiet weeks that still raised a warning. ${a.outbreakWeeks ? `The test years held ${a.outbreakWeeks} outbreak weeks. ` : ""}${fired.size ? `Gold weeks are the ${fired.size} weeks with the highest rain-model score, matching the ${a.alerts} alerts the test counted. ` : ""}The model learned from ${a.trainYears[0]} to ${a.trainYears[1]} and was tested on ${yrs}, years it had never seen. Case records run to 2022, but the test stops at ${a.years[1]}.</p>
    ${hasSeries ? `<h3 class="card-title" style="margin-top:var(--s2)">Cases and both forecasts</h3><div class="chart-host" data-chart="line"></div>
      <ul class="legend"><li><span class="ln"></span>Actual cases</li><li><span class="ln rain"></span>Rain model</li><li><span class="ln seas"></span>Seasonal average (dashed)</li></ul>` : ""}
  </details>`;
  return `<div class="card warn-story">
    <h2 class="card-title">Rain warning</h2>
    <p class="test-label"><span class="badge badge-neutral">Test on past data (${yrs}), not a live warning</span></p>
    <p class="warn-lead">Leptospirosis cases rise 2 to 4 weeks after heavy rain. This warning uses past weeks' rain to say, two weeks ahead, when a hospital should get ready.</p>
    ${chart}
    ${v ? `<p class="verdict-line">${esc(v)}</p>` : ""}
    <p class="warn-do"><b>What a hospital would do:</b> stock doxycycline and alert the ER staff.</p>
    ${tech}
  </div>`;
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
      <div><p class="eyebrow">City dashboard</p><h1>${esc(c.name)}</h1><p class="sub">${esc(place)}</p><p class="scn-line">Figures are for a ${scn(c).label} flood.${scn(c).note ? " " + esc(scn(c).note) : ""}</p></div>
      <div class="city-tools">
        <div class="city-switch"><label for="city-sel">Switch city</label><select id="city-sel" class="field">${opts}</select></div>
        <a class="btn ghost sm" href="#/map/${esc(c.code)}">Open on map</a>
      </div>
    </header>
    <div class="tabs" role="tablist" aria-label="City sections"><span class="tab-ind" aria-hidden="true"></span>${TABS.map(([id, label]) => `<button type="button" role="tab" id="tab-${id}" aria-controls="panel-${id}" aria-selected="false" tabindex="-1" data-tab="${id}" data-label="${esc(label)}">${label}</button>`).join("")}</div>
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
  const ind = el.querySelector(".tab-ind");
  const tabsBox = el.querySelector(".tabs");
  let cur = null;
  const placeInd = (animate) => {
    const t = tabEls.find((x) => x.dataset.tab === cur);
    if (!t || !t.offsetWidth) return;
    const instant = !animate || reducedMotion();
    if (instant) ind.style.transition = "none";
    ind.style.width = t.offsetWidth + "px";
    ind.style.transform = `translateX(${t.offsetLeft}px)`;
    if (instant) { void ind.offsetWidth; ind.style.transition = ""; }
  };
  const show = (id, focus) => {
    const prev = cur ? TABS.findIndex(([x]) => x === cur) : -1;
    const next = TABS.findIndex(([x]) => x === id);
    cur = id;
    tabEls.forEach((t) => { const on = t.dataset.tab === id; t.setAttribute("aria-selected", on); t.tabIndex = on ? 0 : -1; if (on && focus) t.focus(); });
    TABS.forEach(([pid]) => {
      const p = el.querySelector("#panel-" + pid);
      p.classList.remove("slide-r", "slide-l");
      p.hidden = pid !== id;
      if (pid === id && prev !== -1 && prev !== next && !reducedMotion()) {
        void p.offsetWidth;
        p.classList.add(next > prev ? "slide-r" : "slide-l");
      }
    });
    placeInd(prev !== -1);
    fadeCue();
    const act = tabEls.find((t) => t.dataset.tab === id);
    if (act && tabsBox.scrollWidth > tabsBox.clientWidth) act.scrollIntoView({ inline: "nearest", block: "nearest" });
  };
  // Fade cue on the tab strip when it scrolls sideways (phones).
  const fadeCue = () => {
    const sc = tabsBox.scrollWidth - tabsBox.clientWidth;
    tabsBox.classList.toggle("fade-r", sc > 2 && tabsBox.scrollLeft < sc - 2);
    tabsBox.classList.toggle("fade-l", sc > 2 && tabsBox.scrollLeft > 2);
  };
  tabsBox.addEventListener("scroll", fadeCue, { passive: true });
  // Charts draw at their real pixel width so axis text stays readable on phones.
  const drawers = {
    cov: (w) => covChart(m, w),
    line: (w) => lineChart(m.series, m.alert.years, w),
    bars: (w) => barChart(m.series, firedWeeks(m.series, m.alert), m.alert.years, w),
  };
  const ros = [];
  el.querySelectorAll(".chart-host").forEach((host) => {
    let last = 0;
    const ro = new ResizeObserver(() => {
      const w = Math.floor(host.clientWidth);
      if (!w || w === last) return;
      last = w;
      host.innerHTML = drawers[host.dataset.chart](w);
    });
    ro.observe(host);
    ros.push(ro);
  });
  cleanup.push(() => ros.forEach((r) => r.disconnect()));
  const onResize = () => { placeInd(false); fadeCue(); };
  window.addEventListener("resize", onResize);
  cleanup.push(() => window.removeEventListener("resize", onResize));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { placeInd(false); fadeCue(); });
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
