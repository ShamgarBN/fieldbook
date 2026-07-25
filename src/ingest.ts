import mqtt from "mqtt";
import { config } from "./config.js";
import { recordDetection, type Detection } from "./state.js";
import { ensureArtFor } from "./grow.js";

/**
 * BirdNET-Go publishes detections as JSON over MQTT. The exact field casing has varied
 * across versions, so we normalize defensively and confirm the real shape against the Pi
 * in Phase 1. Accepts the common variants for name / scientific / confidence / time.
 */
export function normalizeDetection(payload: unknown, source: string): Detection | null {
  let obj: Record<string, unknown>;
  if (typeof payload === "string") {
    try {
      obj = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      return null;
    }
  } else if (payload && typeof payload === "object") {
    obj = payload as Record<string, unknown>;
  } else {
    return null;
  }

  const pick = (...keys: string[]): unknown => {
    for (const k of keys) {
      if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
    }
    return undefined;
  };

  const species = pick("CommonName", "commonName", "common_name", "Com_Name", "species", "Species");
  if (typeof species !== "string") return null;

  const scientific = pick("ScientificName", "scientificName", "scientific_name", "Sci_Name");
  const confidenceRaw = pick("Confidence", "confidence");
  const timeRaw = pick("Time", "time", "Date", "timestamp", "detected_at");

  let detectedAt = Date.now();
  if (typeof timeRaw === "number") {
    // seconds vs ms heuristic
    detectedAt = timeRaw > 1e12 ? timeRaw : timeRaw * 1000;
  } else if (typeof timeRaw === "string") {
    const parsed = Date.parse(timeRaw);
    if (!Number.isNaN(parsed)) detectedAt = parsed;
  }

  return {
    species,
    scientific: typeof scientific === "string" ? scientific : undefined,
    confidence: typeof confidenceRaw === "number" ? confidenceRaw : undefined,
    detectedAt,
    source,
  };
}

// Live ingestion status, surfaced on the config page's system-status card.
let mqttConnected = false;

export function getIngestStatus(): { mqttConfigured: boolean; mqttConnected: boolean } {
  return { mqttConfigured: Boolean(config.mqtt.url), mqttConnected };
}

// Strip any user:pass@ credentials from an MQTT URL before it hits the logs.
function redactUrl(url: string): string {
  return url.replace(/\/\/[^/@]*@/, "//");
}

export function startMqtt(): void {
  if (!config.mqtt.url) {
    console.log("[mqtt] MQTT_URL not set — MQTT ingestion disabled (dev mode).");
    return;
  }

  const client = mqtt.connect(config.mqtt.url, {
    username: config.mqtt.username || undefined,
    password: config.mqtt.password || undefined,
    reconnectPeriod: 5000,
  });

  client.on("connect", () => {
    mqttConnected = true;
    console.log(`[mqtt] connected to ${redactUrl(config.mqtt.url)}`);
    client.subscribe(config.mqtt.topic, (err) => {
      if (err) console.error(`[mqtt] subscribe failed for '${config.mqtt.topic}':`, err.message);
      else console.log(`[mqtt] subscribed to '${config.mqtt.topic}'`);
    });
  });

  client.on("close", () => {
    mqttConnected = false;
  });
  client.on("offline", () => {
    mqttConnected = false;
  });

  client.on("message", (topic, buf) => {
    const det = normalizeDetection(buf.toString(), "mqtt");
    if (!det) {
      console.warn(`[mqtt] unparseable message on ${topic}: ${buf.toString().slice(0, 120)}`);
      return;
    }
    const res = recordDetection(det);
    if (res.accepted) {
      console.log(`[mqtt] ${det.species} (${det.confidence ?? "?"})`);
      ensureArtFor(det.species, det.scientific);
    }
  });

  client.on("error", (err) => {
    const e = err as NodeJS.ErrnoException & { errors?: unknown[] };
    console.error(
      "[mqtt] error:",
      `code=${e.code ?? "?"}`,
      `msg=${e.message || "(none)"}`,
      `name=${e.name ?? "?"}`,
      e.errors ? `sub=${JSON.stringify(e.errors)}` : "",
    );
  });
  client.on("reconnect", () => console.log("[mqtt] reconnecting…"));
}
