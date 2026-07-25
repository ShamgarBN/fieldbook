import express from "express";
import { mkdirSync } from "node:fs";
import { config } from "./config.js";
import { getState, recordDetection, startPreview, clearPreview } from "./state.js";
import { normalizeDetection, startMqtt, getIngestStatus } from "./ingest.js";
import {
  listLibrary,
  detectionLog,
  lastDetection,
  getSettings,
  setActiveWindowMinutes,
  setNestWindowMinutes,
  resetActivity,
  regenerate,
  metrics,
} from "./admin.js";
import { ensureArtFor } from "./grow.js";

mkdirSync(config.artDir, { recursive: true });

const startedAt = Date.now();

const app = express();
app.use(express.json());

// CSRF guard for state-changing requests. This is a trusted-LAN device with no
// login, so a malicious site the user visits shouldn't be able to drive their
// browser into POSTing here (e.g. wiping history or running up art costs). We
// reject any mutating request that carries a cross-origin `Origin` header.
// Requests with no Origin (BirdNET-Go's webhook, curl, native clients) pass
// through; same-origin fetches from the config/display pages match Host and pass.
app.use((req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  const origin = req.get("origin");
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return res.status(403).json({ error: "bad origin" });
    }
    if (originHost !== req.get("host")) {
      return res.status(403).json({ error: "cross-origin request blocked" });
    }
  }
  next();
});

// Dev-only routes (fake detections) are live on the dev laptop — where MQTT
// isn't configured — but stay off on the real device unless explicitly enabled,
// so nothing on the LAN can inject detections / trigger paid art there.
const devRoutesEnabled = !config.mqtt.url || process.env.ENABLE_SIMULATE === "1";

// --- Display state (polled by the Portal kiosk browser) ---
app.get("/state", (_req, res) => {
  res.json(getState());
});

// --- Detection ingestion (webhook fallback from BirdNET-Go) ---
app.post("/webhook", (req, res) => {
  const det = normalizeDetection(req.body, "webhook");
  if (!det) return res.status(400).json({ error: "could not parse detection" });
  const result = recordDetection(det);
  if (result.accepted) ensureArtFor(det.species, det.scientific);
  res.status(result.accepted ? 202 : 200).json(result);
});

// --- Dev helper: inject a fake detection so the display can be exercised pre-hardware ---
// e.g. curl -X POST localhost:3000/simulate -H 'content-type: application/json' \
//        -d '{"species":"American Robin","confidence":0.9}'
// Gated: on the real device (MQTT configured) set ENABLE_SIMULATE=1 to turn on.
if (devRoutesEnabled) {
  app.post("/simulate", (req, res) => {
    const body = (req.body ?? {}) as { species?: string; scientific?: string; confidence?: number };
    if (!body.species) return res.status(400).json({ error: "species required" });
    const result = recordDetection({
      species: body.species,
      scientific: body.scientific,
      confidence: body.confidence ?? 0.99,
      detectedAt: Date.now(),
      source: "simulate",
    });
    if (result.accepted) ensureArtFor(body.species, body.scientific);
    res.status(result.accepted ? 202 : 200).json({ ...result, state: getState() });
  });
}

app.get("/healthz", (_req, res) => res.json({ ok: true, mode: getState().mode }));

// --- Config page API (consumed by public/config.js) ---
app.get("/api/status", (_req, res) => {
  const last = lastDetection();
  const ingest = getIngestStatus();
  const recentlyHeard = last ? Date.now() - last.detectedAt < 15 * 60 * 1000 : false;
  res.json({
    mode: getState().mode,
    ingest,
    // "Likely online" if MQTT is connected, or a detection arrived in the last 15 min.
    piLikelyOnline: ingest.mqttConnected || recentlyHeard,
    lastDetection: last,
    libraryCount: listLibrary().length,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    serverTime: Date.now(),
  });
});

app.get("/api/library", (_req, res) => res.json({ items: listLibrary() }));

app.get("/api/detections", (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  res.json(detectionLog(limit));
});

app.get("/api/metrics", (_req, res) => res.json(metrics()));

app.get("/api/settings", (_req, res) => res.json(getSettings()));

app.post("/api/settings", (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;

  if (body.activeWindowMinutes !== undefined) {
    const result = setActiveWindowMinutes(Number(body.activeWindowMinutes));
    if (!result.ok) return res.status(400).json(result);
  }
  if (body.nestWindowMinutes !== undefined) {
    const result = setNestWindowMinutes(Number(body.nestWindowMinutes));
    if (!result.ok) return res.status(400).json(result);
  }
  res.json({ ok: true, settings: getSettings() });
});

app.post("/api/regenerate", (req, res) => {
  const species = String((req.body ?? {}).species ?? "");
  const result = regenerate(species);
  res.status(result.started ? 202 : 409).json(result);
});

app.post("/api/reset-activity", (_req, res) => {
  res.json({ ok: true, ...resetActivity() });
});

// Show one bird on the wall for a moment (the display owns the 15s timing).
app.post("/api/preview", (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const result = startPreview(String(body.species ?? ""), typeof body.scientific === "string" ? body.scientific : null);
  res.status(result.ok ? 202 : 400).json(result);
});

app.post("/api/preview/clear", (_req, res) => {
  clearPreview();
  res.json({ ok: true });
});

// --- Static assets ---
app.get("/config", (_req, res) => res.sendFile("config.html", { root: config.publicDir }));
app.use("/art", express.static(config.artDir));
app.use(express.static(config.publicDir)); // serves index.html (the display) at /

app.listen(config.port, () => {
  // Binds all interfaces so the phone can reach the config page over the LAN.
  console.log(`[server] Fieldbook listening on :${config.port} (reachable across the LAN)`);
  console.log(`[server] display: /   config: /config   state: /state${devRoutesEnabled ? "   simulate: POST /simulate" : ""}`);
  startMqtt();
});
