# Fieldbook — Art Style Guide

This is the fixed visual DNA of the project. Every generated image reuses it so the
collection reads as one cohesive set. Ben expects to refine the *exact* look over time,
but the two pillars below are the foundation and should not drift.

## The two pillars

1. **Audubon naturalist rendering — pencil-and-watercolor.** In the spirit of John James
   Audubon's *The Birds of America*, but leaning toward a **hand-drawn pencil illustration
   with light watercolor washes**, NOT a photographic render. Delicate graphite linework and
   visible pencil shading, translucent watercolor coloring that lets the drawn lines show
   through; the bird in a lifelike, observed naturalist pose; a muted, gentle natural-pigment
   palette. Single bird, side or three-quarter profile, as if a plate from a 19th-century
   field folio — clean, not artificially distressed. Explicitly avoid: photorealism, glossy
   highlights, harsh contrast. (Ben feedback 2026-07-09: first pass read too photographic.)

2. **Clean transparent isolation — the whole bird, no cut-off.** Each bird is a transparent
   cutout that composites softly onto the shared background via its own anti-aliased edges.
   **No radial fade** is applied. (Ben, 2026-07-10: an earlier elliptical vignette faded to
   transparent through the outer 30% of the frame, which erased the extremities — beaks,
   tails — of birds that reach toward the edge. Preserving the full bird is the priority.)

## How images are produced (pipeline contract)

1. **Generate** the Audubon bird on a **plain, near-white / transparent backdrop** via the
   image API (`gpt-image-1.5`, `background: "transparent"`) for clean subject isolation.
   One bird, centered, full body, consistent framing.
2. **Post-process deterministically** with `sharp` (`finalizeArt` in src/art.ts):
   (a) despeckle — zero out near-transparent halo pixels left by background removal;
   (b) trim to the bird's actual bounding box, then re-pad with a **uniform 8% margin** so
   every bird sits identically and close to its caption. No fade, no clipping — the complete
   bird is always preserved. Raw renders are kept in `art/raw/` so this step can be re-run
   for free (`art-cli --refinalize`) if the framing rules change.

The empty-nest image and the collage background/layout are generated in the **same Audubon
style** so the whole screen feels like one artwork.

## Reusable prompt fragment

Prepend/append this to every per-species generation prompt (the pipeline injects it):

> "A single {species} bird as a hand-drawn naturalist field illustration in the spirit of
> John James Audubon's Birds of America. Rendered primarily in fine pencil: delicate
> graphite linework and visible pencil shading, with light, translucent watercolor washes
> for soft coloring that let the drawn linework show through. Lifelike naturalist pose
> perched on a small branch, illustrated and hand-drawn — NOT a photograph, not glossy, not
> photorealistic, no harsh highlights. Keep each species' true, naturally saturated plumage
> colors — the watercolor washes are gentle in texture but should NOT wash out or desaturate
> the bird's real colors (a cardinal stays vivid red). The bird
> centered and full-body in a clean three-quarter profile, on a plain near-white background,
> no text, no border, no frame, no cage, single subject only."

(The prompt builder in `src/art.ts` is the source of truth; keep this fragment in sync.)

## Framing parameters (single source of truth)

Kept in one place in the pipeline (`src/art.ts`) so a tweak re-renders the whole library
consistently via `art-cli --refinalize` (no API cost):

- Generation canvas: **portrait 1024×1536** — the Portal hangs in portrait mode (800×1280
  panel), so renders are portrait, never square.
- Despeckle floor: alpha below ~48/255 is zeroed (removes background-removal halo).
- Framing: trim to the bird's content bounding box, then re-pad with a **uniform 8% margin**
  (fraction of content height) on every side. The complete bird is always kept — no fade,
  no crop.
- Output: PNG with straight alpha (RGBA).

## Palette / framing notes (to refine with Ben)

- Display background (the shared canvas birds composite onto): soft blue gradient
  (`#d5e6f4` → `#a2c4e2`), warm brown serif labels. Lives in public/display.css.
- Collage view: several cutout birds arranged on the shared background without overlap
  fighting; layout template lives with the display page.
- Avoid: modern flat-vector look, cartoon outlines, drop shadows, neon, photographic realism.
