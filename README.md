# Fieldbook

**A living field guide for your yard.** A microphone listens for birdsong, an AI model
identifies the species in real time, and a wall display responds by showing hand-drawn,
Audubon-style artwork of exactly the birds that are singing right now — fading to a
rotating collage of everyone heard in the last 48 hours when the yard goes quiet.

Everything runs **locally on your own network**. The only thing that ever touches the
internet is the one-time (and optional) art generation.

[![Buy me a coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-FFDD00?style=flat-square&logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/makeforlife)

```
  🎤  mic  ──►  🍓 Raspberry Pi  ──►  🖼️  any screen with a browser
              (BirdNET-Go listens,      (shows the art, full-screen)
               Fieldbook serves the
               display + art library)
```

---

## Table of contents

- [How it works](#how-it-works)
- [What you'll need](#what-youll-need)
- [Quick start — the simple all-in-one-Pi build](#quick-start--the-simple-all-in-one-pi-build)
- [Using it (the config page)](#using-it-the-config-page)
- [About the artwork (and its cost)](#about-the-artwork-and-its-cost)
- [Choosing a display device](#choosing-a-display-device)
- [Security notes](#security-notes)
- [Advanced setups](#advanced-setups)
- [Reference](#reference)

---

## How it works

Three moving parts, and in the simple build **all three live on one Raspberry Pi**:

1. **[BirdNET-Go](https://github.com/tphakala/birdnet-go)** listens to the mic and identifies birds, publishing each detection to a local MQTT broker.
2. **Mosquitto** is that broker — a tiny message bus.
3. **Fieldbook** (this repo — a small Node/TypeScript app) subscribes to the detections, keeps the display "state" (who's singing, who was heard recently), serves a full-screen display page, and manages an art library of one illustration per species.

Your **display** is just a device with a web browser pointed at the Pi. It doesn't run any special software — it loads a web page and polls it every few seconds.

**The display logic:**
- A species is **active** for 10 minutes after it was last heard → its art shows large and centered (up to 4 birds composite together).
- When the yard goes quiet, a brief **empty-nest** rest, then a **collage** of every species heard in the rolling **48-hour** window (the window intentionally carries overnight owls into the daytime view). If more than 9 have been heard, the collage **cycles** — swapping a few birds every 30 seconds so everyone gets screen time.
- Nothing heard in 48 hours → an empty nest.

All of these timings are tunable from the config page.

---

## What you'll need

**For the simple build:**

| Part | Notes |
|---|---|
| **Raspberry Pi** | A **Pi 4 or 5** is recommended. A Pi 3B+ works (this project was built on one) but it's the floor — see the [performance note](#performance-on-a-pi-3b). |
| **microSD card** | 32 GB+. A "**High Endurance**" card (SanDisk/Samsung) is worth it for 24/7 writing. |
| **USB audio adapter** | The Pi has no mic input. You need a **USB adapter with a separate 3.5 mm microphone jack** (a C-Media-based one like a UGREEN CM477 or Sabrent AU-MMSA, ~$10). Avoid the headphone-output-only kind — it can't record. |
| **Microphone** | Any mic the adapter can power. An omnidirectional **electret lavalier** (e.g. BOYA BY-LM20) works well — the pink mic jack supplies the "plug-in power" it needs. For outdoors you'll want weather protection. |
| **A display** | Anything with a browser: a cheap tablet, an old phone, or a monitor/TV driven by a Pi. See [Choosing a display device](#choosing-a-display-device). |
| **Power** | A good Pi power supply (an undervolted Pi causes weird failures). |

**Optional:** an [OpenAI API key](https://platform.openai.com/) if you want the app to generate the bird artwork for you (see [About the artwork](#about-the-artwork-and-its-cost)).

---

## Quick start — the simple all-in-one-Pi build

Everything below runs **on the Pi**. SSH in (or use a keyboard/monitor). This assumes
**Raspberry Pi OS (64-bit)** and that your username is `pi` — adjust paths if not.

### 1. Plug in the mic

Connect the USB audio adapter, then the mic into its **pink** jack. Confirm the Pi sees a capture device:

```bash
arecord -l
```

You should see a `USB Audio Device` card. If `arecord -l` shows nothing, your adapter is output-only — swap it for one with a mic input.

### 2. Install BirdNET-Go (the listener)

BirdNET-Go ships as a Docker image. Install Docker, then run it:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker
docker run -d --name birdnet-go --restart unless-stopped \
  --network host \
  -e TZ="$(cat /etc/timezone)" \
  --device /dev/snd --group-add "$(getent group audio | cut -d: -f3)" \
  -v "$HOME/birdnet-go-app/config:/config" \
  -v "$HOME/birdnet-go-app/data:/data" \
  ghcr.io/tphakala/birdnet-go:nightly
```

Then open **`http://<your-pi>:8080`** in a browser and, in its settings:
- **Audio → source:** pick your `USB Audio Device`.
- **Integrations → MQTT:** enable it, broker `tcp://localhost:1883`, topic `birdnet`.
- **Station/location:** set your latitude/longitude so it filters to species plausible for your area.

#### Performance on a Pi 3B+

If you're on a 3B+, set BirdNET-Go's **audio overlap to `0`** (in its settings). The default (1.5) runs inference twice as often and a 3B+ can't keep up — detections pile up and never publish. On a Pi 4/5 the default is fine.

### 3. Install Mosquitto (the broker)

```bash
sudo apt update && sudo apt install -y mosquitto mosquitto-clients
echo "allow_anonymous true" | sudo tee /etc/mosquitto/conf.d/fieldbook.conf
sudo systemctl enable --now mosquitto
```

(This keeps the broker on localhost, which is all the all-in-one build needs. For a separate app server, see [Advanced setups](#advanced-setups).)

### 4. Install Fieldbook (this app)

```bash
sudo apt install -y nodejs npm git      # Debian 13 provides Node 20+
git clone https://github.com/ShamgarBN/fieldbook.git ~/fieldbook
cd ~/fieldbook
npm install                              # builds better-sqlite3 + sharp for the Pi (~1 min)
npm run build
cp .env.example .env
```

Now edit `.env`:

```ini
MQTT_URL=mqtt://localhost:1883
# For artwork (optional but that's the whole point) — see the Artwork section:
OPENAI_API_KEY=sk-...
```

Generate the starter art library (needs the OpenAI key — see [cost](#about-the-artwork-and-its-cost)):

```bash
npm run seed
```

### 5. Run it as a service (starts on boot)

```bash
sudo cp deploy/fieldbook.service /etc/systemd/system/
# If your username isn't "pi", edit User= and the paths in that file first.
sudo systemctl daemon-reload
sudo systemctl enable --now fieldbook
journalctl -u fieldbook -f      # watch it start; look for "connected to mqtt" + "subscribed"
```

### 6. Point a display at it

On any device with a browser, open **`http://<your-pi>:3000/`** — that's the wall display. The config page is at **`/config`**. See [Choosing a display device](#choosing-a-display-device) for making a device show it full-screen, always-on.

**That's it.** Play a bird call near the mic (or wait for a real one) and the wall reacts within ~15–30 seconds.

---

## Using it (the config page)

Browse to **`http://<your-pi>:3000/config`** from your phone. It's a mobile-friendly control panel:

- **Status** — is the Pi listening? MQTT connected? What's on the wall right now?
- **Idle timeout / Empty-nest hold / Collage cycle** — sliders that tune the display timings.
- **Detections + Activity** — a live log and stats (most-heard, by hour of day).
- **Art library** — every species with its illustration. Each has:
  - **Preview** — throw that bird up on the wall for 15 seconds, then it reverts.
  - **Regenerate** — repaint it (a paid API call).
- **Reset activity** — wipe detection history (handy before "going live"; keeps your art).

---

## About the artwork (and its cost)

Fieldbook doesn't ship the art — it **generates** it, one illustration per species, using an
image API (default: OpenAI `gpt-image-1.5`). This is the **only paid, internet-dependent part**.

- Each image is a paid API call (cents each). The **~32-bird starter set** (`npm run seed`) is a few dollars, one-time.
- When a **brand-new species** is heard, Fieldbook paints it on the fly. A cost cap (`MAX_GROW_BIRDS`, default 50) limits how many new birds it will auto-paint before stopping, so a noisy migration day can't run up a surprise bill. Set it to `0` to disable on-the-fly painting entirely.
- **No key = no art**, but the app still runs (it shows placeholders). If you'd rather not pay, you can generate art on any machine with a key and copy the `art/` folder to the Pi.

The art style (pencil + watercolor, transparent cut-outs) is documented in [`docs/STYLE_GUIDE.md`](docs/STYLE_GUIDE.md), and the backend is swappable (`IMAGE_BACKEND`).

---

## Choosing a display device

The display is **just a browser** showing `http://<your-pi>:3000/`. You don't need the exact
device this project used. Good options, simplest first:

- **A cheap tablet in kiosk mode** *(easiest)* — a refurbished Amazon Fire HD (~$50), any Android tablet, or an old phone, running **[Fully Kiosk Browser](https://www.fully-kiosk.com/)** locked to the URL. iPads work too via **Guided Access**. Mount it, set it to never sleep, done. ([Home Assistant folks use these constantly](https://www.smarthomeexplorer.com/guides/home-assistant-dashboard-setup-2026).)
- **A Pi + HDMI monitor/TV** *(no extra tablet)* — a second Pi (or a beefy one) driving a monitor, running **Chromium in kiosk mode** on boot. Cheap HDMI touchscreens start around [$35](https://pimylifeup.com/raspberry-pi-kiosk/). Note: recent Raspberry Pi OS uses Wayland, so follow a current kiosk guide. Portrait orientation matches the art best.
- **The Facebook Portal** *(what this project used — advanced)* — a repurposed smart display. Works, but needs sideloading Fully Kiosk and has firmware quirks. See [Advanced setups](#advanced-setups); not recommended as a starting point.

Whatever you pick: mount it **portrait** if you can (the art is drawn tall), disable sleep, and point the kiosk browser at the Pi. If your device can't resolve `.local` hostnames (some Android/Fire builds can't), use the Pi's IP address instead.

---

## Security notes

Fieldbook is built for a **trusted home LAN** — no login, plain HTTP. That's an intentional
trade-off for a wall gadget, but it's hardened for the realistic threats:

- **CSRF guard:** the server rejects cross-origin state-changing requests, so a malicious website you visit can't quietly drive your browser into wiping data or running up art costs.
- **Dev routes off by default:** the fake-detection `/simulate` endpoint is disabled on a real device (auto-enabled only when MQTT isn't configured, e.g. a dev laptop; force with `ENABLE_SIMULATE=1`).
- **Cost cap** on art generation (`MAX_GROW_BIRDS`), input validation, parameterized SQL, secrets kept in `.env` (gitignored), and MQTT credentials redacted from logs.

**Don't** port-forward this to the internet. It has no authentication — anyone who can reach
it can drive it. If you want remote access, use a VPN like [Tailscale](https://tailscale.com/)
rather than exposing a port. And if you use Fully Kiosk's Remote Administration, **set a strong
password** (not the default).

---

## Advanced setups

<details>
<summary><strong>Separate app server (keep the Pi light / run 24-7 elsewhere)</strong></summary>

You can run Fieldbook's app server on a **different always-on computer** (this project ran it on
a Mac Mini) while the Pi does only detection + the broker. Then:

- On the Pi, make Mosquitto reachable over the LAN — add `listener 1883 0.0.0.0` to `/etc/mosquitto/conf.d/fieldbook.conf`.
- On the app-server machine, install Node, clone this repo, and set `MQTT_URL=mqtt://<pi-host>:1883`.
- Point the display at the app server's address instead of the Pi's.

macOS gotchas we hit: a **LaunchAgent** only runs while you're logged in (a LaunchDaemon doesn't
help if it still runs as your user), **FileVault** blocks auto-login, and **Local Network Privacy**
(macOS 15+) will block the background server's *outbound* LAN connections until you grant it under
**System Settings → Privacy & Security → Local Network**. The macOS launchd plists this project
used are in [`deploy/`](deploy/) (`com.birdsong.server*.plist` — legacy name).

</details>

<details>
<summary><strong>Using a Facebook Portal as the display</strong></summary>

Meta officially enabled ADB on deprecated Portals (mid-2026 firmware). Enable USB debugging,
`adb install` **Fully Kiosk Browser**, set the Start URL to `http://<server-ip>:3000/`, and turn
on Launch-on-Boot + Keep-Screen-On + portrait. Known quirks:

- **ADB doesn't persist across reboots** on some firmware (the toggle is cosmetic) — enable everything you need in one session.
- **Android WebView can't resolve `.local`** — the Portal's Start URL must be an **IP address**.
- Enable Fully's **Remote Administration** (port 2323, with a strong password) — since ADB is unreliable, that REST API becomes your only remote lifeline for reloading/reconfiguring it.
- Set Fully → Advanced Web Settings → **"Auto Reload after Page Error"** so it self-heals if the server is briefly unreachable at boot.

</details>

---

## Reference

### Endpoints

| Route | Purpose |
|---|---|
| `GET /` | The display page (point your kiosk browser here) |
| `GET /config` | The mobile config/control page |
| `GET /state` | Current display state as JSON (the page polls this) |
| `POST /webhook` | BirdNET-Go webhook fallback for detections |
| `GET /healthz` | Liveness + current mode |
| `GET /api/*` | Status, library, detections, metrics, settings (consumed by the config page) |

### Key environment variables (`.env`)

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Server port |
| `MQTT_URL` | *(blank)* | Broker URL, e.g. `mqtt://localhost:1883`. Blank disables MQTT (dev). |
| `MQTT_TOPIC` | `birdnet` | Topic BirdNET-Go publishes to |
| `ACTIVE_WINDOW_MINUTES` | `10` | How long a bird stays "active" after being heard |
| `NEST_WINDOW_MINUTES` | `15` | Empty-nest hold before the collage takes over |
| `COLLAGE_WINDOW_HOURS` | `48` | Rolling window for the idle collage |
| `CYCLE_INTERVAL_SECONDS` | `30` | How often the collage swaps birds |
| `MIN_CONFIDENCE` | `0.6` | Ignore detections below this |
| `OPENAI_API_KEY` | *(blank)* | For art generation |
| `MAX_GROW_BIRDS` | `50` | Cap on auto-painted new species (0 = off) |
| `ENABLE_SIMULATE` | *(blank)* | Set `1` to enable the `/simulate` dev route on a real device |

(All timings are also editable live from the config page.)

### Project layout

```
src/          the Node/TypeScript app server
public/       the display page + config page (vanilla JS/CSS, no framework)
deploy/       systemd unit (Pi) + launchd plists (macOS) + notes
docs/         art style guide
art/          generated illustrations (gitignored — regenerable)
data/         SQLite DB (gitignored)
```

### Development

```bash
npm run dev        # tsx watch, http://localhost:3000 — MQTT off, /simulate on
npm run typecheck  # tsc --noEmit
npm run build      # compile to dist/
```

With no hardware, exercise the display with a fake detection:

```bash
curl -X POST localhost:3000/simulate -H 'content-type: application/json' \
  -d '{"species":"American Robin","confidence":0.9}'
```

---

## License

[MIT](LICENSE) — use it, change it, share it; just keep the copyright notice, and know it
comes with no warranty.

One caveat: Fieldbook *orchestrates* [BirdNET](https://github.com/kahst/BirdNET-Analyzer) (via
BirdNET-Go), whose model is licensed **non-commercially** (CC BY-NC-SA 4.0). This repo's MIT
license covers Fieldbook's own code — but if you run the detection stack, you're also bound by
BirdNET's terms, which matter only if you try to commercialize it.
