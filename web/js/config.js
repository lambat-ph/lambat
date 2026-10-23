// Shared constants. Colours here mirror the tokens in css/base.css.
export const REPO_URL = "https://github.com/bih-science/lambat";
export const DATA = "data";
export const COLORS = {
  blue: "#0038BD", blueDark: "#00267F", gold: "#EFBE01", bg: "#EEEEEE", card: "#FFFFFF",
  ink: "#141A2E", muted: "#4A5168", line: "#D3D6DE", blueTint: "#E3EAF8", grid: "#E1E4EB", seriesMuted: "#6A7188",
};
// Sequential ramp, light to dark, tints of the brand blue.
export const RAMP = ["#E3EAF8", "#AFC2EA", "#6F90D9", "#0038BD", "#001F6B"];
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
