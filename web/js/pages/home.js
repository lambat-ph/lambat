import { getNational, getCities, getCity, scenarioOf } from "../data.js";
import { RAMP, FLAT_CITY } from "../config.js";
import { fmt, esc, useCss } from "../format.js";

// Static mini choropleth of the first city: equirectangular projection into an SVG box.
function previewSvg(city) {
  const gj = city.barangays, W = 400, H = 300, P = 10;
  const bb = city.bbox, lat0 = (((bb[1] + bb[3]) / 2) * Math.PI) / 180, kx = Math.cos(lat0);
  const w = (bb[2] - bb[0]) * kx, h = bb[3] - bb[1];
  const sc = Math.min((W - 2 * P) / w, (H - 2 * P) / h);
  const ox = (W - w * sc) / 2, oy = (H - h * sc) / 2;
  const X = (lon) => (ox + (lon - bb[0]) * kx * sc).toFixed(1);
  const Y = (lat) => (oy + (bb[3] - lat) * sc).toFixed(1);
  const vals = gj.features.map((f) => +f.properties.exposed || 0).sort((a, b) => a - b);
  const cuts = [1, 2, 3, 4].map((i) => vals[Math.floor((i * vals.length) / 5)]);
  const color = (v) => RAMP[cuts.filter((c) => v >= c && c > vals[0]).length];
  const ring = (r) => "M" + r.map((p) => X(p[0]) + " " + Y(p[1])).join("L") + "Z";
  const paths = gj.features.map((f) => {
    const g = f.geometry, polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    return `<path d="${polys.map((p) => p.map(ring).join("")).join("")}" fill="${color(+f.properties.exposed || 0)}" fill-rule="evenodd" stroke="#fff" stroke-width="1"/>`;
  }).join("");
  const dots = city.dosePoints.features.filter((f) => f.properties.rank != null && f.properties.rank <= 3)
    .sort((a, b) => a.properties.rank - b.properties.rank)
    .map((f) => { const [lon, lat] = f.geometry.coordinates; return `<g transform="translate(${X(lon)} ${Y(lat)})"><circle r="13" fill="var(--gold)" stroke="#fff" stroke-width="2.5"/><text y="5" text-anchor="middle" font-family="Space Grotesk,system-ui,sans-serif" font-weight="700" font-size="15" fill="var(--ink)">${f.properties.rank}</text></g>`; }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Example map of ${esc(city.meta.name)}: barangays shaded light to dark by exposed residents, with three numbered gold dose points.">${paths}${dots}</svg>`;
}

// Rolling numbers. The real value always stays in the DOM: the animated copy is aria-hidden,
// a screen-reader-only copy holds the final value, and the animated copy is reset to the final
// value if the animation is cut short (page change, tab hidden, timeout).
let live = [];
function settle(n) { n.textContent = n.dataset.final; }
function rollNumbers(root) {
  const nodes = [...root.querySelectorAll("[data-to]")].filter((n) => Number.isFinite(+n.dataset.to));
  if (!nodes.length || matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
  const run = (n) => {
    const to = +n.dataset.to, t0 = performance.now();
    live.push(n);
    const done = () => { settle(n); live = live.filter((x) => x !== n); };
    const tick = (t) => {
      if (!n.isConnected) return done();
      const k = Math.min(1, (t - t0) / 700);
      if (k >= 1) return done();
      n.textContent = fmt(Math.round(to * (1 - (1 - k) ** 3)));
      requestAnimationFrame(tick);
    };
    n.textContent = fmt(0);
    requestAnimationFrame(tick);
    setTimeout(done, 1000);
  };
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { io.unobserve(e.target); run(e.target); } }), { threshold: 0.6 });
  nodes.forEach((n) => io.observe(n));
}
const onHide = () => { if (document.hidden) live.slice().forEach(settle); };

const ARROW = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
const floodAbbr = (y) => `<abbr title="A flood big enough that it has about a ${y === 100 ? "1" : "4"}% chance of happening in any year${y === 100 ? ". It is larger than a 25-year flood" : ""} (UP NOAH hazard map)">${y}-year flood</abbr>`;
const FLOOD = floodAbbr(25);
const stat = (l, v) => `<div><dt>${l}</dt><dd><span class="num" aria-hidden="true" data-to="${v}" data-final="${fmt(v)}">${fmt(v)}</span><span class="sr-only">${fmt(v)}</span></dd></div>`;

export async function render(el) {
  useCss("home");
  document.addEventListener("visibilitychange", onHide);
  el.innerHTML = `
  <div class="home">
    <div class="home-bg" aria-hidden="true">
      <div class="net"></div>
      <i class="wave"></i>
      <i class="wave w2"></i>
    </div>
    <div class="home-inner">
      <div class="brand-line"><img src="assets/favicon.svg" alt="" width="32" height="32">LAMBAT</div>
      <p class="eyebrow tagline">Get the capsule to the other side of the water</p>
      <h1 id="answer" aria-busy="true"><span class="skel sk-h" aria-hidden="true"></span><span class="skel sk-h s2" aria-hidden="true"></span></h1>
      <p class="def" id="def">A 25-year flood has about a 4% chance of happening in any year. Dose points are temporary spots where a nurse hands out free doxycycline.</p>
      <div class="cta">
        <a class="btn btn-primary" href="#/map">Open the map ${ARROW}</a>
        <a class="cities-link" id="cities" href="#/map/all" hidden></a>
      </div>
      <dl class="stats-strip" id="strip" aria-label="Totals for a 25-year flood"><div><dt class="skel sk-t"></dt><dd class="skel sk-n"></dd></div><div><dt class="skel sk-t"></dt><dd class="skel sk-n"></dd></div><div><dt class="skel sk-t"></dt><dd class="skel sk-n"></dd></div></dl>
      <p class="lede">After a flood, LAMBAT shows a city health office who was exposed, who is cut off from care, and where to open dose points.</p>
      <div class="how" id="how">
        <a class="preview" id="preview" href="#/map" hidden>
          <div class="pv-map" id="pvMap"></div>
          <span class="pv-cap">Open the full map ${ARROW}</span>
          <p class="pv-legend"><span class="dot" aria-hidden="true">1</span>Gold numbers: where to set up dose points, 1 first.</p>
          <span class="pv-key" aria-hidden="true"><span>Fewer exposed</span><i style="background:${RAMP[0]}"></i><i style="background:${RAMP[1]}"></i><i style="background:${RAMP[2]}"></i><i style="background:${RAMP[3]}"></i><i style="background:${RAMP[4]}"></i><span>More exposed</span></span>
        </a>
        <div class="steps">
          <h2>How it works</h2>
          <ol>
            <li><span class="n" aria-hidden="true">1</span><div><b>Map the flood.</b> We outline where a 25-year flood reaches, barangay by barangay.</div></li>
            <li><span class="n" aria-hidden="true">2</span><div><b>Count exposed residents and who is cut off from care.</b> We count people who live where the flood reaches, and those more than a <span class="nb">30-minute</span> walk from a clinic while it is on.</div></li>
            <li><span class="n" aria-hidden="true">3</span><div><b>Choose dose points.</b> We put them in order, 1 opens first, so the first few reach the most cut-off residents.</div></li>
          </ol>
        </div>
      </div>
      <blockquote class="quote">
        <p>The capsule that could have protected Rosa was free. But it was on the other side of the water.</p>
        <cite>Rosa is a composite; the numbers are not.</cite>
      </blockquote>
    </div>
  </div>`;
  const h1 = el.querySelector("#answer"), strip = el.querySelector("#strip");
  let cities = [];
  try { cities = await getCities(); } catch { /* handled below */ }
  const c25 = cities.filter((c) => !scenarioOf(c).is100), n100 = cities.length - c25.length;
  const pilot = c25.find((c) => c.code === FLAT_CITY.code) || c25[0] || cities[0];
  if (pilot && pilot.exposed != null) {
    const cov = pilot.coverage_after && pilot.coverage_after[3];
    h1.innerHTML = `After a ${floodAbbr(scenarioOf(pilot).yrs)}, ${fmt(pilot.exposed)} people in ${esc(pilot.name)} live in the water's path.` +
      (cov != null ? ` <span class="h1-2">3 dose points put ${Math.round(cov * 100)}% of them within a <span class="nb">30-minute</span> walk of free medicine.</span>` : "");
  } else {
    h1.innerHTML = `After a ${FLOOD}, thousands of people live in the water's path. LAMBAT shows where to put dose points.`;
  }
  h1.removeAttribute("aria-busy");
  if (cities.length > 1) {
    const n = c25.length;
    const a = el.querySelector("#cities");
    a.textContent = n100 ? `${fmt(n)} cities with a 25-year flood map, ${fmt(n100)} more on the 100-year map. See the national map` : `${fmt(cities.length)} cities covered. See the national map`;
    a.hidden = false;
  }
  try {
    const n = await getNational();
    strip.innerHTML = [
      stat(n.cities > 1 ? `exposed residents in ${fmt(n.cities)} cities with a 25-year flood map` : "residents exposed in a 25-year flood", n.exposed),
      stat("capsules needed for each week the water stays", n.weekly_capsules),
      stat("barangays ranked by priority", n.barangays),
    ].join("");
    rollNumbers(strip);
  } catch { strip.hidden = true; }
  try {
    const city = pilot && (await getCity(pilot.code));
    if (city && city.barangays && city.bbox && el.isConnected) {
      el.querySelector("#pvMap").innerHTML = previewSvg(city);
      el.querySelector("#preview").hidden = false;
    }
  } catch { /* the preview is optional */ }
}

export function destroy() {
  document.removeEventListener("visibilitychange", onHide);
  live.slice().forEach(settle);
  live = [];
}
