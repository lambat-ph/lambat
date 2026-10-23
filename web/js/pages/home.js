import { getNational, getCities, getCity, barangayHref, tierOf } from "../data.js";
import { RISK } from "../config.js";
import { fmt, pct, esc, useCss } from "../format.js";
import { mountSearch } from "../search.js";

// Static mini choropleth of the first city: equirectangular projection into an SVG box.
function previewSvg(city) {
  const gj = city.barangays, W = 400, H = 320, P = 10;
  const bb = city.bbox, lat0 = (((bb[1] + bb[3]) / 2) * Math.PI) / 180, kx = Math.cos(lat0);
  const w = (bb[2] - bb[0]) * kx, h = bb[3] - bb[1];
  const sc = Math.min((W - 2 * P) / w, (H - 2 * P) / h);
  const ox = (W - w * sc) / 2, oy = (H - h * sc) / 2;
  const X = (lon) => (ox + (lon - bb[0]) * kx * sc).toFixed(1);
  const Y = (lat) => (oy + (bb[3] - lat) * sc).toFixed(1);
  const vals = gj.features.map((f) => +f.properties.exposed || 0).sort((a, b) => a - b);
  const cuts = [1, 2, 3, 4].map((i) => vals[Math.floor((i * vals.length) / 5)]);
  const color = (v) => RISK[cuts.filter((c) => v >= c && c > vals[0]).length];
  const ring = (r) => "M" + r.map((p) => X(p[0]) + " " + Y(p[1])).join("L") + "Z";
  const paths = gj.features.map((f) => {
    const g = f.geometry, polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    return `<a href="${barangayHref(f.properties.adm4_pcode)}"><path d="${polys.map((p) => p.map(ring).join("")).join("")}" fill="${color(+f.properties.exposed || 0)}" fill-rule="evenodd" stroke="#fff" stroke-width="1"><title>${esc(f.properties.adm4_en)}: ${fmt(f.properties.exposed)} exposed</title></path></a>`;
  }).join("");
  const dots = city.dosePoints.features.filter((f) => f.properties.rank != null && f.properties.rank <= 3)
    .sort((a, b) => a.properties.rank - b.properties.rank)
    .map((f) => { const [lon, lat] = f.geometry.coordinates; return `<g transform="translate(${X(lon)} ${Y(lat)})" pointer-events="none"><circle r="12" fill="var(--blue)" stroke="#fff" stroke-width="2.5"/><text y="5" text-anchor="middle" font-family="Space Grotesk,system-ui,sans-serif" font-weight="700" font-size="13" fill="#fff">${f.properties.rank}</text></g>`; }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Map of ${esc(city.meta.name)}: barangays shaded yellow to red by exposed residents, with the first three dose points numbered in blue.">${paths}${dots}</svg>`;
}

const STEPS = [
  ["Where is the water?", "Flood hazard maps on day one; Sentinel-1 radar read by a U-Net model when a satellite pass arrives."],
  ["Who was in it?", "Flood extent laid over a population map gives exposed residents and capsules needed, per barangay."],
  ["Who can still reach care?", "Walking times on real roads, with flooded roads slowed or closed. Who is more than 30 minutes from a clinic?"],
  ["Where should dose points go?", "A covering model picks the 3, 5 or 8 temporary sites that bring the most exposed residents within reach."],
  ["Should hospitals get ready?", "Rain from 2 to 4 weeks before tells hospitals when leptospirosis cases are likely to rise."],
];
const ARROW = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

export async function render(el) {
  useCss("home");
  el.innerHTML = `
  <div class="home">
    <section class="hero">
      <div class="hero-in">
        <div class="hero-copy">
          <p class="eyebrow">Leptospirosis Alert, Mapping and Barangay Allocation Tool</p>
          <h1>After a flood, which barangays need doxycycline first?</h1>
          <p class="lede">LAMBAT shows a city health office who waded through floodwater, who can still walk to care, and where to open temporary dose points. Pilot city: Dagupan, Pangasinan.</p>
          <div class="hero-search" id="heroSearch"></div>
          <div class="hero-cta">
            <a class="btn" href="#/map">Open the map ${ARROW}</a>
            <a class="btn ghost" href="#/city">See the priority list</a>
          </div>
        </div>
        <figure class="preview" id="preview" hidden>
          <div class="pv-head"><b id="pvName">Dagupan City</b><span class="scenario">25-year flood</span></div>
          <div class="pv-map" id="pvMap"></div>
          <figcaption>
            <div class="pv-key" aria-hidden="true"><span>Fewer exposed</span>${RISK.map((c) => `<i style="background:${c}"></i>`).join("")}<span>More</span></div>
            <div class="pv-key2"><span class="pv-dot">1</span>First dose points to open</div>
          </figcaption>
        </figure>
      </div>
    </section>

    <section class="band" aria-label="Key numbers for a 25-year flood">
      <dl class="stats" id="strip"></dl>
    </section>

    <div class="home-body">
      <section class="h-sec two">
        <div>
          <h2>Start with the barangays at the top</h2>
          <p class="muted">Ranked by exposed residents who cannot walk to a clinic within 30 minutes while the flood is on. Pick one for a printable report.</p>
          <ol class="toplist" id="toplist"></ol>
          <a class="more" href="#/city/PH015518000/barangays">All barangays ${ARROW}</a>
        </div>
        <div class="who">
          <h2>Who it is for</h2>
          <ul>
            <li><b>City Health Office</b><span>Runs LAMBAT after a flood: who to reach, how many capsules, where to set up.</span></li>
            <li><b>City disaster council (CDRRMO)</b><span>Acts on the dose point plan and opens barangay halls and evacuation centres.</span></li>
            <li><b>DOH regional office</b><span>Releases doxycycline stock using the weekly capsule count.</span></li>
          </ul>
        </div>
      </section>

      <section class="h-sec">
        <div class="sec-head"><h2>How it works</h2><a class="more" href="#/method">Method and limits ${ARROW}</a></div>
        <ol class="steps">${STEPS.map(([q, a], i) => `<li><span class="n">${i + 1}</span><b>${q}</b><p>${a}</p></li>`).join("")}</ol>
      </section>

      <section class="h-sec cards3">
        <a class="feature" href="#/radar"><span class="eyebrow">Flood from space</span><b>A U-Net reads radar through the clouds</b><p>Pooled overlap (IoU) of 0.64 against 0.21 for a simple threshold, on 90 test images of floods abroad.</p><span class="go">See the model ${ARROW}</span></a>
        <a class="feature" href="#/alert"><span class="eyebrow">Rain alert</span><b>Two weeks' warning for hospitals</b><p>Caught 36% of outbreak weeks with 1.7% false alerts in 2017 to 2019, against 21% for the seasonal average.</p><span class="go">See the alert ${ARROW}</span></a>
        <a class="feature" href="#/method"><span class="eyebrow">Honest limits</span><b>What LAMBAT cannot tell you yet</b><p>The ranking could not be confirmed against news reports of 13 floods. We say so, with the numbers.</p><span class="go">Read the checks ${ARROW}</span></a>
      </section>

      <blockquote class="quote">
        <p>“The flood was gone by the time Rosa's fever came. The capsule that could have protected her was free. But it was on the other side of the water.”</p>
        <cite>Rosa is a composite; the numbers are not.</cite>
      </blockquote>
    </div>
  </div>`;
  mountSearch(el.querySelector("#heroSearch"), { big: true, placeholder: "Check a barangay, e.g. Pantal", label: "Check a barangay" });

  const strip = el.querySelector("#strip");
  try {
    const n = await getNational();
    const cities = await getCities();
    const c = cities[0];
    const items = [
      [fmt(n.exposed), `residents exposed to floodwater${n.population ? `, ${pct(n.exposed / n.population)} of the city` : ""}`],
      [fmt(n.weekly_capsules), "doxycycline capsules needed for each week the water stays"],
      [fmt(n.access_gap ?? (c && c.access_gap)), "residents who can reach care on a dry day but not in the flood"],
      [c && c.coverage_after && c.coverage_after[3] != null ? pct(c.coverage_after[3]) : "n/a", "of exposed residents within a 30-minute walk of care once 3 dose points open"],
    ];
    strip.innerHTML = items.map(([v, l]) => `<div><dd class="num">${v}</dd><dt>${l}</dt></div>`).join("");
  } catch { strip.closest(".band").hidden = true; }

  try {
    const cities = await getCities();
    const city = cities[0] && (await getCity(cities[0].code));
    if (!city || !el.isConnected) return;
    const n = city.rows.length;
    el.querySelector("#toplist").innerHTML = [...city.rows].sort((a, b) => a.priority - b.priority).slice(0, 5).map((r) => {
      const t = tierOf(r.priority, n);
      return `<li><a href="${barangayHref(r.id)}"><span class="rk">${r.priority}</span><span class="nm">${esc(r.name)}<small>${fmt(r.unreached)} cut off from care · ${fmt(r.exposed)} exposed</small></span><span class="tier ${t.key}">${t.short}</span></a></li>`;
    }).join("");
    el.querySelector(".more[href^='#/city/']").href = `#/city/${cities[0].code}/barangays`;
    if (city.barangays && city.bbox) {
      el.querySelector("#pvName").textContent = city.meta.name;
      el.querySelector("#pvMap").innerHTML = previewSvg(city);
      el.querySelector("#preview").hidden = false;
    }
  } catch { /* the preview is optional */ }
}
