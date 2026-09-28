// Dashboard: loads data/driver_races.csv, applies the filters and switches, and redraws
// the summary numbers, four charts and the table on every change.
import { TEAM_COLORS, F1_RED, ACADEMY, CATEGORICAL, fmtInt, fmt1, fmtPct, fmtLap, applyChartDefaults } from "./common.js";
import { parseCSV, MEASURES, BREAKDOWNS, applyFilters, groupBy, rankGroups, raceLaps } from "./metrics.js";
import { CIRCUITS, circuitFor } from "./venues.js";
import { createGlobe } from "./globe.js";
import { loadTracks, trackSVG } from "./tracks.js";

applyChartDefaults(Chart);

const $ = (id) => document.getElementById(id);
const FILTER_FIELDS = ["team", "cons", "driver", "nationality", "race"];
const DEFAULT_MEASURE = "wins";
const DEFAULT_BREAKDOWN = "team";
const PLURAL = { team: "team lineages", constructor: "constructors", driver: "drivers", nationality: "nationalities", race: "Grands Prix" };

let ROWS = [];
let YEARS = [];
let TEAM_OF = new Map(); // constructor -> team lineage
let GLOBAL_RANK = {}; // breakdown -> Map(name -> rank by entries), for stable colours
const state = {};
const charts = {};
let tableSort = null; // { key, dir }
let globe = null;
let trackToken = 0; // ignores outline loads for a Grand Prix that is no longer selected

// ---------- formatting ----------
function fmtMeasure(key, v) {
  const m = MEASURES[key];
  if (v == null || Number.isNaN(v)) return "–";
  if (m.kind === "time") return fmtLap(v);
  if (m.kind === "count") return fmtInt(v);
  if (m.label.includes("%")) return fmtPct(v);
  return fmt1(v);
}
function tickFmt(key) {
  const m = MEASURES[key];
  if (m.kind === "time") return (v) => fmtLap(v, 0);
  if (m.label.includes("%")) return (v) => v + "%";
  return (v) => fmtInt(v);
}

// ---------- colours: follow the entity, never the rank ----------
function groupColor(breakdown, name) {
  if (breakdown === "team") return TEAM_COLORS[name] || TEAM_COLORS.Defunct;
  if (breakdown === "constructor") return TEAM_COLORS[TEAM_OF.get(name)] || TEAM_COLORS.Defunct;
  return null;
}
// Up to six series: team colours where they exist, otherwise the fixed categorical order,
// assigned by each group's all-time rank so a group keeps its colour as filters change.
function seriesColors(breakdown, names) {
  const out = new Map();
  if (breakdown === "team" || breakdown === "constructor") {
    const used = new Map();
    for (const n of names) {
      const c = groupColor(breakdown, n);
      const k = (used.get(c) || 0) + 1;
      used.set(c, k);
      out.set(n, { color: c, dash: k > 1 ? [6, 4] : [] }); // same lineage twice -> dashed line
    }
    return out;
  }
  const rank = GLOBAL_RANK[breakdown];
  const taken = new Set();
  for (const n of [...names].sort((a, b) => rank.get(a) - rank.get(b))) {
    let i = rank.get(n) % CATEGORICAL.length;
    while (taken.has(i)) i = (i + 1) % CATEGORICAL.length;
    taken.add(i);
    out.set(n, { color: CATEGORICAL[i], dash: [] });
  }
  return out;
}

// ---------- controls ----------
function fillSelect(el, values, allLabel) {
  el.innerHTML = (allLabel ? `<option value="">${allLabel}</option>` : "") +
    values.map((v) => `<option value="${v}">${v}</option>`).join("");
}

function buildControls() {
  const uniq = (f) => [...new Set(ROWS.map((r) => r[f]))].sort((a, b) => String(a).localeCompare(String(b)));
  fillSelect($("f-from"), YEARS);
  fillSelect($("f-to"), YEARS);
  fillSelect($("f-team"), uniq("team"), "All team lineages");
  fillSelect($("f-cons"), uniq("constructor"), "All constructors");
  fillSelect($("f-driver"), uniq("driver"), "All drivers");
  fillSelect($("f-nationality"), uniq("nationality"), "All nationalities");
  fillSelect($("f-race"), uniq("race"), "All Grands Prix");

  $("measure").innerHTML = Object.entries(MEASURES)
    .map(([k, m]) => `<option value="${k}">${m.label}${m.lowerIsBetter ? " (lower is better)" : ""}</option>`)
    .join("");
  $("breakdown").innerHTML = Object.entries(BREAKDOWNS)
    .map(([k, label]) => `<button type="button" data-key="${k}" aria-pressed="false">${label}</button>`)
    .join("");

  $("f-from").addEventListener("change", (e) => {
    state.from = +e.target.value;
    if (state.to < state.from) state.to = state.from;
    update();
  });
  $("f-to").addEventListener("change", (e) => {
    state.to = +e.target.value;
    if (state.from > state.to) state.from = state.to;
    update();
  });
  for (const f of FILTER_FIELDS) {
    $("f-" + f).addEventListener("change", (e) => { state[f] = e.target.value; update(); });
  }
  $("measure").addEventListener("change", (e) => { state.measure = e.target.value; tableSort = null; update(); });
  $("breakdown").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    state.breakdown = b.dataset.key;
    update();
  });
  $("reset").addEventListener("click", () => { resetState(); tableSort = null; update(); });
}

function resetState() {
  Object.assign(state, {
    from: YEARS[0], to: YEARS[YEARS.length - 1],
    team: "", cons: "", driver: "", nationality: "", race: "",
    measure: DEFAULT_MEASURE, breakdown: DEFAULT_BREAKDOWN,
  });
}

function syncControls() {
  $("f-from").value = state.from;
  $("f-to").value = state.to;
  for (const f of FILTER_FIELDS) $("f-" + f).value = state[f];
  $("measure").value = state.measure;
  for (const b of $("breakdown").querySelectorAll("button")) {
    b.setAttribute("aria-pressed", String(b.dataset.key === state.breakdown));
  }
}

// ---------- KPIs ----------
const KPI_COLORS = ["var(--ferrari)", "var(--williams)", "var(--mclaren)", "var(--mercedes)", "var(--alpine)", "var(--sauber)", "var(--academy)"];

function renderKPIs(rows, ctx) {
  const M = MEASURES;
  let fastestSub = "";
  if (rows.length) {
    const best = rows.reduce((a, r) => (r.best_ms < a.best_ms ? r : a));
    fastestSub = `${best.driver}, ${best.year} ${best.race.replace(" Grand Prix", " GP")}`;
  }
  const drivers = new Set(rows.map((r) => r.driver)).size;
  const tiles = [
    [fmtInt(M.races.calc(rows)), "Grands Prix", `${fmtInt(rows.length)} driver-race entries`],
    [fmtInt(drivers), "Drivers", ""],
    [fmtInt(M.laps.calc(rows)), "Laps completed", ""],
    [fmtInt(M.laps_led.calc(rows)), "Laps led", fmtPct(M.lead_share.calc(rows, ctx)) + " of all race laps"],
    [fmtInt(M.wins.calc(rows)), "Wins", fmtPct(M.win_rate.calc(rows)) + " win rate"],
    [fmtPct(M.finish_rate.calc(rows)), "Finish rate", "classified ÷ entries"],
    [fmtLap(M.fastest.calc(rows)), "Fastest lap", fastestSub],
  ];
  $("kpis").innerHTML = tiles.map(([v, label, sub], i) => `
    <div class="card stat">
      <div class="checker" style="--c:${KPI_COLORS[i]}"></div>
      <div class="card-body">
        <div class="stat-value">${v}</div>
        <div class="stat-label">${label}</div>
        ${sub ? `<div class="stat-sub">${sub}</div>` : ""}
      </div>
    </div>`).join("");
}

// ---------- charts ----------
function makeChart(id, type, horizontal = false) {
  charts[id] = new Chart($(id), {
    type,
    data: { labels: [], datasets: [] },
    options: {
      indexAxis: horizontal ? "y" : "x",
      scales: {
        x: { grid: { display: horizontal } },
        y: { grid: { display: !horizontal } },
      },
      plugins: { tooltip: { callbacks: {} } },
    },
  });
}

function setValueAxis(chart, key, horizontal = false) {
  const axis = chart.options.scales[horizontal ? "x" : "y"];
  const m = MEASURES[key];
  axis.beginAtZero = m.kind !== "time";
  axis.ticks = { callback: tickFmt(key) };
  axis.reverse = false;
  const other = chart.options.scales[horizontal ? "y" : "x"];
  other.ticks = {};
  other.beginAtZero = false;
}

function updateCharts(rows, ctx, yearCtx) {
  const key = state.measure;
  const m = MEASURES[key];
  const bd = state.breakdown;
  const bdLabel = BREAKDOWNS[bd];
  const years = YEARS.filter((y) => y >= state.from && y <= state.to);
  const byYear = groupBy(rows, "year");
  const label = (c) => ` ${c.dataset.label ? c.dataset.label + ": " : ""}${fmtMeasure(key, c.parsed[c.chart.options.indexAxis === "y" ? "x" : "y"])}`;

  // 1. measure by season
  $("t1").textContent = `${m.label} by season`;
  const c1 = charts.c1;
  setValueAxis(c1, key);
  c1.data.labels = years;
  const v1 = years.map((y) => (byYear.has(y) ? m.calc(byYear.get(y), yearCtx.get(y)) : null));
  c1.data.datasets = [{
    label: m.label, data: v1, borderColor: F1_RED, backgroundColor: F1_RED, pointBackgroundColor: F1_RED,
    maxBarThickness: 60,
  }];
  c1.options.plugins.tooltip.callbacks.label = label;
  c1.update();

  // 2. measure by breakdown (top 15)
  const ranked = rankGroups(rows, bd, key, ctx);
  const top15 = ranked.slice(0, 15);
  $("t2").textContent = `${m.label} by ${bdLabel.toLowerCase()}${ranked.length > 15 ? " (top 15)" : ""}`;
  const c2 = charts.c2;
  setValueAxis(c2, key, true);
  c2.data.labels = top15.map((g) => g.name);
  c2.data.datasets = [{
    label: m.label,
    data: top15.map((g) => g.value),
    backgroundColor: top15.map((g) => groupColor(bd, g.name) || (m.kind === "time" ? ACADEMY : F1_RED)),
    maxBarThickness: 22,
  }];
  c2.options.plugins.tooltip.callbacks.label = (c) =>
    ` ${fmtMeasure(key, c.parsed.x)} (${fmtInt(top15[c.dataIndex].rows.length)} entries)`;
  c2.update();

  // 3. top 6 groups by season
  const top6 = ranked.slice(0, 6).map((g) => g.name);
  $("t3").textContent = `${m.label} by season: top ${top6.length} ${top6.length === 1 ? bdLabel.toLowerCase() : PLURAL[bd]}`;
  const colors = seriesColors(bd, top6);
  const c3 = charts.c3;
  setValueAxis(c3, key);
  c3.data.labels = years;
  c3.data.datasets = top6.map((name) => {
    const g = groupBy(rows.filter((r) => r[bd] === name), "year");
    const { color, dash } = colors.get(name);
    return {
      label: name,
      data: years.map((y) => (g.has(y) ? m.calc(g.get(y), yearCtx.get(y)) : null)),
      borderColor: color, backgroundColor: color, pointBackgroundColor: color, borderDash: dash,
      spanGaps: false,
    };
  });
  c3.options.plugins.tooltip.callbacks.label = label;
  c3.options.plugins.tooltip.itemSort = (a, b) => (m.lowerIsBetter ? a.parsed.y - b.parsed.y : b.parsed.y - a.parsed.y);
  c3.update();
  $("legend3").innerHTML = top6
    .map((n) => {
      const { color, dash } = colors.get(n);
      const style = dash.length ? `background: repeating-linear-gradient(90deg, ${color} 0 4px, transparent 4px 6px)` : `background:${color}`;
      return `<span><i style="${style}"></i>${n}</span>`;
    })
    .join("");

  // 4. measure by position after lap 1
  const posKey = (r) => Math.min(r.lap1_pos, 21);
  const byPos = groupBy(rows, posKey);
  const positions = [...byPos.keys()].sort((a, b) => a - b);
  $("t4").textContent = `${m.label} by position after lap 1`;
  const c4 = charts.c4;
  setValueAxis(c4, key);
  c4.data.labels = positions.map((p) => (p === 21 ? "P21+" : "P" + p));
  c4.data.datasets = [{
    label: m.label,
    data: positions.map((p) => m.calc(byPos.get(p), ctx)),
    backgroundColor: m.kind === "time" ? ACADEMY : TEAM_COLORS.VCARB,
    maxBarThickness: 28,
  }];
  c4.options.plugins.tooltip.callbacks.label = (c) =>
    ` ${fmtMeasure(key, c.parsed.y)} (${fmtInt(byPos.get(positions[c.dataIndex]).length)} entries)`;
  c4.update();
}

// ---------- table ----------
const TABLE_COLS = ["entries", "races", "laps", "laps_led", "lead_share", "wins", "win_rate", "podiums",
  "finish_rate", "gains_per_race", "avg_finish", "fastest", "median_lap"];
const SHORT = {
  entries: "Entries", races: "GPs", laps: "Laps", laps_led: "Laps led", lead_share: "Led %", wins: "Wins",
  win_rate: "Win %", podiums: "Podiums", podium_rate: "Podium %", finish_rate: "Finish %",
  gains_per_race: "Gains / race", avg_finish: "Avg finish", fastest: "Fastest lap", median_lap: "Median lap",
};

function renderTable(rows, ctx) {
  const bd = state.breakdown;
  const cols = TABLE_COLS.includes(state.measure) ? TABLE_COLS : [...TABLE_COLS, state.measure];
  const groups = [...groupBy(rows, bd)].map(([name, g]) => {
    const o = { name, n: g.length };
    for (const c of cols) o[c] = MEASURES[c].calc(g, ctx);
    return o;
  });
  const sort = tableSort || { key: state.measure, dir: MEASURES[state.measure].lowerIsBetter ? 1 : -1 };
  groups.sort((a, b) => {
    if (sort.key === "name") return sort.dir * String(a.name).localeCompare(String(b.name));
    const va = a[sort.key], vb = b[sort.key];
    if (va == null) return 1;
    if (vb == null) return -1;
    return sort.dir * (va - vb) || String(a.name).localeCompare(String(b.name));
  });
  const total = { name: "All in view" };
  for (const c of cols) total[c] = MEASURES[c].calc(rows, ctx);

  $("t5").textContent = `Numbers behind the view: ${groups.length} ${BREAKDOWNS[bd].toLowerCase()} group${groups.length === 1 ? "" : "s"}`;
  const th = (key, text) => {
    const cls = [key === state.measure ? "active" : "", key === sort.key ? "sorted" : ""].join(" ").trim();
    const arrow = key === sort.key ? (sort.dir > 0 ? " ▲" : " ▼") : "";
    return `<th class="${cls}" scope="col" aria-sort="${key === sort.key ? (sort.dir > 0 ? "ascending" : "descending") : "none"}"><button type="button" data-key="${key}">${text}${arrow}</button></th>`;
  };
  $("table").querySelector("thead").innerHTML =
    "<tr>" + th("name", BREAKDOWNS[bd]) + cols.map((c) => th(c, SHORT[c])).join("") + "</tr>";
  const tr = (g, isTotal) => {
    const sw = !isTotal && groupColor(bd, g.name) ? `<span class="swatch" style="background:${groupColor(bd, g.name)}"></span>` : "";
    const cells = cols.map((c) => `<td class="${c === state.measure ? "active" : ""}">${fmtMeasure(c, g[c])}</td>`).join("");
    return `<tr${isTotal ? ' style="font-weight:700"' : ""}><td>${sw}${g.name}</td>${cells}</tr>`;
  };
  $("table").querySelector("tbody").innerHTML = tr(total, true) + groups.map((g) => tr(g, false)).join("");
}

function onTableSort(e) {
  const b = e.target.closest("button[data-key]");
  if (!b) return;
  const key = b.dataset.key;
  const current = tableSort || { key: state.measure, dir: -1 };
  tableSort = { key, dir: current.key === key ? -current.dir : key === "name" ? 1 : -1 };
  const { rows, ctx } = currentView();
  renderTable(rows, ctx);
}

// ---------- globe ----------
// "1996, 1999–2007, 2016"
function yearSpans(years) {
  const ys = [...new Set(years)].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < ys.length; i++) {
    let j = i;
    while (j + 1 < ys.length && ys[j + 1] === ys[j] + 1) j++;
    out.push(i === j ? `${ys[i]}` : `${ys[i]}–${ys[j]}`);
    i = j;
  }
  return out.join(", ");
}

function renderGlobe(rows) {
  const races = new Map();
  for (const r of rows) {
    if (!races.has(r.raceKey)) races.set(r.raceKey, { race: r.race, year: r.year, circuit: circuitFor(r.race, r.year) });
  }
  const list = [...races.values()];
  if (globe) globe.update(list, state.race);

  const byCircuit = new Map();
  for (const x of list) {
    let c = byCircuit.get(x.circuit);
    if (!c) byCircuit.set(x.circuit, (c = { id: x.circuit, years: [], names: new Map() }));
    c.years.push(x.year);
    c.names.set(x.race, (c.names.get(x.race) || 0) + 1);
  }
  const circuits = [...byCircuit.values()].sort((a, b) => b.years.length - a.years.length || Math.max(...b.years) - Math.max(...a.years));
  const topName = (c) => [...c.names].sort((a, b) => b[1] - a[1])[0][0];
  const n = (k, word) => `${fmtInt(k)} ${word}${k === 1 ? "" : "s"}`;
  let html;

  if (!state.race) {
    const countries = new Set(circuits.map((c) => CIRCUITS[c.id].country));
    html = `
      <div class="eyebrow">Where they raced</div>
      <h3>${n(circuits.length, "circuit")} in ${fmtInt(countries.size)} ${countries.size === 1 ? "country" : "countries"}</h3>
      <p>${list.length === 1 ? "1 Grand Prix" : `${fmtInt(list.length)} Grands Prix`} in the current view, ${state.from}–${state.to}.
        Bigger dots hosted more races. Click a dot or a circuit below to zoom in on its Grand Prix.</p>
      <ul>${circuits.slice(0, 6).map((c) => {
        const v = CIRCUITS[c.id];
        return `<li><span><button type="button" class="linkish" data-race="${topName(c)}">${v.name}</button><br>
          <span class="sub">${v.city}, ${v.country}</span></span><b>${n(c.years.length, "race")}</b></li>`;
      }).join("")}</ul>
      <p class="hint">Drag the globe to turn it. Hover over a dot to see which Grands Prix were held there.</p>`;
  } else {
    const wins = [...groupBy(rows.filter((r) => r.win), "driver")].map(([d, g]) => [d, g.length])
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3);
    const best = rows.reduce((a, r) => (r.best_ms < a.best_ms ? r : a));
    html = `
      <div class="eyebrow">Grand Prix</div>
      <h3>${state.race}</h3>
      <div class="track-box" id="track-main"></div>
      <div class="track-cap" id="track-cap"></div>
      <ul>${circuits.map((c) => {
        const v = CIRCUITS[c.id];
        const mini = circuits.length > 1 ? `<span class="mini-track" data-track="${v.track || ""}" data-name="${v.name}"></span>` : "";
        return `<li>${mini}<span class="grow">${v.name}<br><span class="sub">${v.city}, ${v.country} · ${yearSpans(c.years)}</span></span>
          <b>${n(c.years.length, "race")}</b></li>`;
      }).join("")}</ul>
      <p>${wins.length ? `Most wins in this view: ${wins.map(([d, k]) => `${d} (${k})`).join(", ")}.` : "No wins in this view."}
        Fastest race lap: ${fmtLap(best.best_ms / 1000)}, ${best.driver}, ${best.year}.</p>
      <button type="button" class="btn ghost" data-race="">Show all Grands Prix</button>
      <p class="hint" style="margin-top:10px">Or click anywhere else on the globe to zoom back out.</p>`;
  }
  $("globe-info").innerHTML = html;
  if (state.race) drawTracks(CIRCUITS[circuits[0].id]);
}

// Outline of the circuit the globe zooms to, plus small outlines when a Grand Prix used several.
function drawTracks(focus) {
  const token = ++trackToken;
  loadTracks().then((tracks) => {
    if (token !== trackToken) return;
    const f = focus.track && tracks.get(focus.track);
    $("track-main").innerHTML = f
      ? trackSVG(f, 420, 210, { label: `Outline of ${focus.name}` })
      : `<p class="track-missing">No track outline available for ${focus.name}.</p>`;
    $("track-cap").textContent = f
      ? `${focus.name} · ${(f.properties.length / 1000).toFixed(3)} km · current layout`
      : "";
    for (const el of document.querySelectorAll("#globe-info .mini-track")) {
      const m = el.dataset.track && tracks.get(el.dataset.track);
      el.innerHTML = m ? trackSVG(m, 54, 38, { pad: 4, stroke: 2, label: `Outline of ${el.dataset.name}` }) : "";
    }
  }).catch((err) => {
    console.error("Track outlines unavailable:", err);
    if (token === trackToken) $("track-main").style.display = "none";
  });
}

// ---------- main loop ----------
// Laps-led share is measured against every race lap in the selected seasons and Grands Prix,
// so the denominator ignores the team, constructor, driver and nationality filters.
function currentView() {
  const rows = applyFilters(ROWS, state);
  const universe = applyFilters(ROWS, { from: state.from, to: state.to, race: state.race });
  const ctx = { raceLaps: raceLaps(universe) };
  const yearCtx = new Map([...groupBy(universe, "year")].map(([y, g]) => [y, { raceLaps: raceLaps(g) }]));
  return { rows, ctx, yearCtx };
}

function update() {
  syncControls();
  const { rows, ctx, yearCtx } = currentView();
  const races = MEASURES.races.calc(rows);
  $("status").textContent = rows.length
    ? `Showing ${fmtInt(rows.length)} driver-race entries from ${fmtInt(races)} Grand${races === 1 ? "" : "s"} Prix, ${state.from}–${state.to}.`
    : "No driver-race entries match these filters. Loosen a filter or press Reset.";
  renderKPIs(rows, ctx);
  $("dash-body").style.display = rows.length ? "" : "none";
  if (!rows.length) return;
  renderGlobe(rows);
  updateCharts(rows, ctx, yearCtx);
  renderTable(rows, ctx);
}

function pickRace(name) {
  state.race = name;
  update();
}

async function main() {
  const res = await fetch("data/driver_races.csv");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  ROWS = parseCSV(await res.text());
  YEARS = [...new Set(ROWS.map((r) => r.year))].sort((a, b) => a - b);
  for (const r of ROWS) TEAM_OF.set(r.constructor, r.team);
  for (const bd of Object.keys(BREAKDOWNS)) {
    const counts = [...groupBy(ROWS, bd)].map(([n, g]) => [n, g.length]).sort((a, b) => b[1] - a[1]);
    GLOBAL_RANK[bd] = new Map(counts.map(([n], i) => [n, i]));
  }
  buildControls();
  makeChart("c1", "line");
  makeChart("c2", "bar", true);
  makeChart("c3", "line");
  makeChart("c4", "bar");
  charts.c3.options.plugins.legend = { display: false };
  $("table").addEventListener("click", onTableSort);
  $("globe-info").addEventListener("click", (e) => {
    const b = e.target.closest("[data-race]");
    if (b) pickRace(b.dataset.race);
  });
  try {
    globe = createGlobe($("globe"), { onPick: pickRace });
  } catch (err) {
    console.error("Globe unavailable:", err); // the rest of the dashboard still works
    $("globe").style.display = "none";
  }
  resetState();
  update();
}

main().catch((err) => {
  console.error(err);
  $("status").textContent = "Could not load data/driver_races.csv. Open the site through a web server (see README).";
});
