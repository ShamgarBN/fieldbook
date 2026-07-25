// Generate art for named species from the command line.
//   npx tsx src/art-cli.ts "Northern Cardinal:Cardinalis cardinalis" "Carolina Wren"
// Species and (optional) scientific name are separated by ":".
// Pass --refinalize to re-run despeckle+framing on stored raws instead of calling the API.
// Pass --nest to (re)generate the empty-nest idle illustration.
import { generateBirdArt, refinalize, generateEmptyNest } from "./art.js";

const args = process.argv.slice(2);

if (args.includes("--nest")) {
  const { file, ms } = await generateEmptyNest();
  console.log(`[ok] empty nest: generated in ${(ms / 1000).toFixed(1)}s -> ${file}`);
  process.exit(0);
}

const refinalizeOnly = args.includes("--refinalize");
const specs = args.filter((a) => a !== "--refinalize");

if (specs.length === 0) {
  console.error('usage: tsx src/art-cli.ts [--refinalize] "Species[:Scientific name]" ...');
  process.exit(1);
}

const results = await Promise.allSettled(
  specs.map(async (spec) => {
    const [species, scientific] = spec.split(":").map((s) => s.trim());
    if (refinalizeOnly) {
      const file = await refinalize(species);
      return `${species}: re-finalized -> ${file}`;
    }
    const { file, ms } = await generateBirdArt(species, scientific || null);
    return `${species}: generated in ${(ms / 1000).toFixed(1)}s -> ${file}`;
  }),
);

let failed = 0;
for (const [i, r] of results.entries()) {
  if (r.status === "fulfilled") console.log(`[ok] ${r.value}`);
  else {
    failed++;
    console.error(`[fail] ${specs[i]}: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
  }
}
process.exit(failed > 0 ? 1 : 0);
