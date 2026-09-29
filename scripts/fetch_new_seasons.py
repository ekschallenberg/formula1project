"""Fetch lap-by-lap data for seasons after the spreadsheet (2025 onward) from the Jolpica-F1 API.

Jolpica-F1 (https://github.com/jolpica/jolpica-f1) continues the Ergast database that
data/formula1file.xlsx was compiled from, and serves the same lap data. Its data is licensed
CC BY-NC-SA 4.0 (free for non-commercial use, with attribution).

Writes data/laps_2025_2026.csv with the same columns as the spreadsheet: one row per driver
per lap. Only races with published results are fetched, so an in-progress season stops at the
last completed round. Races already in the CSV are skipped, so re-running only adds new ones.

Jolpica allows 500 requests an hour without a key, so requests are spaced 7.5 seconds apart:
a full 2025 season plus part of 2026 takes a bit over an hour. The GitHub Action in
.github/workflows/fetch-laps.yml runs this on GitHub's servers.

Usage (from the repository root):  python3 scripts/fetch_new_seasons.py 2025 2026
Standard library only.
"""

import csv
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

API = "https://api.jolpi.ca/ergast/f1"
OUT = Path(__file__).resolve().parent.parent / "data" / "laps_2025_2026.csv"
COLUMNS = ["year", "round", "race_name", "date", "driverId", "driver_name", "code", "driver_nationality",
           "constructorId", "constructor_name", "lap", "lap_position", "lap_time", "lap_time_ms"]
INTERVAL = 7.5  # seconds between requests: 480 an hour, under the 500/hour limit
USER_AGENT = "formula1project data website (github.com/ekschallenberg/formula1project)"

_last_request = 0.0
requests_made = 0


def get(path, **params):
    """GET an API path as JSON, spacing requests out and retrying on throttling or server errors."""
    global _last_request, requests_made
    query = "&".join(f"{k}={v}" for k, v in params.items())
    url = f"{API}/{path}.json" + (f"?{query}" if query else "")
    for attempt in range(6):
        wait = _last_request + INTERVAL - time.time()
        if wait > 0:
            time.sleep(wait)
        _last_request = time.time()
        requests_made += 1
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.load(resp)["MRData"]
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503, 504):
                raise
            delay = float(e.headers.get("Retry-After") or 0) or 30 * (attempt + 1)
            print(f"  HTTP {e.code} on {url}; retrying in {delay:.0f}s", flush=True)
            time.sleep(delay)
        except (urllib.error.URLError, TimeoutError) as e:
            print(f"  {e} on {url}; retrying in 30s", flush=True)
            time.sleep(30)
    raise RuntimeError(f"giving up on {url}")


def paged(path, table, key):
    """All items of a paginated endpoint: MRData[table][key], merged across pages."""
    items, offset = [], 0
    while True:
        data = get(path, limit=100, offset=offset)
        items.extend(data[table][key])
        offset += int(data["limit"])  # the page size the API actually used
        if offset >= int(data["total"]):
            return items


def lap_ms(text):
    """'1:32.345' or '92.345' -> milliseconds."""
    minutes, _, seconds = text.rpartition(":")
    return round((int(minutes or 0) * 60 + float(seconds)) * 1000)


def fetch_season(season, done):
    # Results tell us which rounds are complete, and each driver's code, nationality and team.
    results = paged(f"{season}/results", "RaceTable", "Races")
    races = {}
    for race in results:  # a race can be split across pages; merge its results
        r = races.setdefault(int(race["round"]), {**race, "Results": []})
        r["Results"].extend(race["Results"])
    rows = []
    for rnd in sorted(races):
        race = races[rnd]
        if (season, rnd) in done:
            print(f"{season} round {rnd}: already saved, skipping", flush=True)
            continue
        entrants = {res["Driver"]["driverId"]: res for res in race["Results"]}
        timings = {}
        laps_pages = []
        offset = 0
        while True:
            data = get(f"{season}/{rnd}/laps", limit=100, offset=offset)
            races_page = data["RaceTable"]["Races"]
            if races_page:
                laps_pages.extend(races_page[0]["Laps"])
            offset += int(data["limit"])
            if offset >= int(data["total"]):
                break
        for lap in laps_pages:  # a lap can be split across pages
            for t in lap["Timings"]:
                timings[(t["driverId"], int(lap["number"]))] = t
        if not timings:
            print(f"{season} round {rnd}: no lap data published yet, stopping here", flush=True)
            break
        for (driver_id, lap_no), t in sorted(timings.items(), key=lambda kv: (kv[0][0], kv[0][1])):
            res = entrants.get(driver_id)
            if res is None:
                print(f"  {driver_id} has laps but no result in {season} round {rnd}; skipped", flush=True)
                continue
            d, c = res["Driver"], res["Constructor"]
            rows.append({
                "year": season, "round": rnd, "race_name": race["raceName"], "date": race["date"],
                "driverId": driver_id, "driver_name": f'{d["givenName"]} {d["familyName"]}',
                "code": d.get("code") or "No Code Found", "driver_nationality": d["nationality"],
                "constructorId": c["constructorId"], "constructor_name": c["name"],
                "lap": lap_no, "lap_position": int(t["position"]), "lap_time": t["time"],
                "lap_time_ms": lap_ms(t["time"]),
            })
        print(f"{season} round {rnd} {race['raceName']}: {len(timings)} laps "
              f"({requests_made} requests so far)", flush=True)
    return rows


def main(seasons):
    existing = []
    if OUT.exists():
        with OUT.open(newline="", encoding="utf-8") as f:
            existing = list(csv.DictReader(f))
    done = {(int(r["year"]), int(r["round"])) for r in existing}
    new_rows = []
    for season in seasons:
        new_rows += fetch_season(season, done)
    rows = existing + new_rows
    rows.sort(key=lambda r: (int(r["year"]), int(r["round"]), r["driverId"], int(r["lap"])))
    with OUT.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
    print(f"wrote {OUT.name}: {len(rows):,} laps ({len(new_rows):,} new) in {requests_made} requests")


if __name__ == "__main__":
    main([int(s) for s in sys.argv[1:]] or [2025, 2026])
