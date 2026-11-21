// Planner: the data behind the health-officer features (pick counts, range, exclude a site, flood switch).
// Pure functions plus one fetch helper. Nothing here touches the DOM, so it also runs in Node for checks.
//
// A planner file describes "points" (exposed residents NOT reached by clinics during the flood, with a weight each)
// and "candidates" (sites, each listing the point indices it reaches). A plan is a set of k candidates;
// its value is the summed weight of the points in the union of their reach.

import { DATA } from "./config.js";

export const SCENARIOS = ["5", "25", "100"];
// Which flood scenarios have a planner file, per city (web/data/planner_index.json, written by
// scripts/export_planner.py). A city without an entry skips the planner fetch, so the console stays clean.
let indexP = null;
export function plannerScenarios(code) {
  if (!indexP) indexP = fetch(`${DATA}/planner_index.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return indexP.then((idx) => (Array.isArray(idx[code]) ? idx[code] : []));
}

const cache = new Map();
/** Fetches planner_<scn>yr.json for a city. Resolves to null when the file is missing or malformed. Cached. */
export function loadPlanner(code, scn) {
  const key = code + "|" + scn;
  if (!cache.has(key)) {
    cache.set(key, (async () => {
      try {
        const r = await fetch(`${DATA}/${code}/planner_${scn}yr.json`);
        if (!r.ok) return null;
        const d = await r.json();
        return d && d.points && Array.isArray(d.candidates) && d.plans ? index(d) : null;
      } catch { return null; }
    })());
  }
  return cache.get(key);
}

// Add lookups once, so the UI and the solver do not rebuild them.
function index(d) {
  d.byId = {};
  d.candidates.forEach((c, i) => { c._i = i; d.byId[c.id] = c; });
  d.totalW = d.points.w.reduce((t, x) => t + x, 0);
  return d;
}

/** Share of exposed residents within reach, given the newly covered weight. Same denominator as the published plans. */
export const shareOf = (d, newly) => (d.clinic_reach + newly) / d.exposed_on_network;
export const clinicShare = (d) => d.clinic_reach / d.exposed_on_network;

// Weight covered by a set of candidate indices. `covered` is scratch space of length = number of points.
function coverWeight(d, idxs, covered) {
  covered.fill(0);
  let t = 0;
  const w = d.points.w;
  for (const i of idxs) for (const p of d.candidates[i].reach) if (!covered[p]) { covered[p] = 1; t += w[p]; }
  return t;
}

const EPS = 1e-7;

// Drop candidates that add nothing new: an empty reach, or the same reach as a later candidate.
function reduce(d, pool) {
  const key = (i) => d.candidates[i].reach.join(",");
  const last = new Map();
  pool.forEach((i) => { if (d.candidates[i].reach.length) last.set(key(i), i); });
  return pool.filter((i) => last.get(key(i)) === i);
}

/**
 * Best k candidates (ids) by covered weight, leaving out `excluded` (a Set of ids).
 * 1. Greedy: add the site with the largest marginal gain (ties go to the later candidate).
 * 2. 1-swap local search: swap one chosen site for one unchosen site while that raises the covered weight.
 * 3. Branch and bound from that start, to prove it is the best or find a better set. Among sets with the same covered
 *    weight, the one that keeps the most sites of the published plan wins (so excluding a site changes the plan as little
 *    as possible), then the one with the later candidates. Without this, equally good sets are an arbitrary choice. Greedy and 1-swap alone can stop
 *    short of the best plan (the published 7-site plan is one such case); the bound makes this exact and still fast
 *    (the pool is the usable sites with duplicates dropped). A node cap keeps the page responsive on very large inputs.
 */
export function solve(d, k, excluded = new Set()) {
  const all = [];
  d.candidates.forEach((c, i) => { if (!excluded.has(c.id)) all.push(i); });
  const pool = reduce(d, all);
  const n = d.points.w.length, w = d.points.w, covered = new Uint8Array(n);
  const want = Math.min(k, pool.length);
  const chosen = [];
  // 1. greedy
  while (chosen.length < want) {
    let best = -1, bestGain = -1;
    for (const i of pool) {
      if (chosen.includes(i)) continue;
      let g = 0;
      for (const p of d.candidates[i].reach) if (!covered[p]) g += w[p];
      if (g >= bestGain - EPS) { bestGain = g; best = i; }
    }
    if (best < 0) break;
    chosen.push(best);
    for (const p of d.candidates[best].reach) covered[p] = 1;
  }
  // 2. 1-swap local search
  const scratch = new Uint8Array(n);
  let cur = coverWeight(d, chosen, scratch), improved = true, guard = 0;
  while (improved && guard++ < 200) {
    improved = false;
    for (let a = 0; a < chosen.length && !improved; a++) {
      for (const j of pool) {
        if (chosen.includes(j)) continue;
        const trial = chosen.slice(); trial[a] = j;
        const v = coverWeight(d, trial, scratch);
        if (v > cur + EPS) { chosen[a] = j; cur = v; improved = true; break; }
      }
    }
  }
  // 3. branch and bound; a set replaces the incumbent when it is better, or equal with later candidates
  let best = chosen.slice(), bestV = cur, nodes = 0;
  // Sites with the same reach are interchangeable, so compare plans by reach, not by id.
  const rk = (i) => d.candidates[i].reach.join(",");
  const pubIds = (d.plans[String(k)] || {}).sites || [];
  const keep = new Set(pubIds.map((id) => d.byId[id]).filter(Boolean).map((c) => rk(c._i)));
  const overlap = (a) => a.filter((i) => keep.has(rk(i))).length;
  const later = (a, b) => { const oa = overlap(a), ob = overlap(b); if (oa !== ob) return oa > ob; const x = a.slice().sort((p, q) => q - p), y = b.slice().sort((p, q) => q - p); for (let t = 0; t < x.length; t++) if (x[t] !== y[t]) return x[t] > y[t]; return false; };
  const order = pool.slice().sort((x, y) => d.candidates[y].reach.reduce((t, p) => t + w[p], 0) - d.candidates[x].reach.reduce((t, p) => t + w[p], 0));
  const cov = new Uint8Array(n), stack = [];
  (function go(start, v) {
    if (nodes++ > 400000) return;
    const left = want - stack.length;
    if (left === 0) { if (v > bestV + EPS || (v > bestV - EPS && later(stack, best))) { bestV = Math.max(bestV, v); best = stack.slice(); } return; }
    const gains = [];
    for (let t = start; t < order.length; t++) {
      let g = 0;
      for (const p of d.candidates[order[t]].reach) if (!cov[p]) g += w[p];
      gains.push(g);
    }
    if (order.length - start < left) return;
    const top = gains.slice().sort((x, y) => y - x).slice(0, left).reduce((t, x) => t + x, 0);
    if (v + top < bestV - EPS) return;
    for (let t = start; t < order.length; t++) {
      const g = gains[t - start];
      const c = d.candidates[order[t]], newly = [];
      for (const p of c.reach) if (!cov[p]) { cov[p] = 1; newly.push(p); }
      stack.push(order[t]);
      go(t + 1, v + g);
      stack.pop();
      for (const p of newly) cov[p] = 0;
    }
  })(0, 0);
  // Among interchangeable sites, show the one the published plan uses (unless it was excluded).
  const twin = new Map(pubIds.filter((id) => d.byId[id] && !excluded.has(id)).map((id) => [rk(d.byId[id]._i), id]));
  const out = [];
  best.forEach((i) => { const t = twin.get(rk(i)); out.push(t && !out.includes(t) ? t : d.candidates[i].id); });
  return out;
}

/**
 * Order sites largest gain first and work out what each one adds.
 * Returns rows [{id, newly, serves:[{pcode, residents}]}] and the total newly covered weight.
 * serves lists the barangays of the points this site reaches that no earlier site reached.
 */
export function evaluate(d, ids) {
  const w = d.points.w, pc = d.points.pcode, covered = new Uint8Array(w.length);
  const left = ids.map((id) => d.byId[id]).filter(Boolean);
  const rows = [];
  while (left.length) {
    let bi = 0, bg = -1;
    left.forEach((c, i) => {
      let g = 0;
      for (const p of c.reach) if (!covered[p]) g += w[p];
      if (g > bg + EPS) { bg = g; bi = i; }
    });
    const c = left.splice(bi, 1)[0], by = new Map();
    let newly = 0;
    for (const p of c.reach) if (!covered[p]) { covered[p] = 1; newly += w[p]; by.set(pc[p], (by.get(pc[p]) || 0) + w[p]); }
    rows.push({ id: c.id, newly, serves: [...by].map(([pcode, residents]) => ({ pcode, residents })).sort((a, b) => b.residents - a.residents) });
  }
  return { rows, newly: rows.reduce((t, r) => t + r.newly, 0), covered };
}

/**
 * The plan for k sites. Without exclusions it is the published optimum (plans[k]). With exclusions it is solved here,
 * unless no excluded site is in the published plan (then the published plan is still the best one).
 * Returns { rows, newly, share, changed, uncovered: Map pcode -> weight still out of reach }.
 */
export function planFor(d, k, excluded = new Set()) {
  if (+k === 0) {  // no dose points: clinics alone
    const unc = new Map();
    d.points.pcode.forEach((p, i) => unc.set(p, (unc.get(p) || 0) + d.points.w[i]));
    return { rows: [], newly: 0, share: clinicShare(d), changed: false, uncovered: unc };
  }
  const pub = d.plans[String(k)];
  const hit = pub && pub.sites.some((id) => excluded.has(id));
  const ids = pub && !hit ? pub.sites : solve(d, k, excluded);
  const ev = evaluate(d, ids);
  const unc = new Map();
  d.points.pcode.forEach((p, i) => { if (!ev.covered[i]) unc.set(p, (unc.get(p) || 0) + d.points.w[i]); });
  // published share when it is the published plan, else recomputed from the covered weight
  const share = pub && !hit ? pub.share : shareOf(d, ev.newly);
  return { rows: ev.rows, newly: ev.newly, share, changed: !!hit, uncovered: unc };
}

/** Range text pieces from uncertainty.share[k]: whole percents, low to high. Null when there is no range. */
export function rangeOf(d, k) {
  const r = d.uncertainty && d.uncertainty.share && d.uncertainty.share[String(k)];
  if (!r || r.p05 == null || r.p95 == null) return null;
  return { lo: Math.round(r.p05 * 100), hi: Math.round(r.p95 * 100) };
}

/** In how many of the simulated floods was this site one of the best k. */
export const pickCount = (d, k, id) => {
  const m = d.uncertainty && d.uncertainty.pick && d.uncertainty.pick[String(k)];
  return m && m[id] ? m[id] : 0;
};
