"""Build the site's data files from the raw lap-by-lap spreadsheet.

Reads  data/formula1file.xlsx   (one row = one driver on one lap of one race, 1996-2024)
       data/laps_2025_2026.csv  (the same columns for 2025 onward, fetched from the Jolpica-F1 API
                                 by scripts/fetch_new_seasons.py; optional)
Writes data/driver_races.csv    (one row = one driver in one race; loaded by the dashboard)
       data/report_data.json    (every number and chart series used on the report page)

Run from the repository root:  python3 scripts/build_data.py
"""

import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "formula1file.xlsx"
NEW = ROOT / "data" / "laps_2025_2026.csv"
OUT_CSV = ROOT / "data" / "driver_races.csv"
OUT_JSON = ROOT / "data" / "report_data.json"

# Every constructor in the data mapped to the 2024 team it grew into ("team family").
# Teams with no descendant on the 2024 grid go to "Defunct".
TEAM_FAMILY = {
    "Ferrari": "Ferrari",
    "McLaren": "McLaren",
    "Williams": "Williams",
    "Stewart": "Red Bull", "Jaguar": "Red Bull", "Red Bull": "Red Bull",
    "Tyrrell": "Mercedes", "BAR": "Mercedes", "Honda": "Mercedes", "Brawn": "Mercedes", "Mercedes": "Mercedes",
    "Jordan": "Aston Martin", "MF1": "Aston Martin", "Spyker MF1": "Aston Martin", "Spyker": "Aston Martin",
    "Force India": "Aston Martin", "Racing Point": "Aston Martin", "Aston Martin": "Aston Martin",
    "Benetton": "Alpine", "Renault": "Alpine", "Lotus F1": "Alpine", "Alpine F1 Team": "Alpine",
    "Haas F1 Team": "Haas",
    "Sauber": "Sauber", "BMW Sauber": "Sauber", "Alfa Romeo": "Sauber",
    "Minardi": "VCARB", "Toro Rosso": "VCARB", "AlphaTauri": "VCARB", "RB F1 Team": "VCARB",
    "Ligier": "Defunct", "Prost": "Defunct", "Footwork": "Defunct", "Arrows": "Defunct", "Forti": "Defunct",
    "Toyota": "Defunct", "Super Aguri": "Defunct", "Lotus": "Defunct", "Caterham": "Defunct",
    "Virgin": "Defunct", "Marussia": "Defunct", "Manor Marussia": "Defunct", "HRT": "Defunct",
}


def load_laps() -> pd.DataFrame:
    laps = pd.read_excel(RAW, sheet_name="f1_lap_times_panel")
    if NEW.exists():
        new = pd.read_csv(NEW, parse_dates=["date"])
        assert list(new.columns) == list(laps.columns), "new laps must use the spreadsheet's columns"
        assert new.year.min() > laps.year.max(), "new laps must start after the spreadsheet ends"
        laps = pd.concat([laps, new], ignore_index=True)
    # The spreadsheet uses Ergast's numeric ids and the API uses text ids ("max_verstappen"),
    # so drivers are identified by name; ids are kept as text.
    laps["driverId"] = laps.driverId.astype(str)
    laps["constructorId"] = laps.constructorId.astype(str)
    assert laps.notna().all().all(), "unexpected missing values"
    assert not laps.duplicated(["year", "round", "driverId", "lap"]).any(), "duplicate laps"
    missing = set(laps.constructor_name) - set(TEAM_FAMILY)
    assert not missing, f"constructors without a team family: {missing}"
    return laps.sort_values(["year", "round", "driverId", "lap"]).reset_index(drop=True)


def build_driver_races(laps: pd.DataFrame) -> pd.DataFrame:
    key = ["year", "round", "driverId"]
    laps = laps.copy()
    # Places a driver gains from one lap to the next (lap 2 onward; the start is not counted).
    prev = laps.groupby(key).lap_position.shift()
    laps["gain"] = (prev - laps.lap_position).clip(lower=0).fillna(0)
    laps["led"] = laps.lap_position == 1

    g = laps.groupby(key)
    dr = g.agg(
        race=("race_name", "first"),
        date=("date", "first"),
        driver=("driver_name", "first"),
        code=("code", "first"),
        nationality=("driver_nationality", "first"),
        constructor=("constructor_name", "first"),
        laps=("lap", "size"),
        last_lap=("lap", "max"),
        laps_led=("led", "sum"),
        track_gains=("gain", "sum"),
        best_ms=("lap_time_ms", "min"),
        median_ms=("lap_time_ms", "median"),
        finish_pos=("lap_position", "last"),
    ).reset_index()
    assert (dr.laps == dr.last_lap).all(), "a driver skipped a lap"

    lap1 = laps[laps.lap == 1].set_index(key).lap_position.rename("lap1_pos")
    race_laps = laps.groupby(["year", "round"]).lap.max().rename("race_laps")
    dr = dr.join(lap1, on=key).join(race_laps, on=["year", "round"])
    assert dr.lap1_pos.notna().all()

    dr["team"] = dr.constructor.map(TEAM_FAMILY)
    # Classified = completed at least 90% of the leader's laps (the FIA classification rule).
    dr["classified"] = (dr.last_lap >= np.floor(0.9 * dr.race_laps)).astype(int)
    # Win = led the race's final lap (first across the line; post-race penalties are not in the data).
    dr["win"] = ((dr.last_lap == dr.race_laps) & (dr.finish_pos == 1)).astype(int)
    dr["podium"] = ((dr.classified == 1) & (dr.finish_pos <= 3)).astype(int)
    assert (dr.groupby(["year", "round"]).win.sum() == 1).all(), "every race needs exactly one winner"

    dr["date"] = dr.date.dt.strftime("%Y-%m-%d")
    dr["median_ms"] = dr.median_ms.round().astype(int)
    cols = ["year", "round", "race", "date", "driver", "code", "nationality", "constructor", "team",
            "race_laps", "laps", "laps_led", "lap1_pos", "finish_pos", "classified", "win", "podium",
            "track_gains", "best_ms", "median_ms"]
    dr = dr[cols].astype({"laps_led": int, "track_gains": int, "lap1_pos": int})
    for c in ["race", "driver", "nationality", "constructor"]:
        assert not dr[c].str.contains('[,"]').any(), f"{c} contains a comma or quote"
    return dr.sort_values(["year", "round", "finish_pos", "driver"]).reset_index(drop=True)


def rows(df: pd.DataFrame) -> list:
    return json.loads(df.to_json(orient="records"))


def build_report(laps: pd.DataFrame, dr: pd.DataFrame) -> dict:
    r = {}
    races = dr[["year", "round"]].drop_duplicates()
    total_laps_led = int(dr.laps_led.sum())  # one leader per race lap = total race laps
    r["headline"] = {
        "lap_rows": len(laps),
        "driver_races": len(dr),
        "races": len(races),
        "seasons": int(dr.year.nunique()),
        "first_year": int(dr.year.min()),
        "last_year": int(dr.year.max()),
        "drivers": int(laps.driver_name.nunique()),
        "constructors": int(laps.constructor_name.nunique()),
        "race_laps": total_laps_led,
        "finish_rate": round(dr.classified.mean() * 100, 1),
    }

    # 1. Laps led by driver
    d = dr.groupby("driver").agg(laps_led=("laps_led", "sum"), wins=("win", "sum")).reset_index()
    d = d.sort_values("laps_led", ascending=False).head(10)
    d["share"] = (d.laps_led / total_laps_led * 100).round(1)
    r["laps_led_drivers"] = rows(d)

    # 2. Dominant constructor each season: share of that season's laps led
    t = dr.groupby(["year", "constructor", "team"]).laps_led.sum().reset_index()
    t["share"] = t.laps_led / t.groupby("year").laps_led.transform("sum") * 100
    top = t.sort_values("share").groupby("year").tail(1).sort_values("year")
    top["share"] = top.share.round(1)
    r["dominant_team"] = rows(top)

    # 3. Win rate by position at the end of lap 1
    s = dr.groupby("lap1_pos").agg(driver_races=("win", "size"), wins=("win", "sum")).reset_index()
    s = s[s.lap1_pos <= 20]
    s["win_rate"] = (s.wins / s.driver_races * 100).round(1)
    r["win_by_lap1"] = rows(s)

    # 4. Finish rate by season
    f = dr.groupby("year").agg(driver_races=("classified", "size"), classified=("classified", "sum")).reset_index()
    f["finish_rate"] = (f.classified / f.driver_races * 100).round(1)
    r["finish_rate"] = rows(f)

    # 5. On-track position gains per race by season
    o = dr.groupby("year").agg(track_gains=("track_gains", "sum"),
                               races=("round", "nunique")).reset_index()
    o["gains_per_race"] = (o.track_gains / o.races).round(1)
    r["track_gains"] = rows(o)

    # 6. Fastest race lap at Monaco by season
    m = dr[dr.race == "Monaco Grand Prix"].groupby("year").best_ms.min().reset_index()
    m["best_s"] = (m.best_ms / 1000).round(3)
    r["monaco"] = rows(m)

    # 7. Races and laps per season
    c = dr.groupby("year").agg(races=("round", "nunique"), laps=("laps", "sum")).reset_index()
    r["calendar"] = rows(c)

    # 8. Wins and laps led by driver nationality
    n = dr.groupby("nationality").agg(wins=("win", "sum"), laps_led=("laps_led", "sum"),
                                      drivers=("driver", "nunique")).reset_index()
    r["nationality"] = rows(n.sort_values("wins", ascending=False).head(10))

    # 9. Team families: wins, laps led, win rate
    fam = dr.groupby("team").agg(wins=("win", "sum"), laps_led=("laps_led", "sum"),
                                 driver_races=("win", "size"), podiums=("podium", "sum")).reset_index()
    fam["win_rate"] = (fam.wins / fam.driver_races * 100).round(1)
    fam["label"] = fam.team
    # If only one defunct team ever won, show that team under its own name and figures
    # instead of the whole "Defunct" group.
    defunct = dr[dr.team == "Defunct"]
    winners = defunct.groupby("constructor").win.sum()
    winners = winners[winners > 0]
    if len(winners) == 1:
        name = winners.index[0]
        c = defunct[defunct.constructor == name]
        i = fam.index[fam.team == "Defunct"][0]
        fam.loc[i, ["wins", "laps_led", "driver_races", "podiums"]] = [
            int(c.win.sum()), int(c.laps_led.sum()), len(c), int(c.podium.sum())]
        fam.loc[i, "win_rate"] = round(c.win.sum() / len(c) * 100, 1)
        fam.loc[i, "label"] = name
        fam["constructor"] = fam.team.map({"Defunct": name})
        r["defunct_without_wins"] = int(defunct.constructor.nunique() - 1)
    r["team_family"] = rows(fam.sort_values(["wins", "label"], ascending=[False, True]))
    return r


def main():
    laps = load_laps()
    dr = build_driver_races(laps)
    dr.to_csv(OUT_CSV, index=False)
    report = build_report(laps, dr)
    OUT_JSON.write_text(json.dumps(report, indent=1))
    print(f"wrote {OUT_CSV.name}: {len(dr):,} rows; {OUT_JSON.name}")
    print(json.dumps(report["headline"], indent=1))


if __name__ == "__main__":
    main()
