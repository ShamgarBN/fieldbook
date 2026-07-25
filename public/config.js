// Fieldbook — config page logic. Vanilla JS, no deps.
const $ = (id) => document.getElementById(id);

// --- Segmented views (Status / Settings / Art) ---
// Panels stay in the DOM (polling keeps hidden ones fresh); we just toggle
// which one is shown. Tab state mirrors into aria-selected for a11y.
const segTabs = document.querySelectorAll(".seg-tab");
const segPanels = document.querySelectorAll(".view");
function showView(name) {
  segTabs.forEach((t) => t.setAttribute("aria-selected", t.dataset.view === name ? "true" : "false"));
  segPanels.forEach((p) => { p.hidden = p.dataset.panel !== name; });
}
segTabs.forEach((t) => t.addEventListener("click", () => showView(t.dataset.view)));

async function api(path, opts) {
  const res = await fetch(path, { cache: "no-store", ...opts });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j.reason) msg = j.reason;
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

let toastTimer;
function toast(text) {
  let t = document.querySelector(".toast");
  if (!t) {
    t = document.createElement("div");
    t.className = "toast";
    document.body.appendChild(t);
  }
  t.textContent = text;
  requestAnimationFrame(() => t.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2400);
}

// Relative time ("3m ago") from a unix-ms timestamp.
function ago(ms) {
  if (!ms) return "—";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function clockTime(ms) {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// --- System status ---
async function loadStatus() {
  try {
    const s = await api("/api/status");
    const dot = $("pi-dot");
    dot.className = "dot " + (s.piLikelyOnline ? "ok" : "bad");
    $("pi-status").textContent = s.ingest.mqttConnected
      ? "Connected"
      : s.piLikelyOnline
        ? "Recent"
        : s.ingest.mqttConfigured
          ? "Offline"
          : "Dev mode";
    $("mode-status").textContent = { active: "Birds", collage: "Collage", empty: "Empty nest" }[s.mode] ?? s.mode;
    $("last-heard").textContent = s.lastDetection ? ago(s.lastDetection.detectedAt) : "never";
    $("lib-count").textContent = `${s.libraryCount} birds`;
  } catch (err) {
    $("pi-status").textContent = "unreachable";
    $("pi-dot").className = "dot bad";
  }
}

// --- Idle timeout ---
const range = $("timeout-range");
const out = $("timeout-out");
range.addEventListener("input", () => {
  out.textContent = `${range.value} min`;
});
$("timeout-save").addEventListener("click", async () => {
  const btn = $("timeout-save");
  btn.disabled = true;
  try {
    await api("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ activeWindowMinutes: Number(range.value) }),
    });
    toast(`Idle timeout set to ${range.value} min`);
  } catch (err) {
    toast(`Couldn't save: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
});

// --- Empty-nest hold ---
const nestRange = $("nest-range");
const nestOut = $("nest-out");
nestRange.addEventListener("input", () => {
  nestOut.textContent = `${nestRange.value} min`;
});
$("nest-save").addEventListener("click", async () => {
  const btn = $("nest-save");
  btn.disabled = true;
  try {
    await api("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nestWindowMinutes: Number(nestRange.value) }),
    });
    toast(
      nestRange.value === "0"
        ? "Empty nest skipped — collage shows right away"
        : `Empty-nest hold set to ${nestRange.value} min`,
    );
  } catch (err) {
    toast(`Couldn't save: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
});

// --- Collage cycle interval ---
const cycleRange = $("cycle-range");
const cycleOut = $("cycle-out");
function fmtSecs(s) {
  s = Number(s);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r === 0 ? `${m}m` : `${m}m ${r}s`;
}
cycleRange.addEventListener("input", () => {
  cycleOut.textContent = fmtSecs(cycleRange.value);
});
$("cycle-save").addEventListener("click", async () => {
  const btn = $("cycle-save");
  btn.disabled = true;
  try {
    await api("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cycleIntervalSeconds: Number(cycleRange.value) }),
    });
    toast(`Collage cycle set to ${fmtSecs(cycleRange.value)}`);
  } catch (err) {
    toast(`Couldn't save: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
});

async function loadSettings() {
  try {
    const s = await api("/api/settings");
    range.value = s.activeWindowMinutes;
    out.textContent = `${s.activeWindowMinutes} min`;
    nestRange.value = s.nestWindowMinutes;
    nestOut.textContent = `${s.nestWindowMinutes} min`;
    cycleRange.value = s.cycleIntervalSeconds;
    cycleOut.textContent = fmtSecs(s.cycleIntervalSeconds);
  } catch {}
}

// --- Detection log ---
async function loadDetections() {
  try {
    const { recent, last24hCount, last24hSpecies } = await api("/api/detections?limit=60");
    $("det-summary").textContent = `${last24hCount} in 24h · ${last24hSpecies} species`;
    const log = $("det-log");
    if (!recent.length) {
      log.innerHTML = '<li class="empty">Nothing heard yet.</li>';
      return;
    }
    log.innerHTML = "";
    for (const d of recent) {
      const li = document.createElement("li");
      const sp = document.createElement("span");
      sp.className = "sp";
      sp.textContent = d.species;
      const conf = document.createElement("span");
      conf.className = "conf";
      conf.textContent = d.confidence != null ? `${Math.round(d.confidence * 100)}%` : "";
      const meta = document.createElement("span");
      meta.className = "meta";
      meta.textContent = clockTime(d.detectedAt);
      li.append(sp, conf, meta);
      log.appendChild(li);
    }
  } catch (err) {
    $("det-log").innerHTML = `<li class="empty">Couldn't load (${err.message})</li>`;
  }
}

// --- Full-size preview (lightbox) ---
function openLightbox(it) {
  if (!it.url) return;
  $("lb-img").src = it.url;
  $("lb-img").alt = it.species;
  $("lb-name").textContent = it.species;
  $("lb-sci").textContent = it.scientific || "";
  const origin = it.inSeed ? "Pre-generated" : "Discovered in your yard";
  const when = it.status === "ready" ? ` · painted ${ago(it.updatedAt)}` : ` · ${it.status}`;
  $("lb-meta").textContent = origin + when;
  $("lightbox").hidden = false;
}
function closeLightbox() {
  $("lightbox").hidden = true;
  $("lb-img").src = "";
}

// One library tile — used by both the full library and the discovered grid.
function makeTile(it) {
  const tile = document.createElement("div");
  tile.className = "tile";

  if (!it.inSeed) {
    const wild = document.createElement("span");
    wild.className = "wild";
    wild.textContent = "WILD";
    tile.appendChild(wild);
  }

  let thumb;
  if (it.url) {
    thumb = document.createElement("img");
    thumb.className = "thumb";
    thumb.src = it.url;
    thumb.alt = it.species;
    thumb.loading = "lazy";
    thumb.addEventListener("click", () => openLightbox(it));
  } else {
    thumb = document.createElement("div");
    thumb.className = "thumb placeholder";
    thumb.textContent = it.status === "pending" ? "painting…" : "no art";
  }

  const name = document.createElement("div");
  name.className = "tname";
  name.textContent = it.species;

  const status = document.createElement("div");
  status.className = "tstatus " + it.status;
  status.textContent = it.status === "ready" ? ago(it.updatedAt) : it.status;

  const prev = document.createElement("button");
  prev.className = "regen preview";
  prev.textContent = "Preview";
  prev.disabled = it.status !== "ready";
  prev.addEventListener("click", () => previewBird(it, prev));

  const btn = document.createElement("button");
  btn.className = "regen";
  btn.textContent = it.status === "pending" ? "…" : "Regenerate";
  btn.disabled = it.status === "pending";
  btn.addEventListener("click", () => regenerate(it.species, btn));

  const actions = document.createElement("div");
  actions.className = "tactions";
  actions.append(prev, btn);

  tile.append(thumb, name, status, actions);
  return tile;
}

// --- Art library + newly-discovered ---
async function loadLibrary() {
  try {
    const { items } = await api("/api/library");
    $("lib-badge").textContent = `${items.length} birds`;
    const grid = $("lib-grid");
    grid.innerHTML = "";
    for (const it of items) grid.appendChild(makeTile(it));

    // Discovered = grow-on-demand birds (not pre-seeded), newest first.
    const discovered = items.filter((it) => !it.inSeed).sort((a, b) => b.updatedAt - a.updatedAt);
    $("disc-badge").textContent = discovered.length ? String(discovered.length) : "none yet";
    const dgrid = $("disc-grid");
    dgrid.innerHTML = "";
    if (!discovered.length) {
      dgrid.innerHTML =
        '<div class="empty">Nothing new yet — a species heard that isn\'t pre-generated will show up here, freshly painted.</div>';
    } else {
      for (const it of discovered) dgrid.appendChild(makeTile(it));
    }
  } catch (err) {
    $("lib-grid").innerHTML = `<div class="empty">Couldn't load (${err.message})</div>`;
  }
}

// --- Metrics (species leaderboard + time-of-day) ---
async function loadMetrics() {
  try {
    const m = await api("/api/metrics");
    $("m-total").textContent = m.totalDetections.toLocaleString();
    $("m-species").textContent = m.distinctSpecies;
    $("metrics-badge").textContent = m.totalDetections ? "all time" : "no data yet";

    const lb = $("m-leaderboard");
    const top = m.speciesCounts.slice(0, 8);
    if (!top.length) {
      lb.innerHTML = '<div class="empty">No detections yet.</div>';
    } else {
      const max = top[0].count || 1;
      lb.innerHTML = "";
      for (const s of top) {
        const row = document.createElement("div");
        row.className = "bar-row";
        const t = document.createElement("div");
        t.className = "bar-top";
        const nm = document.createElement("span");
        nm.className = "bar-name";
        nm.textContent = s.species;
        const vl = document.createElement("span");
        vl.className = "bar-val";
        vl.textContent = s.count.toLocaleString();
        t.append(nm, vl);
        const track = document.createElement("div");
        track.className = "bar-track";
        const fill = document.createElement("div");
        fill.className = "bar-fill";
        fill.style.width = Math.max(6, Math.round((s.count / max) * 100)) + "%";
        track.appendChild(fill);
        row.append(t, track);
        lb.appendChild(row);
      }
    }

    const hours = $("m-hours");
    const hasHours = m.byHour.some((n) => n > 0);
    const hmax = Math.max(1, ...m.byHour);
    hours.innerHTML = "";
    for (let h = 0; h < 24; h++) {
      const col = document.createElement("div");
      col.className = "hour-col";
      const bar = document.createElement("div");
      bar.className = "hour-bar";
      bar.style.height = hasHours ? Math.round((m.byHour[h] / hmax) * 100) + "%" : "0";
      bar.title = `${h}:00 — ${m.byHour[h]} detection${m.byHour[h] === 1 ? "" : "s"}`;
      col.appendChild(bar);
      hours.appendChild(col);
    }
    $("m-hours-axis").hidden = !hasHours;
  } catch (err) {
    $("m-leaderboard").innerHTML = `<div class="empty">Couldn't load (${err.message})</div>`;
  }
}

// Push a bird to the wall for 15s. The display owns the countdown + revert; here
// we just fire it and lock the button for the duration as feedback.
const PREVIEW_MS = 15000;
async function previewBird(it, btn) {
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = "On wall…";
  try {
    await api("/api/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ species: it.species, scientific: it.scientific }),
    });
    toast(`Previewing ${it.species} on the wall (15s)`);
  } catch (err) {
    toast(`Couldn't preview: ${err.message}`);
  } finally {
    setTimeout(() => {
      btn.textContent = orig;
      btn.disabled = it.status !== "ready";
    }, PREVIEW_MS);
  }
}

async function regenerate(species, btn) {
  btn.disabled = true;
  btn.textContent = "…";
  try {
    await api("/api/regenerate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ species }),
    });
    toast(`Repainting ${species}…`);
    // Reflect pending immediately, then poll the library until it settles.
    setTimeout(loadLibrary, 800);
    setTimeout(loadLibrary, 8000);
    setTimeout(loadLibrary, 20000);
    setTimeout(loadLibrary, 40000);
  } catch (err) {
    toast(`Couldn't start: ${err.message}`);
    btn.disabled = false;
    btn.textContent = "Regenerate";
  }
}

// --- Lightbox close (button, or tapping the backdrop) ---
$("lb-close").addEventListener("click", closeLightbox);
$("lightbox").addEventListener("click", (e) => {
  if (e.target.id === "lightbox") closeLightbox();
});

// --- Reset activity (destructive; confirm first) ---
$("reset-activity").addEventListener("click", async () => {
  if (!confirm("Delete ALL detection history?\n\nThis clears the collage, detection log, and Activity stats. Your art library is kept. This cannot be undone.")) return;
  const btn = $("reset-activity");
  btn.disabled = true;
  try {
    const r = await api("/api/reset-activity", {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    toast(`Cleared ${r.deleted} detection${r.deleted === 1 ? "" : "s"}`);
    refresh();
  } catch (err) {
    toast(`Couldn't reset: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
});

// --- Boot + polling ---
function refresh() {
  loadStatus();
  loadDetections();
  loadMetrics();
  loadLibrary();
}
loadSettings();
refresh();
setInterval(() => {
  loadStatus();
  loadDetections();
  loadMetrics();
}, 10000);
