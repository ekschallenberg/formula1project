// Shared colours, number formatting and Chart.js styling for both pages.

// Team-family colours from the poster. Red Bull's navy is lifted for chart marks so it
// stays visible on the dark panels; the poster navy is still used for the card tops.
export const TEAM_COLORS = {
  "Ferrari": "#DC0000",
  "Williams": "#1E44FF",
  "McLaren": "#FD8000",
  "Red Bull": "#4557C4",
  "Mercedes": "#00A09A",
  "Aston Martin": "#0E9A83",
  "Alpine": "#FF67ED",
  "Haas": "#C21A1A",
  "Sauber": "#53E254",
  "VCARB": "#58B6FF",
  "Cadillac": "#C54CFF", // new in 2026; takes the poster's unused F1 Academy purple
  "Defunct": "#979797",
};

export const F1_RED = "#FC1F04";
export const ACADEMY = "#C54CFF"; // purple = fastest lap, as on F1 timing screens
export const MUTED = "#4a4a55";

// Fixed categorical order for breakdowns that have no team colour (driver, nationality, GP).
export const CATEGORICAL = ["#FD8000", "#58B6FF", "#53E254", "#FF67ED", "#C54CFF", "#00A09A"];

const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const fmtInt = (v) => (v == null || Number.isNaN(v) ? "–" : nf0.format(v));
export const fmt1 = (v) => (v == null || Number.isNaN(v) ? "–" : nf1.format(v));
export const fmtPct = (v) => (v == null || Number.isNaN(v) ? "–" : nf1.format(v) + "%");

// Lap time in seconds -> "1:12.909"
export function fmtLap(seconds, digits = 3) {
  if (seconds == null || Number.isNaN(seconds)) return "–";
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  // seconds part is always two digits before the decimal point: "1:05.2", "1:28"
  return `${m}:${s.toFixed(digits).padStart(digits ? digits + 3 : 2, "0")}`;
}

export function applyChartDefaults(Chart) {
  Chart.defaults.color = "#B9B9C3";
  Chart.defaults.font.family = '"Titillium Web", "Segoe UI", system-ui, sans-serif';
  Chart.defaults.font.size = 13;
  Chart.defaults.borderColor = "rgba(255,255,255,0.08)";
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.animation.duration = 350;
  Chart.defaults.plugins.legend.display = false;
  Chart.defaults.interaction.mode = "index";
  Chart.defaults.interaction.intersect = false;
  const tt = Chart.defaults.plugins.tooltip;
  tt.backgroundColor = "#0a0a0c";
  tt.borderColor = "#3a3a44";
  tt.borderWidth = 1;
  tt.titleColor = "#fff";
  tt.bodyColor = "#E9E9EE";
  tt.padding = 10;
  tt.boxPadding = 4;
  tt.titleFont = { weight: "700" };
  Chart.defaults.elements.bar.borderRadius = 4;
  Chart.defaults.elements.bar.borderSkipped = "start";
  Chart.defaults.elements.line.borderWidth = 2;
  Chart.defaults.elements.line.tension = 0.25;
  Chart.defaults.elements.point.radius = 3;
  Chart.defaults.elements.point.hoverRadius = 6;
  Chart.defaults.elements.point.hitRadius = 10;
  Chart.defaults.scale.grid.color = "rgba(255,255,255,0.07)";
  Chart.defaults.scale.border = { display: false };
}
