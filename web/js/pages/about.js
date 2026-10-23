// About: who built LAMBAT, for whom, with what data, and what it is not.
import { REPO_URL } from "../config.js";
import { useCss } from "../format.js";

const TEAM = ["Gavrie Alistair Aquino", "Ezra Jeonadab Del Rosario", "Clarence Pagaduan", "Paul Andrei Recio", "VL Kirsten Camille Saguin"];
const DATA = [
  ["Project CCHAIN", "Thinking Machines Data Science", "Weekly leptospirosis cases and daily barangay rainfall, 2008 to 2022. CC BY 4.0.", "https://www.kaggle.com/datasets/thinkdatasci/project-cchain"],
  ["UP NOAH hazard maps", "UP Resilience Institute", "Flood hazard extent and depth for 5-, 25- and 100-year rain.", "https://noah.up.edu.ph"],
  ["WorldPop", "University of Southampton", "Gridded population estimates.", "https://www.worldpop.org"],
  ["OpenStreetMap", "OpenStreetMap contributors", "Roads, clinics, barangay halls, schools and evacuation centres. ODbL.", "https://www.openstreetmap.org/copyright"],
  ["Copernicus Sentinel-1", "European Space Agency", "Radar images that see floodwater through cloud.", "https://dataspace.copernicus.eu"],
  ["Sen1Floods11", "Bonafilia et al., 2020", "Hand-labelled radar flood images used to train and test the U-Net.", "https://github.com/cloudtostreet/Sen1Floods11"],
];

export async function render(el) {
  useCss("about");
  el.innerHTML = `
  <div class="page narrow about">
    <header class="page-head">
      <p class="eyebrow">About</p>
      <h1>A net is only as good as where you cast it</h1>
      <p class="lede"><i>Lambat</i> is Filipino for net. LAMBAT stands for Leptospirosis Alert, Mapping and Barangay Allocation Tool.</p>
    </header>

    <section class="card">
      <h2 class="card-title">Why it exists</h2>
      <p>By September 2026 the Philippines had 10,936 suspected leptospirosis cases, 3,005 more than a year earlier, while 3.73 million doxycycline capsules sat in government warehouses. The medicine exists. The hard part is getting it across the water to the people who waded through it.</p>
      <p>LAMBAT is the map for that job: for a city health office in the days after a flood. The pilot is Dagupan City, Pangasinan, with all 31 barangays.</p>
    </section>

    <section class="card">
      <h2 class="card-title">Who uses it</h2>
      <dl class="who2">
        <div><dt>City Health Office</dt><dd>Runs the tool after a flood and prints a sheet for each priority barangay.</dd></div>
        <div><dt>City disaster council (CDRRMO)</dt><dd>Opens the suggested dose points in barangay halls, schools and evacuation centres.</dd></div>
        <div><dt>DOH regional office</dt><dd>Releases doxycycline stock using the weekly capsule count.</dd></div>
      </dl>
      <p class="muted sm">Residents are the people LAMBAT serves, not its users. It holds no personal data: every input is public.</p>
    </section>

    <section class="card notice-card">
      <h2 class="card-title">What LAMBAT is not</h2>
      <ul class="plain">
        <li>It is a planning aid, not an official hazard advisory or a medical service. Follow DOH and your City Health Office.</li>
        <li>It counts places, not patients, and never estimates lives saved.</li>
        <li>Its barangay ranking could not yet be confirmed against news reports of past floods. <a href="#/method">See the checks.</a></li>
      </ul>
    </section>

    <section class="card">
      <h2 class="card-title">Data we stand on</h2>
      <ul class="data">${DATA.map(([n, by, what, url]) => `<li><a href="${url}" rel="noopener"><b>${n}</b></a><small>${by}</small><span>${what}</span></li>`).join("")}</ul>
      <p class="muted sm">Full references are on the <a href="#/method">Method and limits</a> page.</p>
    </section>

    <section class="card">
      <h2 class="card-title">Team BIH-SCIENCE</h2>
      <p>Built for the Philippine Junior Data Science Challenge 2026.</p>
      <ul class="team">${TEAM.map((t) => `<li><span class="av" aria-hidden="true">${t[0]}${t.split(" ").pop()[0]}</span>${t}</li>`).join("")}</ul>
      <p><a class="btn ghost sm" href="${REPO_URL}" rel="noopener">Code on GitHub</a></p>
    </section>
  </div>`;
}
