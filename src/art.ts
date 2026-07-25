import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import db from "./db.js";
import { config } from "./config.js";
import { slugify } from "./state.js";

// --- Style guide (docs/STYLE_GUIDE.md) — reusable prompt fragment ---
// The vignette is NOT the model's job; sharp applies it deterministically below.
export function buildPrompt(species: string, scientific?: string | null): string {
  const name = scientific ? `${species} (${scientific})` : species;
  return (
    `A single ${name} bird as a hand-drawn naturalist field illustration in the ` +
    `spirit of John James Audubon's Birds of America. Rendered primarily in fine ` +
    `pencil: delicate graphite linework and visible pencil shading, with light, ` +
    `translucent watercolor washes for soft coloring that let the drawn linework ` +
    `show through. Lifelike naturalist pose perched on a small branch, illustrated ` +
    `and hand-drawn — NOT a photograph, not glossy, not photorealistic, no harsh ` +
    `highlights. Keep each species' true, naturally saturated plumage colors — the ` +
    `watercolor washes are gentle in texture but should NOT wash out or desaturate the ` +
    `bird's real colors (a cardinal stays vivid red). The bird centered and ` +
    `full-body in a clean three-quarter profile, on a plain near-white background, ` +
    `no text, no border, no frame, no cage, single subject only.`
  );
}

// --- OpenAI image generation ---
interface ImageResponse {
  data?: Array<{ b64_json?: string }>;
  error?: { message?: string };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type ImageBackground = "transparent" | "opaque" | "auto";

async function generateImageOnce(prompt: string, background: ImageBackground): Promise<Buffer> {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.openaiApiKey}`,
    },
    body: JSON.stringify({
      model: config.imageModel,
      prompt,
      size: config.imageSize,
      quality: config.imageQuality,
      background,
      output_format: "png",
    }),
  });
  const json = (await res.json()) as ImageResponse;
  if (!res.ok) {
    const err = new Error(`image API ${res.status}: ${json.error?.message ?? "unknown error"}`);
    // Rate limits and server errors are worth retrying; 4xx (bad key, billing) are not.
    (err as { retryable?: boolean }).retryable = res.status === 429 || res.status >= 500;
    throw err;
  }
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error("image API returned no image data");
  return Buffer.from(b64, "base64");
}

async function generateImage(
  prompt: string,
  attempts = 4,
  background: ImageBackground = "transparent",
): Promise<Buffer> {
  for (let i = 1; ; i++) {
    try {
      return await generateImageOnce(prompt, background);
    } catch (err) {
      const retryable = (err as { retryable?: boolean }).retryable;
      if (!retryable || i >= attempts) throw err;
      await sleep(2000 * i); // linear backoff: 2s, 4s, 6s
    }
  }
}

/** Low-level styled render (used by the style sampler). Returns the raw PNG. */
export function renderImage(prompt: string, background: ImageBackground = "opaque"): Promise<Buffer> {
  return generateImage(prompt, 4, background);
}

// Model background-removal leaves faint semi-transparent speckle around the
// subject; zero out near-transparent pixels so composites stay clean.
const ALPHA_FLOOR = 48;

async function cleanAlpha(png: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < ALPHA_FLOOR) data[i] = 0;
  }
  return { data, width: info.width, height: info.height };
}

// The model places the bird at an inconsistent height in the frame, leaving
// 15–25% empty space below it — so each bird floats a different distance from
// its caption. Trim to the actual content, then re-pad with a uniform margin so
// every bird sits identically and close to its label. (Ben, 2026-07-09.)
const FRAME_MARGIN = 0.08; // uniform transparent border, as fraction of content height
const CONTENT_ALPHA = 8; // alpha above this counts as bird content (keeps soft edges)

async function normalizeFraming(png: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  let top = H, bottom = -1, left = W, right = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * C + 3] > CONTENT_ALPHA) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  if (bottom < 0) return png; // fully transparent — nothing to normalize
  const cw = right - left + 1;
  const ch = bottom - top + 1;
  const margin = Math.round(ch * FRAME_MARGIN);
  const bg = { r: 0, g: 0, b: 0, alpha: 0 };
  return sharp(png)
    .extract({ left, top, width: cw, height: ch })
    .extend({ top: margin, bottom: margin, left: margin, right: margin, background: bg })
    .png()
    .toBuffer();
}

// Finalize a raw render for the library: despeckle the background-removal halo,
// then trim to the bird and re-pad with a uniform margin. We deliberately do NOT
// fade the edges to transparent — the model already isolates each bird on a
// transparent background with soft anti-aliased edges, and a radial fade clipped
// the extremities (beaks, tails) of birds that reach toward the frame edge.
// (Ben, 2026-07-10: preserve the full bird, no cut-off.)
export async function finalizeArt(png: Buffer): Promise<Buffer> {
  const { data, width, height } = await cleanAlpha(png);
  const cleaned = await sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
  return normalizeFraming(cleaned);
}

// --- Library management ---
const upsertArt = db.prepare(
  `INSERT INTO art (species, slug, status, updated_at)
   VALUES (@species, @slug, @status, @updatedAt)
   ON CONFLICT(species) DO UPDATE SET
     slug = excluded.slug, status = excluded.status, updated_at = excluded.updated_at`,
);

export function artFilePath(species: string): string {
  return resolve(config.artDir, `${slugify(species)}.png`);
}

// Raw (pre-vignette) renders are kept so vignette parameter tweaks can be
// re-applied to the whole library without any new API calls.
export function rawFilePath(species: string): string {
  return resolve(config.artDir, "raw", `${slugify(species)}.png`);
}

/**
 * Generate (or regenerate) the vignetted portrait for a species.
 * Marks the art row pending -> ready/failed around the API call so the
 * display can show "portrait being painted" in the meantime.
 */
export async function generateBirdArt(
  species: string,
  scientific?: string | null,
): Promise<{ file: string; ms: number }> {
  const slug = slugify(species);
  const started = Date.now();
  upsertArt.run({ species, slug, status: "pending", updatedAt: started });
  try {
    const raw = await generateImage(buildPrompt(species, scientific));
    mkdirSync(resolve(config.artDir, "raw"), { recursive: true });
    writeFileSync(rawFilePath(species), raw);
    const file = artFilePath(species);
    writeFileSync(file, await finalizeArt(raw));
    upsertArt.run({ species, slug, status: "ready", updatedAt: Date.now() });
    return { file, ms: Date.now() - started };
  } catch (err) {
    upsertArt.run({ species, slug, status: "failed", updatedAt: Date.now() });
    throw err;
  }
}

/** Re-run finalize (despeckle + framing) on the stored raw render — no API call. */
export async function refinalize(species: string): Promise<string> {
  const raw = rawFilePath(species);
  if (!existsSync(raw)) throw new Error(`no raw render for ${species}`);
  const file = artFilePath(species);
  writeFileSync(file, await finalizeArt(readFileSync(raw)));
  return file;
}

// --- Empty-nest illustration (the idle-state art) ---
// Not a species, so it skips the library table; the display loads it directly
// at /art/empty-nest.png. Same pencil-and-watercolor pipeline as the birds so
// the idle screen matches, and it's high-resolution (no emoji pixelation).
export const EMPTY_NEST_SLUG = "empty-nest";

export function buildNestPrompt(): string {
  return (
    `An empty songbird's nest woven from twigs, grass and moss, cradling three ` +
    `pale robin's-egg-blue eggs, with NO bird present. Hand-drawn naturalist field ` +
    `illustration in the spirit of John James Audubon's Birds of America: fine ` +
    `pencil linework and visible pencil shading with light, translucent watercolor ` +
    `washes for gentle natural coloring that let the drawn lines show through — NOT ` +
    `a photograph, not glossy, not photorealistic, no harsh highlights. The nest ` +
    `centered and viewed slightly from above, on a plain near-white background, no ` +
    `text, no border, no frame, single subject only.`
  );
}

export async function generateEmptyNest(): Promise<{ file: string; ms: number }> {
  const started = Date.now();
  const raw = await generateImage(buildNestPrompt());
  mkdirSync(resolve(config.artDir, "raw"), { recursive: true });
  writeFileSync(rawFilePath(EMPTY_NEST_SLUG), raw);
  const file = artFilePath(EMPTY_NEST_SLUG);
  writeFileSync(file, await finalizeArt(raw));
  return { file, ms: Date.now() - started };
}
