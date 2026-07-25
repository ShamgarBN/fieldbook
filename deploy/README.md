# Deploying the birdsong server on shopmini (M1 Mac Mini, 192.168.50.63)

The app server is deployed to `~/birdsong` on shopmini and runs as a launchd service.
Node runtime lives in `~/.local/bin/node` (copied from the laptop, no Homebrew).

## Current state: LaunchAgent (starts at login)

`~/Library/LaunchAgents/com.birdsong.server.plist` is installed and running.
It auto-starts when Ben logs in and restarts on crash (KeepAlive). It does **not**
start after a reboot until someone logs in, because auto-login is off.

## To make it fully reboot-proof: promote to a LaunchDaemon (needs admin password)

A LaunchDaemon starts at boot with no login required — the right pattern for an
always-on server. The daemon plist is already staged at
`~/birdsong/deploy/com.birdsong.server.daemon.plist`. Install it once:

```bash
# 1. Stop and remove the per-login agent (avoids two servers fighting for port 3000)
launchctl bootout gui/$(id -u)/com.birdsong.server 2>/dev/null
rm -f ~/Library/LaunchAgents/com.birdsong.server.plist

# 2. Install the boot-time daemon
sudo cp ~/birdsong/deploy/com.birdsong.server.daemon.plist /Library/LaunchDaemons/com.birdsong.server.plist
sudo chown root:wheel /Library/LaunchDaemons/com.birdsong.server.plist
sudo launchctl bootstrap system /Library/LaunchDaemons/com.birdsong.server.plist

# 3. Verify
curl -s localhost:3000/healthz
```

(Alternative, no daemon: enable auto-login in System Settings → Users & Groups →
Automatically log in as… — then the existing LaunchAgent survives reboots too.)

## Redeploying after code changes

From the laptop project dir. **Deploy CODE only — never push `art/`, `data/`, or `.env`.**
Those are prod state that lives on shopmini: art is regenerated *on* shopmini via
`/config` (the laptop's copies are stale), `data/birdsong.db` is the live detection
history + art table, and `.env` holds prod secrets. Rsyncing them from the laptop
silently reverts regenerated art and can wipe live detections. (This is exactly what
happened 2026-07-24: a deploy overwrote a freshly-regenerated Eastern Towhee with the
laptop's stale broken copy.)

```bash
npm run build
rsync -a --exclude='.git' --exclude='node_modules/.cache' \
      --exclude='.env' --exclude='art' --exclude='data' \
      ./ shopmini:birdsong/
# kickstart often does NOT actually restart (stale process seen up 3+ days). Verify:
ssh shopmini 'P=$(lsof -nP -i :3000 -t); kill $P; sleep 8; ps -o pid,etime -p $(lsof -nP -i :3000 -t)'
```

## MQTT ingestion

The Mosquitto broker runs **on the Pi** (`birdpi`), co-located with BirdNET-Go — not on
shopmini (shopmini has no Homebrew; we keep it lightweight). BirdNET-Go publishes
detections to `birdnet` on `birdpi.local:1883` (anonymous, LAN-only). shopmini's server
subscribes. Config is in `~/birdsong/.env` (NOT rsynced — env is per-machine):

```
MQTT_URL=mqtt://birdpi.local:1883
MQTT_TOPIC=birdnet
```

### ⚠️ macOS Local Network Privacy (macOS 15+/26) — REQUIRED for MQTT to work

macOS silently blocks a **background launchd service's *outbound* LAN connections**
(inbound serving on :3000 is fine, which is why the display worked but MQTT didn't).
Symptom: `[mqtt] error: code=EHOSTUNREACH ... 192.168.50.x:1883` in `logs/server.err.log`,
while running the same `node dist/server.js` from an interactive shell connects fine.

Fix (either):
1. **Grant Local Network access:** System Settings → Privacy & Security → **Local Network**
   → enable the `birdsong`/`node` entry, then the service auto-reconnects (~5s).
2. **Run as a LaunchDaemon** (system/root context — not subject to the per-user Local
   Network control, and also survives reboots): follow the LaunchDaemon promotion above.

Fallback if the privacy control proves too fiddly: switch transport to **webhook**
(BirdNET-Go → POST shopmini `/webhook`), which is inbound-only and never gated.

## Useful checks

```bash
ssh shopmini 'launchctl list | grep birdsong'          # PID <tab> last-exit <tab> label
ssh shopmini 'tail -f ~/birdsong/logs/server.err.log'  # live logs
curl http://192.168.50.63:3000/config                  # config page from any device on the LAN
```
