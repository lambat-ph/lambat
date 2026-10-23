import { getNational } from "../data.js";
import { fmt, useCss } from "../format.js";

export async function render(el) {
  useCss("home");
  el.innerHTML = `
  <div class="home">
    <div class="home-bg" aria-hidden="true">
      <div class="net"></div>
      <svg viewBox="0 0 1200 200" preserveAspectRatio="none"><path fill="currentColor" d="M0 90C100 50 200 50 300 90S500 130 600 90 800 50 900 90s200 40 300 0V200H0Z"/></svg>
      <svg viewBox="0 0 1200 200" preserveAspectRatio="none"><path fill="currentColor" d="M0 110C120 70 220 70 330 110S520 150 600 110 840 70 930 110s190 40 270 0V200H0Z"/></svg>
    </div>
    <div class="home-inner">
      <div class="brand-line"><img src="assets/favicon.svg" alt="" width="32" height="32">LAMBAT</div>
      <h1>Get the capsule to the other side of the water.</h1>
      <p class="lede">After a flood, LAMBAT shows a city health office who was exposed to floodwater, who can still walk to care, and where to open temporary doxycycline dose points.</p>
      <a class="btn btn-primary" href="#/map">Open the map
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
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
}
