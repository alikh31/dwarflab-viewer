import { ipcMain, BrowserWindow, dialog, app, shell } from 'electron';
import { writeFile, mkdir, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { IPC } from './channels';
import { Command, packParamId, ParamSection, ParamCamera } from '@alikh/dwarflab-sdk';
import type { SdkService } from '../services/sdk-service';
import { getSetting, setSetting } from '../services/settings';

// Build the packed int64 paramId the firmware actually expects.
// Verified live on firmware v1.5.0.1: all camera-side general int params
// live under section 1, tele camera = 0. modeId comes from the current
// shooting mode tracked in SdkService.
function pid(svc: SdkService, paramId: number, cameraId: number = ParamCamera.TELE) {
  return packParamId({
    modeId: svc.shootingMode,
    sectionId: ParamSection.GENERAL,
    cameraId,
    paramId,
  });
}

export function registerSdkHandlers(
  sdkService: SdkService,
  getWindow: () => BrowserWindow,
): void {
  ipcMain.handle(IPC.SDK_CONNECT, async (_event, host: string) => {
    await sdkService.connect(host, getWindow());
  });

  ipcMain.handle(IPC.SDK_DISCONNECT, async () => {
    sdkService.disconnect();
  });

  ipcMain.handle(IPC.SDK_DEVICE_INFO, async () => {
    const client = sdkService.getClient();
    return await client.device.getDeviceInfo();
  });

  // Camera streams are handled by RTSP (port 554) transcoded via ffmpeg.
  // The firmware ignores openCamera (cmd 10000/12000), so these are no-ops.
  ipcMain.handle(IPC.SDK_CAMERA_TELE_OPEN, async () => {});
  ipcMain.handle(IPC.SDK_CAMERA_WIDE_OPEN, async () => {});

  ipcMain.handle(IPC.SDK_CAMERA_TELE_CLOSE, async () => {
    const client = sdkService.getClient();
    await client.cameraTele.closeCamera();
  });

  ipcMain.handle(IPC.SDK_CAMERA_WIDE_CLOSE, async () => {
    const client = sdkService.getClient();
    await client.cameraWide.closeCamera();
  });

  ipcMain.handle(IPC.SDK_CAMERA_TELE_PHOTO, async () => {
    const client = sdkService.getClient();
    await client.cameraTele.takePhoto();
  });

  ipcMain.handle(IPC.SDK_CAMERA_WIDE_PHOTO, async () => {
    const client = sdkService.getClient();
    await client.cameraWide.takePhoto();
  });

  // Burst start. Per BURST_SPEC §1.1/§1.2 the firmware burst is a CONTINUOUS
  // rapid-fire primitive that IGNORES any count in the start command — the
  // official app leaves ReqBurstPhoto.count=0 and instead configures the shot
  // count out-of-band via the BURST_COUNT device param (paramId 21). We mirror
  // that: push BURST_COUNT first (so a future firmware that honours the param
  // does the right thing, and to match the reference app), then seed the
  // viewer-side "N shots" policy via beginBurst(n, camera) — which counts the
  // per-shot progress notifs and issues stopBurst() at N — then send start.
  // The advisory count on startBurst is belt-and-suspenders (§1.1); harmless.
  const BURST_COUNT_PARAM = 21; // BURST_COUNT param id
  const startBurst = async (camera: 'tele' | 'wide', count: unknown) => {
    const n = typeof count === 'number' && count >= 1 ? Math.floor(count) : 5;
    console.log(`[sdk] ${camera} burst start n=${n}`);
    const client = sdkService.getClient();

    // PRECONDITION (BURST_SPEC §1.4): the device should be in the BURST shooting
    // technique before startBurst. We enter BURST tech (orthogonal to scene
    // mode) and confirm via the switch reply before proceeding.
    //
    // ⚠ UNRESOLVED LIVE ISSUE (burst-qa, v1.5.0.1): startBurst (cmd 10003) is
    // currently refused with ComResponse{code:-1 PARSE_PROTOBUF_ERROR} in ALL
    // modes/techs AND all payloads — including the exact empty ReqBurstPhoto the
    // official app sends, which the SDK encodes byte-identically. A *parse*
    // error (vs a busy/precondition code) means the firmware can't decode the
    // request at all, so the tech-switch below is NOT confirmed to be the fix —
    // root cause (likely firmware-version regression on v1.5.0.1, or a deeper
    // precondition) is being investigated by burst-analyst + burst-qa.
    //
    // We keep ensureBurstTech because it's spec-recommended and HARMLESS (a
    // no-op round-trip if already in BURST tech; it never sends the refused
    // mode-only path), and it's the single isolated place to add a
    // switchShootingMode(NORMAL) step if the live root-cause shows it's needed.
    // It does not, by itself, claim to resolve the -1.
    await sdkService.ensureBurstTech(camera);

    // Configure the device-side shot count AFTER the tech switch, so the packed
    // paramId's modeId reflects the (now-burst) shooting mode. Best-effort; the
    // viewer-side count-to-N policy (beginBurst) is authoritative regardless.
    await client.sendCommandNoWait(Command.PARAM_SET_GENERAL_INT_PARAM, {
      paramId: pid(sdkService, BURST_COUNT_PARAM, camFor(camera)),
      value: n,
    }).catch(() => { /* best-effort — viewer-side count-to-N is authoritative */ });
    sdkService.beginBurst(n, camera);
    if (camera === 'wide') await client.cameraWide.startBurst(n);
    else await client.cameraTele.startBurst(n);
  };

  ipcMain.handle(IPC.SDK_CAMERA_TELE_BURST_START, (_e, count: unknown) => startBurst('tele', count));
  ipcMain.handle(IPC.SDK_CAMERA_TELE_BURST_STOP, async () => {
    // Mark the stop so the terminal 15274 clears the ring (whether this is a
    // manual ✕ cancel or completion). Then send the single stop command.
    sdkService.noteBurstStopRequested();
    const client = sdkService.getClient();
    await client.cameraTele.stopBurst();
  });
  ipcMain.handle(IPC.SDK_CAMERA_WIDE_BURST_START, (_e, count: unknown) => startBurst('wide', count));
  ipcMain.handle(IPC.SDK_CAMERA_WIDE_BURST_STOP, async () => {
    sdkService.noteBurstStopRequested();
    const client = sdkService.getClient();
    await client.cameraWide.stopBurst();
  });

  // --- Shooting mode ---

  ipcMain.handle(IPC.SDK_GET_MODES, async () => {
    const client = sdkService.getClient();
    return await client.firmware.getSupportedShootingModes();
  });

  // Mode switch reply carries {shootingModeId}; mode change is also broadcast
  // via NOTIFY_SWITCH_SHOOTING_MODE (15267) which updates the status bar.
  ipcMain.handle(IPC.SDK_SWITCH_MODE, async (_event, mode: number) => {
    const client = sdkService.getClient();
    return await client.taskCenter.switchShootingModeNoWait(mode);
  });

  // Shooting-technique switch (cmd 16403). Technique is orthogonal to scene
  // mode: SINGLE_SHOT=1, STACKING=2, BURST=3, VIDEO=4, TIMELAPSE=5, PANORAMA=6.
  // Entering the BURST technique is the precondition for startBurst (BURST_SPEC
  // §1.4 — without it cmd 10003 is refused code:-1). The device confirms via the
  // tele/wide shooting-tech-state notifications (15269/15271). Returns the reply
  // so the caller can inspect the ack.
  ipcMain.handle(IPC.SDK_SWITCH_TECH, async (_event, tech: number) => {
    const client = sdkService.getClient();
    return await client.taskCenter.switchShootingTech(tech);
  });

  // --- Camera parameters ---
  // All param commands use the new PARAM module (16700-16703) which the firmware
  // actually supports. Old camera commands (10xxx) crash the WebSocket connection.
  // ParamIds: EXP=1, GAIN=2, WB=3, BRIGHTNESS=4, CONTRAST=5, SATURATION=6,
  //           HUE=7, SHARPNESS=8, FILTER_TYPE=13
  // Exposure/Gain use PARAM_SET_EXPOSURE/GAIN with mode (0=auto, 1=manual).
  // Other params use PARAM_SET_GENERAL_INT_PARAM.

  // Param commands return {code, ...} so the renderer can show success/failure.
  // sendCommandNoWait is non-throwing — caller can ignore the reply or inspect it.

  // Camera ID: 0 = tele, 1 = wide. The packing is the same for both.
  const camFor = (camera: string) => (camera === 'wide' ? ParamCamera.WIDE : ParamCamera.TELE);

  ipcMain.handle(IPC.SDK_SET_EXP_MODE, async (_event, camera: string, mode: number) => {
    const client = sdkService.getClient();
    return await client.sendCommandNoWait(Command.PARAM_SET_EXPOSURE, { paramId: pid(sdkService, 1, camFor(camera)), mode, value: 0 });
  });

  ipcMain.handle(IPC.SDK_SET_EXPOSURE, async (_event, camera: string, value: number) => {
    const client = sdkService.getClient();
    // value is an INDEX (0-165) mapping to discrete shutter speeds, not ms
    return await client.sendCommandNoWait(Command.PARAM_SET_EXPOSURE, { paramId: pid(sdkService, 1, camFor(camera)), mode: 1, value });
  });

  ipcMain.handle(IPC.SDK_SET_GAIN_MODE, async (_event, camera: string, mode: number) => {
    const client = sdkService.getClient();
    return await client.sendCommandNoWait(Command.PARAM_SET_GAIN, { paramId: pid(sdkService, 2, camFor(camera)), mode, value: 0 });
  });

  ipcMain.handle(IPC.SDK_SET_GAIN, async (_event, camera: string, value: number) => {
    const client = sdkService.getClient();
    return await client.sendCommandNoWait(Command.PARAM_SET_GAIN, { paramId: pid(sdkService, 2, camFor(camera)), mode: 1, value });
  });

  ipcMain.handle(IPC.SDK_SET_BRIGHTNESS, async (_event, camera: string, value: number) => {
    const client = sdkService.getClient();
    return await client.sendCommandNoWait(Command.PARAM_SET_GENERAL_INT_PARAM, { paramId: pid(sdkService, 4, camFor(camera)), value });
  });

  ipcMain.handle(IPC.SDK_SET_CONTRAST, async (_event, camera: string, value: number) => {
    const client = sdkService.getClient();
    return await client.sendCommandNoWait(Command.PARAM_SET_GENERAL_INT_PARAM, { paramId: pid(sdkService, 5, camFor(camera)), value });
  });

  ipcMain.handle(IPC.SDK_SET_SATURATION, async (_event, camera: string, value: number) => {
    const client = sdkService.getClient();
    return await client.sendCommandNoWait(Command.PARAM_SET_GENERAL_INT_PARAM, { paramId: pid(sdkService, 6, camFor(camera)), value });
  });

  ipcMain.handle(IPC.SDK_SET_HUE, async (_event, camera: string, value: number) => {
    const client = sdkService.getClient();
    return await client.sendCommandNoWait(Command.PARAM_SET_GENERAL_INT_PARAM, { paramId: pid(sdkService, 7, camFor(camera)), value });
  });

  ipcMain.handle(IPC.SDK_SET_SHARPNESS, async (_event, camera: string, value: number) => {
    const client = sdkService.getClient();
    return await client.sendCommandNoWait(Command.PARAM_SET_GENERAL_INT_PARAM, { paramId: pid(sdkService, 8, camFor(camera)), value });
  });

  ipcMain.handle(IPC.SDK_SET_IRCUT, async (_event, _camera: string, mode: number) => {
    const client = sdkService.getClient();
    return await client.sendCommandNoWait(Command.CAMERA_TELE_SET_IRCUT, { mode });
  });

  // --- Tracking ---
  // Fire-and-forget for all tracking commands — device responds via notifications

  ipcMain.handle(IPC.SDK_TRACK_STOP, async () => {
    const client = sdkService.getClient();
    client.sendCommandNoWait(Command.TRACK_STOP_TRACK);
  });

  // Old SDK_TRACK_SENTRY_START sent SENTRY_MODE_START with no payload. The
  // firmware silently dropped that (verified live v1.5.0.1). Kept the handler
  // so any caller still using it doesn't crash, but it's a no-op now — use
  // SDK_TRACK_SENTRY_START_TYPED with a type.
  ipcMain.handle(IPC.SDK_TRACK_SENTRY_START, async () => {
    return null;
  });

  // Sentry with object-type. Verified live: types 1=UFO, 2=BIRD, 3=PERSON,
  // 4=ANIMAL, 5=VEHICLE, 6=FLYING, 7=BOAT.
  // Type 0 is silently dropped by the firmware.
  ipcMain.handle(IPC.SDK_TRACK_SENTRY_START_TYPED, async (_event, type: number) => {
    const client = sdkService.getClient();
    return await client.sendCommandNoWait(Command.SENTRY_MODE_START, { type });
  });

  // Click-to-track: device coords (frame x/y on the tele or wide stream).
  ipcMain.handle(IPC.SDK_TRACK_CLICK, async (_event, x: number, y: number, camId: number) => {
    const client = sdkService.getClient();
    return await client.sendCommandNoWait(Command.TRACK_START_CLICK, { x, y, camId });
  });

  ipcMain.handle(IPC.SDK_TRACK_SENTRY_STOP, async () => {
    const client = sdkService.getClient();
    client.sendCommandNoWait(Command.SENTRY_MODE_STOP);
  });

  ipcMain.handle(IPC.SDK_TRACK_MOT_START, async () => {
    const client = sdkService.getClient();
    client.sendCommandNoWait(Command.MOT_START);
  });

  ipcMain.handle(IPC.SDK_TRACK_UFO_START, async () => {
    const client = sdkService.getClient();
    client.sendCommandNoWait(Command.UFOTRACK_MODE_START);
  });

  ipcMain.handle(IPC.SDK_TRACK_UFO_STOP, async () => {
    const client = sdkService.getClient();
    client.sendCommandNoWait(Command.UFOTRACK_MODE_STOP);
  });

  // --- Filter ---
  // Filter is a general int param (raw paramId=13): 0=VIS, 1=ASTRO, 2=DUO_BAND, 3=DARK.
  // Filter is a physical wheel on the tele camera only.
  ipcMain.handle(IPC.SDK_SET_FILTER, async (_event, value: number) => {
    const client = sdkService.getClient();
    return await client.sendCommandNoWait(Command.PARAM_SET_GENERAL_INT_PARAM, { paramId: pid(sdkService, 13, ParamCamera.TELE), value });
  });

  // --- Focus ---

  ipcMain.handle(IPC.SDK_FOCUS_AUTO, async () => {
    const client = sdkService.getClient();
    return await client.sendCommandNoWait(Command.FOCUS_AUTO_FOCUS, { mode: 0 });
  });

  ipcMain.handle(IPC.SDK_FOCUS_MANUAL_START, async (_event, direction: number) => {
    const client = sdkService.getClient();
    // direction: 0=far (toward infinity), 1=near (toward close)
    client.sendCommandNoWait(Command.FOCUS_START_MANUAL_CONTINU_FOCUS, { direction });
  });

  ipcMain.handle(IPC.SDK_FOCUS_MANUAL_STOP, async () => {
    const client = sdkService.getClient();
    client.sendCommandNoWait(Command.FOCUS_STOP_MANUAL_CONTINU_FOCUS);
  });

  ipcMain.handle(IPC.SDK_FOCUS_STEP, async (_event, direction: number) => {
    const client = sdkService.getClient();
    // direction: 0=far, 1=near
    client.sendCommandNoWait(Command.FOCUS_MANUAL_SINGLE_STEP_FOCUS, { direction });
  });

  ipcMain.handle(IPC.SDK_FOCUS_ASTRO_AUTO_START, async () => {
    const client = sdkService.getClient();
    client.sendCommandNoWait(Command.FOCUS_START_ASTRO_AUTO_FOCUS, { mode: 0 });
  });

  ipcMain.handle(IPC.SDK_FOCUS_ASTRO_AUTO_STOP, async () => {
    const client = sdkService.getClient();
    client.sendCommandNoWait(Command.FOCUS_STOP_ASTRO_AUTO_FOCUS);
  });

  // Album
  ipcMain.handle(IPC.SDK_ALBUM_COUNTS, async () => {
    const client = sdkService.getClient();
    return await client.album.getMediaCounts();
  });

  ipcMain.handle(IPC.SDK_ALBUM_LIST, async (_event, mediaType: number, pageIndex: number, pageSize?: number) => {
    const client = sdkService.getClient();
    return await client.album.getMediaList(mediaType, pageIndex, pageSize);
  });

  ipcMain.handle(IPC.SDK_ALBUM_FILE_URL, async (_event, devicePath: string) => {
    const client = sdkService.getClient();
    return client.album.fileUrl(devicePath, client.host);
  });

  ipcMain.handle(IPC.SDK_ALBUM_DELETE, async (_event, items: Array<{ filePath: string; fileName?: string; mediaType: number; subType?: number }>) => {
    const client = sdkService.getClient();
    return await client.album.deleteMedia(items);
  });

  ipcMain.handle(IPC.SDK_ALBUM_DOWNLOAD, async (_event, devicePath: string, suggestedName: string) => {
    const client = sdkService.getClient();
    const url = client.album.fileUrl(devicePath, client.host);
    const result = await dialog.showSaveDialog(getWindow(), {
      defaultPath: suggestedName,
      title: 'Save album item',
    });
    if (result.canceled || !result.filePath) return { ok: false };
    try {
      const res = await fetch(url);
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(result.filePath, buf);
      return { ok: true, savedTo: result.filePath };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  /**
   * Download the file to a temp cache dir and hand it to the OS to open with
   * the user's default app. Used for videos because the device records H.265
   * (hvc1) which Chromium doesn't decode in <video>, but QuickTime / VLC /
   * mpv all handle it. Cache by filename so repeat opens don't re-download.
   */
  ipcMain.handle(IPC.SDK_ALBUM_OPEN_EXTERNAL, async (_event, devicePath: string, suggestedName: string) => {
    try {
      const client = sdkService.getClient();
      const url = client.album.fileUrl(devicePath, client.host);
      const cacheDir = path.join(app.getPath('temp'), 'dwarflab-viewer-album');
      await mkdir(cacheDir, { recursive: true });
      const safeName = suggestedName.replace(/[^\w.\- ()]+/g, '_');
      const target = path.join(cacheDir, safeName);
      // If already cached, just open it
      try {
        await access(target, fsConstants.R_OK);
      } catch {
        const res = await fetch(url);
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
        await writeFile(target, Buffer.from(await res.arrayBuffer()));
      }
      const err = await shell.openPath(target);
      if (err) return { ok: false, error: err };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  // Motor joystick — vectorAngle (degrees), vectorLength (0..1).
  // Hold-to-slew: caller is expected to call joystick() repeatedly while held
  // and joystickStop() on release. Reply is ignored (best-effort).
  ipcMain.handle(IPC.SDK_MOTOR_JOYSTICK, async (_event, vectorAngle: number, vectorLength: number) => {
    const client = sdkService.getClient();
    return await client.motor.joystick(vectorAngle, vectorLength);
  });

  ipcMain.handle(IPC.SDK_MOTOR_JOYSTICK_STOP, async () => {
    const client = sdkService.getClient();
    return await client.motor.joystickStop();
  });

  // --- Astro ---
  // Calibration (plate-solve). Requires lon, lat. Result via 15210 + 15256.
  ipcMain.handle(IPC.SDK_ASTRO_CALIBRATION_START, async (_event, lon: number, lat: number) => {
    const client = sdkService.getClient();
    return await client.astro.startCalibration(lon, lat);
  });

  ipcMain.handle(IPC.SDK_ASTRO_CALIBRATION_STOP, async () => {
    const client = sdkService.getClient();
    return await client.astro.stopCalibration();
  });

  // EQ polar-align solving. Requires lon, lat. Progress via 15239.
  ipcMain.handle(IPC.SDK_ASTRO_EQ_SOLVING_START, async (_event, lon: number, lat: number) => {
    const client = sdkService.getClient();
    return await client.astro.startEqSolving(lon, lat);
  });

  ipcMain.handle(IPC.SDK_ASTRO_EQ_SOLVING_STOP, async () => {
    const client = sdkService.getClient();
    return await client.astro.stopEqSolving();
  });

  // GoTo: DSO by RA/Dec, solar system by index. Progress via 15211.
  ipcMain.handle(IPC.SDK_ASTRO_GOTO_DSO, async (_event, ra: number, dec: number, targetName?: string) => {
    const client = sdkService.getClient();
    return await client.astro.gotoDSO(ra, dec, targetName);
  });

  ipcMain.handle(IPC.SDK_ASTRO_GOTO_SOLAR, async (_event, index: number, lon: number, lat: number, targetName?: string) => {
    const client = sdkService.getClient();
    return await client.astro.gotoSolarSystem(index, lon, lat, targetName);
  });

  ipcMain.handle(IPC.SDK_ASTRO_GOTO_STOP, async () => {
    const client = sdkService.getClient();
    return await client.astro.stopGoto();
  });

  // Exit any astro pipeline and return to plain live view.
  ipcMain.handle(IPC.SDK_ASTRO_GO_LIVE, async () => {
    const client = sdkService.getClient();
    return await client.astro.goLive();
  });

  // Live stacking — tele and wide are distinct commands (11005 vs 11016).
  // State notifications: 15208 (tele) / 15236 (wide); progress: 15209 / 15237.
  //
  // Start passes through the official app's two wire fields. forceStart=true skips the
  // firmware's preflight (use only when the UX gating has already confirmed
  // calibration+GoTo — see STACKING_SPEC). irIndex is the filter-wheel index;
  // the official app threads its current filter index here,
  // so we default it to the device's tracked filterType rather than -1. -1 is
  // only the "filter unknown" fallback when we've never seen a filter notif.
  // Tele only — the wide proto has no irIndex field.
  // We feed the ack reply into sdkService.noteAstroResult so a synchronous
  // -11501 (CODE_ASTRO_FUNCTION_BUSY) surfaces in deviceState.astroError and
  // the UI can offer Recover.
  // Throw a coded error on a negative ack so the renderer can branch on it
  // (ui-eng's isBusyError checks err.code === -11501). The numeric code rides
  // on the thrown Error; ipcMain serializes Error.message across the bridge, so
  // we also embed the code in the message as a belt-and-braces fallback for
  // renderers that only see the message string.
  const throwIfAstroError = (cmd: number, reply: unknown): unknown => {
    sdkService.noteAstroResult(cmd, reply);
    const code = (reply as { code?: number } | null)?.code;
    if (typeof code === 'number' && code < 0) {
      const err = new Error(`astro command ${cmd} failed: code ${code}`) as Error & { code: number };
      err.code = code;
      throw err;
    }
    return reply;
  };

  ipcMain.handle(
    IPC.SDK_ASTRO_LIVE_STACKING_TELE_START,
    async (_event, opts?: { forceStart?: boolean; irIndex?: number }) => {
      const client = sdkService.getClient();
      // Prefer an explicit irIndex from the caller; otherwise use the device's
      // tracked filter index; -1 only if we've never seen a filter notification.
      const irIndex = opts?.irIndex ?? sdkService.filterType ?? -1;
      const reply = await client.astro.startLiveStacking(
        irIndex,
        opts?.forceStart ?? false,
      );
      return throwIfAstroError(11005, reply);
    },
  );

  ipcMain.handle(IPC.SDK_ASTRO_LIVE_STACKING_TELE_STOP, async () => {
    // The official app's user-facing Stop button uses the FAST stop (11037), not the
    // slow stop (11006). Slow stop blocks the firmware while it finalises
    // queued frames and can take minutes — the UI just looks frozen. Fast
    // stop cuts the pipeline immediately and the firmware confirms via the
    // 15208 state notification.
    const client = sdkService.getClient();
    return await client.astro.fastStopLiveStacking();
  });

  ipcMain.handle(
    IPC.SDK_ASTRO_LIVE_STACKING_WIDE_START,
    async (_event, opts?: { forceStart?: boolean }) => {
      const client = sdkService.getClient();
      const reply = await client.astro.startWideLiveStacking(opts?.forceStart ?? false);
      return throwIfAstroError(11016, reply);
    },
  );

  ipcMain.handle(IPC.SDK_ASTRO_LIVE_STACKING_WIDE_STOP, async () => {
    const client = sdkService.getClient();
    return await client.astro.fastStopWideLiveStacking();
  });

  // Slow stop (11006 / 11017) — finalize & save queued frames. Exposed as a
  // secondary "Finalize" action; the default Stop above is the fast cut.
  ipcMain.handle(IPC.SDK_ASTRO_LIVE_STACKING_TELE_STOP_SLOW, async () => {
    const client = sdkService.getClient();
    return await client.astro.stopLiveStacking();
  });

  ipcMain.handle(IPC.SDK_ASTRO_LIVE_STACKING_WIDE_STOP_SLOW, async () => {
    const client = sdkService.getClient();
    return await client.astro.stopWideLiveStacking();
  });

  // Recover from a stuck astro session. Fast-stops both stacks then defensively
  // stops goto/calibration/EQ/dark (sdk-eng's recoverStacking). Clears the
  // astroError flag on success so the UI dismisses the Recover affordance.
  ipcMain.handle(IPC.SDK_ASTRO_RECOVER, async () => {
    const client = sdkService.getClient();
    const result = await client.astro.recoverStacking();
    console.log(`[astro] recover issued=${result.issued.join(',')} failed=${result.failed.join(',')}`);
    sdkService.clearAstroError();
    // The pipeline drop also kills RTSP routes — re-arm so streams resume.
    await sdkService.rearmStreams();
    return result;
  });

  // On-demand stacking-state query. Returns sdk-eng's normalized
  // StackingStateSnapshot { tele:{state,label,active}, wide:{state,label,active} }.
  // The main process also calls this on (re)connect to seed stackingJob; this
  // handler just exposes it for any explicit renderer-driven refresh.
  ipcMain.handle(IPC.SDK_ASTRO_QUERY_STACKING, async () => {
    const client = sdkService.getClient();
    return await client.astro.queryStackingState();
  });

  // --- System ---
  // Push lon/lat into firmware. Preflight for any astro op that takes location.
  ipcMain.handle(IPC.SDK_SYSTEM_SET_LOCATION, async (_event, lon: number, lat: number) => {
    const client = sdkService.getClient();
    return await client.system.setLocation(lon, lat);
  });

  // --- Settings (local JSON store, userData/settings.json) ---
  ipcMain.handle(IPC.SETTINGS_GET, async (_event, key: string) => {
    return await getSetting(key);
  });

  ipcMain.handle(IPC.SETTINGS_SET, async (_event, key: string, value: unknown) => {
    await setSetting(key, value);
  });
}
