import { skel } from "../format.js";
// "Flood from space" page. Numbers come from docs/flood.md (full run, one seed).
const EX = {
  usa: {
    note: "Lakes and a wide river with clear, dark water. One of the better chips: U-Net 0.94, Otsu 0.55 on this chip.",
    alts: {
      vv: "Radar image (VV band) of a landscape in the USA in greyscale. Large lakes and a river show as dark areas.",
      label: "The same radar image with the hand-drawn water shown in blue: the lakes, the river and many small ponds.",
      unet: "The same radar image with the U-Net water prediction in blue. It covers the large lakes and river and most small ponds.",
      otsu: "The same radar image with the Otsu threshold prediction in blue. It covers the lakes and river but also marks many dark farm fields."
    }
  },
  spain: {
    note: "A harder chip with dark farmland. U-Net 0.65, Otsu 0.57 on this chip, closer to a typical result.",
    alts: {
      vv: "Radar image (VV band) of a landscape in Spain in greyscale with dark patches of water and dark fields.",
      label: "The same radar image with the hand-drawn water shown in blue.",
      unet: "The same radar image with the U-Net water prediction in blue.",
      otsu: "The same radar image with the Otsu threshold prediction in blue, which also marks some dark land."
    }
  }
};
const PANELS = [
  ["vv", "Radar (VV)", "What the satellite measures. Dark means little signal came back."],
  ["label", "Hand label", "Water drawn by a person. This is the answer key."],
  ["unet", "U-Net", "Water predicted by the trained model."],
  ["otsu", "Otsu threshold", "Water predicted by one brightness cut-off."]
];

function picsHTML(key) {
  const ex = EX[key];
  return `<div class="rd-pics">${PANELS.map(([k, t, d]) =>
    `<figure><img src="assets/radar/${key}_${k}.png" width="384" height="384" alt="${ex.alts[k]}"><figcaption><b>${t}</b>${d}</figcaption></figure>`).join("")}</div>
    <p class="caption">${ex.note}</p>`;
}

const TRAIN = `
<figure class="rd-flow">
  <picture>
    <source media="(prefers-reduced-motion: reduce)" srcset="assets/radar/unet_training.png">
    <img src="assets/radar/unet_training.gif" width="960" height="700" alt="Animation of the U-Net learning over 15 rounds of training. Three radar images are shown, each beside its hand-drawn water label and the model's guess. Before training the guesses are blotchy and mostly wrong. After each round the guess gets closer to the hand-drawn water, while a line chart of the score on unseen images climbs and a second chart of the training loss falls.">
  </picture>
  <figcaption><b>How it learned</b>Before training the model guesses almost at random. After each round of training on 252 hand-labelled images it gets closer to the hand-drawn water. This is a re-run with the same settings, so the numbers differ slightly from the reported run.</figcaption>
</figure>`;

const FLOW = `
<figure class="rd-flow">
  <picture>
    <source media="(prefers-reduced-motion: reduce)" srcset="assets/radar/unet_flow.png">
    <img src="assets/radar/unet_flow.gif" width="960" height="720" alt="Animation of the trained U-Net reading one radar image of a landscape with lakes. A radar picture enters at the top left. Four steps shrink it going down the left side: fine detail, shapes, regions, scene. At the bottom is a compact summary. Four steps grow it back going up the right side, with gold dashed lines passing detail across. At the top right is the water mask, which closely matches the hand-drawn label, with an overlap score (IoU) of 0.94.">
  </picture>
  <figcaption><b>How it works</b>The trained model reading one real radar image, step by step. Each square is what the model pays attention to at that step; it gets smaller and more abstract going down, then the decoder rebuilds a sharp water map going up. This chip is one of the easier ones (overlap 0.94); the typical chip scores 0.33, see the results below.</figcaption>
</figure>`;

const DIAGRAM = `
<div class="rd-diagram-wrap">
<svg class="rd-diagram" viewBox="0 0 760 420" role="img" aria-labelledby="unet-t unet-d">
  <title id="unet-t">U-Net diagram</title>
  <desc id="unet-d">Two radar bands, VV and VH, enter at the top left. The encoder, a resnet34, shrinks the image step by step going down the left side. At the bottom it holds a compact summary. The decoder grows the image back going up the right side. Skip connections pass fine detail straight across from each encoder step to the matching decoder step. One channel, a water mask, comes out at the top right.</desc>
  <defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--ink)"/></marker></defs>
  <rect class="box-in" x="10" y="14" width="130" height="54" rx="8"/>
  <text class="t-md" x="75" y="37" text-anchor="middle">Radar in</text>
  <text class="t-sm t-mu" x="75" y="55" text-anchor="middle">VV and VH bands</text>
  <rect class="box-out" x="620" y="14" width="130" height="54" rx="8"/>
  <text class="t-md on-blue" x="685" y="37" text-anchor="middle">Water mask</text>
  <text class="t-sm on-blue" x="685" y="55" text-anchor="middle">1 channel out</text>
  <rect class="box" x="30" y="100" width="150" height="46" rx="8"/><text class="t-sm" x="105" y="127" text-anchor="middle">Step 1: fine detail</text>
  <rect class="box" x="60" y="170" width="130" height="46" rx="8"/><text class="t-sm" x="125" y="197" text-anchor="middle">Step 2: shapes</text>
  <rect class="box" x="90" y="240" width="110" height="46" rx="8"/><text class="t-sm" x="145" y="267" text-anchor="middle">Step 3: regions</text>
  <rect class="box" x="120" y="310" width="100" height="46" rx="8"/><text class="t-sm" x="170" y="337" text-anchor="middle">Step 4: scene</text>
  <rect class="box" x="260" y="352" width="240" height="46" rx="8"/><text class="t-sm" x="380" y="379" text-anchor="middle">Compact summary of the image</text>
  <rect class="box-dec" x="580" y="100" width="150" height="46" rx="8"/><text class="t-sm" x="655" y="127" text-anchor="middle">Step 1: sharp edges</text>
  <rect class="box-dec" x="570" y="170" width="130" height="46" rx="8"/><text class="t-sm" x="635" y="197" text-anchor="middle">Step 2: shapes</text>
  <rect class="box-dec" x="560" y="240" width="110" height="46" rx="8"/><text class="t-sm" x="615" y="267" text-anchor="middle">Step 3: regions</text>
  <rect class="box-dec" x="540" y="310" width="100" height="46" rx="8"/><text class="t-sm" x="590" y="337" text-anchor="middle">Step 4: scene</text>
  <path class="arrow" d="M75 68V100" marker-end="url(#ah)"/>
  <path class="arrow" d="M105 146V170" marker-end="url(#ah)"/>
  <path class="arrow" d="M135 216V240" marker-end="url(#ah)"/>
  <path class="arrow" d="M160 286V310" marker-end="url(#ah)"/>
  <path class="arrow" d="M200 356Q230 375 260 375" marker-end="url(#ah)"/>
  <path class="arrow" d="M500 375Q540 375 570 356" marker-end="url(#ah)"/>
  <path class="arrow" d="M590 310V286" marker-end="url(#ah)"/>
  <path class="arrow" d="M615 240V216" marker-end="url(#ah)"/>
  <path class="arrow" d="M635 170V146" marker-end="url(#ah)"/>
  <path class="arrow" d="M655 100V68" marker-end="url(#ah)"/>
  <path class="skip" d="M180 123H580"/>
  <path class="skip" d="M190 193H570"/>
  <path class="skip" d="M200 263H560"/>
  <path class="skip" d="M220 333H540"/>
  <text class="t-md" x="30" y="408">Encoder (resnet34)</text>
  <text class="t-md" x="620" y="408">Decoder</text>
</svg></div>
<p class="rd-legend"><span><i></i>Skip connection: fine detail passed straight across</span></p>
<p class="caption">Text version: the radar image goes down through four shrinking steps (the resnet34 encoder), reaches a compact summary, then goes back up through four growing steps (the decoder). At each level, detail from the way down is copied across to the way up so edges stay sharp. The output is one picture where each pixel is water or not.</p>`;

const H = 200;
const bar = (x, v, cls) => `<rect class="${cls}" x="${x}" y="${(220 - v * H).toFixed(1)}" width="100" height="${(v * H).toFixed(1)}" rx="4"/>`;
const CHART = `
<svg class="rd-chart" viewBox="0 0 420 260" role="img" aria-labelledby="ch-t ch-d">
  <title id="ch-t">Pooled IoU on 90 test chips</title>
  <desc id="ch-d">Bar chart. U-Net scores 0.639. Otsu threshold scores 0.208. Higher is better, 1 is perfect.</desc>
  <g class="gridl"><line x1="60" x2="400" y1="20" y2="20"/><line x1="60" x2="400" y1="70" y2="70"/><line x1="60" x2="400" y1="120" y2="120"/><line x1="60" x2="400" y1="170" y2="170"/></g>
  <line class="axis" x1="60" x2="400" y1="220" y2="220"/>
  <g class="t-sm t-mu" text-anchor="end"><text x="52" y="224">0</text><text x="52" y="174">0.25</text><text x="52" y="124">0.5</text><text x="52" y="74">0.75</text><text x="52" y="24">1</text></g>
  ${bar(100, 0.639, "bar-u")}${bar(260, 0.208, "bar-o")}
  <text class="v" x="150" y="${(220 - 0.639 * H - 8).toFixed(1)}" text-anchor="middle">0.639</text>
  <text class="v" x="310" y="${(220 - 0.208 * H - 8).toFixed(1)}" text-anchor="middle">0.208</text>
  <text class="t-sm" x="150" y="242" text-anchor="middle">U-Net</text>
  <text class="t-sm" x="310" y="242" text-anchor="middle">Otsu threshold</text>
</svg>`;

function resultsHTML() {
  return `
  <div class="rd-stats">
    <div class="card stat"><div class="stat-value">0.64</div><div class="stat-label">U-Net, pooled IoU on 90 test chips</div></div>
    <div class="card stat"><div class="stat-value">0.21</div><div class="stat-label">Otsu threshold, same chips</div></div>
    <div class="card stat"><div class="stat-value">67 of 82</div><div class="stat-label">chips with water where the U-Net scored higher</div></div>
  </div>
  <div class="rd-def">
    <p><b>What is IoU?</b> The overlap between the predicted water and the hand-drawn water, divided by their union. 1 is perfect. 0 means no overlap at all.</p>
    <p><b>What the scores say.</b> 0.64 against 0.21 means the U-Net found about three times as much of the true flood overlap as the simple threshold. A typical single image scores 0.33, lower than the pooled 0.64. The test images are floods in other countries. The model has not been tested on Dagupan yet.</p>
  </div>
  <div class="rd-two">
    <div class="card"><h3 class="card-title">Pooled IoU, higher is better</h3>${CHART}</div>
    <div class="card"><h3 class="card-title">Scores on the test chips</h3>
      <div class="table-wrap"><table class="table">
        <caption class="sr-only">U-Net compared with Otsu threshold on test chips</caption>
        <thead><tr><th scope="col">Measure</th><th scope="col">U-Net</th><th scope="col">Otsu</th></tr></thead>
        <tbody>
          <tr><th scope="row" class="l">Pooled over all pixels</th><td>0.639</td><td>0.208</td></tr>
          <tr><th scope="row" class="l">Median chip</th><td>0.333</td><td>0.046</td></tr>
          <tr><th scope="row" class="l">Mean, 82 chips with water</th><td>0.395</td><td>0.228</td></tr>
          <tr><th scope="row" class="l">Median, same 82 chips</th><td>0.372</td><td>0.062</td></tr>
        </tbody></table></div>
      <p class="caption" style="margin-top:var(--s1)">Training used 252 chips. Another 89 picked the best of 15 training rounds (round 14). 90 were held back for this test.</p>
    </div>
  </div>
  <div class="card"><h3 class="card-title">What these numbers do not say</h3>
    <ul class="rd-cave">
      <li>The test chips are floods in other countries, not Dagupan. We have not yet measured how well it does on Dagupan or on tidal flooding.</li>
      <li>One training run, one random seed. A different run could move these scores by a few points.</li>
      <li>Chip scores vary widely (the middle half runs from 0.105 to 0.592) because many chips hold very little water and IoU is harsh on those. The pooled 0.639 is the steadier figure. The median of 0.333 is the more cautious one.</li>
      <li>The Otsu threshold is a weak comparison: one cut-off per image, one band, no before picture.</li>
    </ul></div>`;
}

const COMING = `<div class="card"><span class="badge">Coming next</span>
  <h3 class="card-title" style="margin-top:var(--s1)">Typhoon Egay over Dagupan</h3>
  <p>We will map the flood from a radar pass on 28 July 2023, two days after the typhoon made landfall. We will compare it with a dry pass on 11 April 2023 from the same orbit track, so both images look at the ground from the same angle.</p>
  <p class="caption" style="margin:0">No numbers yet. They will appear here once the run is done.</p></div>`;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function egayHTML(gj) {
  const feats = gj.features || [];
  const keys = feats.length ? Object.keys(feats[0].properties || {}) : [];
  const key = keys.find((k) => /s1.*(share|frac)|flood.*(share|frac)/i.test(k));
  const nameKey = keys.find((k) => /name/i.test(k));
  let body = `<p>${feats.length} barangay areas in the result file.</p>`;
  if (key && nameKey) {
    const rows = feats.map((f) => [f.properties[nameKey], +f.properties[key]]).filter((r) => Number.isFinite(r[1])).sort((a, b) => b[1] - a[1]).slice(0, 8);
    body += `<div class="table-wrap"><table class="table"><caption class="sr-only">Barangays with the largest flooded share</caption><thead><tr><th scope="col">Barangay</th><th scope="col">Flooded share</th></tr></thead><tbody>${rows.map((r) => `<tr><th scope="row" class="l">${esc(r[0])}</th><td>${(r[1] * 100).toFixed(1)}%</td></tr>`).join("")}</tbody></table></div>`;
  }
  return `<div class="card"><span class="badge">Result</span><h3 class="card-title" style="margin-top:var(--s1)">Typhoon Egay over Dagupan</h3>${body}
  <p class="caption" style="margin-top:var(--s1)">One radar pass, two days after landfall. Radar can miss floods between buildings, so downtown shares are probably too low.</p></div>`;
}

export async function render(root) {
  if (!document.querySelector('link[href="css/radar.css"]')) {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = "css/radar.css";
    document.head.appendChild(l);
  }
  const egay = `<div id="rd-egay" aria-busy="true"><div class="card" aria-hidden="true">${skel(1)}${skel(3)}</div><span class="sr-only" role="status">Loading the Typhoon Egay result.</span></div>`;
  const alt = EX.usa.alts;

  root.innerHTML = `<div class="rd">
  <header class="rd-hero">
    <span class="eyebrow">Satellite flood maps</span>
    <h1>Seeing a flood from space <span class="badge badge-neutral">Experimental</span></h1>
    <p class="rd-one">The map today uses the UP NOAH flood hazard map. Satellites can show a real flood within days, even through clouds.</p>
    <a class="btn btn-primary sm" href="#/map">Back to the map</a>
  </header>

  <section class="rd-story" aria-labelledby="rd-pic-h">
    <h2 id="rd-pic-h" class="sr-only">One example, three pictures</h2>
    <div class="rd-trio">
      <figure><img src="assets/radar/usa_vv.png" width="384" height="384" alt="${alt.vv}"><figcaption><b>What the satellite sees</b></figcaption></figure>
      <figure><img src="assets/radar/usa_unet.png" width="384" height="384" alt="${alt.unet}"><figcaption><b>What our model marks as water</b></figcaption></figure>
      <figure><img src="assets/radar/usa_label.png" width="384" height="384" alt="${alt.label}"><figcaption><b>The real flood (hand-drawn)</b></figcaption></figure>
    </div>
    <p class="caption">A clear example, from the USA.</p>
  </section>

  <section class="rd-story rd-num" aria-labelledby="rd-num-h">
    <h2 id="rd-num-h" class="sr-only">How well it works</h2>
    <p class="rd-big">Our model found about <b>three times</b> as much of the real flood as a simple rule.</p>
    <p class="caption">IoU 0.64 vs 0.21. IoU is overlap with the real flood: 0 is none, 1 is perfect.</p>
  </section>

  <section class="rd-story rd-next" aria-labelledby="rd-next-h">
    <h2 id="rd-next-h" class="sr-only">Next</h2>
    <p class="rd-big"><b>Next:</b> run it on Typhoon Egay over Dagupan (July 2023).</p>
  </section>

  <details class="rd-details rd-tech-all"><summary>Technical details</summary>
    <p>Dark patches in the radar picture sent little signal back. The three pictures above show one test chip from the USA. The public training data has no Philippine images yet. The 0.64 and 0.21 come from 90 test chips the model had never seen.</p>
    <section class="rd-sec" aria-labelledby="rd-h1">
      <h3 id="rd-h1">Why radar</h3>
      <p>A normal satellite camera needs clear sky. A radar satellite sends its own signal and listens for the echo, so clouds do not matter. Rough ground, crops and buildings send plenty of signal back and look bright. Still water acts like a mirror and bounces the signal away, so it looks dark.</p>
      <div class="card rd-ex">
        <h4 class="card-title">More examples</h4>
        <p class="caption">From the Sen1Floods11 test set (Bonafilia et al., 2020): Sentinel-1 radar chips not used for training. Blue marks water. These are floods in the USA and Spain, not the Philippines.</p>
        <div class="seg rd-seg" role="group" aria-label="Choose an example">
          <button type="button" data-ex="usa" aria-pressed="true">USA</button>
          <button type="button" data-ex="spain" aria-pressed="false">Spain</button>
        </div>
        <div id="rd-pics" aria-live="polite">${picsHTML("usa")}</div>
        <p class="caption" style="margin:0">Both chips were picked because they hold a lot of water. They are not an average sample.</p>
      </div>
    </section>
    <section class="rd-sec" aria-labelledby="rd-h2">
      <h3 id="rd-h2">The model</h3>
      <p>A threshold only looks at how dark each pixel is. A U-Net also looks at the shapes around it, so a dark farm field and a dark lake can be told apart.</p>
      <details class="rd-details rd-tech"><summary>VV and VH bands</summary>
        <p>The satellite sends and receives the signal in two orientations. VV means sent and received vertically. VH means sent vertically and received horizontally. Water and land respond differently in each, so the U-Net takes both as input.</p></details>
      <div class="card">${TRAIN}${FLOW}
        <details class="rd-details"><summary>Show as diagram</summary>${DIAGRAM}</details></div>
    </section>
    <section class="rd-sec" aria-labelledby="rd-h3">
      <h3 id="rd-h3">How well it works</h3>
      <p>We compared the U-Net with the simplest alternative: one brightness cut-off for each image. Both were scored against hand-drawn water on 90 chips the model had never seen.</p>
      <details class="rd-details rd-tech"><summary>The Otsu threshold</summary>
        <p>Otsu is a standard method that looks at the histogram of pixel brightness in one image and picks the cut-off that best splits dark pixels from bright ones. Everything darker is called water. It uses one band and no before picture, so it is a weak comparison.</p></details>
      ${resultsHTML()}
    </section>
    <section class="rd-sec" aria-labelledby="rd-h4">
      <h3 id="rd-h4">Typhoon Egay case study</h3>
      ${egay}
    </section>
    <p class="rd-foot">Source for the training and test data: Bonafilia, D., Tellman, B., Anderson, T., Issenberg, E. (2020). Sen1Floods11: a georeferenced dataset to train and test deep learning flood algorithms for Sentinel-1. CVPR Workshops. Scores come from one full training run.</p>
  </details>
  </div>`;

  const picsEl = root.querySelector("#rd-pics");
  const btns = [...root.querySelectorAll(".rd-seg button")];
  btns.forEach((b) => b.addEventListener("click", () => {
    btns.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    picsEl.innerHTML = picsHTML(b.dataset.ex);
  }));
  const slot = root.querySelector("#rd-egay");
  let card = COMING;
  try {
    const r = await fetch("data/PH015518000/s1_flood.geojson");
    if (r.ok) card = egayHTML(await r.json());
  } catch (e) { /* keep placeholder */ }
  if (slot.isConnected) { slot.innerHTML = card; slot.removeAttribute("aria-busy"); }
}

export function destroy() {}
