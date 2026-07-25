// Batch-generate the seed library.
//   npx tsx src/seed.ts            # generate everything not yet "ready"
//   npx tsx src/seed.ts --force    # regenerate all (ignore existing)
//
// Throttled concurrency keeps us under image-API rate limits; each species is
// independent, so one failure never aborts the batch.
import { existsSync } from "node:fs";
import db from "./db.js";
import { SEED_SPECIES } from "./species-seed.js";
import { generateBirdArt, artFilePath } from "./art.js";

const CONCURRENCY = 4;
const force = process.argv.includes("--force");

const readyRow = db.prepare<[string], { status: string }>("SELECT status FROM art WHERE species = ?");

function alreadyDone(species: string): boolean {
  if (force) return false;
  const row = readyRow.get(species);
  return row?.status === "ready" && existsSync(artFilePath(species));
}

const todo = SEED_SPECIES.filter((s) => !alreadyDone(s.species));
const skipped = SEED_SPECIES.length - todo.length;

console.log(
  `[seed] ${SEED_SPECIES.length} species total — ${skipped} already ready, ${todo.length} to generate ` +
    `(concurrency ${CONCURRENCY})`,
);

let done = 0;
const failures: Array<{ species: string; error: string }> = [];

// Simple worker pool over a shared queue.
const queue = [...todo];
async function worker(): Promise<void> {
  for (let next = queue.shift(); next; next = queue.shift()) {
    const label = `${done + 1 + failures.length}/${todo.length}`;
    try {
      const { ms } = await generateBirdArt(next.species, next.scientific);
      done++;
      console.log(`[ok ${label}] ${next.species} (${(ms / 1000).toFixed(0)}s)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push({ species: next.species, error: msg });
      console.error(`[fail ${label}] ${next.species}: ${msg}`);
    }
  }
}

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));

console.log(`\n[seed] complete: ${done} generated, ${failures.length} failed, ${skipped} skipped.`);
if (failures.length) {
  console.log("[seed] failures (re-run to retry — successes are skipped):");
  for (const f of failures) console.log(`  - ${f.species}: ${f.error}`);
}
process.exit(failures.length ? 1 : 0);
