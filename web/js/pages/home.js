import { getNational, getCities, getCity } from "../data.js";
import { RAMP } from "../config.js";
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
    return `<path d="${polys.map((p) => p.map(ring).join("")).join("")}" fill="${color(+f.properties.exposed || 0)}" fill-rule="evenodd" style="stroke:var(--surface)" stroke-width="1"/>`;
  }).join("");
  const dots = city.dosePoints.features.filter((f) => f.properties.rank != null && f.properties.rank <= 3)
    .sort((a, b) => a.properties.rank - b.properties.rank)
    .map((f) => { const [lon, lat] = f.geometry.coordinates; return `<g transform="translate(${X(lon)} ${Y(lat)})"><circle r="13" fill="var(--gold)" stroke="#fff" stroke-width="2.5"/><text y="5" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Inter,Segoe UI,sans-serif" font-weight="700" font-size="14" fill="#141A2E">${f.properties.rank}</text></g>`; }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Example map of ${esc(city.meta.name)}: barangays shaded light to dark by exposed residents, with three numbered gold dose points.">${paths}${dots}</svg>`;
}

export async function render(el) {
  useCss("home");
  el.innerHTML = `
  <div class="home">
    <div class="home-inner">
      <section class="hero">
        <div class="hero-copy">
          <div class="brand-line"><svg viewBox="0 0 100 100" aria-hidden="true"><path d="M50 94C50 94 18 62 18 40A32 32 0 0 1 82 40C82 62 50 94 50 94ZM37 40A13 13 0 1 0 63 40A13 13 0 1 0 37 40Z" fill="var(--pin)" fill-rule="evenodd"/><circle cx="50" cy="40" r="8.2" fill="var(--gold)"/></svg>LAMBAT</div>
          <h1>Get the capsule to the other side of the water.</h1>
          <p class="lede">After a flood, LAMBAT shows a city health office who was exposed to floodwater, who can still walk to care, and where to open temporary doxycycline dose points.</p>
          <a class="btn btn-primary" href="#/map">Open the map
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
        </div>
        <figure class="preview" id="preview" hidden>
          <div class="pv-map" id="pvMap"></div>
          <figcaption>What a health officer sees: who was exposed, and where to set up dose points.</figcaption>
          <div class="pv-key" aria-hidden="true"><span>Fewer exposed</span><i style="background:${RAMP[0]}"></i><i style="background:${RAMP[1]}"></i><i style="background:${RAMP[2]}"></i><i style="background:${RAMP[3]}"></i><i style="background:${RAMP[4]}"></i><span>More exposed</span></div>
        </figure>
      </section>
      <section class="steps" aria-labelledby="howH">
        <h2 id="howH">How it works</h2>
        <ol>
          <li><span class="n" aria-hidden="true">1</span><div><b>Map the flood.</b> We outline the area a 25-year flood covers, barangay by barangay.</div></li>
          <li><span class="n" aria-hidden="true">2</span><div><b>Count who was in it and who cannot reach care.</b> We count residents in the water and those cut off from a clinic.</div></li>
          <li><span class="n" aria-hidden="true">3</span><div><b>Choose where to put dose points.</b> We rank sites so the first few help the most people.</div></li>
        </ol>
      </section>
      <dl class="stats-strip" id="strip" aria-label="National totals for a 25-year flood"></dl>
      <blockquote class="quote">
        <p>The capsule that could have protected Rosa was free. But it was on the other side of the water.</p>
        <cite>Rosa is a composite; the numbers are not.</cite>
      </blockquote>
    </div>
  </div>`;
  const strip = el.querySelector("#strip");
  try {
    const n = await getNational();
    const items = [
      [`residents exposed to floodwater in a 25-year flood, across ${fmt(n.cities)} ${n.cities === 1 ? "city" : "cities"}`, fmt(n.exposed)],
      ["doxycycline capsules needed for each week the water stays", fmt(n.weekly_capsules)],
      ["barangays mapped and ranked by priority", fmt(n.barangays)],
    ];
    strip.innerHTML = items.map(([l, v]) => `<div><dt>${l}</dt><dd class="num">${v}</dd></div>`).join("");
  } catch { strip.hidden = true; }
  try {
    const cities = await getCities();
    const city = cities[0] && (await getCity(cities[0].code));
    if (city && city.barangays && city.bbox && el.isConnected) {
      el.querySelector("#pvMap").innerHTML = previewSvg(city);
      el.querySelector("#preview").hidden = false;
    }
  } catch { /* the preview is optional */ }
}
