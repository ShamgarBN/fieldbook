import db from "./db.js";
import { config } from "./config.js";

export interface Detection {
  species: string;
  scientific?: string;
  confidence?: number;
  detectedAt: number; // unix ms
  source: string;
}

export interface SpeciesView {
  species: string;
  scientific: string | null;
  lastHeard: number; // unix ms
  count: number; // detections within the relevant window
  art: { status: string; url: string | null };
}

export type DisplayMode = "active" | "collage" | "empty";

export interface DisplayState {
  mode: DisplayMode;
  active: SpeciesView[]; // heard within the active window (10 min)
  collage: SpeciesView[]; // distinct species heard within the 48h rolling window
  generatedAt: number;
  pollSeconds: number;
  cycleSeconds: number; // collage swap interval (config-tunable)
  previewId?: number; // set while a manual "Preview" override is on the wall
}

export function slugify(species: string): string {
  const base = species
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // A name with no ASCII alphanumerics (e.g. non-Latin scripts) would collapse
  // to "" and every such species would collide on the same file. Fall back to a
  // short deterministic hash of the original so each still gets a unique slug.
  if (base) return base;
  let h = 0;
  for (let i = 0; i < species.length; i++) h = (Math.imul(h, 31) + species.charCodeAt(i)) | 0;
  return `sp-${(h >>> 0).toString(36)}`;
}

// --- settings overrides (config page can tune these) ---
const getSetting = db.prepare<[string], { value: string }>(
  "SELECT value FROM settings WHERE key = ?",
);

function activeWindowMs(): number {
  const row = getSetting.get("active_window_minutes");
  const mins = row ? Number(row.value) : NaN;
  return Number.isFinite(mins) && mins > 0 ? mins * 60 * 1000 : config.activeWindowMs;
}

// How long the empty nest lingers after the last bird drops off, before the
// 48h collage takes over. 0 is valid and means "go straight to the collage".
function nestWindowMs(): number {
  const row = getSetting.get("nest_window_minutes");
  const mins = row ? Number(row.value) : NaN;
  return Number.isFinite(mins) && mins >= 0 ? mins * 60 * 1000 : config.nestWindowMs;
}

// How often the collage swaps birds (seconds). Read by the display each poll.
function cycleIntervalSeconds(): number {
  const row = getSetting.get("cycle_interval_seconds");
  const secs = row ? Number(row.value) : NaN;
  return Number.isFinite(secs) && secs > 0 ? secs : config.cycleIntervalSeconds;
}

// --- writes ---
const insertDetection = db.prepare(
  `INSERT INTO detections (species, scientific, confidence, detected_at, source)
   VALUES (@species, @scientific, @confidence, @detectedAt, @source)`,
);

export function recordDetection(d: Detection): { accepted: boolean; reason?: string } {
  if (!d.species || d.species.trim() === "") {
    return { accepted: false, reason: "missing species" };
  }
  if (d.confidence !== undefined && d.confidence < config.minConfidence) {
    return { accepted: false, reason: `below min confidence ${config.minConfidence}` };
  }
  insertDetection.run({
    species: d.species.trim(),
    scientific: d.scientific ?? null,
    confidence: d.confidence ?? null,
    detectedAt: d.detectedAt,
    source: d.source,
  });
  return { accepted: true };
}

// --- reads ---
const artFor = db.prepare<[string], { status: string; slug: string; updatedAt: number }>(
  "SELECT status, slug, updated_at AS updatedAt FROM art WHERE species = ?",
);

function artView(species: string): { status: string; url: string | null } {
  const row = artFor.get(species);
  if (row && row.status === "ready") {
    // ?v=<updated_at> is a cache-buster: regenerating a bird bumps updated_at,
    // which changes this URL, so the Portal + browsers refetch just that bird's
    // new art instead of showing the stale cached copy.
    return { status: "ready", url: `/art/${row.slug}.png?v=${row.updatedAt}` };
  }
  return { status: row?.status ?? "none", url: null };
}

const activeRows = db.prepare<[number], { species: string; scientific: string | null; lastHeard: number; count: number }>(
  `SELECT species,
          MAX(scientific)     AS scientific,
          MAX(detected_at)    AS lastHeard,
          COUNT(*)            AS count
   FROM detections
   WHERE detected_at >= ?
   GROUP BY species
   ORDER BY lastHeard DESC`,
);

const collageRows = db.prepare<[number], { species: string; scientific: string | null; lastHeard: number; count: number }>(
  `SELECT species,
          MAX(scientific)     AS scientific,
          MAX(detected_at)    AS lastHeard,
          COUNT(*)            AS count
   FROM detections
   WHERE detected_at >= ?
   GROUP BY species
   ORDER BY count DESC, lastHeard DESC`,
);

function toView(r: { species: string; scientific: string | null; lastHeard: number; count: number }): SpeciesView {
  return {
    species: r.species,
    scientific: r.scientific,
    lastHeard: r.lastHeard,
    count: r.count,
    art: artView(r.species),
  };
}

// --- Manual "Preview on the wall" override (config page Preview button) ---
// A press shows one bird on the display. The display renders it and runs its own
// 15s timer, then POSTs /api/preview/clear. `until` is a server-side safety net
// in case that clear never arrives (e.g. the Portal was offline) so the wall
// can't get stuck on a preview.
let preview: { species: string; scientific: string | null; id: number; until: number } | null = null;
let previewSeq = 0;
const PREVIEW_SAFETY_MS = 30_000;

export function startPreview(species: string, scientific: string | null): { ok: boolean; reason?: string } {
  const s = (species ?? "").trim();
  if (!s) return { ok: false, reason: "species required" };
  if (artView(s).status !== "ready") return { ok: false, reason: "no ready art for this species" };
  preview = { species: s, scientific: scientific ?? null, id: ++previewSeq, until: Date.now() + PREVIEW_SAFETY_MS };
  return { ok: true };
}

export function clearPreview(): void {
  preview = null;
}

export function getState(now = Date.now()): DisplayState {
  // A manual preview overrides everything for its short window.
  if (preview && now < preview.until) {
    const bird: SpeciesView = {
      species: preview.species,
      scientific: preview.scientific,
      lastHeard: now,
      count: 1,
      art: artView(preview.species),
    };
    return { mode: "active", active: [bird], collage: [], generatedAt: now, pollSeconds: config.displayPollSeconds, cycleSeconds: cycleIntervalSeconds(), previewId: preview.id };
  }
  if (preview) preview = null; // safety window elapsed — drop it

  const active = activeRows.all(now - activeWindowMs()).map(toView);
  const collage = collageRows.all(now - config.collageWindowMs).map(toView);

  // active -> (quiet beat on the empty nest) -> 48h collage -> empty nest once
  // the 48h window itself runs dry.
  let mode: DisplayMode;
  if (active.length > 0) {
    mode = "active";
  } else if (collage.length === 0) {
    mode = "empty";
  } else {
    const lastHeard = Math.max(...collage.map((c) => c.lastHeard));
    const quietFor = now - lastHeard;
    mode = quietFor < activeWindowMs() + nestWindowMs() ? "empty" : "collage";
  }

  return {
    mode,
    active,
    collage,
    generatedAt: now,
    pollSeconds: config.displayPollSeconds,
    cycleSeconds: cycleIntervalSeconds(),
  };
}
