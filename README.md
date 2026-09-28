# Lights Out: 29 Seasons of F1, Lap by Lap

A two-page data website about every timed lap of every Formula 1 World Championship race from 1996 to 2024.

- **Report** (`index.html`): nine findings, each with the numbers behind it and a chart, plus a section explaining the data.
- **Dashboard** (`dashboard.html`): loads the data in the browser and lets you filter by season, team lineage,
  constructor, driver, nationality and Grand Prix, switch the measure and the breakdown, and see every number update.
  A spinning globe marks every circuit in the current view and zooms in on the circuit when you pick a Grand Prix,
  with an outline of the track beside it.
- **Music**: both pages have a small player in the corner that plays "Lights Out", an original race-day theme
  synthesised live in the browser (no audio files). It never starts on its own.

Live site: `https://ekschallenberg.github.io/formula1project/` (GitHub Pages, served from the `main` branch).

## The data

`data/formula1file.xlsx`, sheet `f1_lap_times_panel`, is compiled from the
[Ergast Motor Racing database](https://ergast.com/mrd/) (its lap times, races, drivers and constructors tables;
the IDs follow Ergast's numbering). Ergast has lap-by-lap timing for every championship race since 1996.

| | |
|---|---|
| One row | one driver on one lap of one race |
| Rows × columns | 589,081 × 14 |
| Time column | `year` (29 seasons, 1996–2024); also `round` and `date` |
| Group columns | `driver_name` (143), `constructor_name` (43) |
| Categorical columns | driver, nationality, constructor, race |
| Numeric columns | `lap`, `lap_position`, `lap_time_ms` |

No rows are dropped. The file has no missing values and no duplicate driver-laps. The about section of the report
defines every measure (laps led, win, classified, finish rate, places gained, team lineage, and so on).

## Files

| File | What it does |
|---|---|
| `index.html` | Report page: title, summary, six headline numbers, nine findings with charts, and the about-the-data section. |
| `dashboard.html` | Dashboard page: filters, measure and breakdown switches, seven summary numbers, a circuit globe, four charts, a sortable table and a reset button. |
| `css/style.css` | Shared fonts, colours and layout for both pages (palette from the F1 team-colours poster by @Leighrule_1459). |
| `js/common.js` | Shared team colours, number and lap-time formatting, and Chart.js styling. |
| `js/report.js` | Reads `data/report_data.json` and draws the report's headline numbers and charts. |
| `js/metrics.js` | The dashboard's calculations: CSV parsing, filters, the 14 measures and group ranking. It has no browser code, so Node can run it too. |
| `js/dashboard.js` | Wires the dashboard controls to `js/metrics.js` and redraws the numbers, globe, charts and table. |
| `js/globe.js` | The dashboard globe (D3 orthographic projection): spins with a dot per circuit in view, can be dragged to turn it, zooms to the circuit when one Grand Prix is selected (clicking elsewhere on the globe zooms back out), and selects a Grand Prix when you click its dot. |
| `js/venues.js` | Circuit names and coordinates, which circuit hosted each Grand Prix in each season (several Grands Prix moved between circuits), and each circuit's track outline id. |
| `js/music.js` | The music player on both pages and the song itself: an original theme composed as code and played with the Web Audio API (drums, bass, arpeggio, lead melody, pads and an engine-rev riser). Remembers volume and play state in the browser. |
| `js/tracks.js` | Loads `data/f1-circuits.geojson` and draws a circuit's track outline for the dashboard's Grand Prix panel. |
| `data/formula1file.xlsx` | The raw lap-by-lap data (source file). |
| `data/driver_races.csv` | One row per driver per race (11,041 rows), built from the laps. The dashboard loads this file. |
| `data/report_data.json` | Every number and chart series on the report page. |
| `data/f1-circuits.geojson` | Track outlines (current layouts) for 36 of the 41 circuits, from [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits). Jerez, Fuji, Valencia, Yeongam and Buddh are not included. |
| `data/f1-circuits-LICENSE.md` | The MIT licence and copyright notice for `f1-circuits.geojson`. |
| `scripts/build_data.py` | Reads the spreadsheet, validates it and writes `driver_races.csv` and `report_data.json`. |
| `scripts/check_numbers.mjs` | Runs the dashboard's own calculations in Node and checks they match all 289 figures in `report_data.json`, that all 544 races map to a circuit, and that every track outline id exists. |
| `requirements.txt` | Python packages for the build script. |
| `.nojekyll` | Tells GitHub Pages to serve the files as they are, without Jekyll processing. |

## Rebuilding and checking

```bash
pip install -r requirements.txt
python3 scripts/build_data.py      # about a minute: reads 589k rows from Excel
node scripts/check_numbers.mjs     # expects "869/869 checks agree"
```

## Viewing locally

The pages load their data with `fetch`, which browsers block for `file://` pages, so serve the folder:

```bash
python3 -m http.server 8000
# open http://localhost:8000/
```

Chart.js 4.4.1, D3 7.9.0, topojson-client 3.1.0 and the world map (world-atlas 2.0.2, Natural Earth 1:110m)
come from jsDelivr, and the fonts (Bebas Neue, Titillium Web) come from Google Fonts.
