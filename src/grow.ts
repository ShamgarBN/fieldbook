// Grow-on-demand: the first time a species is heard that has no art yet, paint it.
// Called from the detection-ingestion paths (webhook / mqtt / simulate). Async and
// fire-and-forget — the display falls back to the empty nest / placeholder until the
// art is ready, then picks it up on the next poll.
import db from "./db.js";
import { generateBirdArt } from "./art.js";

const artStatus = db.prepare<[string], { status: string }>("SELECT status FROM art WHERE species = ?");
const inFlight = new Set<string>();

// Cost guard: cap how many new birds this process will paint on the fly. Each
// generation is a paid image-API call, so an unfamiliar location (or a noisy
// afternoon) shouldn't be able to run the bill up. 0 disables generation
// entirely; unset falls back to the previous unlimited behaviour.
const MAX_GROWS = (() => {
  const raw = process.env.MAX_GROW_BIRDS;
  if (raw === undefined || raw === "") return Infinity;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : Infinity;
})();
let grown = 0;

export function ensureArtFor(species: string | undefined, scientific?: string | null): void {
  if (!species || !species.trim()) return;
  const row = artStatus.get(species);
  // Already have it (ready) or already painting it (pending) or actively generating.
  if (row && (row.status === "ready" || row.status === "pending")) return;
  if (inFlight.has(species)) return;

  if (grown >= MAX_GROWS) {
    console.log(`[grow] skipping "${species}" — hit MAX_GROW_BIRDS cap (${MAX_GROWS})`);
    return;
  }
  grown++;
  console.log(`[grow] first time hearing "${species}" — painting it…`);
  generateBirdArt(species, scientific ?? null)
    .then(() => console.log(`[grow] "${species}" ready`))
    .catch((err) => console.error(`[grow] "${species}" failed:`, err instanceof Error ? err.message : err))
    .finally(() => inFlight.delete(species));
}
