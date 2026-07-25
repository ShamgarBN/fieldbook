// Style-recipe confirmation: each KEPT style rendered as bird CUTOUTS on a
// SIMPLE per-style ground (Ben's rule — no scenes/ornate backgrounds).
// For each style: 1 opaque simple BACKGROUND + N transparent bird CUTOUTS.
//   npx tsx src/sample-scenes.ts [style-keys...]
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./config.js";
import { SEED_SPECIES } from "./species-seed.js";
import { renderImage, finalizeArt } from "./art.js";
import { slugify } from "./state.js";

const CONCURRENCY = 4;
const BIRD_NAMES = ["Northern Cardinal", "Blue Jay", "American Goldfinch", "Carolina Wren"];
const BIRDS = BIRD_NAMES.map((name) => ({
  species: name,
  scientific: SEED_SPECIES.find((s) => s.species === name)?.scientific ?? "",
}));

const POSES = [
  "perched in a clean side profile",
  "with its head turned back over its shoulder",
  "upright and alert, glancing to one side",
  "leaning forward on a short branch",
];
const POSE_OVERRIDE: Record<string, string> = {
  "Carolina Wren": "leaning forward with its tail cocked upright",
};
function pose(styleIdx: number, birdIdx: number, species: string): string {
  return POSE_OVERRIDE[species] ?? POSES[(styleIdx + birdIdx) % POSES.length];
}

interface SceneStyle {
  key: string;
  label: string;
  bg: string;
  bird: (name: string, pose: string) => string;
}

// Every cutout prompt ends with this so the bird stands alone, no baked scene.
const CUT = (extra: string) =>
  ` Isolated as a clean cutout on a plain transparent background — ${extra}, just the bird ` +
  `and its small perch, single subject, the complete bird fully within the frame, nothing cropped.`;

const STYLES: SceneStyle[] = [
  {
    key: "sumi-e",
    label: "Sumi-e",
    bg:
      "A plain, simple background: warm off-white washi / rice paper with a very subtle fibre " +
      "texture and the faintest pale-grey ink wash near the edges. NO birds, NO branches, NO " +
      "scenery — a calm, near-empty ground.",
    bird: (n, p) =>
      `A single ${n} ${p}, in traditional Japanese sumi-e ink-wash: expressive black brush ` +
      `strokes with soft grey washes and a single restrained muted colour accent, minimal and ` +
      `calligraphic, perched on a short simple twig.` + CUT("NO paper texture, NO scenery"),
  },
  {
    key: "charley-harper",
    label: "Mid-century (Charley Harper)",
    bg:
      "A plain, simple background: a single flat, soft, warm cream colour field, completely even " +
      "with no texture, no gradient detail and no objects. NO birds, NO scenery — a clean solid " +
      "mid-century ground.",
    bird: (n, p) =>
      `A single ${n} ${p}, in the flat geometric mid-century style of Charley Harper: bold simple ` +
      `shapes, hard-edged flat colour, a limited retro palette, playful minimal-realism reduction, ` +
      `perched on a short simple stylised branch.` + CUT("NO background, NO scenery"),
  },
  {
    key: "scratchboard",
    label: "Scratchboard",
    bg:
      "A plain, simple background: solid deep near-black with the faintest charcoal texture. NO " +
      "birds, NO scenery — a dark, empty ground.",
    bird: (n, p) =>
      `A single ${n} ${p}, as a scratchboard / scraperboard engraving: fine crisp WHITE scratched ` +
      `lines and hatching defining the bird's form and feather detail against deep black, dramatic ` +
      `high contrast, a few subtle hand-tinted colour accents, perched on a short twig also drawn ` +
      `in white line.` + CUT("keep the black only WITHIN the bird's own shape, no black rectangle behind it"),
  },
  {
    key: "papercut",
    label: "Papercut",
    bg:
      "A plain, simple background: a soft flat warm paper colour (pale putty / cream) with a " +
      "barely-there paper texture and the softest even vignette. NO birds, NO scenery.",
    bird: (n, p) =>
      `A single ${n} ${p}, as a layered cut-paper collage in the Matisse cut-out spirit: flat ` +
      `coloured paper shapes with clean edges and soft drop shadows for gentle depth, bold graphic ` +
      `simplicity, perched on a short simple paper branch.` + CUT("NO background paper, NO scenery"),
  },
  {
    key: "linocut",
    label: "Linocut",
    bg:
      "A plain, simple background: off-white printmaking paper (cream) with a subtle handmade " +
      "paper grain. NO birds, NO scenery — a clean print ground.",
    bird: (n, p) =>
      `A single ${n} ${p}, as a BOLD REDUCTION LINOCUT block print: strong confident carved lines ` +
      `and expressive gouge marks, high contrast, a limited palette of black plus one or two flat ` +
      `accent inks drawn from the bird's own real colours, visible hand-printed texture and slight ` +
      `ink registration offset, graphic and striking, perched on a short carved branch.` +
      CUT("NO paper background, NO scenery"),
  },
  {
    key: "gongbi",
    label: "Chinese gongbi",
    bg:
      "A plain, simple background: pale warm ivory silk with a very faint silk-weave texture. NO " +
      "birds, NO branches, NO flowers, NO scenery — an elegant, empty ground.",
    bird: (n, p) =>
      `A single ${n} ${p}, as a Chinese gongbi (工筆) fine-line painting: meticulous precise ink ` +
      `outlines filled with delicate layered mineral-colour washes, refined and elegant, perched ` +
      `on a short simple twig.` + CUT("NO silk background, NO scenery"),
  },
];

const styleKeys = process.argv.slice(2).filter((a) => !/^\d+$/.test(a));
const RUN = styleKeys.length ? STYLES.filter((s) => styleKeys.includes(s.key)) : STYLES;

type Job =
  | { kind: "bg"; style: SceneStyle; file: string }
  | { kind: "bird"; style: SceneStyle; species: string; pose: string; file: string };

const jobs: Job[] = [];
const manifest = RUN.map((style, si) => {
  const dir = resolve(config.artDir, "samples", "scenes", style.key);
  mkdirSync(dir, { recursive: true });
  jobs.push({ kind: "bg", style, file: resolve(dir, "_bg.png") });
  const birds = BIRDS.map((b, bi) => {
    const p = pose(si, bi, b.species);
    jobs.push({ kind: "bird", style, species: b.species, pose: p, file: resolve(dir, `${slugify(b.species)}.png`) });
    return { species: b.species, scientific: b.scientific, slug: slugify(b.species), pose: p };
  });
  return { key: style.key, label: style.label, bg: "_bg.png", birds };
});

writeFileSync(resolve(config.artDir, "samples", "scenes", "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`[recipes] ${RUN.length} styles → ${jobs.length} images, concurrency ${CONCURRENCY}`);

let done = 0;
const failures: string[] = [];
const queue = [...jobs];
async function worker(): Promise<void> {
  for (let job = queue.shift(); job; job = queue.shift()) {
    const tag = job.kind === "bg" ? `${job.style.key}/_bg` : `${job.style.key}/${slugify(job.species)}`;
    try {
      if (job.kind === "bg") {
        writeFileSync(job.file, await renderImage(job.style.bg, "opaque"));
      } else {
        const raw = await renderImage(job.style.bird(job.species, job.pose), "transparent");
        writeFileSync(job.file, await finalizeArt(raw));
      }
      done++;
      console.log(`[ok ${done + failures.length}/${jobs.length}] ${tag}`);
    } catch (err) {
      failures.push(tag);
      console.error(`[fail] ${tag}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
console.log(`\n[recipes] done: ${done} ok, ${failures.length} failed.`);
if (failures.length) console.log("failed:", failures.join(", "));
process.exit(failures.length ? 1 : 0);
