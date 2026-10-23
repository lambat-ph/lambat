const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
export const fmt = (v) => (v == null || Number.isNaN(+v) ? "n/a" : nf.format(Math.round(v)));
export const pct = (v, d = 0) => (v == null || Number.isNaN(+v) ? "n/a" : (v * 100).toFixed(d) + "%");
export const dec = (v, d = 2) => (v == null || Number.isNaN(+v) ? "n/a" : (+v).toFixed(d));
export function compact(v) {
  if (v == null) return "";
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (a >= 1e4) return Math.round(v / 1e3) + "k";
  if (a >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
  if (a > 0 && a < 1) return v.toFixed(2).replace(/0$/, "");
  return String(Math.round(v));
}
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
export function el(tag, attrs = {}, html = "") {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (html) e.innerHTML = html;
  return e;
}
export function useCss(name) {
  const href = `css/${name}.css`;
  if (!document.querySelector(`link[data-css="${name}"]`)) {
    const l = document.createElement("link");
    l.rel = "stylesheet"; l.href = href; l.dataset.css = name;
    document.head.appendChild(l);
  }
}
// Skeleton placeholders. skel(3) = three text lines; or a shape: "stat", "chart", "list", "rows".
// Always aria-hidden: put aria-busy="true" on the container and remove it when real content lands.
export function skel(a = 1, o = {}) {
  const line = (w) => `<span class="skel skel-line" style="--w:${w}%"></span>`;
  if (typeof a === "number") return `<div class="skel-lines" aria-hidden="true">${Array.from({ length: a }, (_, i) => line(i === a - 1 && a > 1 ? 60 : 100)).join("")}</div>`;
  if (a === "stat") return `<div class="card stat skel-card" aria-hidden="true">${line(45)}<span class="skel skel-big"></span>${line(90)}</div>`;
  if (a === "chart") return `<div class="skel skel-chart" style="--h:${o.h || 240}px" aria-hidden="true"></div>`;
  if (a === "list") return `<div class="skel-list" aria-hidden="true">${Array.from({ length: o.n || 3 }, () => `<div class="skel-item"><span class="skel skel-dot"></span><span>${line(70)}${line(45)}</span></div>`).join("")}</div>`;
  if (a === "rows") return Array.from({ length: o.n || 6 }, () => `<tr class="skel-row" aria-hidden="true">${Array.from({ length: o.cols || 4 }, (_, i) => `<td>${line(i ? 60 : 80)}</td>`).join("")}</tr>`).join("");
  return "";
}
