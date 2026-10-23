// Rain alert: should hospitals get ready? Reuses the scoring panel from the dashboard.
import { getCities } from "../data.js";
import { esc, useCss } from "../format.js";
import { loadAny, model, alertPanel } from "./city.js";

export async function render(el, params) {
  useCss("city");
  el.innerHTML = '<div class="page"><p class="muted" role="status">Loading the alert.</p></div>';
  const cities = await getCities().catch(() => []);
  const code = params.code || (cities[0] && cities[0].code);
  let m;
  try {
    const raw = await loadAny(code);
    if (!raw || !raw.barangays) throw new Error((raw && raw.error) || "No data.");
    m = model(raw);
  } catch (e) {
    el.innerHTML = `<div class="page narrow"><h1 class="page-title">Rain alert</h1><p class="notice" role="alert">The alert could not be loaded: ${esc(e.message)}</p></div>`;
    return;
  }
  const name = m.meta.name || "the city";
  el.innerHTML = `
  <div class="page city">
    <header class="page-head">
      <p class="eyebrow">Rain alert · ${esc(name)}</p>
      <h1>Should hospitals get ready?</h1>
      <p class="lede">Leptospirosis follows heavy rain by 2 to 4 weeks. The rain model uses that lag to warn hospitals two weeks ahead of weeks with unusually many cases, on a separate clock from the flood map.</p>
    </header>
    <ol class="how3">
      <li><b>Rain falls</b><span>Daily rainfall over the city's barangays, from Project CCHAIN.</span></li>
      <li><b>Two to four weeks pass</b><span>Cases rise after people wade through floodwater (pooled r = 0.29 across cities; ${esc(name)} r = 0.45).</span></li>
      <li><b>Alert two weeks ahead</b><span>An outbreak week is one above the 90th percentile of the training years (2008 to 2016).</span></li>
    </ol>
    ${alertPanel(m)}
    <div class="card" style="margin-top:var(--s2)">
      <h2 class="card-title">How to read this</h2>
      <ul class="plain">
        <li>This is an <b>alert</b>, not a forecast of how many people will fall ill. All three methods raise the same number of alerts, so the scores compare like with like.</li>
        <li>It was tested on 2017 to 2019 after training on 2008 to 2016. Case data ends in 2022, so it is not running live.</li>
        <li>It cannot see tidal flooding, which floods parts of ${esc(name)} without rain.</li>
      </ul>
    </div>
  </div>`;
}
