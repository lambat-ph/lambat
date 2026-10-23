import { REPO_URL } from "../config.js";
import { skel } from "../format.js";

const CSS_ID = "css-method";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const STEPS = [
  { q: "Where is the water?", s: "Start with the NOAH flood hazard map on day zero. Swap in a Sentinel-1 radar image when one arrives.", m: "NOAH map, then radar read by a threshold or a U-Net (an image-reading neural network)" },
  { q: "Who was in it?", s: "Count the residents living in flooded areas, barangay by barangay.", m: "NOAH flood map combined with WorldPop population estimates" },
  { q: "Who can still walk to care?", s: "Slow or close flooded roads, then see who can reach a clinic in 30 minutes.", m: "OpenStreetMap roads, 30-minute walk" },
  { q: "Where should dose points go?", s: "Pick 3, 5 or 8 temporary sites that reach the most exposed residents.", m: "Maximal covering: a method that picks the sites reaching the most people" },
  { q: "Should hospitals get ready?", s: "Rain from the past 2 to 5 weeks flags weeks when more cases are likely.", m: "Rain warning, run on a separate clock" },
];

// The five steps as plain HTML cards: text stays real text, 14px and up, and the row stacks on phones.
function pipeline() {
  return `<ol class="pipe">${STEPS.map((p, i) => `<li><span class="pipe-n" aria-hidden="true">${i + 1}</span><h3>${esc(p.q)}</h3><p>${esc(p.s)}</p><p class="pipe-m"><span class="sr-only">Method: </span>${esc(p.m)}</p></li>`).join("")}</ol>`;
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

const TOC = [
  ["m-glance", "What we know and don't"],
  ["m-problem", "The problem"],
  ["m-how", "How it works"],
  ["m-defs", "Words we use"],
  ["m-val", "How we checked it"],
  ["m-limits", "Limits"],
  ["m-notyet", "Not included yet"],
  ["m-refs", "Data and references"],
  ["m-run", "Reproduce it"],
];

const html = () => `
<article class="method">
  <header>
    <p class="eyebrow">Method and limits</p>
    <h1>How LAMBAT works, and what it cannot tell you yet</h1>
    <p class="lede">Every step, every check, and every known weakness, in plain language.</p>
  </header>

  <nav class="toc card" aria-label="On this page">
    <h2 class="card-title">On this page</h2>
    <ol>${TOC.map(([id, label]) => `<li><a href="#/method" data-jump="${id}">${esc(label)}</a></li>`).join("")}</ol>
  </nav>

  <section class="card" aria-labelledby="m-glance">
    <h2 class="card-title" id="m-glance">What we know, and what we don't know yet</h2>
    <div class="know">
      <div class="know-col know-yes">
        <h3>What we know</h3>
        <ul>
          <li>Which barangays a 25-year flood reaches, and how many residents live there.</li>
          <li>How many of those residents can walk to a clinic in 30 minutes, and how many cannot.</li>
          <li>Which 3, 5 or 8 dose points reach the most exposed residents on a map.</li>
          <li>How a rain warning, trained on past years, scored on years it had not seen.</li>
        </ul>
      </div>
      <div class="know-col know-no">
        <h3>What we don't know yet</h3>
        <ul>
          <li><strong>Whether the ranking is right.</strong> We compared it with news reports of 13 flood events in Dagupan City. The Spearman correlation (a score from -1 to 1 for how well two rankings agree, where 0 means none) is -0.10, with a 95% interval of -0.48 to 0.30. That is no detectable agreement.</li>
          <li><strong>Why reports are a weak ruler.</strong> They mostly follow where people live (0.64 against population density), not where the water goes.</li>
          <li>Whether the radar flood model works in Dagupan. It was tested on floods in other countries.</li>
          <li>How access changes on the ground. It is modelled from maps.</li>
        </ul>
      </div>
    </div>
  </section>

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
    ${pipeline()}
  </section>

  <section class="card" aria-labelledby="m-defs">
    <h2 class="card-title" id="m-defs">Words we use</h2>
    <dl class="defs">
      <div><dt>25-year flood</dt><dd>A flood big enough that it has about a 4% chance of happening in any year (UP NOAH hazard map).</dd></div>
      <div><dt>Exposed residents</dt><dd>People who live where a 25-year flood reaches.</dd></div>
      <div><dt>Within reach</dt><dd>A resident who can walk to a clinic or hospital in 30 minutes, with flooded roads slowed or closed.</dd></div>
      <div><dt>Cut off from care</dt><dd>An exposed resident more than a 30-minute walk from a clinic while the flood is on.</dd></div>
      <div><dt>Lose access in the flood (estimated)</dt><dd>Residents who can reach care on a dry day but not during the flood. This is a hypothesis we test, not a premise. If the gap is zero, the tool still gives exposure and capsule counts for each barangay.</dd></div>
      <div><dt>Dose point</dt><dd>A temporary site, such as a school or barangay hall, where a nurse hands out doxycycline for a few weeks after the flood.</dd></div>
      <div><dt>Barangay priority</dt><dd>Barangays ordered by exposed residents cut off from care. Not the same as dose point order, which picks the places that reach the most cut-off residents first.</dd></div>
    </dl>
    <p>We report residents within reach of care. We never report lives saved.</p>
  </section>

  <section class="card" aria-labelledby="m-val">
    <h2 class="card-title" id="m-val">How we checked it</h2>
    <p>We asked whether barangays that our flood ranking calls flood-prone were named more often in news reports. The reports cover 13 flood events in Dagupan City, and 31 barangays are ranked. We score the match with Spearman correlation: a number from -1 to 1 that says how well two rankings agree. 1 means the same order, 0 means no link, -1 means opposite orders.</p>
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
      <li>Case data is weekly, for whole cities, and ends in 2022. The rain warning learned from 2008 to 2016 and was tested on 2017 to 2019.</li>
      <li>The rain warning cannot see tidal flooding.</li>
      <li>Access is modelled from maps, not checked on the ground.</li>
      <li>Each dose point assumes a prescriber is present.</li>
      <li>The tool counts places, not patients. Pregnant and lactating women are flagged for referral, and people who were never diagnosed do not appear.</li>
      <li>The radar flood model is a U-Net, an image-reading neural network. It was tested on floods in other countries, not in Dagupan. Its score is IoU, the overlap between predicted water and true water, where 1 is a perfect match.</li>
    </ul>
  </section>

  <section class="card" aria-labelledby="m-notyet">
    <h2 class="card-title" id="m-notyet">Not included yet, and why</h2>
    <p>Four cities are not on the map. Every one is waiting on the same step: downloading the whole-city OpenStreetMap road network, which has not finished because the Overpass service is overloaded. Without roads, we cannot work out who can walk to care.</p>
    <ul class="limits">
      <li><strong>Mandaue and Iloilo.</strong> Only a 100-year flood map exists for them, and the road download is incomplete.</li>
      <li><strong>Navotas and Muntinlupa.</strong> A 25-year flood map exists, but the road download is incomplete.</li>
    </ul>
  </section>

  <section class="card fold-card" aria-labelledby="m-refs">
    <details class="fold" open>
      <summary><h2 class="card-title" id="m-refs">Data and references</h2></summary>
      <div class="fold-body">
        <div class="refs-bar"><button type="button" class="copy-all">Copy all references</button><span class="copy-msg" aria-hidden="true"></span></div>
        <ul class="refs">${REFS.map((r, i) => `<li data-i="${i}"><span class="ref-text">${r}</span>${copyBtn()}</li>`).join("")}</ul>
      </div>
    </details>
  </section>

  <section class="card fold-card" aria-labelledby="m-run">
    <details class="fold">
      <summary><h2 class="card-title" id="m-run">Reproduce it</h2></summary>
      <div class="fold-body">
        <p>You need <a href="https://docs.astral.sh/uv/">uv</a>. Data download steps are in <a href="${REPO_URL}/blob/main/data/README.md">data/README.md</a>.</p>
        <div class="codewrap"><pre><code>${esc(RUN_CMDS)}</code></pre>${copyBtn("Copy commands")}</div>
        <p><a class="btn" href="${REPO_URL}">Open the repository</a></p>
      </div>
    </details>
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
    const jump = e.target.closest("a[data-jump]");
    if (jump && el.contains(jump)) {
      e.preventDefault();
      const target = el.querySelector("#" + jump.dataset.jump);
      if (!target) return;
      const det = target.closest("details");
      if (det) det.open = true;
      target.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
      return;
    }
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
