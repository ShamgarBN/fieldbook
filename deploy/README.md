# Deploy notes

Most people want the **simple all-in-one-Pi setup** — see the main [README](../README.md).
`fieldbook.service` in this folder is the Pi systemd unit for that path.

The rest of this file is detailed notes for the **advanced "separate app server on macOS"**
setup (the Pi does detection + broker; a Mac runs the app server). The examples use this
project's actual machines — a Mac Mini (`shopmini`) and a Pi (`birdpi`) — as a concrete
illustration; adapt the hostnames/paths to yours.

## Running the server on macOS (LaunchAgent)

The app runs as a per-user LaunchAgent (`~/Library/LaunchAgents/com.birdsong.server.plist`
— legacy label). It auto-starts at login and restarts on crash (KeepAlive).

**Reboot survival is the catch on macOS:**
- If **FileVault is on** (the default), macOS *disables* auto-login. A reboot needs one
  password at the FileVault screen — which then logs you in and the LaunchAgent starts on
  its own. Not zero-touch, but it recovers after that single unlock.
- If FileVault is off, enable auto-login (System Settings → Users & Groups) and the
  LaunchAgent survives reboots untouched.
- A LaunchDaemon does **not** help here: to see your home dir + `.env` it still runs as your
  user, so it's subject to the same Local Network Privacy control below.

## Redeploying after code changes

From the project dir. **Deploy CODE only — never rsync `art/`, `data/`, or `.env`.** Those
are live state on the server: art is regenerated *there* via `/config`, `data/` is the live
detection DB, and `.env` holds secrets. Rsyncing them from a dev machine silently reverts
regenerated art and can wipe detection history.

```bash
npm run build
rsync -a --exclude='.git' --exclude='node_modules/.cache' \
      --exclude='.env' --exclude='art' --exclude='data' \
      ./ <server>:fieldbook/
# `launchctl kickstart` sometimes does NOT actually restart (a stale process was seen
# running for days). Kill it and let KeepAlive respawn the fresh build, then verify:
ssh <server> 'P=$(lsof -nP -i :3000 -t); kill $P; sleep 8; ps -o pid,etime -p $(lsof -nP -i :3000 -t)'
```

## MQTT across machines

With a separate server, the broker stays on the Pi and the Mac subscribes over the LAN. On
the Pi add a LAN listener (`listener 1883 0.0.0.0` in `/etc/mosquitto/conf.d/`), and on the
Mac set `MQTT_URL=mqtt://<pi-host>:1883` in its `.env`.

### ⚠️ macOS Local Network Privacy (macOS 15+) — required for MQTT to work

macOS silently blocks a **background launchd service's *outbound* LAN connections** (inbound
serving on :3000 is fine — which is why the display works but MQTT won't connect). Symptom:
`[mqtt] error: code=EHOSTUNREACH ... :1883`, while running `node dist/server.js` from an
interactive shell connects fine.

**Fix:** System Settings → Privacy & Security → **Local Network** → enable the `node` /
Fieldbook entry. The service reconnects within seconds. (Fallback if it stays fiddly: switch
BirdNET-Go to POST detections to the server's `/webhook` — inbound-only, never gated.)

## Useful checks

```bash
ssh <server> 'launchctl list | grep birdsong'         # PID <tab> last-exit <tab> label
ssh <server> 'tail -f ~/fieldbook/logs/server.err.log'
curl http://<server>:3000/config                       # config page from any LAN device
```
