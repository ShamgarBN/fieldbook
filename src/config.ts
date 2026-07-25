import "dotenv/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Project root is one level up from src/ (or dist/ when compiled)
export const ROOT = resolve(__dirname, "..");

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function str(name: string, fallback = ""): string {
  const raw = process.env[name];
  return raw === undefined ? fallback : raw;
}

export const config = {
  port: num("PORT", 3000),
  displayPollSeconds: num("DISPLAY_POLL_SECONDS", 8),

  // State machine
  activeWindowMs: num("ACTIVE_WINDOW_MINUTES", 10) * 60 * 1000,
  // After the last bird drops off, hold the empty nest this long before the
  // collage takes over. 0 = straight to the collage (the pre-2026-07 behaviour).
  nestWindowMs: num("NEST_WINDOW_MINUTES", 15) * 60 * 1000,
  collageWindowMs: num("COLLAGE_WINDOW_HOURS", 48) * 60 * 60 * 1000,
  // How often the 48h collage swaps some birds (when >9 have been heard).
  cycleIntervalSeconds: num("CYCLE_INTERVAL_SECONDS", 30),
  minConfidence: num("MIN_CONFIDENCE", 0.6),

  // MQTT ingestion (empty MQTT_URL disables the subscriber — useful on the dev laptop)
  mqtt: {
    url: str("MQTT_URL"),
    topic: str("MQTT_TOPIC", "birdnet"),
    username: str("MQTT_USERNAME"),
    password: str("MQTT_PASSWORD"),
  },

  // Art generation (Phase 4)
  openaiApiKey: str("OPENAI_API_KEY"),
  imageBackend: str("IMAGE_BACKEND", "openai"),
  imageModel: str("IMAGE_MODEL", "gpt-image-1.5"),
  imageQuality: str("IMAGE_QUALITY", "high"),
  // Portal hangs in portrait (800x1280 panel) — portrait renders match it.
  imageSize: str("IMAGE_SIZE", "1024x1536"),

  // Filesystem
  dataDir: resolve(ROOT, "data"),
  artDir: resolve(ROOT, "art"),
  publicDir: resolve(ROOT, "public"),
} as const;

export type AppConfig = typeof config;
