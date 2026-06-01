import { DwarfClient, Command, unpackParamId, describeLiveStackingState, LiveStackingState, isBurstActive, ShootingTech } from '@alikh/dwarflab-sdk';
import WebSocket from 'ws';
import { BrowserWindow } from 'electron';
import { IPC } from '../ipc/channels';
import type { StreamProxyService } from './stream-proxy-service';

interface DeviceStateSnapshot {
  batteryPercentage: number | null;
  charging: boolean | null;
  sdCardPresent: boolean | null;
  sdCardAvailableGB: number | null;
  sdCardTotalGB: number | null;
  temperature: number | null;
  cmosTemperature: number | null;
  shootingMode: number | null;
  focusPosition: number | null;
  filterType: number | null;
  connected: boolean;
  // Astro pipeline state (populated by 152xx notifications). All null until
  // the corresponding operation has reported state for the first time;
  // cleared back to null on terminal states so the UI can tell "never run"
  // from "currently running".
  calibrationState: { state: number; plateSolvingTimes: number } | null;
  gotoState: { state: number; targetName: string } | null;
  eqSolvingState: { state: number } | null;
  liveStackingProgress: {
    totalCount: number;
    currentCount: number;
    stackedCount: number;
    expIndex: number;
    gainIndex: number;
    targetName: string;
    shootingTime: number;
    stackedTime: number;
    cameraType: number;
    // Raw OperationState int (0=IDLE,1=RUNNING,2=STOPPING,3=STOPPED) mirrored
    // from the latest 15208/15236 STATE notification, so consumers that read
    // progress also see lifecycle without joining to stackingJob. While a
    // progress notif is arriving the job is by definition RUNNING(1).
    state: number;
  } | null;
  // Authoritative live-stacking job descriptor. Driven by the 15208/15236
  // STATE notification (lifecycle) enriched with counts/target from the
  // 15209/15237 PROGRESS notification. Unlike liveStackingProgress (which is
  // null between Start and the first progress notif, and on every terminal
  // transition), stackingJob persists across that gap and across reconnect, so
  // the UI can reliably answer "is a job running and on which camera".
  // null = no job started this session / fully cleared after a terminal state.
  // Must stay in sync with the copies in renderer/lib/types.ts and
  // useDeviceState.ts defaults.
  stackingJob: {
    camera: 'tele' | 'wide';
    // From describeLiveStackingState(): 'idle' | 'running' | 'stopping' |
    // 'stopped' | 'unknown(<n>)'. The firmware's OperationState enum does NOT
    // distinguish success from failure — both land on 'stopped'.
    state: string;
    targetName: string;
    totalCount: number;
    stackedCount: number;
    startedAt: number | null; // epoch ms when first observed RUNNING
    elapsedMs: number;        // derived: now - startedAt while running
  } | null;
  // Last astro error code surfaced by a notification/reply (e.g. -11501 =
  // CODE_ASTRO_FUNCTION_BUSY, the "stuck session" condition). The UI uses this
  // to offer the Recover affordance. Cleared on a successful start or recover.
  astroError: { code: number; cmd: number; at: number } | null;
  calibrationResult: { azi: number; alt: number } | null;
  astroLocation: { lon: number; lat: number } | null;
  // Burst-photo progress. Reset to null when the burst ends. Used by the
  // shutter button to draw a ring of green progress cells. Must stay in sync
  // with the copies in renderer/lib/types.ts and useDeviceState.ts defaults.
  burstProgress: {
    totalCount: number;
    completedCount: number;
    cameraType: number;
  } | null;
}

const FRESH_STATE = (): DeviceStateSnapshot => ({
  batteryPercentage: null,
  charging: null,
  sdCardPresent: null,
  sdCardAvailableGB: null,
  sdCardTotalGB: null,
  temperature: null,
  cmosTemperature: null,
  shootingMode: null,
  focusPosition: null,
  filterType: null,
  connected: false,
  calibrationState: null,
  gotoState: null,
  eqSolvingState: null,
  liveStackingProgress: null,
  stackingJob: null,
  astroError: null,
  calibrationResult: null,
  astroLocation: null,
  burstProgress: null,
});

// Raw param IDs we care about pulling out of NOTIFY_GENERAL_INT_PARAM.
// Verified live on v1.5.0.1 via /shootingMode/getParamAndSetting.
const PARAM_FILTER_TYPE = 13;

export class SdkService {
  private client: DwarfClient | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private streamProxy: StreamProxyService | null = null;
  private state: DeviceStateSnapshot = FRESH_STATE();
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribeNotifications: (() => void) | null = null;
  // Burst tracking. LIVE-CONFIRMED (burst-qa round-2, v1.5.0.1 — Model B):
  // after we set the BURST_COUNT param (21) and switch to BURST tech, the
  // firmware fires EXACTLY that many shots and SELF-STOPS (15274 → terminal,
  // no stopBurst needed). The 15285 BURST_PROGRESS notif carries a REAL
  // totalCount (= BURST_COUNT) and a running completedCount (1→2→…→N). So the
  // device does both the counting and the stopping; the viewer just reflects
  // it. We keep burstExpectedTotal only to seed the ring for the instant before
  // the first progress notif arrives; once notifs flow, the firmware's
  // totalCount/completedCount are authoritative (clamped defensively).
  //
  // BURST_VIEWER_ISSUES_STOP = false: the viewer does NOT issue a count-to-N
  // stop (the firmware self-stops at BURST_COUNT — a viewer stop would be
  // redundant and risk a double-stop). The flag/issueBurstStop machinery is
  // retained as a deliberate hedge: if a future firmware reverts to the
  // continuous Model-A behaviour (no self-stop), flipping this back to true
  // restores the viewer-issued bound with no other change. The manual ✕ cancel
  // path (noteBurstStopRequested + stopBurst) is independent of this flag and
  // always active — it's how the user stops a burst EARLY, before N.
  private static readonly BURST_VIEWER_ISSUES_STOP = false;
  private burstExpectedTotal = 0;
  private burstCompleted = 0;
  private burstCamera: 'tele' | 'wide' = 'tele';
  private burstStopIssued = false;
  private lastWindow: BrowserWindow | null = null;
  // Latest raw OperationState int from the most recent 15208/15236 STATE notif,
  // mirrored onto liveStackingProgress.state. Defaults to RUNNING(1) since a
  // progress notif implies an active job.
  private lastStackStateInt = 1;
  // Current shooting TECHNIQUE (orthogonal to shooting mode): SINGLE_SHOT=1,
  // STACKING=2, BURST=3, … Populated from the tele/wide shooting-tech-state
  // notifications (15269/15271) once the SDK registers their codecs (pending
  // burst-sdk #12). null until first observed. ensureBurstTech() waits on this
  // to confirm a BURST-tech switch landed before startBurst (BURST_SPEC §1.4).
  private shootingTech: number | null = null;

  /** Called by the IPC handler when the user starts a burst, so the
   *  notification path knows the total to draw the ring against AND which
   *  camera to auto-stop once N shots have been counted. `total` is the
   *  user-requested shot count (the viewer-side "N shots" policy); `camera`
   *  is the scope the burst was started on. */
  beginBurst(total: number, camera: 'tele' | 'wide' = 'tele'): void {
    this.burstExpectedTotal = Math.max(1, Math.floor(total));
    this.burstCompleted = 0;
    this.burstCamera = camera;
    this.burstStopIssued = false;
    this.state.burstProgress = {
      totalCount: this.burstExpectedTotal,
      completedCount: 0,
      cameraType: camera === 'wide' ? 1 : 0,
    };
    if (this.lastWindow) this.pushState(this.lastWindow);
  }

  /** Issue the stop-burst command for the camera the current burst is on.
   *  Used by the count-to-N policy (auto-stop after N progress notifs).
   *  Guarded so the continuous firmware burst is only told to stop once per
   *  burst. Best-effort / fire-and-forget: the authoritative "burst ended"
   *  signal is the 15274 BurstState→STOPPED transition, not this command's
   *  reply (BURST_SPEC §2). */
  private issueBurstStop(): void {
    if (this.burstStopIssued) return;
    this.burstStopIssued = true;
    const client = this.client;
    if (!client) return;
    const stop = this.burstCamera === 'wide'
      ? client.cameraWide.stopBurst()
      : client.cameraTele.stopBurst();
    Promise.resolve(stop).catch(() => { /* best-effort; 15274 confirms */ });
  }

  /** Mark that a stop has been requested for the current burst WITHOUT sending
   *  the command (the caller — e.g. the manual-cancel IPC handler — sends it).
   *  This sets the same guard issueBurstStop() uses, so the subsequent terminal
   *  15274 transition is recognised as end-of-burst and clears the ring. Idempotent. */
  noteBurstStopRequested(): void {
    this.burstStopIssued = true;
  }

  /** Put the device into BURST shooting technique before a startBurst, per
   *  BURST_SPEC §1.4 (live-verified): cmd 10003 is rejected with code:-1 unless
   *  the device is already in BURST tech. Technique is orthogonal to the scene
   *  mode, so we only switch the tech axis here — we do NOT send the
   *  mode-only path that burst-qa observed refused.
   *
   *  Confirmation strategy (robust, no dependency on the 15269/15271 tech-state
   *  notif codec which isn't registered yet — burst-sdk #12): switchShootingTech
   *  is a strict sendCommand whose reply is ResSwitchShootingTech{code,
   *  shootingTechId}. We trust that reply to confirm the switch landed. If the
   *  reply doesn't echo the tech (older firmware), we fall back to the passively
   *  observed `this.shootingTech` (populated once the codec lands) with a bounded
   *  wait, then proceed regardless — startBurst itself will surface a code:-1 if
   *  the tech truly didn't take, which the caller logs.
   *
   *  NOTE: the `camera` arg is currently advisory — switchShootingTech is not
   *  camera-scoped on the wire (one tech for the device). Kept in the signature
   *  so the call site reads naturally and in case a future per-camera tech
   *  appears. */
  async ensureBurstTech(_camera: 'tele' | 'wide'): Promise<void> {
    const client = this.client;
    if (!client) return;
    const BURST_TECH = ShootingTech.BURST; // =3, the typed SDK enum
    // Already in BURST per the last observed tech-state? skip the round-trip.
    if (this.shootingTech === BURST_TECH) return;
    try {
      const reply = (await client.taskCenter.switchShootingTech(BURST_TECH)) as
        { code?: number; shootingTechId?: number } | null;
      if (reply && typeof reply.shootingTechId === 'number') {
        // Reply echoes the now-active tech — authoritative, seed our state.
        this.shootingTech = reply.shootingTechId;
        return;
      }
    } catch {
      /* fall through to the passive-confirm wait */
    }
    // Reply didn't carry the tech — wait briefly for the passive tech-state
    // notification to report BURST, then proceed regardless (bounded ~2s).
    const deadline = Date.now() + 2000;
    while (this.shootingTech !== BURST_TECH && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  setStreamProxy(proxy: StreamProxyService): void {
    this.streamProxy = proxy;
  }

  /**
   * Record the ack/reply of an astro start/stop command so the UI can react
   * to error codes the firmware returns synchronously (notably
   * CODE_ASTRO_FUNCTION_BUSY = -11501, the "stuck session" condition that the
   * Recover action clears). Called from the IPC handlers right after a
   * start/stop, since these codes come back on the command REPLY, not as a
   * notification. A non-negative / zero code clears any prior error.
   */
  noteAstroResult(cmd: number, reply: unknown): void {
    const code = (reply as { code?: number } | null)?.code;
    if (typeof code === 'number' && code < 0) {
      this.state.astroError = { code, cmd, at: Date.now() };
    } else if (typeof code === 'number') {
      // A clean ack clears any stale error.
      this.state.astroError = null;
    }
    if (this.lastWindow) this.scheduleStatePush(this.lastWindow);
  }

  /** Clear the stuck-session error flag (called after a successful recover). */
  clearAstroError(): void {
    this.state.astroError = null;
    if (this.lastWindow) this.scheduleStatePush(this.lastWindow);
  }

  /** Public alias for use from IPC handlers. */
  async rearmStreams(): Promise<void> {
    return this.rearmCameraRoutes();
  }

  /** Re-publish both RTSP routes by re-sending CAMERA_*_OPEN_CAMERA. The
   *  firmware drops the routes after astro operations (live stacking, EQ
   *  solving), so this is a safe "kick" we can call after any such op. */
  private async rearmCameraRoutes(): Promise<void> {
    if (!this.client) return;
    try {
      await Promise.all([
        this.client.sendCommandNoWait(Command.CAMERA_TELE_OPEN_CAMERA, {
          rtspEncodeType: 1,
        }).catch(() => {}),
        this.client.sendCommandNoWait(Command.CAMERA_WIDE_OPEN_CAMERA, {
          rtspEncodeType: 1,
        }).catch(() => {}),
      ]);
      // Give the firmware a moment, then restart the stream proxy so it
      // re-DESCRIBEs the routes and reconnects.
      const host = this.client.host;
      setTimeout(() => {
        if (host) this.streamProxy?.startStreams(host);
      }, 1500);
    } catch {
      /* best-effort */
    }
  }

  /**
   * Deterministic stacking resync on (re)connect (STACKING_SPEC §7). Queries
   * the device task state (cmd 16405 via sdk-eng's queryStackingState) and, if
   * either camera reports an active stacking job, seeds stackingJob so the UI
   * shows the running job immediately — without waiting for the firmware's
   * passive re-push of 15208/15209. The subsequent progress notifications fill
   * in target/counts and keep elapsed advancing.
   *
   * Best-effort: if the query fails (older firmware, transient error) we fall
   * back to the passive re-push path, which still works. We never overwrite an
   * already-populated stackingJob (a live notification is more authoritative
   * than this one-shot query).
   */
  private async resyncStackingState(window: BrowserWindow): Promise<void> {
    if (!this.client) return;
    try {
      const snap = await this.client.astro.queryStackingState();
      // Prefer tele if both report active (the device runs one stack at a time;
      // both-active should not happen, but pick deterministically).
      const activeCam: 'tele' | 'wide' | null = snap.tele.active
        ? 'tele'
        : snap.wide.active
          ? 'wide'
          : null;
      if (!activeCam) return;            // nothing running — leave state as-is
      if (this.state.stackingJob) return; // a notif already populated it — don't clobber

      const cam = snap[activeCam];
      this.state.stackingJob = {
        camera: activeCam,
        state: cam.label,
        targetName: '',                  // filled by the next progress notif
        totalCount: 0,
        stackedCount: 0,
        startedAt: Date.now(),           // unknown true start; count from resync
        elapsedMs: 0,
      };
      this.scheduleStatePush(window);
    } catch {
      /* best-effort — passive 15208/15209 re-push covers the fallback */
    }
  }

  async connect(host: string, window: BrowserWindow): Promise<void> {
    this.disconnect();
    this.state = FRESH_STATE();
    this.lastWindow = window;

    this.client = new DwarfClient({
      host,
      WebSocket: WebSocket as unknown,
      reconnect: true,
      logLevel: 'info',
    });

    this.client.ws.setConnectHandler(() => {
      this.state.connected = true;
      this.pushState(window);
      if (!window.isDestroyed()) {
        window.webContents.send(IPC.SDK_CONNECTION_STATE, { connected: true });
      }
      // Stacking resync: there is NO get/query command for stacking state in
      // the protocol (verified — only PANORAMA has a GET_CURRENT_*_STATE). If a
      // job is running on the device when the WS (re)connects, the firmware
      // re-pushes 15208/15209 (+15236/15237); applyNotification rebuilds
      // stackingJob from those, so an already-running job repopulates within a
      // few seconds with no action here. We deliberately do NOT clear
      // stackingJob on the matching disconnect (below) so the UI shows
      // last-known state during a blip rather than flickering to "no job".
    });

    this.client.ws.setDisconnectHandler(() => {
      this.state.connected = false;
      this.pushState(window);
      if (!window.isDestroyed()) {
        window.webContents.send(IPC.SDK_CONNECTION_STATE, { connected: false });
      }
    });

    // Subscribe to all notifications and translate them into state updates.
    // Decoders for these are registered in the SDK codec map.
    this.unsubscribeNotifications = this.client.onAnyNotification((packet, decoded) => {
      this.applyNotification(packet.cmd, decoded);
      this.scheduleStatePush(window);
    });

    await this.client.connect();
    this.state.connected = true;

    // Capture the reply from enterCamera — it carries the current shootingMode.
    void this.client.sendCommandNoWait(Command.TASK_MANAGER_ENTER_CAMERA, {
      clientParam: { encodeType: 1 },
    }).then(async (reply) => {
      const r = reply as { shootingModeId?: number } | null;
      if (r && typeof r.shootingModeId === 'number') {
        this.state.shootingMode = r.shootingModeId;
        this.scheduleStatePush(window);
      }
      // Camera RTSP routes are gated by openCamera commands. Wide (12000) is
      // required. Tele (10000) was historically a no-op, but observed live on
      // 2026-05-28 with v1.5.0.1: after astro operations (EQ solving start/stop)
      // the RTSP server can stop publishing /ch0/stream0 — sending openCamera
      // re-registers both routes. Cheap to always send, fixes the stuck
      // "Connecting to stream..." state on reconnect.
      await Promise.all([
        this.client?.sendCommandNoWait(Command.CAMERA_TELE_OPEN_CAMERA, {
          rtspEncodeType: 1,
        }).catch(() => { /* best-effort */ }),
        this.client?.sendCommandNoWait(Command.CAMERA_WIDE_OPEN_CAMERA, {
          rtspEncodeType: 1,
        }).catch(() => { /* best-effort */ }),
      ]);

      // Push higher stream quality — guesses, will refine once tested live.
      // type=2 assumes the bitrate-type enum runs low→high; quality=100 with
      // level=0 (main stream) is the max in the proto's [0..100] range.
      // Both are best-effort — if the firmware rejects, the stream keeps the
      // default preset.
      await Promise.all([
        this.client?.sendCommandNoWait(Command.CAMERA_TELE_SET_RTSP_BITRATE_TYPE, {
          bitrateType: 2,
        }).catch(() => { /* best-effort */ }),
        this.client?.sendCommandNoWait(Command.CAMERA_WIDE_SET_RTSP_BITRATE_TYPE, {
          bitrateType: 2,
        }).catch(() => { /* best-effort */ }),
        this.client?.sendCommandNoWait(Command.CAMERA_TELE_SET_PREVIEW_QUALITY, {
          level: 0, quality: 100,
        }).catch(() => { /* best-effort */ }),
        this.client?.sendCommandNoWait(Command.CAMERA_WIDE_SET_PREVIEW_QUALITY, {
          level: 0, quality: 100,
        }).catch(() => { /* best-effort */ }),
      ]);
    }).catch(() => { /* best-effort */ });

    // Start RTSP→fMP4 proxy streams (pure Node.js, no ffmpeg). Give both
    // cameras a moment to come up — the wide openCamera (12000) reply lands
    // ~50ms after WS connect, but the device's RTSP server takes another
    // ~1s before /ch0 and /ch1 actually accept DESCRIBE. 2500ms covers it.
    setTimeout(() => this.streamProxy?.startStreams(host), 2500);

    // Stacking resync (STACKING_SPEC §7): deterministically seed stackingJob
    // from the device's current task state, rather than only waiting for the
    // firmware to passively re-push 15208/15209. This makes "connect while a
    // job is already running" show the running job within ~2s. The passive
    // re-push still fills in counts/target as progress notifs arrive.
    void this.resyncStackingState(window);

    // App-level heartbeat. The firmware doesn't strictly need this on v1.5
    // (TCP-level keepalive holds the WS) but the official app does it, so we match.
    this.pingInterval = setInterval(() => {
      try {
        this.client?.ws.sendRawText('ping');
      } catch {
        // Ignore if not connected
      }
    }, 5000);

    this.pushState(window);
  }

  private applyNotification(cmd: number, decoded: unknown): void {
    // Decoded payloads come straight from the proto messages. Field names
    // verified live against firmware v1.5.0.1.
    const d = decoded as Record<string, unknown>;
    switch (cmd) {
      case 15201: // NOTIFY_ELE (BatteryInfo)
        if (typeof d.percentage === 'number') this.state.batteryPercentage = d.percentage;
        break;
      case 15202: // NOTIFY_CHARGE (ChargingState)
        if (typeof d.state === 'number') this.state.charging = d.state > 0;
        break;
      case 15203: // NOTIFY_SDCARD_INFO (StorageInfo)
        if (typeof d.totalSize === 'number') this.state.sdCardTotalGB = d.totalSize;
        if (typeof d.availableSize === 'number') this.state.sdCardAvailableGB = d.availableSize;
        if (typeof d.isValid === 'boolean') this.state.sdCardPresent = d.isValid;
        else if (typeof d.totalSize === 'number') this.state.sdCardPresent = d.totalSize > 0;
        break;
      case 15243: // NOTIFY_TEMPERATURE
        if (typeof d.temperature === 'number') this.state.temperature = d.temperature;
        break;
      case 15257: // NOTIFY_FOCUS_POSITION
        if (typeof d.pos === 'number') this.state.focusPosition = d.pos;
        break;
      case 15264: { // NOTIFY_GENERAL_INT_PARAM — echoed param changes
        // paramId comes through as string (Long.toString()); decode it
        const raw = d.paramId;
        if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'bigint') {
          try {
            const t = unpackParamId(raw as string | number | bigint);
            const v = typeof d.value === 'number' ? d.value : 0;
            if (t.paramId === PARAM_FILTER_TYPE) this.state.filterType = v;
          } catch { /* ignore malformed */ }
        }
        break;
      }
      case 15267: // NOTIFY_SWITCH_SHOOTING_MODE
        if (typeof d.dstMode === 'number') this.state.shootingMode = d.dstMode;
        break;
      case 15292: // NOTIFY_CMOS_TEMPERATURE
        if (typeof d.temperature === 'number') this.state.cmosTemperature = d.temperature;
        break;

      // --- Astro pipeline notifications ---
      // 15210 NOTIFY_STATE_ASTRO_CALIBRATION → CalibrationState
      // (final result arrives separately as 15256 NOTIFY_CALIBRATION_RESULT)
      case 15210: {
        const state = typeof d.state === 'number' ? d.state : 0;
        const plateSolvingTimes = typeof d.plateSolvingTimes === 'number' ? d.plateSolvingTimes : 0;
        this.state.calibrationState = { state, plateSolvingTimes };
        break;
      }

      // 15211 NOTIFY_STATE_ASTRO_GOTO → GotoState (state + targetName)
      case 15211: {
        const state = typeof d.state === 'number' ? d.state : 0;
        const targetName = typeof d.targetName === 'string' ? d.targetName : '';
        this.state.gotoState = { state, targetName };
        break;
      }

      // 15208 NOTIFY_STATE_CAPTURE_RAW_LIVE_STACKING → tele stacking lifecycle
      // 15236 NOTIFY_STATE_WIDE_CAPTURE_RAW_LIVE_STACKING → wide variant
      // proto: OperationStateNotify { state } — NO cameraType field, so the
      // camera is keyed off the cmd id (15208=tele, 15236=wide). State enum
      // (dwarflab.notify.OperationState, per sdk-eng SDK_STACKING_NOTES):
      //   0 IDLE · 1 RUNNING · 2 STOPPING · 3 STOPPED.
      // The enum does NOT distinguish success from failure — both → STOPPED.
      //
      // We maintain stackingJob as the authoritative lifecycle descriptor.
      // On RUNNING we (re)create/refresh it (this also rebuilds it on reconnect
      // when the firmware re-pushes the running state — the resync path, since
      // there is no GET/query command). On a terminal state (STOPPED/IDLE) we
      // clear both the job and the progress.
      //
      // Live observation 2026-05-29: starting either tele or wide live
      // stacking knocks the device's RTSP server off — afterwards
      // /ch0/stream0 and /ch1/stream0 return empty / 454 until openCamera is
      // re-sent. So on every terminal transition we re-arm both routes by
      // firing CAMERA_*_OPEN_CAMERA again. Cheap, idempotent.
      case 15208:
      case 15236: {
        const stateInt = typeof d.state === 'number' ? d.state : 0;
        this.lastStackStateInt = stateInt;
        // Mirror the raw int onto an existing progress object so consumers that
        // read liveStackingProgress.state see the lifecycle immediately.
        if (this.state.liveStackingProgress) {
          this.state.liveStackingProgress.state = stateInt;
        }
        const camera: 'tele' | 'wide' = cmd === 15236 ? 'wide' : 'tele';
        const label = describeLiveStackingState(stateInt);
        const active = stateInt === LiveStackingState.RUNNING
          || stateInt === LiveStackingState.STOPPING;

        if (active) {
          const prev = this.state.stackingJob;
          // Preserve startedAt/counts/target across repeated RUNNING notifs and
          // across a reconnect-driven re-push. Reset them if the camera changed
          // (a new job on the other scope).
          const carry = prev && prev.camera === camera ? prev : null;
          const startedAt = carry?.startedAt
            ?? (stateInt === LiveStackingState.RUNNING ? Date.now() : null);
          this.state.stackingJob = {
            camera,
            state: label,
            targetName: carry?.targetName ?? this.state.liveStackingProgress?.targetName ?? '',
            totalCount: carry?.totalCount ?? 0,
            stackedCount: carry?.stackedCount ?? 0,
            startedAt,
            elapsedMs: startedAt ? Math.max(0, Date.now() - startedAt) : 0,
          };
        } else {
          // Terminal (STOPPED/IDLE). Clear job + progress, re-arm RTSP routes.
          this.state.stackingJob = null;
          this.state.liveStackingProgress = null;
          void this.rearmCameraRoutes();
        }
        break;
      }

      // 15209 NOTIFY_PROGRASS_CAPTURE_RAW_LIVE_STACKING (tele)
      // 15237 NOTIFY_PROGRASS_WIDE_CAPTURE_RAW_LIVE_STACKING (wide)
      // ProgressCaptureRawLiveStacking — carries cameraType. We keep the full
      // liveStackingProgress object (legacy consumers: LiveStackPreview,
      // AstroPanel, ControlBar) AND fold target/counts into stackingJob.
      //
      // ⚠️ LIVE-VERIFIED (qa2, 2026-05-29): the firmware sends these as SPARSE
      // FIELD DELTAS, not a complete struct per notification — e.g. first
      // {updateType:2}, then {currentCount:1}, then {updateType:1,stackedCount:1}.
      // So we must MERGE each delta over the previous values: an absent field
      // means "unchanged", NOT "zero". Rebuilding the object from scratch with
      // zero-defaults each notif would flicker counts/target to 0 between deltas.
      //
      // Resync note: if the WS reconnects mid-job and the firmware re-pushes a
      // progress notif before any state notif, stackingJob is still null here —
      // so we lazily reconstruct it as 'running' from the accumulated payload.
      case 15209:
      case 15237: {
        // cameraType may itself be omitted from a delta; fall back to the
        // previous progress's cameraType, then the cmd-id default.
        const prevProg = this.state.liveStackingProgress;
        const cameraType = typeof d.cameraType === 'number'
          ? d.cameraType
          : prevProg?.cameraType ?? (cmd === 15237 ? 1 : 0);

        // num(field): use the delta's value if present, else carry prevProg's,
        // else 0. str() is the string analogue.
        const num = (key: string, fallback: number): number =>
          typeof d[key] === 'number' ? (d[key] as number) : fallback;
        const str = (key: string, fallback: string): string =>
          typeof d[key] === 'string' ? (d[key] as string) : fallback;

        const merged = {
          totalCount: num('totalCount', prevProg?.totalCount ?? 0),
          currentCount: num('currentCount', prevProg?.currentCount ?? 0),
          stackedCount: num('stackedCount', prevProg?.stackedCount ?? 0),
          expIndex: num('expIndex', prevProg?.expIndex ?? 0),
          gainIndex: num('gainIndex', prevProg?.gainIndex ?? 0),
          targetName: str('targetName', prevProg?.targetName ?? ''),
          shootingTime: num('shootingTime', prevProg?.shootingTime ?? 0),
          stackedTime: num('stackedTime', prevProg?.stackedTime ?? 0),
          cameraType,
          // A progress notif implies the job is active; carry the latest known
          // raw state (RUNNING unless a STOPPING notif arrived in between).
          state: this.lastStackStateInt,
        };
        this.state.liveStackingProgress = merged;

        // Fold the accumulated counts/target into the job descriptor.
        // Reconstruct the descriptor if a progress notif arrives before any
        // state notif (e.g. on reconnect resync).
        const camera: 'tele' | 'wide' = cameraType === 1 ? 'wide' : 'tele';
        const prev = this.state.stackingJob && this.state.stackingJob.camera === camera
          ? this.state.stackingJob : null;
        const startedAt = prev?.startedAt ?? Date.now();
        this.state.stackingJob = {
          camera,
          state: prev?.state ?? describeLiveStackingState(LiveStackingState.RUNNING),
          // Use the MERGED (accumulated) values, so a sparse delta that omits
          // target/totalCount doesn't blank them in the descriptor either.
          targetName: merged.targetName || prev?.targetName || '',
          totalCount: merged.totalCount || prev?.totalCount || 0,
          stackedCount: merged.stackedCount,
          startedAt,
          elapsedMs: Math.max(0, Date.now() - startedAt),
        };
        break;
      }

      // 15239 NOTIFY_EQ_SOLVING_STATE → EQ polar-align state (0..8)
      case 15239: {
        const state = typeof d.state === 'number' ? d.state : 0;
        this.state.eqSolvingState = { state };
        break;
      }

      // 15256 NOTIFY_CALIBRATION_RESULT → final azi/alt error after plate solve
      case 15256: {
        const azi = typeof d.azi === 'number' ? d.azi : 0;
        const alt = typeof d.alt === 'number' ? d.alt : 0;
        this.state.calibrationResult = { azi, alt };
        break;
      }

      // 15218 / 15220 / 15285 NOTIFY_BURST_PROGRESS variants
      // proto: BurstProgress { totalCount, completedCount, cameraType }
      //
      // LIVE-CONFIRMED (burst-qa round-2, v1.5.0.1 — Model B): the firmware
      // sends a REAL totalCount (= the BURST_COUNT we set) and a running
      // completedCount (1→2→…→N), then SELF-STOPS at N (15274 → terminal). So
      // the device is authoritative for both progress and completion; the
      // viewer just reflects the firmware's values.
      //
      // We prefer the firmware's totalCount/completedCount directly. The
      // beginBurst() seed (burstExpectedTotal) is only a fallback to fill the
      // ring for the instant before the first notif, and to cover a sparse
      // delta that omits a field. Display is clamped (completed ≤ total) so a
      // stray/overshoot value can never render >100%.
      case 15218:
      case 15220:
      case 15285: {
        const cameraType = typeof d.cameraType === 'number'
          ? d.cameraType : (cmd === 15220 ? 1 : 0);
        const prev = this.state.burstProgress;
        // Total: firmware value if present, else the prior notif's, else the
        // beginBurst seed. completed: firmware running count if present, else
        // carry the prior (a sparse delta shouldn't reset it).
        const fwTotal = typeof d.totalCount === 'number' && d.totalCount > 0 ? d.totalCount : 0;
        const total = fwTotal || prev?.totalCount || this.burstExpectedTotal || 0;
        const fwCompleted = typeof d.completedCount === 'number' ? d.completedCount : (prev?.completedCount ?? 0);
        // Clamp completed into [0, total] (total falls back to completed if we
        // somehow have no total yet, so the ring is never >100%).
        const completed = total > 0 ? Math.min(total, Math.max(0, fwCompleted)) : Math.max(0, fwCompleted);
        // Mirror the firmware-authoritative count into our local accumulator so
        // any flag-gated logic and logging stay consistent.
        this.burstCompleted = completed;
        if (total > 0 && this.burstExpectedTotal === 0) this.burstExpectedTotal = total;
        console.log(`[burst] cmd=${cmd} fw completed=${completed}/${total} cam=${cameraType}`);
        this.state.burstProgress = { totalCount: total, completedCount: completed, cameraType };

        // Firmware self-stops at BURST_COUNT (Model B), so BURST_VIEWER_ISSUES_STOP
        // is false and this is skipped. Retained as a hedge: if a future firmware
        // reverts to continuous/no-self-stop, flipping the flag true restores a
        // viewer-issued stop at N. The ring is NOT cleared here either way —
        // clearing is driven by the 15274 terminal transition.
        if (total > 0 && completed >= total && SdkService.BURST_VIEWER_ISSUES_STOP) {
          this.issueBurstStop();
        }
        break;
      }

      // 15274 NOTIFY_BURST_STATE — proto: BurstState { state, cameraType }
      // where `state` is the shared OperationState enum (BURST_SPEC §3.1):
      //   IDLE=0 · RUNNING=1 · STOPPING=2 · STOPPED=3.
      // RUNNING/STOPPING = burst active; IDLE/STOPPED = terminal. This is the
      // AUTHORITATIVE end-of-burst signal (§3.4): a finished, user-stopped, or
      // firmware-ended-early burst all land on STOPPED→idle, which is what
      // clears the progress ring cleanly (fixes the prior stuck-ring bug where
      // the ring only cleared on completed>=expected and could hang if the
      // device stopped early).
      //
      // Uses the SDK's isBurstActive() (mirrors isLiveStackingActive): true for
      // RUNNING/STOPPING, false for IDLE/STOPPED. Keeps burst and stacking on
      // identical active-vs-terminal logic.
      //
      // LIVE-CONFIRMED (burst-qa round-2, BURST_QA.md §4.4): the firmware fires
      // exactly BURST_COUNT shots, then emits a SINGLE terminal 15274 (observed
      // as an empty {} payload → no state field → decodes non-active). It does
      // NOT cycle RUNNING→STOPPED per shot. The full 3-shot trace was:
      //   15274{state:1} · 15285{3,1} · 15285{3,2} · 15285{3,3} · 15274{}
      //
      // So the terminal 15274 is an unambiguous end-of-burst signal — we clear
      // the ring on ANY non-active 15274 (isBurstActive()=false), no guard
      // needed. This also covers early user-cancel: the firmware emits the same
      // terminal after the stop. (We dropped the earlier stopIssued||reachedTarget
      // guard — it was defence against a per-shot-cycling firmware that QA has
      // now ruled out; clearing on terminal is both simpler and strictly more
      // robust against a stuck ring.)
      case 15274: {
        const stateInt = typeof d.state === 'number' ? d.state : -1;
        const active = isBurstActive(stateInt);
        console.log(`[burst] cmd=15274 state=${stateInt} active=${active}`);
        if (!active && this.state.burstProgress) {
          // Terminal: burst is over (self-stopped at N, or user-cancelled early
          // — both land here). Clear the ring + reset the local seed/guard fields.
          this.state.burstProgress = null;
          this.burstExpectedTotal = 0;
          this.burstCompleted = 0;
          this.burstStopIssued = false;
        }
        break;
      }
    }
  }

  private scheduleStatePush(window: BrowserWindow): void {
    // Debounce: notifications can arrive in bursts (~13 NOTIFY_GENERAL_INT_PARAM
    // per mode switch). Coalesce to one IPC push every 100ms.
    if (this.pushTimer) return;
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      this.pushState(window);
    }, 100);
  }

  private pushState(window: BrowserWindow): void {
    if (window.isDestroyed()) return;
    window.webContents.send(IPC.SDK_DEVICE_STATE, { ...this.state });
  }

  disconnect(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.pushTimer) {
      clearTimeout(this.pushTimer);
      this.pushTimer = null;
    }
    this.unsubscribeNotifications?.();
    this.unsubscribeNotifications = null;
    this.streamProxy?.stopStreams();
    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }
    this.state = FRESH_STATE();
  }

  get connected(): boolean {
    return this.client?.connected ?? false;
  }

  get host(): string | null {
    return this.client?.host ?? null;
  }

  /** Current shooting mode tracked from notifications. Falls back to 1 (Normal). */
  get shootingMode(): number {
    return this.state.shootingMode ?? 1;
  }

  /**
   * Current filter-wheel index tracked from NOTIFY_GENERAL_INT_PARAM (paramId
   * 13): 0=VIS, 1=ASTRO, 2=DUO_BAND, 3=DARK. Threaded into live stacking as the
   * official app's `irIndex` (it sends its current filter index here). null if we
   * haven't observed a filter notification yet — caller falls back to -1
   * ("filter unknown"), which the firmware accepts.
   */
  get filterType(): number | null {
    return this.state.filterType;
  }

  getClient(): DwarfClient {
    if (!this.client || !this.client.connected) {
      throw new Error('SDK not connected');
    }
    return this.client;
  }
}
