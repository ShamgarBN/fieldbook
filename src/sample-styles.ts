// DEV-ONLY tool — not imported by the running server; run by hand during art
// exploration and makes paid image-API calls.
//
// Generate a style sampler: N random birds rendered in each candidate art style,
// each in a VARIED, style-appropriate pose (no more identical stock poses per species).
// Writes to art/samples/<style-key>/<bird-slug>.png — separate from the live library.
//   npx tsx src/sample-styles.ts [birdsPerStyle]
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./config.js";
import { SEED_SPECIES } from "./species-seed.js";
import { renderImage } from "./art.js";
import { slugify } from "./state.js";

const BIRDS_PER_STYLE = Number(process.argv[2]) || 2;
const CONCURRENCY = 4;

// --- Pose vocabulary: breaks the model's "one canonical pose per species" habit ---
// General poses varied per bird; a few evocative species-specific ones override.
const POSES = [
  "perched in a clean side profile",
  "with its head turned back over its shoulder",
  "wings spread wide as if just alighting on a branch",
  "peering downward from a high perch",
  "singing, bill open and throat lifted",
  "preening, head curved down toward its wing",
  "upright and alert, glancing sharply to one side",
  "leaning forward along a branch, tail trailing behind",
];
const SPECIES_POSE: Record<string, string> = {
  "Downy Woodpecker": "clinging vertically to the side of a tree trunk",
  "Red-bellied Woodpecker": "clinging vertically to a tree trunk",
  "Pileated Woodpecker": "clinging to a tree trunk, crest raised",
  "Northern Flicker": "clinging to a tree trunk and looking upward",
  "White-breasted Nuthatch": "creeping head-first down a tree trunk",
  "Brown-headed Nuthatch": "creeping head-first down a tree trunk",
  "Ruby-throated Hummingbird": "hovering in mid-air beside a flower, wings a blur",
  "Carolina Wren": "leaning forward with its tail cocked upright",
};
function assignPose(runIndex: number, slot: number, species: string): string {
  const override = SPECIES_POSE[species];
  if (override) return override;
  const h = [...species].reduce((a, c) => a + c.charCodeAt(0), 0);
  return POSES[(runIndex * 2 + slot * 3 + h) % POSES.length];
}

interface Style {
  key: string;
  label: string;
  blurb: string;
  prompt: (name: string, pose: string) => string;
}

// Complete the bird, keep framing consistent, avoid garbled AI text.
const TAIL =
  " Portrait composition, a single bird, the complete bird fully within the frame with a " +
  "comfortable margin — nothing cropped. No text, no words, no lettering, no signature.";

const STYLES: Style[] = [
  {
    key: "scratchboard",
    label: "Scratchboard",
    blurb: "Fine white engraving lines scratched from solid black",
    prompt: (n, pose) =>
      `A ${n} ${pose}, rendered as a scratchboard / scraperboard engraving: crisp fine white ` +
      `lines scratched out of a solid black ground, dramatic high contrast, intricate hatched ` +
      `feather detail in delicate white line-work on deep black, with a few subtle hand-tinted ` +
      `color accents.` + TAIL,
  },
  {
    key: "rimpa",
    label: "Rimpa gold-leaf screen",
    blurb: "Ogata Kōrin decorative screen on luminous gold",
    prompt: (n, pose) =>
      `A ${n} ${pose}, in the Japanese Rinpa (Rimpa) decorative screen tradition of Ogata ` +
      `Kōrin: bold flat stylized forms with fluid confident outlines and tarashikomi pooled-ink ` +
      `washes, set against a luminous gold-leaf background, elegant and ornamental, a byōbu ` +
      `folding-screen aesthetic.` + TAIL,
  },
  {
    key: "persian",
    label: "Persian / Mughal miniature",
    blurb: "Jewel tones, gold accents, ornate flattened detail",
    prompt: (n, pose) =>
      `A ${n} ${pose}, as a Persian / Mughal miniature painting: jewel-toned mineral pigments, ` +
      `fine detailed brushwork, gold-leaf accents, a flattened decorative perspective, set in an ` +
      `ornate stylized flowering garden with an illuminated-manuscript border sensibility.` + TAIL,
  },
  {
    key: "gongbi",
    label: "Chinese gongbi",
    blurb: "Meticulous fine-line bird-and-flower on silk",
    prompt: (n, pose) =>
      `A ${n} ${pose}, as a Chinese gongbi (工筆) fine-line bird-and-flower painting: meticulous ` +
      `precise ink outlines filled with delicate layered mineral-color washes, refined and ` +
      `elegant, on pale silk with a spare flowering branch, classical court-painting quality.` + TAIL,
  },
  {
    key: "art-deco",
    label: "Art Deco",
    blurb: "Streamlined geometric elegance, gold and black",
    prompt: (n, pose) =>
      `A ${n} ${pose}, in an elegant 1920s Art Deco style: streamlined geometric stylization, ` +
      `bold symmetry, a palette of gold and black with a single jewel accent, sunburst and ` +
      `chevron motifs, luxurious flat poster-like forms.` + TAIL,
  },
  {
    key: "impressionist",
    label: "Impressionist impasto",
    blurb: "Thick expressive oil strokes, swirling color",
    prompt: (n, pose) =>
      `A ${n} ${pose}, as an Impressionist oil painting with thick impasto brushwork in the ` +
      `spirit of Van Gogh: bold visible directional strokes, swirling vivid complementary ` +
      `colors, energetic texture, dappled light.` + TAIL,
  },
  {
    key: "decorative-folk-art",
    label: "Decorative folk-art",
    blurb: "Ink-outline watercolor on patterned ground, ornate border",
    prompt: (n, pose) =>
      `A ${n} ${pose}, as a decorative folk-art watercolor: soft watercolor washes with fine ink ` +
      `outlines and a few gouache highlights, a gently stylized bird, set on a patterned damask ` +
      `ground of scrolling vines, stylized leaves and small red bell-flowers, with an ornamental ` +
      `painted gold-and-black border, a whimsical illuminated-tapestry feel.` + TAIL,
  },
];

// Optional CLI filter: pass style keys to run a subset (default = all).
const styleKeys = process.argv.slice(2).filter((a) => !/^\d+$/.test(a));
const RUN = styleKeys.length ? STYLES.filter((s) => styleKeys.includes(s.key)) : STYLES;

// Vary bird selection across styles (arbitrary but reproducible spread).
function pickBirds(runIndex: number, count: number): typeof SEED_SPECIES {
  const picks: typeof SEED_SPECIES = [];
  const n = SEED_SPECIES.length;
  let idx = (runIndex * 7 + runIndex * runIndex) % n;
  const seen = new Set<number>();
  while (picks.length < count && seen.size < n) {
    if (!seen.has(idx)) {
      seen.add(idx);
      picks.push(SEED_SPECIES[idx]);
    }
    idx = (idx + 11 + runIndex) % n;
  }
  return picks;
}

interface Job {
  style: Style;
  species: string;
  scientific: string;
  pose: string;
  file: string;
}

const jobs: Job[] = [];
const manifest: Array<{
  key: string;
  label: string;
  blurb: string;
  birds: Array<{ species: string; scientific: string; slug: string; pose: string }>;
}> = [];

for (const [i, style] of RUN.entries()) {
  const dir = resolve(config.artDir, "samples", style.key);
  mkdirSync(dir, { recursive: true });
  const birds = pickBirds(i, BIRDS_PER_STYLE);
  manifest.push({
    key: style.key,
    label: style.label,
    blurb: style.blurb,
    birds: birds.map((b, slot) => ({
      species: b.species,
      scientific: b.scientific,
      slug: slugify(b.species),
      pose: assignPose(i, slot, b.species),
    })),
  });
  birds.forEach((b, slot) => {
    jobs.push({
      style,
      species: b.species,
      scientific: b.scientific,
      pose: assignPose(i, slot, b.species),
      file: resolve(dir, `${slugify(b.species)}.png`),
    });
  });
}

writeFileSync(resolve(config.artDir, "samples", "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`[styles] ${RUN.length} styles x ${BIRDS_PER_STYLE} birds = ${jobs.length} images (concurrency ${CONCURRENCY})`);

let done = 0;
const failures: string[] = [];
const queue = [...jobs];
async function worker(): Promise<void> {
  for (let job = queue.shift(); job; job = queue.shift()) {
    const tag = `${job.style.key}/${slugify(job.species)}`;
    try {
      const name = `${job.species} (${job.scientific})`;
      const png = await renderImage(job.style.prompt(name, job.pose), "opaque");
      writeFileSync(job.file, png);
      done++;
      console.log(`[ok ${done + failures.length}/${jobs.length}] ${tag} — "${job.pose}"`);
    } catch (err) {
      failures.push(tag);
      console.error(`[fail] ${tag}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
console.log(`\n[styles] done: ${done} ok, ${failures.length} failed.`);
if (failures.length) console.log("failed:", failures.join(", "));
process.exit(failures.length ? 1 : 0);
