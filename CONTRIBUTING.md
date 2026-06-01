# Contributing

Thanks for your interest in the (unofficial) DWARFLab Viewer! Contributions —
code, bug reports, and especially **hardware reports** for non-DWARF-3 models —
are very welcome.

## Ground rules

- This project is **not affiliated with DWARFLAB**. Keep contributions free of
  any proprietary material (decompiled code, leaked firmware, internal vendor
  documents). The telescope protocol is described independently in
  [`@alikh/dwarflab-sdk`](https://github.com/alikh31/dwarflab-sdk); use that.
- Be respectful and constructive on the issue tracker.

## Development setup

Requires Node.js ≥ 18.

```bash
git clone https://github.com/alikh31/dwarflab-viewer.git
cd dwarflab-viewer
npm install
npm run dev
```

`npm install` runs `patch-package` (a `jmuxer` patch is applied automatically).

## Before opening a pull request

Run the same checks CI runs:

```bash
npm run typecheck   # type-check Node + web sides
npm run build       # electron-vite production build
```

Both must pass. For UI changes, please verify the app launches (`npm run dev`)
and, where relevant, test against a real device.

## Project layout

```
src/
  main/       Electron main process (services + IPC)
    services/   sdk, discovery, ble, rtsp-client, stream-proxy, settings
    ipc/        IPC channel definitions + handlers
  preload/    contextBridge API exposed to the renderer
  renderer/   React + Tailwind UI (components, hooks, lib)
```

The app depends on the published `@alikh/dwarflab-sdk` and
`@alikh/dwarflab-ble` packages from npm — it does not vendor the SDK.

## Hardware reports

Only the **DWARF 3** is verified. If you have another model, please open an
issue with your device model, firmware version, what you tried, and what
happened (including any error codes).

## Releasing (maintainers)

Releases are tag-driven and build installers for all three platforms in CI:

1. Bump `version` in `package.json` and update any release notes.
2. Commit, then tag and push:
   ```bash
   git tag vX.Y.Z
   git push origin main --tags
   ```
3. `.github/workflows/release.yml` builds macOS (`.dmg`), Windows (NSIS), and
   Linux (`AppImage` + `deb`) and attaches them to the GitHub Release for the
   tag (via `GITHUB_TOKEN` — no extra secrets needed for unsigned builds).

Code-signing is not yet configured; binaries ship unsigned. If/when signing
certificates are added, they'll be wired in as CI secrets.

## License

By contributing, you agree your contributions are licensed under the project's
[MIT License](./LICENSE).
