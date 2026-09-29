// Check that the dashboard's calculations (js/metrics.js) reproduce every number in
// data/report_data.json, which scripts/build_data.py computes with pandas, and that every
// race has a circuit for the dashboard globe (js/venues.js).
// Run from the repository root:  node scripts/check_numbers.mjs
import { readFileSync } from "node:fs";
import { parseCSV, MEASURES as M, applyFilters, groupBy, rankGroups, raceLaps } from "../js/metrics.js";

const rows = parseCSV(readFileSync("data/driver_races.csv", "utf8"));
const report = JSON.parse(readFileSync("data/report_data.json", "utf8"));
const YEARS = rows.map((r) => r.year);
const ALL = { from: Math.min(...YEARS), to: Math.max(...YEARS), team: "", cons: "", driver: "", nationality: "", race: "" };
const view = (f) => applyFilters(rows, { ...ALL, ...f });

let checks = 0;
let failures = 0;
function eq(what, got, want, tol = 0.051) { // report values are rounded to 1 decimal
  checks++;
  const ok = typeof want === "number" ? Math.abs(got - want) <= tol : got === want;
  if (!ok) {
    failures++;
    console.log(`MISMATCH ${what}: dashboard ${got}, report ${want}`);
  }
}

const h = report.headline;
eq("laps completed", M.laps.calc(rows), h.lap_rows);
eq("driver-race entries", M.entries.calc(rows), h.driver_races);
eq("races", M.races.calc(rows), h.races);
eq("laps led", M.laps_led.calc(rows), h.race_laps);
eq("finish rate", M.finish_rate.calc(rows), h.finish_rate);

for (const d of report.laps_led_drivers) {
  eq(`laps led ${d.driver}`, M.laps_led.calc(view({ driver: d.driver })), d.laps_led);
  eq(`lead share ${d.driver}`, M.lead_share.calc(view({ driver: d.driver }), { raceLaps: raceLaps(rows) }), d.share);
  eq(`wins ${d.driver}`, M.wins.calc(view({ driver: d.driver })), d.wins);
}

for (const d of report.dominant_team) {
  const season = view({ from: d.year, to: d.year });
  const top = rankGroups(season, "constructor", "lead_share", { raceLaps: raceLaps(season) })[0];
  eq(`top constructor ${d.year}`, top.name, d.constructor);
  eq(`lead share ${d.year}`, top.value, d.share);
}

const byPos = groupBy(rows, "lap1_pos");
for (const d of report.win_by_lap1) eq(`win rate P${d.lap1_pos}`, M.win_rate.calc(byPos.get(d.lap1_pos)), d.win_rate);

for (const d of report.finish_rate) eq(`finish rate ${d.year}`, M.finish_rate.calc(view({ from: d.year, to: d.year })), d.finish_rate);
for (const d of report.track_gains) eq(`gains/race ${d.year}`, M.gains_per_race.calc(view({ from: d.year, to: d.year })), d.gains_per_race);
for (const d of report.monaco) {
  eq(`Monaco fastest ${d.year}`, M.fastest.calc(view({ from: d.year, to: d.year, race: "Monaco Grand Prix" })), d.best_s, 0.0005);
}
for (const d of report.calendar) {
  const v = view({ from: d.year, to: d.year });
  eq(`races ${d.year}`, M.races.calc(v), d.races);
  eq(`laps ${d.year}`, M.laps.calc(v), d.laps);
}
for (const d of report.nationality) eq(`wins ${d.nationality}`, M.wins.calc(view({ nationality: d.nationality })), d.wins);
for (const d of report.team_family) {
  // a lone defunct winner is shown as that constructor rather than the whole group
  const v = d.constructor ? view({ cons: d.constructor }) : view({ team: d.team });
  eq(`wins ${d.label}`, M.wins.calc(v), d.wins);
  eq(`win rate ${d.label}`, M.win_rate.calc(v), d.win_rate);
}

// Every race in the data must map to a circuit on the dashboard globe.
const { circuitFor, CIRCUITS } = await import("../js/venues.js");
for (const r of new Map(rows.map((r) => [r.raceKey, r])).values()) {
  const id = circuitFor(r.race, r.year);
  eq(`circuit for ${r.year} ${r.race}`, Boolean(id && CIRCUITS[id]), true);
}

// Every circuit's track outline id must exist in data/f1-circuits.geojson.
const trackIds = new Set(JSON.parse(readFileSync("data/f1-circuits.geojson", "utf8")).features.map((f) => f.properties.id));
for (const [id, c] of Object.entries(CIRCUITS)) {
  if (c.track) eq(`track outline for ${id}`, trackIds.has(c.track), true);
}

console.log(`${checks - failures}/${checks} checks agree`);
process.exit(failures ? 1 : 0);
