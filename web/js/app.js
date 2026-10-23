// Hash router and shell. Pages live in js/pages/<name>.js and export
// `async function render(el, params)` and optionally `destroy()`.
import { REPO_URL } from "./config.js";
import { getCities } from "./data.js";
import { mountSearch } from "./search.js";

const ROUTES = {
  home: { page: "home", nav: null, title: "LAMBAT: get the capsule across the water" },
  map: { page: "map", nav: "map", title: "Map: LAMBAT" },
  city: { page: "city", nav: "city", title: "Dashboard: LAMBAT" },
  barangay: { page: "barangay", nav: "city", title: "Barangay report: LAMBAT" },
  alert: { page: "alert", nav: "alert", title: "Rain alert: LAMBAT" },
  method: { page: "method", nav: "method", sub: "method", title: "How it works: LAMBAT" },
  radar: { page: "radar", nav: "method", sub: "radar", title: "Flood from space: LAMBAT" },
  about: { page: "about", nav: "about", title: "About: LAMBAT" },
};
const NAV = [
  { id: "map", href: "#/map", label: "Map" },
  { id: "city", href: "#/city", label: "Dashboard" },
  { id: "alert", href: "#/alert", label: "Rain alert" },
  { id: "method", href: "#/method", label: "How it works" },
  { id: "about", href: "#/about", label: "About" },
];
const SUBNAV = [
  { id: "method", href: "#/method", label: "Method and limits" },
  { id: "radar", href: "#/radar", label: "Flood from space (U-Net)" },
];

const view = document.getElementById("view");
const bar = document.getElementById("topbar");
const foot = document.getElementById("foot");
let current = null;
let seq = 0;

function mountShell() {
  bar.innerHTML = `
    <div class="tb-in">
      <a class="brand" href="#/" aria-label="LAMBAT home">
        <img src="assets/favicon.svg" alt="" width="28" height="28">
        <span class="brand-t"><b>LAMBAT</b><small>Dagupan City pilot</small></span>
      </a>
      <nav class="mainnav" id="mainnav" aria-label="Main">
        <ul>${NAV.map((n) => `<li><a data-id="${n.id}" href="${n.href}">${n.label}</a></li>`).join("")}</ul>
        <div class="tb-search" id="tbSearchM"></div>
      </nav>
      <div class="tb-search" id="tbSearch"></div>
      <button class="menu-btn" id="menuBtn" type="button" aria-expanded="false" aria-controls="mainnav" aria-label="Open menu">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path class="m1" d="M4 7h16"/><path class="m2" d="M4 12h16"/><path class="m3" d="M4 17h16"/></svg>
      </button>
    </div>`;
  mountSearch(bar.querySelector("#tbSearch"));
  mountSearch(bar.querySelector("#tbSearchM"));
  const btn = bar.querySelector("#menuBtn");
  const set = (open) => {
    document.body.classList.toggle("menu-open", open);
    btn.setAttribute("aria-expanded", String(open));
    btn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  };
  btn.addEventListener("click", () => set(!document.body.classList.contains("menu-open")));
  window.addEventListener("hashchange", () => set(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && document.body.classList.contains("menu-open")) { set(false); btn.focus(); } });

  foot.innerHTML = `
    <div class="foot-in">
      <div class="foot-brand">
        <a class="brand" href="#/"><img src="assets/favicon.svg" alt="" width="24" height="24"><span class="brand-t"><b>LAMBAT</b></span></a>
        <p>Leptospirosis Alert, Mapping and Barangay Allocation Tool. Built by team BIH-SCIENCE for the Philippine Junior Data Science Challenge 2026.</p>
      </div>
      <nav class="foot-links" aria-label="Footer">
        <a href="#/map">Map</a><a href="#/city">Dashboard</a><a href="#/alert">Rain alert</a><a href="#/method">How it works</a><a href="#/about">About</a><a href="${REPO_URL}" rel="noopener">Source code</a>
      </nav>
      <p class="foot-note"><b>A planning aid, not an official advisory.</b> Figures are model estimates for a 25-year flood scenario. They count places, not patients, and do not forecast cases. Follow DOH and City Health Office guidance for treatment.</p>
      <p class="foot-note">Data: Project CCHAIN (CC BY 4.0), UP NOAH, WorldPop, OpenStreetMap contributors, Copernicus Sentinel-1, Sen1Floods11.</p>
    </div>`;
}

function parse() {
  const h = location.hash.replace(/^#\/?/, "");
  const [path, qs] = h.split("?");
  const seg = path.split("/").filter(Boolean).map(decodeURIComponent);
  return { key: seg[0] || "home", code: seg[1] || null, tab: seg[2] || null, query: new URLSearchParams(qs || ""), segments: seg };
}

function message(title, text) {
  view.innerHTML = `<div class="page narrow" style="padding-top:64px"><h1 class="page-title">${title}</h1><p class="muted" style="margin:8px 0 16px">${text}</p><a class="btn" href="#/">Back to home</a></div>`;
}

async function go() {
  const my = ++seq;
  const p = parse();
  if (p.key === "city" && p.tab === "alert") { location.replace("#/alert"); return; }
  if ((p.key === "city" || p.key === "alert") && !p.code) {
    const cities = await getCities().catch(() => []);
    if (cities[0]) { location.replace(`#/${p.key}/${cities[0].code}`); return; }
  }
  if (current && current.mod && current.mod.destroy) { try { current.mod.destroy(); } catch (e) { console.warn(e); } }
  current = null;
  view.replaceChildren();
  const r = ROUTES[p.key];
  document.body.className = "route-" + (r ? p.key : "notfound");
  document.title = r ? r.title : "Page not found: LAMBAT";
  bar.querySelectorAll(".mainnav a[data-id]").forEach((a) => {
    if (r && a.dataset.id === r.nav) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  if (!r) return message("Page not found", "That address does not match a LAMBAT page.");
  view.setAttribute("aria-busy", "true");
  let mod;
  try {
    mod = await import(`./pages/${r.page}.js`);
  } catch (e) {
    if (my !== seq) return;
    console.warn(e);
    view.removeAttribute("aria-busy");
    return message("This page is not ready yet", "The page " + r.page + " could not be loaded.");
  }
  if (my !== seq) return;
  current = { mod };
  let host = view;
  if (r.sub) {
    view.innerHTML = `<nav class="subnav" aria-label="How it works"><div class="subnav-in">${SUBNAV.map((s) => `<a href="${s.href}"${s.id === r.sub ? ' aria-current="page"' : ""}>${s.label}</a>`).join("")}</div></nav><div></div>`;
    host = view.lastElementChild;
  }
  try {
    await mod.render(host, { code: p.code, tab: p.tab, query: p.query, segments: p.segments });
  } catch (e) {
    console.error(e);
    message("Something went wrong", "This page could not be drawn: " + e.message);
  }
  view.removeAttribute("aria-busy");
  if (my === seq && p.key !== "map") window.scrollTo(0, 0);
}

document.getElementById("skip").addEventListener("click", (e) => { e.preventDefault(); view.focus(); });
mountShell();
window.addEventListener("hashchange", go);
go();
