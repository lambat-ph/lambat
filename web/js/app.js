// Hash router and shell. Pages live in js/pages/<name>.js and export
// `async function render(el, params)` and optionally `destroy()`.
import { REPO_URL } from "./config.js";
import { getCities } from "./data.js";

const I = (d) => `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  home: I('<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>'),
  map: I('<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/>'),
  dash: I('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
  sat: I('<circle cx="12" cy="12" r="2"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4"/><path d="M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2"/>'),
  book: I('<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Z"/><path d="M4 19a2 2 0 0 1 2-2h13"/>'),
  code: I('<path d="m8 8-5 4 5 4M16 8l5 4-5 4M14 5l-4 14"/>'),
  chev: I('<path d="m15 6-6 6 6 6"/>'),
};

const ROUTES = {
  home: { page: "home", nav: "home", title: "LAMBAT: get the capsule across the water" },
  map: { page: "map", nav: "map", title: "Map: LAMBAT" },
  city: { page: "city", nav: "city", title: "City dashboard: LAMBAT" },
  radar: { page: "radar", nav: "radar", title: "Flood from space: LAMBAT" },
  method: { page: "method", nav: "method", title: "Method and limits: LAMBAT" },
};
const NAV = [
  { id: "home", href: "#/", label: "Home", tab: "Home", icon: "home" },
  { id: "map", href: "#/map", label: "Map", tab: "Map", icon: "map" },
  { id: "city", href: "#/city", label: "City dashboard", tab: "Dashboard", icon: "dash" },
  { id: "radar", href: "#/radar", label: "Flood from space", tab: "Flood", icon: "sat" },
  { id: "method", href: "#/method", label: "Method and limits", tab: "Method", icon: "book" },
];

const root = document.documentElement;
const view = document.getElementById("view");
const nav = document.getElementById("nav");
const mq = window.matchMedia("(max-width:767px)");
let current = null;
let seq = 0;

// One highlight that slides between sidebar items (or tab-bar items on phones) instead of jumping.
function placeInd() {
  const ind = nav.querySelector(".nav-ind"), a = nav.querySelector('ul a.item[aria-current="page"]');
  if (!ind) return;
  if (!a) { ind.style.opacity = "0"; return; }
  const ul = ind.parentNode.getBoundingClientRect(), r = a.getBoundingClientRect();
  ind.style.opacity = "1";
  ind.style.width = r.width + "px"; ind.style.height = r.height + "px";
  ind.style.transform = `translate(${r.left - ul.left}px, ${r.top - ul.top}px)`;
}
window.addEventListener("resize", () => placeInd());

function mountNav() {
  nav.setAttribute("aria-label", "Main");
  nav.innerHTML = `
    <div class="nav-head">
      <a class="nav-brand" href="#/" aria-label="LAMBAT home"><img src="assets/logo-mark-white.svg" alt="" width="36" height="32"><span><img class="nav-word" src="assets/wordmark-white.svg" alt="LAMBAT" height="16"></span></a>
      <button class="nav-toggle" type="button" aria-label="Collapse the sidebar" aria-expanded="true">${ICON.chev}</button>
    </div>
    <ul><span class="nav-ind" aria-hidden="true"></span>${NAV.map((n) => `<li><a class="item" data-id="${n.id}" href="${n.href}" title="${n.label}">${ICON[n.icon]}<span class="lbl"></span></a></li>`).join("")}</ul>
    <div class="nav-foot"><a class="item" href="${REPO_URL}" title="Source code on GitHub" rel="noopener">${ICON.code}<span>Source code</span></a></div>`;
  const labels = () => nav.querySelectorAll("ul a.item").forEach((a, i) => { a.querySelector(".lbl").textContent = mq.matches ? NAV[i].tab : NAV[i].label; });
  labels(); mq.addEventListener("change", () => { labels(); placeInd(); });
  const btn = nav.querySelector(".nav-toggle");
  const sync = () => {
    const open = root.dataset.nav !== "closed";
    btn.setAttribute("aria-expanded", String(open));
    btn.setAttribute("aria-label", open ? "Collapse the sidebar" : "Expand the sidebar");
  };
  sync();
  btn.addEventListener("click", () => {
    root.dataset.nav = root.dataset.nav === "closed" ? "open" : "closed";
    try { localStorage.setItem("lambat.nav", root.dataset.nav); } catch {} setTimeout(placeInd, 250);
    sync();
    setTimeout(() => window.dispatchEvent(new Event("resize")), 260);
  });
}

function parse() {
  const h = location.hash.replace(/^#\/?/, "");
  const [path, qs] = h.split("?");
  const seg = path.split("/").filter(Boolean).map(decodeURIComponent);
  return { key: seg[0] || "home", code: seg[1] || null, tab: seg[2] || null, query: new URLSearchParams(qs || ""), segments: seg };
}

function message(title, text) {
  view.innerHTML = `<div style="padding:48px 24px;max-width:560px"><h1 class="num" style="font-size:var(--t-lg)">${title}</h1><p class="muted" style="margin:8px 0 16px">${text}</p><a class="btn" href="#/">Back to home</a></div>`;
}

async function go() {
  const my = ++seq;
  const p = parse();
  if (p.key === "city" && !p.code) {
    const cities = await getCities().catch(() => []);
    if (cities[0]) { location.replace(`#/city/${cities[0].code}`); return; }
  }
  if (current && current.mod && current.mod.destroy) { try { current.mod.destroy(); } catch (e) { console.warn(e); } }
  current = null;
  view.replaceChildren();
  const r = ROUTES[p.key];
  document.body.className = "route-" + (r ? p.key : "notfound");
  document.title = r ? r.title : "Page not found: LAMBAT";
  nav.querySelectorAll("ul a.item").forEach((a) => {
    if (r && a.dataset.id === r.nav) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  placeInd();
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
  try {
    await mod.render(view, { code: p.code, tab: p.tab, query: p.query, segments: p.segments });
    // the new page eases in; the sidebar highlight has already slid to its tab
    if (my === seq && !matchMedia("(prefers-reduced-motion: reduce)").matches && view.animate)
      view.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 240, easing: "cubic-bezier(.3,.9,.3,1)" });
  } catch (e) {
    console.error(e);
    message("Something went wrong", "This page could not be drawn: " + e.message);
  }
  view.removeAttribute("aria-busy");
  if (my === seq && p.key !== "map") window.scrollTo(0, 0);
}

document.getElementById("skip").addEventListener("click", (e) => { e.preventDefault(); view.focus(); });
mountNav();
window.addEventListener("hashchange", go);
go();
