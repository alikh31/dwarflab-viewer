# DWARFLab Viewer (Unofficial)

> A cross-platform desktop app for live-viewing and controlling [DWARFLAB](https://dwarflab.com)
> DWARF smart telescopes — built on the unofficial
> [`@alikh/dwarflab-sdk`](https://github.com/alikh31/dwarflab-sdk).

[![CI](https://github.com/alikh31/dwarflab-viewer/actions/workflows/ci.yml/badge.svg)](https://github.com/alikh31/dwarflab-viewer/actions/workflows/ci.yml)
[![Release](https://github.com/alikh31/dwarflab-viewer/actions/workflows/release.yml/badge.svg)](https://github.com/alikh31/dwarflab-viewer/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

> [!IMPORTANT]
> This is an **independent, community-built** application. It is **not affiliated
> with, authorized, or endorsed by DWARFLAB**. "DWARF" and "DWARFLAB" are
> trademarks of their respective owner, used here only to describe the hardware
> this app controls. It talks to your telescope at a low level (motors, focus,
> power) over your local network — **use at your own risk**; see the
> [disclaimer](#disclaimer).

## What it does

A native desktop window that connects to a DWARF telescope on your local
network and gives you:

- **Live camera view** — H.265 RTSP streams (tele + wide) decoded in-app, with
  no external dependencies (pure-Node RTSP → fMP4 via MSE; no ffmpeg).
- **Focus** — auto-focus, astro auto-focus, and a magnifier loupe with edge
  detection for manual focusing.
- **Mount control** — on-screen direction pad, keyboard, and gamepad slewing.
- **Astrophotography** — plate-solve calibration, GoTo (with a built-in target
  catalog), EQ polar-alignment wizard, and live stacking with a live preview.
- **Camera params** — exposure, gain, white balance, IR-cut filter, and more.
- **Capture** — photo, burst, video, timelapse, and an album browser.
- **Wi-Fi setup over Bluetooth** — discover a telescope and configure its Wi-Fi
  before it's on the network (see [Bluetooth notes](#bluetooth-ble-notes)).

## Install

Download the installer for your platform from the
[**Releases**](https://github.com/alikh31/dwarflab-viewer/releases) page.

| Platform | File |
|----------|------|
| macOS (Apple Silicon / Intel) | `.dmg` |
| Windows | `...-Setup.exe` (NSIS) |
| Linux | `.AppImage` or `.deb` |

> **The binaries are currently unsigned.** Your OS will warn that the app is
> from an unidentified developer. This is expected for an unsigned open-source
> build — here's how to run it anyway:
>
> - **macOS:** right-click (or Ctrl-click) the app → **Open** → **Open** again.
>   (Gatekeeper blocks double-click launch of unsigned apps, but allows this.)
> - **Windows:** on the SmartScreen prompt, click **More info** → **Run anyway**.
> - **Linux (AppImage):** `chmod +x DWARFLab-Viewer-*.AppImage` then run it.

## Connecting to your telescope

1. Power on the telescope and either join its Wi-Fi access point (default
   `192.168.88.1`) or have both the telescope and your computer on the same
   network.
2. Launch the app — it will try to discover the telescope automatically, or you
   can enter its IP manually.
3. That's it. Live view and controls become available once connected.

## Bluetooth (BLE) notes

The optional Wi-Fi-setup feature uses Bluetooth Low Energy to talk to a
telescope before it's on your network. BLE needs OS-level access:

- **macOS:** works out of the box (the app declares the Bluetooth usage
  permission; approve the prompt).
- **Windows:** needs a compatible Bluetooth adapter.
- **Linux:** the underlying library needs raw-socket capability. If BLE
  discovery doesn't work, grant the capability to the bundled Node runtime:
  ```bash
  sudo setcap cap_net_raw+eip $(readlink -f /path/to/the/app/binary)
  ```
  See the [noble prerequisites](https://github.com/abandonware/noble#prerequisites).

If Bluetooth is unavailable, the rest of the app still works normally — just do
Wi-Fi setup another way and connect by IP.

## Device support

Built and tested against the **DWARF 3** (firmware v1.5.x). Other DWARF models
that share the same protocol (DWARF 2, DWARF 3 Plus, DWARF Mini) may work but
are **unverified** — reports welcome via
[issues](https://github.com/alikh31/dwarflab-viewer/issues).

## Development

Requires Node.js ≥ 18.

```bash
git clone https://github.com/alikh31/dwarflab-viewer.git
cd dwarflab-viewer
npm install
npm run dev          # launch the app in dev mode (hot reload)
```

Other scripts:

```bash
npm run build        # build main + preload + renderer (electron-vite)
npm run typecheck    # type-check the Node and web sides
npm run package      # build + produce installers for the current OS (electron-builder)
```

### Tech stack

- **Electron** + **electron-vite** (main / preload / renderer)
- **React 19** + **Tailwind CSS** (renderer UI)
- **[`@alikh/dwarflab-sdk`](https://www.npmjs.com/package/@alikh/dwarflab-sdk)**
  for the telescope protocol (WebSocket + HTTP) and
  **[`@alikh/dwarflab-ble`](https://www.npmjs.com/package/@alikh/dwarflab-ble)**
  for Bluetooth setup.
- Pure-Node RTSP client + `jmuxer` for in-renderer H.265 playback.

### Architecture

```
main process (Node)                         renderer (React)
  ├── sdk-service     WebSocket protocol  ◄──► IPC ──► UI panels, hooks
  ├── discovery       mDNS/UDP device find
  ├── ble-service     Bluetooth Wi-Fi setup
  ├── rtsp-client     H.265 RTSP (port 554)
  └── stream-proxy    raw NAL → HTTP  ─────────► jMuxer → <video> (MSE)
```

## Releases

Tag-driven. Pushing a `vX.Y.Z` tag builds installers for macOS, Windows, and
Linux in CI and attaches them to a GitHub Release. See
[CONTRIBUTING.md](./CONTRIBUTING.md).

## Disclaimer

This software is provided "as is", without warranty of any kind. It controls
physical hardware and communicates with your telescope at a low level. The
authors are not responsible for any damage, data loss, or malfunction resulting
from its use. It is not an official DWARFLAB product and is not supported by
DWARFLAB. Always supervise your telescope while it is under program control.

## License

[MIT](./LICENSE) © alikh31
