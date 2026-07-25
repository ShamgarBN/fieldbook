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
// At most this many species in the 48h collage (most-heard win; server orders by count).
const MAX_COLLAGE = 9;

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
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
    if (showName) wrap.appendChild(el("div", "name", sp.species));
    if (showSci && sp.scientific) wrap.appendChild(el("div", "sci", sp.scientific));
    return wrap;
  }
  const plate = el("div", "plate");
  if (showName) plate.appendChild(el("div", "name", sp.species));
  if (showSci && sp.scientific) plate.appendChild(el("div", "sci", sp.scientific));
  plate.appendChild(el("div", "painting", sp.art && sp.art.status === "pending" ? "portrait being painted" : "no portrait yet"));
  return plate;
}

function render(state) {
  stage.dataset.mode = state.mode;
  scene.replaceChildren();
  caption.textContent = "";

  if (state.mode === "active") {
    const shown = state.active.slice(0, MAX_ACTIVE); // cap; state.active is most-recent-first
    // Drives the adaptive layout/sizing in CSS (see .stage[data-count]).
    stage.dataset.count = shown.length;
    for (const sp of shown) scene.appendChild(birdNode(sp));
    const names = shown.map((s) => s.species);
    caption.textContent = names.length > 1 ? `Now singing: ${names.join(" · ")}` : "";
  } else if (state.mode === "collage") {
    const shown = state.collage.slice(0, MAX_COLLAGE); // most-heard first (server-ordered)
    const n = shown.length;
    stage.dataset.count = n;
    // Balanced grid (cols capped at 4 for the portrait panel); image size and
    // label font are derived from the row height in CSS, so they scale together.
    const cols = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(n))));
    const rows = Math.max(1, Math.ceil(n / cols));
    stage.style.setProperty("--collage-cols", cols);
    stage.style.setProperty("--collage-rows", rows);
    for (const sp of shown) scene.appendChild(birdNode(sp, { showSci: false }));
    caption.textContent = "Heard in the last 48 hours";
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

// One fetch + render. Called by the poll loop AND directly by the preview timer
// (so the timer must not start a second poll loop — only poll() schedules).
async function fetchState() {
  const res = await fetch("/state", { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const state = await res.json();
  statusEl.hidden = true;

  if (typeof state.pollSeconds === "number") pollMs = Math.max(3000, state.pollSeconds * 1000);

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
