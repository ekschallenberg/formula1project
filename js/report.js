// Report page: headline numbers and one chart per finding, all read from data/report_data.json
// (produced by scripts/build_data.py).
import { TEAM_COLORS, F1_RED, ACADEMY, fmtInt, fmt1, fmtPct, fmtLap, applyChartDefaults } from "./common.js";

applyChartDefaults(Chart);

const HEADLINE_COLORS = ["var(--ferrari)", "var(--williams)", "var(--mclaren)", "var(--mercedes)", "var(--alpine)", "var(--sauber)"];

function renderHeadline(h) {
  const tiles = [
    [fmtInt(h.lap_rows), "timed laps in the data"],
    [fmtInt(h.races), `Grands Prix, ${h.first_year}–${h.last_year}`],
    [fmtInt(h.seasons), "championship seasons"],
    [fmtInt(h.drivers), `drivers for ${h.constructors} constructors`],
    [fmtInt(h.race_laps), "race laps led (one leader per lap)"],
    [fmtPct(h.finish_rate), "of starts ended classified"],
  ];
  document.getElementById("headline").innerHTML = tiles
    .map(([v, l], i) => `
      <div class="card stat">
        <div class="checker" style="--c:${HEADLINE_COLORS[i]}"></div>
        <div class="card-body"><div class="stat-value">${v}</div><div class="stat-label">${l}</div></div>
      </div>`)
    .join("");
}

function bar(id, labels, data, { colors, horizontal = false, fmt = fmtInt, yLabel, max } = {}) {
  const valueAxis = {
    beginAtZero: true,
    max,
    ticks: { callback: (v) => fmt(v) },
    title: yLabel ? { display: true, text: yLabel } : undefined,
  };
  return new Chart(document.getElementById(id), {
    type: "bar",
    data: { labels, datasets: [{ data, backgroundColor: colors || F1_RED, maxBarThickness: 34 }] },
    options: {
      indexAxis: horizontal ? "y" : "x",
      scales: horizontal
        ? { x: valueAxis, y: { grid: { display: false } } }
        : { y: valueAxis, x: { grid: { display: false } } },
      plugins: { tooltip: { callbacks: { label: (c) => " " + fmt(c.parsed[horizontal ? "x" : "y"]) } } },
    },
  });
}

function line(id, labels, data, { color = F1_RED, fmt = fmt1, min, max, tickFmt } = {}) {
  return new Chart(document.getElementById(id), {
    type: "line",
    data: { labels, datasets: [{ data, borderColor: color, backgroundColor: color, pointBackgroundColor: color, spanGaps: false }] },
    options: {
      scales: {
        y: { min, max, ticks: { callback: (v) => (tickFmt || fmt)(v) } },
        x: { grid: { display: false } },
      },
      plugins: { tooltip: { callbacks: { label: (c) => " " + fmt(c.parsed.y) } } },
    },
  });
}

function legend(el, entries) {
  el.innerHTML = entries.map(([name, color]) => `<span><i style="background:${color}"></i>${name}</span>`).join("");
}

async function main() {
  const res = await fetch("data/report_data.json");
  const r = await res.json();
  renderHeadline(r.headline);

  // 1. Laps led by driver: Hamilton highlighted, the rest muted
  const d1 = r.laps_led_drivers;
  const c1 = bar("c1", d1.map((d) => d.driver), d1.map((d) => d.laps_led), {
    horizontal: true,
    colors: d1.map((d) => (d.driver === "Lewis Hamilton" ? F1_RED : "#6d6d78")),
  });
  c1.options.plugins.tooltip.callbacks.label = (c) =>
    ` ${fmtInt(d1[c.dataIndex].laps_led)} laps led (${fmt1(d1[c.dataIndex].share)}% of all), ${d1[c.dataIndex].wins} wins`;

  // 2. Dominant team per season, coloured by lineage
  const d2 = r.dominant_team;
  const c2 = bar("c2", d2.map((d) => d.year), d2.map((d) => d.share), {
    colors: d2.map((d) => TEAM_COLORS[d.team]),
    fmt: (v) => v + "%",
    max: 100,
  });
  c2.options.plugins.tooltip.callbacks.label = (c) => {
    const d = d2[c.dataIndex];
    return ` ${d.constructor}: ${fmt1(d.share)}% (${fmtInt(d.laps_led)} laps led)`;
  };
  const seen = [...new Map(d2.map((d) => [d.constructor, TEAM_COLORS[d.team]])).entries()];
  legend(document.getElementById("legend2"), seen);

  // 3. Win rate by lap 1 position
  const d3 = r.win_by_lap1;
  const c3 = bar("c3", d3.map((d) => "P" + d.lap1_pos), d3.map((d) => d.win_rate), { fmt: (v) => v + "%" });
  c3.options.plugins.tooltip.callbacks.label = (c) => {
    const d = d3[c.dataIndex];
    return ` ${fmt1(d.win_rate)}% (${d.wins} wins from ${d.driver_races} races)`;
  };

  // 4. Finish rate
  const d4 = r.finish_rate;
  const c4 = line("c4", d4.map((d) => d.year), d4.map((d) => d.finish_rate), {
    color: TEAM_COLORS.Sauber, fmt: fmtPct, min: 50, max: 100, tickFmt: (v) => v + "%",
  });
  c4.options.plugins.tooltip.callbacks.label = (c) => {
    const d = d4[c.dataIndex];
    return ` ${fmtPct(d.finish_rate)} (${d.classified} of ${d.driver_races} starts)`;
  };

  // 5. Places gained per race; DRS era (2011-2013) highlighted
  const d5 = r.track_gains;
  const c5 = bar("c5", d5.map((d) => d.year), d5.map((d) => d.gains_per_race), {
    colors: d5.map((d) => (d.year >= 2011 && d.year <= 2013 ? TEAM_COLORS.VCARB : "#3d6f99")),
    fmt: fmt1,
  });
  c5.options.plugins.tooltip.callbacks.label = (c) => {
    const d = d5[c.dataIndex];
    return ` ${fmt1(d.gains_per_race)} per race (${fmtInt(d.track_gains)} over ${d.races} races)`;
  };

  // 6. Monaco fastest lap; a gap for 2020 (no race)
  const d6 = r.monaco;
  const years6 = [];
  for (let y = d6[0].year; y <= d6[d6.length - 1].year; y++) years6.push(y);
  const byYear = new Map(d6.map((d) => [d.year, d.best_s]));
  line("c6", years6, years6.map((y) => byYear.get(y) ?? null), {
    color: ACADEMY, fmt: (v) => fmtLap(v), tickFmt: (v) => fmtLap(v, 0), min: 70, max: 88,
  });

  // 7. Races per season
  const d7 = r.calendar;
  const c7 = bar("c7", d7.map((d) => d.year), d7.map((d) => d.races), { colors: TEAM_COLORS.McLaren });
  c7.options.plugins.tooltip.callbacks.label = (c) => {
    const d = d7[c.dataIndex];
    return ` ${d.races} races, ${fmtInt(d.laps)} laps completed by the field`;
  };

  // 8. Wins by nationality
  const d8 = r.nationality;
  const c8 = bar("c8", d8.map((d) => d.nationality), d8.map((d) => d.wins), { horizontal: true, colors: TEAM_COLORS.Alpine });
  c8.options.plugins.tooltip.callbacks.label = (c) => {
    const d = d8[c.dataIndex];
    return ` ${d.wins} wins, ${fmtInt(d.laps_led)} laps led, ${d.drivers} drivers`;
  };

  // 9. Wins by team lineage
  const d9 = r.team_family;
  const c9 = bar("c9", d9.map((d) => d.team), d9.map((d) => d.wins), {
    horizontal: true, colors: d9.map((d) => TEAM_COLORS[d.team]),
  });
  c9.options.plugins.tooltip.callbacks.label = (c) => {
    const d = d9[c.dataIndex];
    return ` ${d.wins} wins from ${fmtInt(d.driver_races)} starts (${fmt1(d.win_rate)}%), ${fmtInt(d.laps_led)} laps led`;
  };
}

main().catch((err) => {
  console.error(err);
  document.getElementById("headline").innerHTML =
    '<p class="empty">Could not load data/report_data.json. Open the site through a web server (see README).</p>';
});
