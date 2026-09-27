// Pure data functions for the dashboard: parse the driver-race CSV, filter it and compute measures.
// No browser APIs here, so scripts/check_numbers.mjs can run the same code in Node.

const NUMERIC = ["year", "round", "race_laps", "laps", "laps_led", "lap1_pos", "finish_pos",
  "classified", "win", "podium", "track_gains", "best_ms", "median_ms"];

export function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(",");
  const numeric = header.map((h) => NUMERIC.includes(h));
  const rows = new Array(lines.length - 1);
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",");
    const row = {};
    for (let j = 0; j < header.length; j++) row[header[j]] = numeric[j] ? +cells[j] : cells[j];
    row.raceKey = row.year * 100 + row.round;
    rows[i - 1] = row;
  }
  return rows;
}

const sum = (rows, f) => rows.reduce((a, r) => a + r[f], 0);

function distinctRaces(rows) {
  const m = new Map();
  for (const r of rows) m.set(r.raceKey, r.race_laps);
  return m;
}

// Total race laps of the distinct races in `rows` (every race lap has exactly one leader).
export function raceLaps(rows) {
  let total = 0;
  for (const l of distinctRaces(rows).values()) total += l;
  return total;
}

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const pct = (a, b) => (b ? (a / b) * 100 : null);

// kind: "count" (additive), "rate" (a ratio), "time" (seconds); lowerIsBetter flips the ranking.
export const MEASURES = {
  entries: { label: "Driver-race entries", kind: "count", calc: (rows) => rows.length },
  races: { label: "Grands Prix", kind: "count", calc: (rows) => distinctRaces(rows).size },
  laps: { label: "Laps completed", kind: "count", calc: (rows) => sum(rows, "laps") },
  laps_led: { label: "Laps led", kind: "count", calc: (rows) => sum(rows, "laps_led") },
  // Denominator: all race laps in the selected seasons and Grands Prix (ctx.raceLaps), whoever
  // took part, so a team that crashed out on lap 1 still counts that race's laps against it.
  lead_share: {
    label: "Share of laps led (%)", kind: "rate",
    calc: (rows, ctx) => pct(sum(rows, "laps_led"), ctx ? ctx.raceLaps : raceLaps(rows)),
  },
  wins: { label: "Wins", kind: "count", calc: (rows) => sum(rows, "win") },
  win_rate: { label: "Win rate (%)", kind: "rate", calc: (rows) => pct(sum(rows, "win"), rows.length) },
  podiums: { label: "Podiums", kind: "count", calc: (rows) => sum(rows, "podium") },
  podium_rate: { label: "Podium rate (%)", kind: "rate", calc: (rows) => pct(sum(rows, "podium"), rows.length) },
  finish_rate: { label: "Finish rate (%)", kind: "rate", calc: (rows) => pct(sum(rows, "classified"), rows.length) },
  gains_per_race: {
    label: "Places gained on track per race", kind: "rate",
    calc: (rows) => {
      const n = distinctRaces(rows).size;
      return n ? sum(rows, "track_gains") / n : null;
    },
  },
  avg_finish: {
    label: "Average finishing position", kind: "rate", lowerIsBetter: true,
    calc: (rows) => {
      const c = rows.filter((r) => r.classified);
      return c.length ? sum(c, "finish_pos") / c.length : null;
    },
  },
  fastest: {
    label: "Fastest lap", kind: "time", lowerIsBetter: true,
    calc: (rows) => (rows.length ? rows.reduce((m, r) => Math.min(m, r.best_ms), Infinity) / 1000 : null),
  },
  median_lap: {
    label: "Median lap time", kind: "time", lowerIsBetter: true,
    calc: (rows) => {
      const m = median(rows.map((r) => r.median_ms));
      return m == null ? null : m / 1000;
    },
  },
};

export const BREAKDOWNS = {
  team: "Team lineage",
  constructor: "Constructor",
  driver: "Driver",
  nationality: "Nationality",
  race: "Grand Prix",
};

export function groupBy(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const k = typeof key === "function" ? key(r) : r[key];
    let g = m.get(k);
    if (!g) m.set(k, (g = []));
    g.push(r);
  }
  return m;
}

// filters: { from, to, team, cons, driver, nationality, race } — "" means all.
// (The constructor filter is called `cons` because every JS object already has a `.constructor`.)
export function applyFilters(rows, f) {
  return rows.filter((r) =>
    r.year >= f.from && r.year <= f.to &&
    (!f.team || r.team === f.team) &&
    (!f.cons || r.constructor === f.cons) &&
    (!f.driver || r.driver === f.driver) &&
    (!f.nationality || r.nationality === f.nationality) &&
    (!f.race || r.race === f.race));
}

// Groups ranked by a measure. Rates and averages need a minimum number of entries so a
// driver with one start cannot top a win-rate chart; the minimum is dropped if nothing qualifies.
export function rankGroups(rows, breakdown, measureKey, ctx, minEntries = 10) {
  const m = MEASURES[measureKey];
  let groups = [...groupBy(rows, breakdown)].map(([name, g]) => ({ name, rows: g, value: m.calc(g, ctx) }));
  groups = groups.filter((g) => g.value != null);
  if (m.kind !== "count") {
    const qualified = groups.filter((g) => g.rows.length >= minEntries);
    if (qualified.length) groups = qualified;
  }
  groups.sort((a, b) => (m.lowerIsBetter ? a.value - b.value : b.value - a.value) || String(a.name).localeCompare(b.name));
  return groups;
}
