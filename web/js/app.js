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
  home: { page: "home", nav: "home", title: "LAMBAT: Cast the net where the people are" },
  map: { page: "map", nav: "map", title: "Map: LAMBAT" },
  city: { page: "city", nav: "city", title: "City dashboard: LAMBAT" },
  radar: { page: "radar", nav: "radar", title: "Satellite flood maps: LAMBAT" },
  method: { page: "method", nav: "method", title: "Method and limits: LAMBAT" },
};
const NAV = [
  { id: "home", href: "#/", label: "Home", tab: "Home", icon: "home" },
  { id: "map", href: "#/map", label: "Map", tab: "Map", icon: "map" },
  { id: "city", href: "#/city", label: "City dashboard", tab: "Dashboard", icon: "dash" },
  { id: "radar", href: "#/radar", label: "Satellite flood maps", tab: "Satellite", icon: "sat" },
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
      <a class="nav-brand" href="#/" aria-label="LAMBAT home"><img src="assets/logo-mark-white.svg" alt="" width="34" height="30"><span><svg class="nav-word" viewBox="0 0 188.02 34.69" height="18" fill="currentColor" role="img" aria-label="LAMBAT"><path class="ltr" style="--i:0" d="M6.85,29.1V0H0v34.69h18.54l2.4-5.59H6.85Z"/><path class="ltr" style="--i:1" d="M44.93,0h-6.85l-12.47,29.1-2.4,5.59h7.3l4.27-9.74h13.5l4.27,9.74h7.24L44.93,0ZM37.18,19.36l4.39-9.73,4.27,9.73h-8.65Z"/><path class="ltr" style="--i:2" d="M96.76,34.69h-6.85V14.6l-10.02,20.09-10.02-20.09v20.09h-6.85V0h6.85l10.02,19.47L89.91,0h6.85v34.69Z"/><path class="ltr" style="--i:3" d="M130.75,24.34c0,2.79-1.04,5.22-3.13,7.27-2.09,2.05-5.14,3.08-9.14,3.08h-17.06V0h16.41c3.4,0,6.25.84,8.53,2.51,2.28,1.67,3.42,4.01,3.42,7.02-.04,3.49-1.44,5.9-4.2,7.25,3.45,1.55,5.17,4.07,5.17,7.56ZM123.71,24.49c-.04-1.28-.52-2.35-1.42-3.24-.9-.88-2.09-1.34-3.55-1.37h-10.53v9.32h10.27c1.59,0,2.86-.48,3.81-1.45.95-.97,1.42-2.05,1.42-3.26ZM123.19,9.94c0-1.28-.42-2.31-1.26-3.11-.84-.79-2.06-1.19-3.65-1.19h-10.02v8.44h9.95c1.46,0,2.65-.44,3.55-1.32.91-.88,1.38-1.82,1.42-2.82Z"/><path class="ltr" style="--i:4" d="M167.33,34.69h-7.24l-4.26-9.73h-13.51l-4.26,9.73h-7.3L145.62,0h6.85l14.86,34.69ZM153.37,19.37l-4.26-9.73-4.39,9.73h8.66Z"/><path class="ltr" style="--i:5" d="M188.02,4.87h-10.02v29.82h-6.85V4.87h-9.89V0h26.75v4.87Z"/></svg></span></a>
      <button class="nav-toggle" type="button" aria-label="Collapse the sidebar" aria-expanded="true">${ICON.chev}</button>
    </div>
    <ul><span class="nav-ind" aria-hidden="true"></span>${NAV.map((n) => `<li><a class="item" data-id="${n.id}" href="${n.href}" title="${n.label}">${ICON[n.icon]}<span class="lbl"></span></a></li>`).join("")}</ul>
    <div class="nav-foot"><a class="item" href="${REPO_URL}" title="Source code on GitHub" rel="noopener">${ICON.code}<span>Source code</span></a></div>`;
  const labels = () => nav.querySelectorAll("ul a.item").forEach((a, i) => { a.querySelector(".lbl").textContent = mq.matches ? NAV[i].tab : NAV[i].label; });
  labels(); mq.addEventListener("change", () => { labels(); placeInd(); });
  // A scrollbar appearing or the sidebar collapsing resizes the list without a window resize event
  if ("ResizeObserver" in window) new ResizeObserver(() => placeInd()).observe(nav.querySelector("ul"));
  const btn = nav.querySelector(".nav-toggle");
  const sync = () => {
    const open = root.dataset.nav !== "closed";
    btn.setAttribute("aria-expanded", String(open));
    btn.setAttribute("aria-label", open ? "Collapse the sidebar" : "Expand the sidebar");
  };
  sync();
  // The mark and the arrow glide between side by side (open) and stacked (closed) instead of jumping.
  const glide = (change) => {
    const els = [nav.querySelector(".nav-brand"), btn]; // the whole brand moves: its own overflow clip would hide a moving mark
    const before = els.map((e) => e.getBoundingClientRect());
    change();
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    els.forEach((e, k) => {
      const a = before[k], b = e.getBoundingClientRect();
      const dx = a.left - b.left, dy = a.top - b.top;
      if (dx || dy) e.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 240, easing: "cubic-bezier(.3,.9,.3,1)" });
    });
  };
  const set = (state) => {
    root.dataset.nav = state;
    try { localStorage.setItem("lambat.nav", state); } catch {}
    setTimeout(placeInd, 250);
    sync();
    setTimeout(() => window.dispatchEvent(new Event("resize")), 260);
  };
  btn.addEventListener("click", () => {
    if (nav.classList.contains("unweave")) return;
    if (root.dataset.nav === "closed") return glide(() => set("open"));
    // Closing: the letters unweave back to bare strands, last letter first, then the sidebar folds.
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return set("closed");
    // The sidebar starts narrowing at once; the letters leave right to left as its edge passes them.
    nav.classList.add("unweave");
    set("closed");
    setTimeout(() => glide(() => nav.classList.remove("unweave")), 260);
  });
}

function parse() {
  const h = location.hash.replace(/^#\/?/, "");
  const [path, qs] = h.split("?");
  const seg = path.split("/").filter(Boolean).map(decodeURIComponent);
  return { key: seg[0] || "home", code: seg[1] || null, tab: seg[2] || null, query: new URLSearchParams(qs || ""), segments: seg };
}

// Each page's stylesheet is loaded before the page draws, so it never shows unstyled for a frame.
function pageCss(name) {
  let l = document.querySelector(`link[href="css/${name}.css"]`);
  if (l && l.sheet) return Promise.resolve();
  if (!l) {
    l = document.createElement("link");
    l.rel = "stylesheet"; l.href = `css/${name}.css`; l.dataset.css = name;
    document.head.appendChild(l);
  }
  return new Promise((res) => {
    l.addEventListener("load", res, { once: true });
    l.addEventListener("error", res, { once: true });
    setTimeout(res, 4000);
  });
}

// The boot loader in index.html covers the blank page until the first page has drawn.
function bootDone() {
  const b = document.getElementById("boot");
  if (!b || b.dataset.done) return;
  b.dataset.done = "1"; b.classList.add("gone");
  setTimeout(() => b.remove(), 400);
}
setTimeout(bootDone, 12000);

function message(title, text) {
  bootDone();
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
  // Placeholder while the page's code and stylesheet download; the page replaces it when it draws.
  if (p.key !== "map") view.innerHTML = `<div class="page-skel" aria-hidden="true"><span class="skel skel-line" style="--w:18%"></span><span class="skel skel-big" style="--w:62%"></span><div class="skel-lines"><span class="skel skel-line" style="--w:100%"></span><span class="skel skel-line" style="--w:72%"></span></div><div class="page-skel-row"><div class="card stat skel-card"><span class="skel skel-line" style="--w:45%"></span><span class="skel skel-big"></span></div><div class="card stat skel-card"><span class="skel skel-line" style="--w:45%"></span><span class="skel skel-big"></span></div><div class="card stat skel-card"><span class="skel skel-line" style="--w:45%"></span><span class="skel skel-big"></span></div></div></div>`;
  let mod;
  try {
    [mod] = await Promise.all([import(`./pages/${r.page}.js`), pageCss(r.page)]);
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
  if (my === seq) bootDone();
  if (my === seq && p.key !== "map") window.scrollTo(0, 0);
}

document.getElementById("skip").addEventListener("click", (e) => { e.preventDefault(); view.focus(); });
mountNav();
window.addEventListener("hashchange", go);
go();
