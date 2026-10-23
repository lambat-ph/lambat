// Small inline-SVG charts. No library. Colours come from CSS tokens.
import { token } from "./config.js";
import { pct, esc, dec } from "./format.js";

// Coverage: share of exposed residents within a 30 minute walk of care.
export function coverageChart(host, cov, plans = ["3", "5", "8"]) {
  const bars = [];
  if (cov.dry != null) bars.push({ k: "Dry day", sub: "no flood", v: cov.dry, kind: "base" });
  if (cov.flood != null) bars.push({ k: "In the flood", sub: "no dose points", v: cov.flood, kind: "flood" });
  plans.forEach((p) => { if (cov.plans && cov.plans[p] != null) bars.push({ k: "+" + p + " points", sub: "dose points open", v: cov.plans[p], kind: "plan" }); });
  const W = 640, H = 300, L = 44, R = 12, T = 28, B = 56;
  const bw = Math.min(72, (W - L - R) / bars.length - 16);
  const step = (W - L - R) / bars.length;
  const Y = (v) => T + (H - T - B) * (1 - v);
  const blue = token("--blue"), ink = token("--ink"), gold = token("--gold"), grid = token("--grid"), tint = token("--ramp-2");
  let s = "";
  [0, .25, .5, .75, 1].forEach((g) => { s += `<line x1="${L}" x2="${W - R}" y1="${Y(g)}" y2="${Y(g)}" stroke="${grid}"/><text x="${L - 8}" y="${Y(g) + 4}" text-anchor="end">${Math.round(g * 100)}%</text>`; });
  bars.forEach((b, i) => {
    const x = L + step * i + (step - bw) / 2, y = Y(b.v), h = Y(0) - y;
    const fill = b.kind === "plan" ? gold : b.kind === "flood" ? blue : tint;
    const stroke = b.kind === "plan" ? ink : b.kind === "base" ? blue : "none";
    s += `<rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="${stroke === "none" ? 0 : 1.5}"/>`;
    s += `<text class="val" x="${x + bw / 2}" y="${y - 8}" text-anchor="middle">${pct(b.v, 0)}</text>`;
    s += `<text x="${x + bw / 2}" y="${H - 30}" text-anchor="middle" style="fill:${ink};font-weight:600">${esc(b.k)}</text><text x="${x + bw / 2}" y="${H - 14}" text-anchor="middle">${esc(b.sub)}</text>`;
  });
  const desc = "Share of exposed residents within a 30 minute walk of care. " + bars.map((b) => `${b.k}: ${pct(b.v, 0)}`).join(". ") + ".";
  host.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(desc)}">${s}</svg>`;
  return desc;
}

// Weekly cases: actual vs rain model vs seasonal average.
export function weeklyChart(host, readout, series, label) {
  const W = 760, H = 300, L = 40, R = 12, T = 12, B = 30, n = series.length;
  const mx = Math.max(2, Math.ceil(Math.max(...series.map((d) => Math.max(d.actual, d.rain, d.seasonal)))));
  const X = (i) => L + ((W - L - R) * i) / (n - 1), Y = (v) => T + (H - T - B) * (1 - v / mx);
  const blue = token("--blue"), ink = token("--ink"), grey = token("--series-muted"), grid = token("--grid");
  let s = "";
  const stepY = mx > 8 ? 2 : 1;
  for (let g = 0; g <= mx; g += stepY) s += `<line x1="${L}" x2="${W - R}" y1="${Y(g)}" y2="${Y(g)}" stroke="${grid}"/><text x="${L - 8}" y="${Y(g) + 4}" text-anchor="end">${g}</text>`;
  const seen = {};
  series.forEach((d, i) => { const y = d.week.slice(0, 4); if (!seen[y]) { seen[y] = 1; s += `<line x1="${X(i)}" x2="${X(i)}" y1="${T}" y2="${H - B}" stroke="${grid}"/><text x="${X(i) + 4}" y="${H - 10}">${y}</text>`; } });
  const pl = (key, color, w, dash) => `<polyline fill="none" stroke="${color}" stroke-width="${w}" stroke-linejoin="round"${dash ? ' stroke-dasharray="6 4"' : ""} points="${series.map((d, i) => X(i).toFixed(1) + "," + Y(d[key]).toFixed(1)).join(" ")}"/>`;
  s += pl("seasonal", grey, 2, true) + pl("rain", blue, 2.6) + pl("actual", ink, 1.6);
  s += `<line id="xh" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="${ink}" stroke-width="1" visibility="hidden"/>`;
  host.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}" style="touch-action:pan-y">${s}<text x="${L}" y="10" style="font-weight:600">cases per week</text></svg>`;
  const svg = host.querySelector("svg"), xh = svg.querySelector("#xh");
  const show = (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - L) / (W - L - R)) * (n - 1))));
    const d = series[i];
    xh.setAttribute("x1", X(i)); xh.setAttribute("x2", X(i)); xh.setAttribute("visibility", "visible");
    readout.textContent = `Week of ${d.week}: ${d.actual} actual, ${dec(d.rain, 1)} rain model, ${dec(d.seasonal, 1)} seasonal average.`;
  };
  svg.addEventListener("pointermove", show);
  svg.addEventListener("pointerdown", show);
  svg.addEventListener("pointerleave", () => { xh.setAttribute("visibility", "hidden"); readout.textContent = ""; });
}

// Share ring
export function ring(host, share, label) {
  const C = 2 * Math.PI * 42;
  host.innerHTML = `<svg viewBox="0 0 100 100" width="96" height="96" role="img" aria-label="${esc(label)}"><circle cx="50" cy="50" r="42" fill="none" stroke="${token("--ramp-1")}" stroke-width="12"/><circle cx="50" cy="50" r="42" fill="none" stroke="${token("--blue")}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${(C * share).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 50 50)"/></svg>`;
}
