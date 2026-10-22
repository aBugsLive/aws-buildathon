# 🔥 Fire Marshal Dashboard

A simple dashboard for exploring Washington State wildfire data, built for fire
marshals. Data comes from the WA Department of Natural Resources (DNR) "DNR Fire
Statistics 2008-Present" layer, synced into a local SQLite database and served to a
React frontend.

This repo also ships a companion **Fire Analytics & Behavior API** (see the second
half of this document) that applies descriptive analytics and quantitative
fire-science models to the same DNR records.

---

## Architecture

The data is **cached locally in SQLite** rather than fetched live from ArcGIS on
every page load. A sync script pulls the full dataset once (or on a schedule), an
Express API serves filtered/aggregated queries, and the React app reads from that API.

```
ArcGIS REST API  ──(npm run sync)──▶  server/fires.db (SQLite)
                                           │
                        Express API (server/index.js, port 4000)
                                           │
                        React dashboard (Vite, port 5173)
```

**Why SQLite instead of live fetching?**

- The ArcGIS query API caps results at ~2,000 rows per request. The full dataset is
  ~31,900 rows, so live loading would require paginating through ~16 requests on every
  load. SQLite serves it all in one indexed query.
- The data is not real-time (historical years never change; the current year updates
  periodically), so a cached copy with a scheduled refresh is a good fit.
- Server-side `GROUP BY` handles the KPIs and chart rollups, so the browser stays fast.

Tradeoff: the local copy is only as fresh as the last `npm run sync`. During fire
season, run the sync regularly. DNR remains the authoritative source; this is a cache.

---

## Prerequisites

- **Node.js 22.5+** (24+ recommended). This project uses Node's built-in
  `node:sqlite` module, which does not exist in older versions.
  - Check your version: `node -v`
  - We intentionally do **not** use `better-sqlite3` because it requires a native
    build that currently fails on very new Node versions. `node:sqlite` needs no
    compilation and no extra dependency.

---

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Populate the local database from ArcGIS (first run, ~31,900 rows)
npm run sync

# 3. Start the API and the dashboard together
npm run dev:all
```

Then open the dashboard at **http://localhost:5173**.

The API runs on **http://localhost:4000**. If you want to run the two separately
(e.g. in different terminals), use `npm run server` and `npm run dev`.

---

## npm scripts

| Command           | What it does                                                        |
| ----------------- | ------------------------------------------------------------------- |
| `npm install`     | Install dependencies                                                |
| `npm run sync`    | Pull the full dataset from ArcGIS into `server/fires.db`            |
| `npm run server`  | Start the Express API on port 4000                                  |
| `npm run dev`     | Start the Vite dev server (dashboard) on port 5173                  |
| `npm run dev:all` | Start the API and dashboard together (via `concurrently`)           |
| `npm run build`   | Production build of the frontend into `dist/`                       |
| `npm run preview` | Preview the production build locally                                |
| `npm run api`     | Start the Fire Analytics & Behavior API (port 8000)                 |
| `npm run api:dev` | Start the analytics API with auto-reload                            |
| `npm test`        | Run the analytics/behavior unit tests                               |

> The `sync` and `server` scripts pass `--no-warnings` to silence Node's
> "SQLite is experimental" notice. That's expected — the feature is stable enough
> for our use.

---

## Keeping the data fresh

The database is a point-in-time snapshot. To refresh it, just re-run:

```bash
npm run sync
```

The sync is an **upsert** (keyed on `OBJECTID`), so re-running it updates existing
records and adds new ones without creating duplicates. During active fire season,
run it daily (or wire up a cron job / scheduled task).

---

## Data modes: live vs. static

The frontend can run against the live API or a bundled snapshot, controlled by the
`VITE_DATA_MODE` environment variable:

- **`live`** (default) — calls the SQLite-backed API on port 4000. Used in local
  development. Supports always-fresh data via `npm run sync`.
- **`static`** — reads a bundled JSON snapshot (`public/data/fires.json`) and does
  all filtering and aggregation in the browser. No backend required, so it can be
  hosted anywhere static (e.g. Vercel). The data is frozen at export time.

Both modes behave identically from the user's perspective; the switch lives in
`src/api.js`, which delegates to `src/staticApi.js` in static mode.

### Deploying to Vercel (static mode)

Vercel has no persistent server or filesystem, so we deploy the **static** build.

1. **Export the data snapshot** (runs locally, needs the SQLite DB from `npm run sync`):

   ```bash
   npm run export:static
   ```

   This writes `public/data/fires.json` and `public/data/wa-counties.geojson`.
   **Commit these files** — Vercel serves them directly; it cannot regenerate them.

2. **Commit and push** your branch to GitHub/GitLab.

3. **Import the repo in Vercel.** The included `vercel.json` already sets:
   - build command: `npm run build:static` (builds with `VITE_DATA_MODE=static`)
   - output directory: `dist`
   - an SPA rewrite (everything except `/data/*` falls back to `index.html`)

   No environment variables are required for static mode.

4. Deploy. Vercel builds the frontend and serves `dist/` plus the bundled data.

To refresh the deployed data later: re-run `npm run sync`, then `npm run export:static`,
commit the updated JSON, and push (Vercel redeploys automatically).

> **Alternative (live data in production):** host the Express API on a platform
> with a real server/disk (Render, Railway, Fly.io), deploy the frontend to Vercel
> in `live` mode, and set `VITE_API_BASE` to the hosted API URL.

### Testing static mode locally

```bash
npm run export:static    # generate the snapshot
npm run build:static     # build with VITE_DATA_MODE=static
npm run preview:static   # serve dist/ at http://localhost:4173
```

---

## Project structure

```
aws-buildathon/
├── index.html            # Vite entry HTML
├── vite.config.js
├── package.json
├── server/
│   ├── db.js             # Opens SQLite + defines schema and indexes
│   ├── sync.js           # Pages ArcGIS data into SQLite (npm run sync)
│   ├── index.js          # Express API (endpoints below)
│   └── fires.db          # The SQLite database (generated — not committed)
└── src/
    ├── main.jsx          # React entry
    ├── App.jsx           # Dashboard UI (KPIs, charts, filters, table)
    ├── api.js            # Frontend client for the local API
    ├── styles.css        # Dark theme
    │
    │  # Fire Analytics & Behavior API (see second half of this README)
    ├── server.js         # Analytics API entry (port 8000)
    ├── app.js            # Express wiring
    ├── schema/record.js  # ESRI fire-record schema + normalization
    ├── lib/              # regime, analytics, fireBehavior, fuelModels
    └── routes/           # analytics + behavior routers
```

---

## API reference (dashboard API, port 4000)

Base URL: `http://localhost:4000`

All list/summary endpoints accept the same optional query filters:

| Param      | Example            | Meaning                               |
| ---------- | ------------------ | ------------------------------------- |
| `county`   | `?county=OKANOGAN` | Filter by county name                 |
| `cause`    | `?cause=Natural`   | Filter by general fire cause          |
| `year`     | `?year=2020`       | Filter by discovery year              |
| `minAcres` | `?minAcres=100`    | Only fires >= this many acres burned  |

### `GET /api/health`

Quick check that the API is up and how many rows are loaded.

```json
{ "ok": true, "rows": 31916 }
```

### `GET /api/options`

Distinct values for the filter dropdowns.

```json
{ "counties": ["ADAMS", ...], "causes": ["Arson", ...], "years": [2026, 2025, ...] }
```

### `GET /api/fires`

Filtered list of incidents, largest first. Extra param: `limit` (default 100, max 5000).

### `GET /api/summary`

KPIs and chart aggregates for the current filters: total fires, total/avg/max acres,
the largest incident, and `byCause`, `byCounty`, and `byYear` rollups.

Example:

```bash
curl "http://localhost:4000/api/summary?county=OKANOGAN&year=2020"
```

---

## Data source

Washington State Department of Natural Resources — "DNR Fire Statistics 2008-Present"
served via the ArcGIS REST Feature Service:

```
https://gis.dnr.wa.gov/site3/rest/services/Public_Wildfire/WADNR_PUBLIC_WD_WildFire_Data/MapServer/2
```

ArcGIS REST query API docs:
https://developers.arcgis.com/rest/services-reference/enterprise/query-feature-service-layer

---

## Troubleshooting

- **Dashboard shows "Failed to load data"** — the API isn't running. Start it with
  `npm run server` (or use `npm run dev:all`).
- **`EADDRINUSE: address already in use :::4000`** — an API instance is already
  running on port 4000. Reuse it, or stop the old process first.
- **Empty dashboard / 0 rows** — you haven't synced yet. Run `npm run sync`.
- **`node:sqlite` import error** — your Node is too old. Upgrade to 22.5+ (`node -v`).

---
---

# WA Fire Analytics & Behavior API

A companion Node/Express API for the WA DNR Regional Fire & Mitigation Officer. It
ingests historical fire-event records (the DNR ESRI fire-occurrence schema) and
applies both descriptive fire analytics and quantitative fire-science models. It
runs independently of the dashboard on **port 8000** (`npm run api`).

## Two layers

### 1. Descriptive analytics — derived directly from the records
The historical schema carries ignition cause, location, elevation, the
discovery → control → out timeline, acres burned, stocking breakdown, fire
class and region. From those:

| Endpoint | What it computes |
| --- | --- |
| `POST /analytics/summary` | Counts, total/mean/median/max acres, year range, west/east regime breakdown |
| `POST /analytics/seasonality` | Monthly and seasonal ignition and area-burned distribution, peak month |
| `POST /analytics/cause-attribution` | Human vs lightning vs other, overall and per regime |
| `POST /analytics/size-class` | NWCG size classes (A–G) and heavy-tail (top 5%) share of acres |
| `POST /analytics/containment` | Discovery→control and discovery→out durations, effective growth rate (ac/hr) |
| `POST /analytics/fire-return-interval` | Burn frequency and mean return interval by county / region / grid |
| `POST /analytics/exposure` | Expected-value style prioritization (frequency × mean size) |

### 2. Fire-behavior models — physics, need supplemental inputs
The raw records have no weather or fuel-moisture data, so these run in scenario
mode. Supply the environmental inputs; optionally attach a record.

| Endpoint | Model |
| --- | --- |
| `GET  /behavior/fuel-models` | Available surface fuel models |
| `POST /behavior/rothermel` | Rothermel (1972) surface rate of spread |
| `POST /behavior/byram` | Byram fireline intensity + flame length |
| `POST /behavior/crown-init` | Van Wagner (1977) crown-fire initiation threshold |
| `POST /behavior/nfdrs/burning-index` | NFDRS Burning Index |
| `POST /behavior/scenario` | Chained Rothermel → Byram → Van Wagner + ERC proxy (primary) |

## Run

```bash
npm install
npm run api         # or: npm run api:dev   (auto-reload)
```

Server listens on `http://127.0.0.1:8000`. `GET /` returns the endpoint index.

## Input shape

Every analytics endpoint accepts any of:

```jsonc
{ "records":  [ { "OBJECTID": 1, "ACRES_BURNED": 12.4, ... } ] }
{ "features": [ { "attributes": { "OBJECTID": 1, ... } } ] }   // raw ESRI feature set
[ { "OBJECTID": 1, ... } ]                                     // bare array
```

Field names match the source layer exactly (`ACRES_BURNED`, `DSCVR_DT`,
`REGION_NAME`, …). ESRI date fields may be epoch-ms, ISO, or `YYYYMMDD`; time
fields are `HHmm` strings.

## Examples

Summary over a feature set:

```bash
curl -s -X POST http://127.0.0.1:8000/analytics/summary \
  -H 'content-type: application/json' \
  --data @samples/fires.json
```

Full behavior scenario (east-side timber, dry, moderate wind, 20% slope):

```bash
curl -s -X POST http://127.0.0.1:8000/behavior/scenario \
  -H 'content-type: application/json' \
  -d '{
    "fuelModel": "FM10",
    "dead1hMoisture": 0.06,
    "windSpeed": 8,
    "slope": 0.2,
    "canopyBaseHeight_m": 3,
    "foliarMoisturePct": 100
  }'
```

## Modeling notes (keep these centered)

- **Regime-specific.** West-side vs east-side of the Cascade crest is the
  dominant split; statewide averages mislead. Analytics report both.
- **Risk ≠ hazard.** Fire-behavior potential matters only where it meets values
  at risk. `exposure` keeps frequency × size together as a screening proxy;
  true net-value-change needs values-at-risk layers absent from this schema.
- **Non-stationarity.** Historical return intervals are a weakening predictor
  under a warming climate — treat them as a floor, not a forecast.
- **Fire-behavior inputs are scenarios.** The records lack weather/fuel
  moisture, so Rothermel/Byram/Van Wagner outputs reflect the inputs you
  supply, not the historical conditions of a given fire.
