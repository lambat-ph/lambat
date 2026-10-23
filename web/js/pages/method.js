import { REPO_URL } from "../config.js";
import { skel } from "../format.js";

const CSS_ID = "css-method";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const STEPS = [
  { q: "Where is the water?", s: "Start with the NOAH flood hazard map on day zero. Swap in a Sentinel-1 radar image when one arrives.", m: "NOAH map, then radar (threshold or U-Net)" },
  { q: "Who was in it?", s: "Count the residents living in flooded areas, barangay by barangay.", m: "NOAH x WorldPop" },
  { q: "Who can still walk to care?", s: "Slow or close flooded roads, then see who can reach a clinic in 30 minutes.", m: "OSM roads, 30-minute walk" },
  { q: "Where should dose points go?", s: "Pick 3, 5 or 8 temporary sites that reach the most exposed residents.", m: "Maximal covering model" },
  { q: "Should hospitals get ready?", s: "Rain from the past 2 to 5 weeks flags weeks when more cases are likely.", m: "Rainfall alert, separate clock" },
];

function wrap(text, n) {
  const out = [];
  let line = "";
  for (const w of text.split(" ")) {
    if ((line + " " + w).trim().length > n) { out.push(line); line = w; } else line = (line + " " + w).trim();
  }
  if (line) out.push(line);
  return out;
}
const tspans = (lines, x, y0, lh, cls) => lines.map((l, i) => `<text class="${cls}" x="${x}" y="${y0 + i * lh}">${esc(l)}</text>`).join("");

function pipeline(tall) {
  const desc = STEPS.map((p, i) => `Step ${i + 1}, ${p.q} ${p.s} Method: ${p.m}.`).join(" ");
  let body = "", w, h;
  if (!tall) {
    const bw = 164, gap = 20, bh = 250;
    w = 5 * bw + 4 * gap; h = bh + 8;
    STEPS.forEach((p, i) => {
      const x = i * (bw + gap);
      const ql = wrap(p.q, 19), ml = wrap(p.m, 24);
      body += `<rect class="box" x="${x + 1}" y="4" width="${bw - 2}" height="${bh}" rx="12"/><circle class="num" cx="${x + 28}" cy="34" r="16"/><text class="t-n" x="${x + 28}" y="40" text-anchor="middle">${i + 1}</text>`;
      body += tspans(ql, x + 14, 72, 18, "t-h") + tspans(wrap(p.s, 22), x + 14, 72 + ql.length * 18 + 8, 16, "t-b") + tspans(ml, x + 14, bh - 18 - (ml.length - 1) * 14, 14, "t-m");
      if (i < 4) body += `<path class="arrow" d="M${x + bw + 2} ${bh / 2} h${gap - 8}"/><path class="arrow-h" d="M${x + bw + gap - 6} ${bh / 2 - 5} l6 5 l-6 5z"/>`;
    });
  } else {
    const bw = 340, gap = 22, bh = 124;
    w = bw; h = 5 * bh + 4 * gap + 8;
    STEPS.forEach((p, i) => {
      const y = 4 + i * (bh + gap);
      body += `<rect class="box" x="1" y="${y}" width="${bw - 2}" height="${bh}" rx="12"/><circle class="num" cx="28" cy="${y + 28}" r="16"/><text class="t-n" x="28" y="${y + 34}" text-anchor="middle">${i + 1}</text>`;
      body += `<text class="t-h" x="54" y="${y + 33}">${esc(p.q)}</text>` + tspans(wrap(p.s, 44), 16, y + 58, 16, "t-b") + tspans(wrap(p.m, 54), 16, y + bh - 10, 14, "t-m");
      if (i < 4) body += `<path class="arrow" d="M${bw / 2} ${y + bh + 1} v${gap - 9}"/><path class="arrow-h" d="M${bw / 2 - 5} ${y + bh + gap - 7} l5 6 l5 -6z"/>`;
    });
  }
  const id = tall ? "pt" : "pw";

  return `<svg class="${tall ? "pipe-tall" : "pipe-wide"}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="${id}-t ${id}-d"><title id="${id}-t">LAMBAT pipeline in five steps</title><desc id="${id}-d">${esc(desc)}</desc>${body}</svg>`;
}

// Values read from results/validation_table.csv, outcome events_all, n = 31 barangays.
const FOREST = [
  { n: "Baseline: 25-year flooded share", r: -0.105, lo: -0.484, hi: 0.304, k: "base" },
  { n: "5-year, medium depth", r: 0.327, lo: -0.052, hi: 0.628 },
  { n: "100-year flooded share", r: -0.467, lo: -0.753, hi: -0.113 },
  { n: "Exposed residents, 25-year", r: 0.261, lo: -0.016, hi: 0.485 },
  { n: "Coast proximity", r: 0.095, lo: -0.273, hi: 0.442 },
  { n: "Low elevation", r: -0.529, lo: -0.753, hi: -0.216 },
  { n: "Population density (reference)", r: 0.638, lo: 0.346, hi: 0.828, k: "ref" },
];

function forest() {
  const W = 640, rowH = 34, top = 14, left = 230, right = 20, pw = W - left - right, H = top + FOREST.length * rowH + 44;
  const X = (v) => left + ((v + 1) / 2) * pw;
  let g = "";
  for (const t of [-1, -0.5, 0, 0.5, 1]) g += `<line class="grid" x1="${X(t)}" x2="${X(t)}" y1="${top - 6}" y2="${H - 38}"/><text x="${X(t)}" y="${H - 22}" text-anchor="middle" style="fill:var(--muted)">${t}</text>`;
  g += `<line class="zero" x1="${X(0)}" x2="${X(0)}" y1="${top - 6}" y2="${H - 38}"/>`;
  FOREST.forEach((d, i) => {
    const y = top + i * rowH + rowH / 2;
    g += `<g class="${d.k || ""}"><text class="lbl" x="${left - 12}" y="${y + 4}" text-anchor="end">${esc(d.n)}</text><line class="ci" x1="${X(d.lo)}" x2="${X(d.hi)}" y1="${y}" y2="${y}"/><circle class="dot" cx="${X(d.r)}" cy="${y}" r="${d.k === "base" ? 6 : 4.5}"/></g>`;
  });
  g += `<text x="${left + pw / 2}" y="${H - 4}" text-anchor="middle" style="fill:var(--muted)">Spearman correlation with reported flood events (95% CI)</text>`;
  const desc = "Correlation of each flood ranking with how often a barangay was named in news reports. " + FOREST.map((d) => `${d.n}: ${d.r} (${d.lo} to ${d.hi}).`).join(" ") + " The baseline interval crosses zero.";
  return `<div class="scroll"><svg class="forest" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-labelledby="fp-t fp-d"><title id="fp-t">Forest plot of ranking correlations</title><desc id="fp-d">${esc(desc)}</desc>${g}</svg></div>`;
}

const VAL_ROWS = FOREST.map((d) => `<tr><td class="l">${esc(d.n)}</td><td>${d.r.toFixed(3)}</td><td>${d.lo.toFixed(3)} to ${d.hi.toFixed(3)}</td></tr>`).join("");

const REFS = [
  `Bonafilia, D., Tellman, B., Anderson, T., &amp; Issenberg, E. (2020). Sen1Floods11: A georeferenced dataset to train and test deep learning flood algorithms for Sentinel-1. In <i>2020 IEEE/CVF Conference on Computer Vision and Pattern Recognition Workshops (CVPRW)</i> (pp. 835&ndash;845). IEEE. <a href="https://doi.org/10.1109/CVPRW50498.2020.00113">https://doi.org/10.1109/CVPRW50498.2020.00113</a>`,
  `Church, R., &amp; ReVelle, C. (1974). The maximal covering location problem. <i>Papers of the Regional Science Association, 32</i>(1), 101&ndash;118. <a href="https://doi.org/10.1007/BF01942293">https://doi.org/10.1007/BF01942293</a>`,
  `European Space Agency. (n.d.). <i>Copernicus Sentinel-1 GRD</i> [Data set]. Copernicus Data Space Ecosystem. <a href="https://dataspace.copernicus.eu">https://dataspace.copernicus.eu</a>`,
  `Lagmay, A. M. F. A., Racoma, B. A., Aracan, K. A., Alconis-Ayco, J., &amp; Saddi, I. L. (2017). Disseminating near-real-time hazards information and flood maps in the Philippines through Web-GIS. <i>Journal of Environmental Sciences, 59</i>, 13&ndash;23. <a href="https://doi.org/10.1016/j.jes.2017.03.014">https://doi.org/10.1016/j.jes.2017.03.014</a>`,
  `OpenStreetMap contributors. (n.d.). <i>OpenStreetMap</i> [Map data]. Open Data Commons Open Database License. <a href="https://www.openstreetmap.org">https://www.openstreetmap.org</a>`,
  `Thinking Machines Data Science. (2024). <i>Project CCHAIN dataset: Open validated health, climate, environment, and socioeconomic data in 12 Philippine cities</i> [Data set]. Kaggle. CC BY 4.0. <a href="https://doi.org/10.34740/kaggle/ds/4918229">https://doi.org/10.34740/kaggle/ds/4918229</a>`,
  `University of the Philippines Resilience Institute. (n.d.). <i>UP NOAH hazard maps</i> [Data set]. <a href="https://noah.up.edu.ph">https://noah.up.edu.ph</a>`,
  `Villanueva, R. (2026, September 23). Leptospirosis cases up, dengue down. <i>The Philippine Star</i>. <a href="https://www.philstar.com/nation/2026/09/23/2558155/leptospirosis-cases-up-dengue-down">https://www.philstar.com/nation/2026/09/23/2558155/leptospirosis-cases-up-dengue-down</a>`,
  `WorldPop. (n.d.). <i>WorldPop gridded population estimates</i> [Data set]. <a href="https://www.worldpop.org">https://www.worldpop.org</a>`,
];

const ICON_COPY = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="3" width="8" height="4" rx="1"/><path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2"/></svg>`;
const ICON_CHECK = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;
const copyBtn = (label = "Copy citation") => `<button type="button" class="copy" aria-label="${label}"><span class="copy-ico">${ICON_COPY}</span></button><span class="copy-msg" aria-hidden="true"></span>`;

// Plain-text version of an HTML reference (tags dropped, entities decoded).
const plain = (h) => { const d = document.createElement("div"); d.innerHTML = h; return d.textContent.trim(); };
const REFS_TEXT = REFS.map(plain);

const RUN_CMDS = `uv sync
uv run pytest
uv run python scripts/run_alert.py
uv run python scripts/run_pipeline.py --scenario 25yr
uv sync --extra cv   # optional: PyTorch for the U-Net`;

const html = () => `
<article class="method">
  <header>
    <p class="eyebrow">Method and limits</p>
    <h1>How LAMBAT works, and what it cannot tell you yet</h1>
    <p class="lede">Every step, every check, and every known weakness, in plain language.</p>
  </header>

  <section class="card" aria-labelledby="m-problem">
    <h2 class="card-title" id="m-problem">The problem</h2>
    <p>By 16 September 2026 the Philippines had 10,936 suspected leptospirosis cases, 3,005 more than a year earlier. At about the same time, 3.73 million doxycycline capsules sat in national and regional government warehouses (Villanueva, 2026).</p>
    <p>The medicine exists. The hard part is getting it across floodwater to the people who were exposed.</p>
    <div class="figs">
      <div class="stat"><span class="stat-value">10,936</span><span class="stat-label">suspected cases by Sept 2026</span></div>
      <div class="stat"><span class="stat-value">+3,005</span><span class="stat-label">more than a year earlier</span></div>
      <div class="stat"><span class="stat-value">3.73 million</span><span class="stat-label">capsules in warehouses</span></div>
    </div>
    <p class="sources">Source: Villanueva (2026), The Philippine Star, 23 September 2026.</p>
  </section>

  <section class="card" aria-labelledby="m-how">
    <h2 class="card-title" id="m-how">How LAMBAT works</h2>
    <p class="caption">Five steps. The first four run after a flood. The fifth runs weeks before.</p>
    ${pipeline(false)}${pipeline(true)}
  </section>

  <section class="card" aria-labelledby="m-defs">
    <h2 class="card-title" id="m-defs">Words we use</h2>
    <dl class="defs">
      <div><dt>Exposed</dt><dd>A resident who lives in an area the flood map says was under water.</dd></div>
      <div><dt>Within reach</dt><dd>A resident who can walk to a clinic or hospital in 30 minutes, with flooded roads slowed or closed.</dd></div>
      <div><dt>Access gap</dt><dd>Residents who can reach care on a dry day but not during the flood. This is a hypothesis we test, not a premise. If the gap is zero, the tool still gives exposure and capsule counts for each barangay.</dd></div>
      <div><dt>Dose point</dt><dd>A temporary site, such as a barangay hall, where capsules are handed out after a flood.</dd></div>
    </dl>
    <p>We report residents within reach of care. We never report lives saved.</p>
  </section>

  <section class="card" aria-labelledby="m-val">
    <h2 class="card-title" id="m-val">How we checked it</h2>
    <p>We asked whether barangays that our flood ranking calls flood-prone were named more often in news reports. The reports cover 13 flood events in Dagupan City, and 31 barangays are ranked.</p>
    <div class="figs">
      <div class="stat"><span class="stat-value">-0.10</span><span class="stat-label">Spearman correlation</span></div>
      <div class="stat"><span class="stat-value">-0.48 to 0.30</span><span class="stat-label">95% confidence interval</span></div>
      <div class="stat"><span class="stat-value">0.64</span><span class="stat-label">reports vs population density</span></div>
    </div>
    ${forest()}
    <p class="caption">Each dot is a correlation, each line its 95% interval. A line that crosses the dashed zero line means no detectable agreement. Values from <a href="${REPO_URL}/blob/main/results/validation_table.csv">results/validation_table.csv</a>.</p>
    <details><summary>Show the plot as a table</summary>
      <div class="table-wrap"><table class="table"><caption class="sr-only">Correlation of each ranking with reported flood events</caption><thead><tr><th scope="col" class="l">Ranking</th><th scope="col">Spearman</th><th scope="col">95% CI</th></tr></thead><tbody>${VAL_ROWS}</tbody></table></div>
    </details>
    <ul class="limits">
      <li>We fixed 18 alternative rankings in advance. None is better than ours after correcting for multiple comparisons.</li>
      <li>News reports follow where people live (density correlation 0.64), so they are a weak ruler for flood risk.</li>
      <li>With 31 barangays and 13 events, the data cannot rule out moderate agreement either way.</li>
    </ul>
    <p class="verdict">We cannot confirm the ranking yet. That is not proof it is wrong.</p>
    <p class="sources">Full method and results: <a href="${REPO_URL}/blob/main/docs/validation.md">docs/validation.md</a>.</p>
  </section>

  <section class="card" aria-labelledby="m-limits">
    <h2 class="card-title" id="m-limits">Limits</h2>
    <ul class="limits">
      <li>Case data is weekly, for whole cities, and ends in 2022.</li>
      <li>The rain alert cannot see tidal flooding.</li>
      <li>Access is modelled from maps, not checked on the ground.</li>
      <li>Each dose point assumes a prescriber is present.</li>
      <li>The tool counts places, not patients. Pregnant and lactating women are flagged for referral, and people who were never diagnosed do not appear.</li>
      <li>The radar flood model (a U-Net) was tested on floods in other countries, not in Dagupan.</li>
    </ul>
  </section>

  <section class="card" aria-labelledby="m-refs">
    <h2 class="card-title" id="m-refs">Data and references</h2>
    <div class="refs-bar"><button type="button" class="copy-all">Copy all references</button><span class="copy-msg" aria-hidden="true"></span></div>
    <ul class="refs">${REFS.map((r, i) => `<li data-i="${i}"><span class="ref-text">${r}</span>${copyBtn()}</li>`).join("")}</ul>
  </section>

  <section class="card" aria-labelledby="m-run">
    <h2 class="card-title" id="m-run">Reproduce it</h2>
    <p>You need <a href="https://docs.astral.sh/uv/">uv</a>. Data download steps are in <a href="${REPO_URL}/blob/main/data/README.md">data/README.md</a>.</p>
<div class="codewrap"><pre><code>${esc(RUN_CMDS)}</code></pre>${copyBtn("Copy commands")}</div>
    <p><a class="btn" href="${REPO_URL}">Open the repository</a></p>
  </section>
</article>`;

// Placeholder cards shown until the page stylesheet has arrived.
const ghost = () => `<article aria-busy="true" style="max-width:880px;margin:0 auto;padding:var(--s3) var(--s2);display:flex;flex-direction:column;gap:var(--s3)"><span class="sr-only" role="status">Loading the method page.</span>
  <header aria-hidden="true"><span class="skel skel-line" style="--w:20%"></span><span class="skel skel-big" style="--w:70%"></span></header>
  ${[3, 2, 4].map((n) => `<section class="card" aria-hidden="true"><span class="skel skel-big" style="--w:35%"></span>${skel(n)}</section>`).join("")}</article>`;

async function writeClip(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through */ }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.setAttribute("aria-hidden", "true");
  ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
  document.body.appendChild(ta);
  const prev = document.activeElement;
  ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { ok = false; }
  ta.remove();
  if (prev && prev.focus) prev.focus({ preventScroll: true });
  return ok;
}

const timers = new WeakMap();
function flash(msgEl, live, btn, ok, text) {
  clearTimeout(timers.get(msgEl));
  msgEl.textContent = text;
  msgEl.classList.toggle("fail", !ok);
  msgEl.classList.add("show");
  live.textContent = "";
  setTimeout(() => { live.textContent = text; }, 30);
  const ico = btn.querySelector(".copy-ico");
  if (ico && ok) ico.innerHTML = ICON_CHECK;
  btn.classList.toggle("done", ok);
  timers.set(msgEl, setTimeout(() => {
    msgEl.classList.remove("show");
    if (ico) ico.innerHTML = ICON_COPY;
    btn.classList.remove("done");
  }, ok ? 1500 : 3500));
}

function selectNode(node) {
  const r = document.createRange();
  r.selectNodeContents(node);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

function wire(el) {
  const live = el.querySelector(".copy-live");
  el.addEventListener("click", async (e) => {
    const btn = e.target.closest("button.copy, button.copy-all");
    if (!btn || !el.contains(btn)) return;
    let text, target;
    if (btn.classList.contains("copy-all")) { text = REFS_TEXT.join("\n\n"); target = el.querySelector(".refs"); }
    else if (btn.closest("li[data-i]")) { const li = btn.closest("li[data-i]"); text = REFS_TEXT[+li.dataset.i]; target = li.querySelector(".ref-text"); }
    else { target = btn.closest(".codewrap").querySelector("code"); text = RUN_CMDS; }
    const msg = btn.nextElementSibling;
    const ok = await writeClip(text);
    if (!ok) selectNode(target);
    flash(msg, live, btn, ok, ok ? "Copied" : "Press Ctrl+C");
  });
}

export async function render(el, params) {
  let ready = Promise.resolve();
  if (!document.getElementById(CSS_ID)) {
    const l = document.createElement("link");
    l.id = CSS_ID;
    l.rel = "stylesheet";
    l.href = "css/method.css";
    ready = new Promise((res) => { l.onload = l.onerror = res; setTimeout(res, 3000); });
    document.head.appendChild(l);
    el.innerHTML = ghost();
    await ready;
  }
  el.innerHTML = html() + `<div class="sr-only copy-live" role="status" aria-live="polite"></div>`;
  wire(el);
}

export function destroy() {}
