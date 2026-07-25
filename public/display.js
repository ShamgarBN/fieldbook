// Fieldbook — display page.
// Polls /state and renders active birds, the 48h collage, or the empty nest.
// No framework, no external deps — this runs in Fully Kiosk on the Portal.

const stage = document.getElementById("stage");
const scene = document.getElementById("scene");
const caption = document.getElementById("caption");
const statusEl = document.getElementById("status");

let pollMs = 8000;
let lastSignature = "";
let lastPreviewId = null;
let previewTimer = null;
const PREVIEW_MS = 15000;

// At most this many birds composite on screen at once (most-recently-heard win).
const MAX_ACTIVE = 4;
// The 48h collage shows up to this many birds at once (3×3). When more than this
// have been heard in 48h, the extras cycle through (see the collage controller).
const MAX_COLLAGE = 9;
let rotateMs = 30000; // swap interval; overridden live by state.cycleSeconds from /state
const SWAP_MIN = 1;
const SWAP_MAX = 3; // random 1–3 birds swapped per cycle (capped by off-screen count)
const FADE_MS = 450; // crossfade duration per cell

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

// Same as el() but sets textContent — use for any string that originated from a
// detection (species / scientific name). Those arrive from BirdNET / MQTT /
// the webhook unauthenticated, so they must never be treated as HTML.
function elText(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// showSci lets the collage show common names only (Ben, 2026-07-19) while the
// active view keeps the scientific name.
function birdNode(sp, { showName = true, showSci = true } = {}) {
  // Real art if ready, otherwise an intentional placeholder plate.
  if (sp.art && sp.art.url) {
    const wrap = el("div", "bird");
    const img = el("img");
    img.src = sp.art.url;
    img.alt = sp.species;
    wrap.appendChild(img);
    if (showName) wrap.appendChild(elText("div", "name", sp.species));
    if (showSci && sp.scientific) wrap.appendChild(elText("div", "sci", sp.scientific));
    return wrap;
  }
  const plate = el("div", "plate");
  if (showName) plate.appendChild(elText("div", "name", sp.species));
  if (showSci && sp.scientific) plate.appendChild(elText("div", "sci", sp.scientific));
  plate.appendChild(el("div", "painting", sp.art && sp.art.status === "pending" ? "portrait being painted" : "no portrait yet"));
  return plate;
}

function render(state) {
  stage.dataset.mode = state.mode;

  // Collage manages its own scene (persistent grid + cycling), so it's handled
  // by the controller rather than a full rebuild on every poll.
  if (state.mode === "collage") {
    renderCollage(state.collage);
    return;
  }

  // Any other mode: tear down the collage cycler and render fresh.
  stopCollage();
  scene.replaceChildren();
  caption.textContent = "";

  if (state.mode === "active") {
    const shown = state.active.slice(0, MAX_ACTIVE); // cap; state.active is most-recent-first
    // Drives the adaptive layout/sizing in CSS (see .stage[data-count]).
    stage.dataset.count = shown.length;
    for (const sp of shown) scene.appendChild(birdNode(sp));
    const names = shown.map((s) => s.species);
    caption.textContent = names.length > 1 ? `Now singing: ${names.join(" · ")}` : "";
  } else {
    stage.dataset.count = 0;
    const nest = el("div", "nest");
    const img = el("img", "nest-img");
    img.src = "/art/empty-nest.png";
    img.alt = "An empty nest";
    // Fall back to the emoji if the illustration isn't present.
    img.onerror = () => img.replaceWith(el("div", "glyph", "🪺"));
    nest.appendChild(img);
    nest.appendChild(el("div", "line", "The nest is quiet"));
    scene.appendChild(nest);
  }
}

// ---- 48h collage cycling ---------------------------------------------------
// state.collage is the full pool of species heard in the last 48h. We show up to
// MAX_COLLAGE at once; when the pool is larger, we rotate SWAP_MIN–SWAP_MAX birds
// every ROTATE_MS with a per-cell crossfade. Airtime is fair: the bird off-screen
// longest cycles in, the one on-screen longest cycles out, and a bird that just
// left won't immediately return. Duplicates are impossible (incoming is drawn only
// from the off-screen set). The 3×3 never reflows because swaps happen in place.
let collageActive = false;
let collagePool = new Map(); // species -> SpeciesView (ready art only)
let collageVisible = []; // species on screen, in cell order
const collageMeta = new Map(); // species -> { enteredAt, lastShown } for fairness
let rotateTimer = null;

function cMeta(sp) {
  let m = collageMeta.get(sp);
  if (!m) {
    m = { enteredAt: 0, lastShown: 0 };
    collageMeta.set(sp, m);
  }
  return m;
}

function renderCollage(poolRaw) {
  const pool = poolRaw.filter((s) => s.art && s.art.url); // only finished art can cycle
  collagePool = new Map(pool.map((s) => [s.species, s]));
  caption.textContent = "Heard in the last 48 hours";

  if (!collageActive) {
    collageActive = true;
    const now = Date.now();
    collageVisible = pool.slice(0, MAX_COLLAGE).map((s) => s.species);
    collageVisible.forEach((sp) => {
      const m = cMeta(sp);
      m.enteredAt = now;
      m.lastShown = now;
    });
    // Warm the cache for the whole pool so crossfades don't pop.
    pool.forEach((s) => {
      const im = new Image();
      im.decoding = "async";
      im.src = s.art.url;
    });
    buildCollage();
    clearInterval(rotateTimer);
    rotateTimer = setInterval(rotateCollage, rotateMs);
    return;
  }
  reconcileCollage();
}

function collageGrid() {
  const n = collageVisible.length;
  stage.dataset.count = n;
  const cols = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(n))));
  stage.style.setProperty("--collage-cols", cols);
  stage.style.setProperty("--collage-rows", Math.max(1, Math.ceil(n / cols)));
}

function buildCollage() {
  collageGrid();
  scene.replaceChildren();
  for (const sp of collageVisible) {
    const v = collagePool.get(sp);
    if (v) scene.appendChild(birdNode(v, { showSci: false }));
  }
}

// Fold in pool changes (new detections / birds aging out of 48h) without
// disturbing the birds that are still valid or resetting the rotation.
function reconcileCollage() {
  let layoutChanged = false;
  for (let i = collageVisible.length - 1; i >= 0; i--) {
    if (!collagePool.has(collageVisible[i])) {
      const inb = pickIncoming(1);
      if (inb.length) {
        swapCell(i, inb[0]);
      } else {
        collageVisible.splice(i, 1);
        layoutChanged = true;
      }
    }
  }
  const target = Math.min(MAX_COLLAGE, collagePool.size);
  while (collageVisible.length < target) {
    const inb = pickIncoming(1);
    if (!inb.length) break;
    const now = Date.now();
    const m = cMeta(inb[0]);
    m.enteredAt = now;
    m.lastShown = now;
    collageVisible.push(inb[0]);
    layoutChanged = true;
  }
  if (layoutChanged) buildCollage();
}

function pickIncoming(k) {
  const off = [...collagePool.keys()].filter((sp) => !collageVisible.includes(sp));
  off.sort((a, b) => cMeta(a).lastShown - cMeta(b).lastShown); // longest-unseen (or never) first
  return off.slice(0, k);
}

function pickOutgoing(k) {
  return collageVisible
    .map((sp, i) => ({ i, entered: cMeta(sp).enteredAt }))
    .sort((a, b) => a.entered - b.entered) // on screen longest first
    .slice(0, k)
    .map((o) => o.i);
}

function rotateCollage() {
  const offCount = collagePool.size - collageVisible.length;
  if (offCount < 1 || collageVisible.length < 1) return; // pool fits on screen — nothing to cycle
  const cap = Math.min(SWAP_MAX, offCount, collageVisible.length);
  const k = SWAP_MIN + Math.floor(Math.random() * (cap - SWAP_MIN + 1));
  const incoming = pickIncoming(k);
  const outIdx = pickOutgoing(k);
  // Stagger so multiple swaps dissolve in sequence rather than all blinking at once.
  outIdx.forEach((cellIdx, j) => setTimeout(() => swapCell(cellIdx, incoming[j]), j * 220));
}

// Crossfade one grid cell to `newSp`, in place — the .bird cell stays put so the
// grid never reflows; only its image + label dissolve.
function swapCell(i, newSp) {
  const cell = scene.children[i];
  const v = collagePool.get(newSp);
  if (!cell || !v) return;

  const prev = collageVisible[i];
  const now = Date.now();
  if (prev) cMeta(prev).lastShown = now; // just left → back of the incoming queue
  const m = cMeta(newSp);
  m.enteredAt = now;
  m.lastShown = now;
  collageVisible[i] = newSp;

  const fresh = birdNode(v, { showSci: false }); // starts loading the image during the fade-out
  cell.style.animation = "none"; // let inline opacity win over the initial fade-in animation
  cell.style.transition = `opacity ${FADE_MS}ms ease`;
  cell.style.opacity = "0";
  setTimeout(() => {
    cell.replaceChildren(...fresh.childNodes); // keep the cell, swap its contents
    cell.style.opacity = "1";
  }, FADE_MS);
}

function stopCollage() {
  if (!collageActive) return;
  collageActive = false;
  clearInterval(rotateTimer);
  rotateTimer = null;
  collageVisible = [];
  // collageMeta is kept so airtime fairness survives brief active/preview breaks.
}

// One fetch + render. Called by the poll loop AND directly by the preview timer
// (so the timer must not start a second poll loop — only poll() schedules).
async function fetchState() {
  const res = await fetch("/state", { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const state = await res.json();
  statusEl.hidden = true;

  if (typeof state.pollSeconds === "number") pollMs = Math.max(3000, state.pollSeconds * 1000);

  // Collage swap interval is config-tunable; apply changes live (restart the
  // running rotation timer if the interval changed while a collage is showing).
  if (typeof state.cycleSeconds === "number") {
    const ms = Math.max(5000, state.cycleSeconds * 1000);
    if (ms !== rotateMs) {
      rotateMs = ms;
      if (collageActive) {
        clearInterval(rotateTimer);
        rotateTimer = setInterval(rotateCollage, rotateMs);
      }
    }
  }

  handlePreview(state);

  // Only re-render when what's shown actually changes (avoids re-triggering fade animations).
  const sig = JSON.stringify({
    m: state.mode,
    a: state.active.map((s) => [s.species, s.art?.url]),
    c: state.collage.map((s) => [s.species, s.art?.url]),
  });
  if (sig !== lastSignature) {
    lastSignature = sig;
    render(state);
  }
}

// A pressed "Preview" shows a bird for exactly 15s (timed here on the display so
// the duration is consistent regardless of poll latency), then we clear the
// server override and immediately re-fetch to revert to the live state.
function handlePreview(state) {
  if (state.previewId == null) {
    lastPreviewId = null;
    return;
  }
  if (state.previewId === lastPreviewId) return; // already counting this one down
  lastPreviewId = state.previewId;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    fetch("/api/preview/clear", { method: "POST" })
      .catch(() => {})
      .finally(() => fetchState().catch(() => {}));
  }, PREVIEW_MS);
}

async function poll() {
  try {
    await fetchState();
  } catch (err) {
    statusEl.hidden = false;
    statusEl.textContent = "reconnecting…";
  } finally {
    setTimeout(poll, pollMs);
  }
}

poll();
