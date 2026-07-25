# Fieldbook

A wall-mounted 10" Facebook Portal shows Audubon-style bird art in response to real-time
bird song detected in the yard. Fully local: a Raspberry Pi runs BirdNET-Go, this Node
server (on the Mac Mini) tracks state and serves the display, and the Portal polls it.

See the approved build plan at `~/.claude/plans/elegant-roaming-storm.md`.

## Architecture

```
Outdoor mic → Raspberry Pi 3B+ (BirdNET-Go)
            → MQTT (Mosquitto on Mac Mini)
            → this app server (Mac Mini): state + art library + display page
            → Facebook Portal (Fully Kiosk) polls /state every few seconds
```

## This repo = the Mac Mini app server

**Dev happens on the MacBook Pro; the server runs on the always-on Mac Mini.**

### Run (dev)

```bash
npm install
cp .env.example .env      # edit as needed; MQTT can stay blank on the laptop
npm run dev               # http://localhost:3000
```

Open http://localhost:3000 for the display. With no detections it shows the empty nest.

### Exercise it without hardware

```bash
# make a bird "sing" — it becomes active for 10 minutes, then joins the 48h collage
curl -X POST localhost:3000/simulate -H 'content-type: application/json' \
  -d '{"species":"American Robin","confidence":0.9}'
```

## Endpoints

- `GET /` — the display page (point Fully Kiosk here)
- `GET /state` — current display state JSON (the page polls this)
- `POST /webhook` — BirdNET-Go webhook fallback for detections
- `POST /simulate` — dev: inject a fake detection `{species, scientific?, confidence?}`
- `GET /healthz` — liveness + current mode

## State model

- A species is **active** for 10 min after its last detection (`ACTIVE_WINDOW_MINUTES`).
- Idle with something heard in the last **48 h** → collage (`COLLAGE_WINDOW_HOURS`); this
  window intentionally carries overnight owls into the daytime view.
- Idle with nothing in 48 h → empty nest.

## Art

Generated into `art/<slug>.png` (gitignored). Audubon style + vignette-to-transparent —
see `docs/STYLE_GUIDE.md`. Pipeline lands in Phase 4 (`gpt-image-1.5` + `sharp`).

## Layout

- `src/server.ts` — Express app + routes
- `src/state.ts` — detection recording + the display state machine
- `src/ingest.ts` — MQTT subscriber + payload normalizer
- `src/db.ts` — SQLite schema
- `public/` — the display page (served at `/`)
- `docs/STYLE_GUIDE.md` — locked art DNA
