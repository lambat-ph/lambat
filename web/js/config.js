// Shared constants. Colours here mirror the tokens in css/base.css.
export const REPO_URL = "https://github.com/bih-science/lambat";
export const DATA = "data";
const LIGHT_COLORS = {
  blue: "#0038BD", blueDark: "#00267F", gold: "#EFBE01", bg: "#EEEEEE", card: "#FFFFFF",
  ink: "#141A2E", muted: "#4A5168", line: "#D3D6DE", blueTint: "#E3EAF8", grid: "#E1E4EB", seriesMuted: "#6A7188",
};
const DARK_COLORS = {
  blue: "#3A66E8", blueDark: "#2F58DB", gold: "#EFBE01", bg: "#0B0E16", card: "#151A26",
  ink: "#FFFFFF", muted: "#A8B0C6", line: "#2A3042", blueTint: "#1F2B52", grid: "#232A3B", seriesMuted: "#9AA3BD",
};
// Sequential ramp, one hue, low to high. Light mode runs light to dark; dark mode runs dim to bright.
const LIGHT_RAMP = ["#E3EAF8", "#AFC2EA", "#6F90D9", "#0038BD", "#001F6B"];
const DARK_RAMP = ["#263A7A", "#3855B0", "#5A7FE0", "#97B3FF", "#DCE6FF"];
// COLORS and RAMP are live: they follow the system appearance, in place, so every importer sees the change.
export const COLORS = { ...LIGHT_COLORS };
export const RAMP = [...LIGHT_RAMP];
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
export const isDark = () => darkQuery.matches;
function applyScheme() {
  Object.assign(COLORS, isDark() ? DARK_COLORS : LIGHT_COLORS);
  RAMP.splice(0, RAMP.length, ...(isDark() ? DARK_RAMP : LIGHT_RAMP));
}
applyScheme();
// Maps and SVG previews bake colours in when they draw, so redraw the current page on a change.
darkQuery.addEventListener("change", () => { applyScheme(); window.dispatchEvent(new HashChangeEvent("hashchange")); });
// Dagupan City, the pilot. Used when only the flat data files exist.
export const FLAT_CITY = { code: "PH015518000", name: "Dagupan City", province: "Pangasinan", region: "Region I (Ilocos Region)" };
export const WALK_MIN = 30;
export const TERRARIUM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
// Light vector basemap (OpenFreeMap, no key). Falls back to OSM raster tiles.
export const BASE_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
export const BASEMAP = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const BASEMAP_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// Read a design token from CSS (optional helper).
export const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
export const ramp = () => RAMP;
