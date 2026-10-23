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
