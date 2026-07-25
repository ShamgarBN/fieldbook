// Data + actions backing the mobile config page (see public/config.*).
import db from "./db.js";
import { config } from "./config.js";
import { SEED_SPECIES } from "./species-seed.js";
import { generateBirdArt } from "./art.js";

const seedMap = new Map(SEED_SPECIES.map((s) => [s.species, s.scientific]));

// --- Art library ---
export interface LibraryItem {
  species: string;
  scientific: string | null;
  status: string; // ready | pending | failed
  url: string | null;
  updatedAt: number;
  inSeed: boolean;
}

const libraryRows = db.prepare<[], { species: string; slug: string; status: string; updatedAt: number; sci: string | null }>(
  `SELECT a.species, a.slug, a.status, a.updated_at AS updatedAt,
          (SELECT MAX(d.scientific) FROM detections d WHERE d.species = a.species) AS sci
   FROM art a
   ORDER BY a.species COLLATE NOCASE`,
);

export function listLibrary(): LibraryItem[] {
  return libraryRows.all().map((r) => ({
    species: r.species,
    scientific: seedMap.get(r.species) ?? r.sci ?? null,
    status: r.status,
    url: r.status === "ready" ? `/art/${r.slug}.png?v=${r.updatedAt}` : null,
    updatedAt: r.updatedAt,
    inSeed: seedMap.has(r.species),
  }));
}

// --- Detection log ---
export interface DetectionRow {
  species: string;
  scientific: string | null;
  confidence: number | null;
  detectedAt: number;
  source: string;
}

const recentRows = db.prepare<[number], DetectionRow>(
  `SELECT species, scientific, confidence, detected_at AS detectedAt, source
   FROM detections ORDER BY detected_at DESC LIMIT ?`,
);

const countSince = db.prepare<[number], { n: number }>(
  "SELECT COUNT(*) AS n FROM detections WHERE detected_at >= ?",
);
const speciesSince = db.prepare<[number], { n: number }>(
  "SELECT COUNT(DISTINCT species) AS n FROM detections WHERE detected_at >= ?",
);

export function detectionLog(limit = 100): {
  recent: DetectionRow[];
  last24hCount: number;
  last24hSpecies: number;
} {
  const since = Date.now() - 24 * 60 * 60 * 1000;
  return {
    recent: recentRows.all(limit),
    last24hCount: countSince.get(since)?.n ?? 0,
    last24hSpecies: speciesSince.get(since)?.n ?? 0,
  };
}

const lastDetectionRow = db.prepare<[], DetectionRow>(
  `SELECT species, scientific, confidence, detected_at AS detectedAt, source
   FROM detections ORDER BY detected_at DESC LIMIT 1`,
);

export function lastDetection(): DetectionRow | null {
  return lastDetectionRow.get() ?? null;
}

// --- Metrics (species leaderboard + time-of-day pattern) ---
const totalRow = db.prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM detections");
const distinctRow = db.prepare<[], { n: number }>("SELECT COUNT(DISTINCT species) AS n FROM detections");
const speciesCountRows = db.prepare<[number], { species: string; count: number; lastHeard: number }>(
  `SELECT species, COUNT(*) AS count, MAX(detected_at) AS lastHeard
   FROM detections GROUP BY species ORDER BY count DESC, lastHeard DESC LIMIT ?`,
);
// Local hour-of-day buckets (shopmini's timezone = the yard's local time).
const byHourRows = db.prepare<[], { h: number; n: number }>(
  `SELECT CAST(strftime('%H', detected_at / 1000, 'unixepoch', 'localtime') AS INTEGER) AS h,
          COUNT(*) AS n
   FROM detections GROUP BY h`,
);

export interface Metrics {
  totalDetections: number;
  distinctSpecies: number;
  speciesCounts: Array<{ species: string; count: number; lastHeard: number }>;
  byHour: number[]; // length 24, index = local hour
}

export function metrics(topN = 20): Metrics {
  const byHour = Array<number>(24).fill(0);
  for (const r of byHourRows.all()) {
    if (r.h >= 0 && r.h < 24) byHour[r.h] = r.n;
  }
  return {
    totalDetections: totalRow.get()?.n ?? 0,
    distinctSpecies: distinctRow.get()?.n ?? 0,
    speciesCounts: speciesCountRows.all(topN),
    byHour,
  };
}

// --- Settings ---
const getSettingRow = db.prepare<[string], { value: string }>("SELECT value FROM settings WHERE key = ?");
const upsertSetting = db.prepare(
  `INSERT INTO settings (key, value) VALUES (?, ?)
   ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
);

export function getSettings(): { activeWindowMinutes: number; nestWindowMinutes: number } {
  const row = getSettingRow.get("active_window_minutes");
  const mins = row ? Number(row.value) : config.activeWindowMs / 60000;

  const nestRow = getSettingRow.get("nest_window_minutes");
  const nestMins = nestRow ? Number(nestRow.value) : config.nestWindowMs / 60000;

  return {
    activeWindowMinutes: Number.isFinite(mins) ? mins : config.activeWindowMs / 60000,
    nestWindowMinutes: Number.isFinite(nestMins) ? nestMins : config.nestWindowMs / 60000,
  };
}

export function setActiveWindowMinutes(mins: number): { ok: boolean; reason?: string } {
  if (!Number.isFinite(mins) || mins < 1 || mins > 120) {
    return { ok: false, reason: "active window must be between 1 and 120 minutes" };
  }
  upsertSetting.run("active_window_minutes", String(Math.round(mins)));
  return { ok: true };
}

// 0 is allowed here (unlike the active window): it means skip the nest entirely
// and fall straight through to the collage.
export function setNestWindowMinutes(mins: number): { ok: boolean; reason?: string } {
  if (!Number.isFinite(mins) || mins < 0 || mins > 120) {
    return { ok: false, reason: "nest window must be between 0 and 120 minutes" };
  }
  upsertSetting.run("nest_window_minutes", String(Math.round(mins)));
  return { ok: true };
}

// --- Reset activity ---
// Wipes all detection history (empties the collage, the detection log, and the
// Activity metrics). The art library and settings are left intact — this only
// clears the `detections` table. Used to dump test data before going live.
const clearDetections = db.prepare("DELETE FROM detections");
export function resetActivity(): { deleted: number } {
  return { deleted: clearDetections.run().changes };
}

// --- Manual regeneration (async; library reflects pending -> ready) ---
const inFlight = new Set<string>();

export function isRegenerating(species: string): boolean {
  return inFlight.has(species);
}

export function regenerate(species: string): { started: boolean; reason?: string } {
  if (!species || !species.trim()) return { started: false, reason: "species required" };
  if (inFlight.has(species)) return { started: false, reason: "already regenerating" };

  const detSci = db
    .prepare<[string], { sci: string | null }>("SELECT MAX(scientific) AS sci FROM detections WHERE species = ?")
    .get(species)?.sci;
  const scientific = seedMap.get(species) ?? detSci ?? null;

  inFlight.add(species);
  generateBirdArt(species, scientific)
    .catch((err) => console.error(`[regen] ${species}: ${err instanceof Error ? err.message : err}`))
    .finally(() => inFlight.delete(species));
  return { started: true };
}
