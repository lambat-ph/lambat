// "Find a barangay" combobox, used in the top bar, the home hero and the map panel.
// mountSearch(host, {onPick, placeholder, big}) — onPick(item) defaults to opening the barangay report.
import { barangayIndex, barangayHref, tierOf } from "./data.js";
import { esc } from "./format.js";

const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const ICON = '<svg class="bs-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
let uid = 0;

export function mountSearch(host, opts = {}) {
  const { placeholder = "Find a barangay", label = "Find a barangay", big = false, onPick = (it) => { location.hash = barangayHref(it.id); } } = opts;
  const id = "bs" + ++uid;
  host.classList.add("bsearch");
  if (big) host.classList.add("big");
  host.innerHTML = `<label class="sr-only" for="${id}">${esc(label)}</label>${ICON}
    <input id="${id}" class="bs-input" type="search" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id}-l" placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false">
    <ul class="bs-list" id="${id}-l" role="listbox" aria-label="Barangays" hidden></ul>`;
  const input = host.querySelector("input"), list = host.querySelector("ul");
  let items = [], active = -1, all = null;

  const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); active = -1; };
  const pick = (it) => { if (!it) return; input.value = ""; close(); input.blur(); onPick(it); };
  const draw = async () => {
    if (!all) { try { all = await barangayIndex(); } catch { all = []; } }
    const q = norm(input.value.trim());
    const multi = new Set(all.map((x) => x.cityCode)).size > 1;
    let head = "";
    if (!q) { items = [...all].sort((a, b) => a.priority - b.priority).slice(0, 5); head = "Top priority barangays"; }
    else {
      items = all.filter((x) => norm(x.name).includes(q) || norm(x.city).includes(q))
        .sort((a, b) => (norm(a.name).startsWith(q) ? 0 : 1) - (norm(b.name).startsWith(q) ? 0 : 1) || a.priority - b.priority).slice(0, 8);
    }
    list.innerHTML = (head ? `<li class="bs-head" role="presentation">${head}</li>` : "") + (items.length
      ? items.map((it, i) => { const t = tierOf(it.priority, it.n); return `<li role="option" id="${id}-o${i}" data-i="${i}" aria-selected="false"><span class="bs-name">${esc(it.name)}${multi ? `<small>${esc(it.city)}</small>` : ""}</span><span class="tier ${t ? t.key : ""}" title="${t ? t.label : ""}">#${it.priority}</span></li>`; }).join("")
      : '<li class="bs-empty" role="presentation">No barangay matches.</li>');
    list.hidden = false; input.setAttribute("aria-expanded", "true");
    active = -1;
  };
  const opts_ = () => [...list.querySelectorAll('[role="option"]')];
  input.addEventListener("focus", draw);
  input.addEventListener("input", draw);
  input.addEventListener("keydown", (e) => {
    const o = opts_();
    if (e.key === "ArrowDown") { e.preventDefault(); if (list.hidden) draw(); else markOpt(Math.min(o.length - 1, active + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); markOpt(Math.max(0, active - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); pick(items[active >= 0 ? active : 0]); }
    else if (e.key === "Escape") { close(); }
  });
  const markOpt = (i) => {
    active = i;
    opts_().forEach((li, j) => li.setAttribute("aria-selected", String(j === i)));
    const li = opts_()[i];
    if (li) { input.setAttribute("aria-activedescendant", li.id); li.scrollIntoView({ block: "nearest" }); }
  };
  list.addEventListener("mousedown", (e) => e.preventDefault());
  list.addEventListener("click", (e) => { const li = e.target.closest('[role="option"]'); if (li) pick(items[+li.dataset.i]); });
  input.addEventListener("blur", () => setTimeout(close, 120));
  return { focus: () => input.focus(), input };
}
