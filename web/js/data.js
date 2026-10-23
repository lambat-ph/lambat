// Data adapter. Reads the per-city layout (cities.json, data/<code>/...) and
// falls back to the flat Dagupan files, so the app works with either.
import { DATA, FLAT_CITY } from "./config.js";

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + " " + r.status);
  return r.json();
}
// manifest.json lists the files that exist. When it is the old flat list, skip
// probing for the per-city layout so the console stays free of 404 noise.
let manifest;
async function listed(url) {
  if (manifest === undefined) {
    try { const r = await fetch(`${DATA}/manifest.json`); manifest = r.ok ? await r.json() : null; } catch { manifest = null; }
  }
  const f = manifest && Array.isArray(manifest.files) ? manifest.files : null;
  if (!f || f.includes("cities.json") || f.some((x) => x.includes("/"))) return true;
  return f.includes(url.slice(DATA.length + 1));
}
async function tryJSON(url) {
  if (!(await listed(url))) return null;
  try { return await getJSON(url); } catch { return null; }
}
async function tryText(url) {
  if (!(await listed(url))) return null;
  try {
    const r = await fetch(url);
    return r.ok ? await r.text() : null;
  } catch { return null; }
}
const memo = new Map();
const once = (k, fn) => { if (!memo.has(k)) memo.set(k, fn()); return memo.get(k); };

const num = (v) => (v == null || v === "" || Number.isNaN(+v) ? null : +v);
const share = (v) => { const n = num(v); return n == null ? null : n > 1 ? n / 100 : n; };

export function bboxOf(gj) {
  let w = 180, s = 90, e = -180, n = -90;
  const walk = (c) => {
    if (typeof c[0] === "number") { w = Math.min(w, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1]); n = Math.max(n, c[1]); }
    else c.forEach(walk);
  };
  (gj.features || []).forEach((f) => walk(f.geometry.coordinates));
  return [w, s, e, n];
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const head = lines.shift().split(",");
  return lines.map((l) => {
    const c = l.split(","); const o = {};
    head.forEach((h, i) => { o[h] = c[i]; });
    return o;
  });
}

function planCoverage(summary) {
  if (!summary || !summary.dose_point_plans) return null;
  const out = {};
  for (const k of ["3", "5", "8"]) {
    const p = summary.dose_point_plans[k];
    if (p) out[k] = share(p.share_of_exposed_within_reach_after);
  }
  return out;
}

function normAlertFromScores(scores) {
  if (!scores || !scores.scores) return null;
  const by = {};
  scores.scores.forEach((s) => { by[s.method] = s; });
  return {
    status: "evaluated",
    testYears: scores.test_years,
    threshold: scores.outbreak_threshold,
    horizon: scores.horizon_weeks,
    rain: by.rain_model || null,
    seasonal: by.seasonal || null,
    lastWeek: by.last_week || null,
  };
}

function normCity(c) {
  const a = c.alert || {};
  return {
    ...c,
    lon: num(c.lon), lat: num(c.lat),
    barangays: num(c.barangays), population: num(c.population), exposed: num(c.exposed),
    exposed_share: share(c.exposed_share) ?? (num(c.population) ? num(c.exposed) / num(c.population) : null),
    weekly_capsules: num(c.weekly_capsules),
    lepto_cases_2008_2022: num(c.lepto_cases_2008_2022),
    access_gap: num(c.access_gap),
    coverage_after: c.coverage_after ? { 3: share(c.coverage_after["3"]), 5: share(c.coverage_after["5"]), 8: share(c.coverage_after["8"]) } : null,
    alert: {
      status: a.status || null,
      correlation: num(a.correlation),
      caught: share(a.caught),
      false_alerts: share(a.false_alerts),
      baseline_correlation: num(a.baseline_correlation),
    },
  };
}

async function loadFlat() {
  return once("flat", async () => {
    const [bar, dose, sum, sc, csv] = await Promise.all([
      tryJSON(`${DATA}/barangays_25yr.geojson`),
      tryJSON(`${DATA}/dose_points_25yr.geojson`),
      tryJSON(`${DATA}/summary_25yr.json`),
      tryJSON(`${DATA}/alert_scores_dagupan.json`),
      tryText(`${DATA}/alert_predictions_dagupan.csv`),
    ]);
    if (!bar || !sum) return null;
    return { bar, dose, sum, sc, csv };
  });
}

function flatMeta(flat) {
  const bb = bboxOf(flat.bar);
  const al = normAlertFromScores(flat.sc);
  const cov = planCoverage(flat.sum);
  return normCity({
    ...FLAT_CITY,
    lon: (bb[0] + bb[2]) / 2, lat: (bb[1] + bb[3]) / 2, bbox: bb,
    barangays: flat.bar.features.length,
    population: flat.sum.population, exposed: flat.sum.exposed,
    exposed_share: flat.sum.exposed / flat.sum.population,
    weekly_capsules: flat.sum.weekly_capsules,
    lepto_cases_2008_2022: null,
    access_gap: flat.sum.exposed_access_gap,
    coverage_after: cov,
    alert: al ? { status: "evaluated", correlation: al.rain.correlation, caught: al.rain.sensitivity, false_alerts: al.rain.false_alert_rate, baseline_correlation: al.seasonal.correlation } : {},
  });
}

export function getCities() {
  return once("cities", async () => {
    const raw = await tryJSON(`${DATA}/cities.json`);
    const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.cities) ? raw.cities : null;
    if (list && list.length) {
      return list.map(normCity).sort((a, b) => (b.exposed || 0) - (a.exposed || 0));
    }
    const flat = await loadFlat();
    return flat ? [flatMeta(flat)] : [];
  });
}

export function getNational() {
  return once("national", async () => {
    const raw = await tryJSON(`${DATA}/national.json`);
    const cities = await getCities();
    const pick = (keys) => { for (const k of keys) if (raw && num(raw[k]) != null) return num(raw[k]); return null; };
    const sum = (f) => cities.reduce((t, c) => t + (c[f] || 0), 0);
    return {
      raw,
      cities: pick(["cities", "n_cities"]) ?? cities.length,
      barangays: pick(["barangays", "n_barangays"]) ?? sum("barangays"),
      population: pick(["population", "total_population"]) ?? sum("population"),
      exposed: pick(["exposed", "total_exposed", "exposed_total"]) ?? sum("exposed"),
      weekly_capsules: pick(["weekly_capsules", "capsules_per_week", "total_weekly_capsules"]) ?? sum("weekly_capsules"),
      access_gap: pick(["access_gap", "total_access_gap"]),
    };
  });
}

export function rowsOf(gj) {
  const rows = gj.features.map((f) => {
    const p = f.properties;
    return {
      id: p.adm4_pcode, name: p.adm4_en,
      pop: num(p.population), exposed: num(p.exposed) ?? 0,
      share: num(p.flooded_share),
      unreached: num(p.exposed_unreached_flood),
      capsules: num(p.weekly_capsules),
      covered: num(p.exposed_covered_by_dose_points),
      priority: num(p.priority),
    };
  });
  if (rows.some((r) => r.priority == null)) {
    [...rows].sort((a, b) => b.exposed - a.exposed).forEach((r, i) => { r.priority = i + 1; });
  }
  return rows;
}

function loadCityFull(code) {
  return once("city:" + code, async () => {
    const cities = await getCities();
    const meta = cities.find((c) => c.code === code);
    if (!meta) return null;
    const base = `${DATA}/${code}`;
    let [bar, dose, sum, sc, csvText, s1] = await Promise.all([
      tryJSON(`${base}/barangays.geojson`), tryJSON(`${base}/dose_points.geojson`),
      tryJSON(`${base}/summary.json`), tryJSON(`${base}/alert_scores.json`),
      tryText(`${base}/alert_predictions.csv`), tryJSON(`${base}/s1_flood.geojson`),
    ]);
    if (!bar) {
      const flat = code === FLAT_CITY.code ? await loadFlat() : null;
      if (!flat) return { meta, barangays: null, dosePoints: null, summary: null, alertScores: null, alertSeries: null, s1Flood: s1, rows: [], bbox: meta.bbox || null, coverage: null, alert: null, error: "No barangay data for " + meta.name };
      bar = flat.bar; dose = dose || flat.dose; sum = sum || flat.sum; sc = sc || flat.sc; csvText = csvText || flat.csv;
    }
    const rows = rowsOf(bar);
    const bbox = meta.bbox && meta.bbox.length === 4 ? meta.bbox : bboxOf(bar);
    let coverage = null;
    if (sum && sum.exposed_on_road_network) {
      coverage = { dry: sum.exposed_within_reach_dry / sum.exposed_on_road_network, flood: sum.exposed_within_reach_flood / sum.exposed_on_road_network, plans: planCoverage(sum) };
    } else if (meta.coverage_after) coverage = { dry: null, flood: null, plans: meta.coverage_after };
    const series = csvText ? parseCsv(csvText).map((r) => ({ week: r.week, actual: +r.actual, rain_model: +r.rain_model, seasonal: +r.seasonal })) : null;
    let alert = normAlertFromScores(sc);
    if (!alert && meta.alert && meta.alert.status) {
      alert = { status: meta.alert.status, rain: { correlation: meta.alert.correlation, sensitivity: meta.alert.caught, false_alert_rate: meta.alert.false_alerts }, seasonal: { correlation: meta.alert.baseline_correlation } };
    }
    if (alert && meta.alert && meta.alert.status && meta.alert.status !== "evaluated") alert.status = meta.alert.status;
    return { meta, barangays: bar, dosePoints: dose || { type: "FeatureCollection", features: [] }, summary: sum || null, alertScores: sc || null, alertSeries: series, s1Flood: s1 || null,
      // extras: normalised helpers
      rows, bbox, coverage, alert };
  });
}
/** City bundle: {meta, barangays, dosePoints, summary, alertScores, alertSeries, s1Flood, + rows, bbox, coverage, alert}. Optional parts are null. */
export async function getCity(code) { return loadCityFull(code); }


// Route helpers
export const cityHref = (code, tab) => `#/city/${encodeURIComponent(code)}${tab ? "/" + tab : ""}`;
export const mapHref = (code) => `#/map/${encodeURIComponent(code)}`;
export const barangayHref = (id) => `#/barangay/${encodeURIComponent(id)}`;

// Priority groups by rank, in quarters, so a health officer reads words before numbers.
// The rank itself comes from the pipeline: most exposed residents cut off from care first.
const TIERS = [
  { key: "t1", label: "Highest priority", short: "Highest" },
  { key: "t2", label: "High priority", short: "High" },
  { key: "t3", label: "Moderate priority", short: "Moderate" },
  { key: "t4", label: "Lower priority", short: "Lower" },
];
export function tierOf(priority, n) {
  if (priority == null || !n) return null;
  return TIERS[Math.min(3, Math.floor(((priority - 1) / n) * 4))];
}
export const tiers = () => TIERS;

// Every barangay in every city, for search. Small: one city has 31.
let indexP;
export function barangayIndex() {
  if (!indexP) indexP = (async () => {
    const out = [];
    for (const c of await getCities()) {
      const d = await getCity(c.code).catch(() => null);
      if (!d || !d.rows) continue;
      d.rows.forEach((r) => out.push({ id: r.id, name: r.name, city: c.name, cityCode: c.code, priority: r.priority, n: d.rows.length }));
    }
    return out;
  })();
  return indexP;
}
