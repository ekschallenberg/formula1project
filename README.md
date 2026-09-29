# Lights Out: 31 Seasons of F1, Lap by Lap

A two-page data website about every timed lap of every Formula 1 World Championship race from 1996 to 2026
(2026 is in progress: through round 15, the Azerbaijan Grand Prix on 26 September 2026).

- **Report** (`index.html`): nine findings, each with the numbers behind it and a chart, plus a section explaining the data.
- **Dashboard** (`dashboard.html`): loads the data in the browser and lets you filter by season, team lineage,
  constructor, driver, nationality and Grand Prix, switch the measure and the breakdown, and see every number update.
  A spinning globe marks every circuit in the current view and zooms in on the circuit when you pick a Grand Prix,
  with an outline of the track beside it.
- **Music**: both pages have a small player in the corner that plays "Lights Out", an original race-day theme
  synthesised live in the browser (no audio files). It never starts on its own.

Live site: `https://ekschallenberg.github.io/formula1project/` (GitHub Pages, served from the `main` branch).

## The data

- **1996–2024:** `data/formula1file.xlsx`, sheet `f1_lap_times_panel`, is compiled from the
  [Ergast Motor Racing database](https://ergast.com/mrd/) (its lap times, races, drivers and constructors tables;
  the IDs follow Ergast's numbering). Ergast has lap-by-lap timing for every championship race since 1996.
- **2025–2026:** `data/laps_2025_2026.csv` has the same columns, fetched from the
  [Jolpica-F1 API](https://github.com/jolpica/jolpica-f1), which continues the Ergast database. Jolpica-F1 data is
  licensed [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) (non-commercial use, with attribution).
  Its IDs are text (`max_verstappen`) rather than numbers, so the build matches drivers by name.

| | |
|---|---|
| One row | one driver on one lap of one race |
| Rows × columns | 632,937 × 14 (589,081 from the spreadsheet + 43,856 fetched) |
| Time column | `year` (31 seasons, 1996–2026, with 2026 in progress); also `round` and `date` |
| Group columns | `driver_name` (147), `constructor_name` (45) |
| Categorical columns | driver, nationality, constructor, race |
| Numeric columns | `lap`, `lap_position`, `lap_time_ms` |

No rows are dropped. Neither file has missing values or duplicate driver-laps. The about section of the report
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
| `data/laps_2025_2026.csv` | Lap-by-lap data for 2025 and 2026 so far, in the spreadsheet's columns, fetched from Jolpica-F1. |
| `data/driver_races.csv` | One row per driver per race (11,826 rows), built from the laps. The dashboard loads this file. |
| `data/report_data.json` | Every number and chart series on the report page. |
| `data/f1-circuits.geojson` | Track outlines (current layouts) for 36 of the 41 circuits, from [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits). Jerez, Fuji, Valencia, Yeongam and Buddh are not included. |
| `data/f1-circuits-LICENSE.md` | The MIT licence and copyright notice for `f1-circuits.geojson`. |
| `scripts/fetch_new_seasons.py` | Downloads every completed race's laps for 2025 onward from the Jolpica-F1 API into `laps_2025_2026.csv`, staying under its rate limit; skips races already saved. |
| `.github/workflows/fetch-laps.yml` | GitHub Action that runs the fetch script on GitHub's servers and commits the CSV. Start it from the Actions tab (**Run workflow**) to add new 2026 races. |
| `scripts/build_data.py` | Reads the spreadsheet and the 2025–2026 laps, validates them and writes `driver_races.csv` and `report_data.json`. `PARTIAL_SEASON` names the season still in progress. |
| `scripts/check_numbers.mjs` | Runs the dashboard's own calculations in Node and checks they match every figure in `report_data.json`, that every race maps to a circuit, and that every track outline id exists. |
| `requirements.txt` | Python packages for the build script. |
| `.nojekyll` | Tells GitHub Pages to serve the files as they are, without Jekyll processing. |

## Rebuilding and checking

```bash
pip install -r requirements.txt
python3 scripts/fetch_new_seasons.py 2025 2026   # optional: new races (or use the GitHub Action)
python3 scripts/build_data.py      # about a minute: reads 589k rows from Excel
node scripts/check_numbers.mjs     # every check should agree (925/925 at the time of writing)
```

## Viewing locally

The pages load their data with `fetch`, which browsers block for `file://` pages, so serve the folder:

```bash
python3 -m http.server 8000
# open http://localhost:8000/
```

Chart.js 4.4.1, D3 7.9.0, topojson-client 3.1.0 and the world map (world-atlas 2.0.2, Natural Earth 1:110m)
come from jsDelivr, and the fonts (Bebas Neue, Titillium Web) come from Google Fonts.
