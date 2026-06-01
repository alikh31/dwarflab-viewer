export interface SerializedBleDevice {
  name: string;
  address: string;
  rssi: number;
}

export interface DiscoveredDevice {
  name: string;
  ip: string;
  mac: string;
  firmware: string;
}

export interface DeviceStateSnapshot {
  batteryPercentage: number | null;
  charging: boolean | null;
  sdCardPresent: boolean | null;
  sdCardAvailableGB: number | null;
  sdCardTotalGB: number | null;
  temperature: number | null;       // system temp °C
  cmosTemperature: number | null;   // sensor temp °C
  shootingMode: number | null;      // 1=Normal, 2=Astro, 4=Milky Way, ...
  focusPosition: number | null;
  filterType: number | null;        // 0=VIS, 1=Astro, 2=Duo (echoed via 15264)
  connected: boolean;
  // Astro pipeline. Must stay in sync field-for-field with the snapshot
  // built in main/services/sdk-service.ts.
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
    cameraType: number;        // 0 = tele, 1 = wide
    // Raw OperationState int (0=IDLE,1=RUNNING,2=STOPPING,3=STOPPED) mirrored
    // from the latest 15208/15236 STATE notif. NOTE (per sdk-eng/spec): the
    // firmware enum has NO success/fail/cancelled — a finished stack (clean or
    // failed) lands on STOPPED(3). So do not expect SUCCESS/FAILED values here.
    state: number;
  } | null;
  // Authoritative live-stacking job descriptor — driven by the 15208/15236
  // STATE notification (lifecycle), enriched by 15209/15237 progress. Persists
  // across the gap before the first progress notif AND across reconnect, so
  // this — not liveStackingProgress's nullness — is the reliable "is a job
  // running / on which camera" signal. null = no job / fully cleared.
  // Kept field-for-field in sync with the copies in
  // main/services/sdk-service.ts and useDeviceState.ts defaults.
  stackingJob: {
    camera: 'tele' | 'wide';
    // 'idle' | 'running' | 'stopping' | 'stopped' | 'unknown(<n>)'.
    // NOTE: firmware OperationState does NOT distinguish success from failure —
    // both terminal outcomes report 'stopped'.
    state: string;
    targetName: string;
    totalCount: number;
    stackedCount: number;
    startedAt: number | null; // epoch ms; tick elapsed locally from this
    elapsedMs: number;        // main-process snapshot of now - startedAt
  } | null;
  // Last astro error code (e.g. -11501 CODE_ASTRO_FUNCTION_BUSY = stuck
  // session). UI shows the Recover affordance when astroError?.code === -11501.
  // Cleared on a clean start or after recover.
  astroError: { code: number; cmd: number; at: number } | null;
  calibrationResult: { azi: number; alt: number } | null;
  astroLocation: { lon: number; lat: number } | null;
  // Burst-photo progress. Reset to null when the burst ends. Used by the
  // shutter button to draw a ring of green progress cells.
  burstProgress: {
    totalCount: number;
    completedCount: number;
    cameraType: number;
  } | null;
}

export interface DwarfApi {
  stream: {
    getProxyPort(): Promise<number>;
    rearm(): Promise<void>;
  };
  discovery: {
    start(timeout?: number): Promise<void>;
    stop(): Promise<void>;
    onDeviceFound(callback: (device: DiscoveredDevice) => void): () => void;
  };
  ble: {
    scan(timeout?: number): Promise<SerializedBleDevice[]>;
    connect(address: string): Promise<void>;
    setWifiSta(ssid: string, password: string): Promise<void>;
    setWifiAp(ssid: string, password: string): Promise<void>;
    getConfig(): Promise<unknown>;
    getApInfo(): Promise<{ ssid: string; password: string }>;
    scanWifi(): Promise<Array<{ ssid: string; signal: number; security: string }>>;
    disconnect(): Promise<void>;
  };
  sdk: {
    connect(host: string): Promise<void>;
    disconnect(): Promise<void>;
    getDeviceInfo(): Promise<unknown>;
    openTeleCamera(): Promise<void>;
    openWideCamera(): Promise<void>;
    closeTeleCamera(): Promise<void>;
    closeWideCamera(): Promise<void>;
    takePhotoTele(): Promise<void>;
    takePhotoWide(): Promise<void>;
    startBurstTele(count: number): Promise<void>;
    stopBurstTele(): Promise<void>;
    startBurstWide(count: number): Promise<void>;
    stopBurstWide(): Promise<void>;

    // Shooting mode
    getShootingModes(): Promise<unknown>;
    switchMode(mode: number): Promise<unknown>;
    // Shooting technique (SINGLE_SHOT=1, STACKING=2, BURST=3, …). Enter the
    // BURST technique before startBurst (BURST_SPEC §1.4).
    switchTech(tech: number): Promise<unknown>;

    // Camera parameters
    setExposureMode(camera: string, mode: number): Promise<void>;
    setExposure(camera: string, value: number): Promise<void>;
    setGainMode(camera: string, mode: number): Promise<void>;
    setGain(camera: string, value: number): Promise<void>;
    setBrightness(camera: string, value: number): Promise<void>;
    setContrast(camera: string, value: number): Promise<void>;
    setSaturation(camera: string, value: number): Promise<void>;
    setHue(camera: string, value: number): Promise<void>;
    setSharpness(camera: string, value: number): Promise<void>;
    setIRCut(camera: string, mode: number): Promise<void>;

    // Filter
    setFilter(value: number): Promise<unknown>;

    // Focus
    focusAuto(): Promise<unknown>;
    focusManualStart(direction: number): Promise<void>;
    focusManualStop(): Promise<void>;
    focusStep(direction: number): Promise<void>;
    focusAstroAutoStart(): Promise<void>;
    focusAstroAutoStop(): Promise<void>;

    // Tracking
    stopTracking(): Promise<void>;
    startSentry(): Promise<unknown>;
    stopSentry(): Promise<void>;
    startMot(): Promise<unknown>;
    startUfoTrack(): Promise<unknown>;
    stopUfoTrack(): Promise<void>;

    onConnectionState(callback: (state: { connected: boolean }) => void): () => void;
    onDeviceState(callback: (state: DeviceStateSnapshot) => void): () => void;

    // Album / media
    albumCounts(): Promise<AlbumCount[]>;
    albumList(mediaType: number, pageIndex: number, pageSize?: number): Promise<AlbumItem[]>;
    albumFileUrl(devicePath: string): Promise<string>;
    albumDelete(items: Array<{ filePath: string; fileName?: string; mediaType: number; subType?: number }>): Promise<unknown>;
    albumDownload(devicePath: string, suggestedName: string): Promise<{ ok: boolean; savedTo?: string; error?: string }>;
    albumOpenExternal(devicePath: string, suggestedName: string): Promise<{ ok: boolean; error?: string }>;

    // Motor joystick
    motorJoystick(vectorAngle: number, vectorLength: number): Promise<unknown>;
    motorJoystickStop(): Promise<unknown>;

    // Tracking (sentry by object-type and click-to-track)
    trackSentryStart(type: number): Promise<unknown>;
    trackClick(x: number, y: number, camId: number): Promise<unknown>;

    // Astro pipeline. lon/lat in decimal degrees where required.
    astro: {
      calibrationStart(lon: number, lat: number): Promise<unknown>;
      calibrationStop(): Promise<unknown>;
      eqSolvingStart(lon: number, lat: number): Promise<unknown>;
      eqSolvingStop(): Promise<unknown>;
      gotoDso(ra: number, dec: number, name?: string): Promise<unknown>;
      gotoSolar(index: number, lon: number, lat: number, name?: string): Promise<unknown>;
      gotoStop(): Promise<unknown>;
      goLive(): Promise<unknown>;
      // Start. forceStart skips firmware preflight (gate in UX first!);
      // irIndex is the IR-filter index (tele only, -1 = none).
      liveStackingTeleStart(opts?: { forceStart?: boolean; irIndex?: number }): Promise<{ code: number } | null>;
      liveStackingTeleStop(): Promise<unknown>;        // FAST stop (11037)
      liveStackingWideStart(opts?: { forceStart?: boolean }): Promise<{ code: number } | null>;
      liveStackingWideStop(): Promise<unknown>;        // FAST stop (11038)
      // Slow "finalize & save" stop (11006 / 11017) — flushes queued frames.
      liveStackingTeleStopSlow(): Promise<unknown>;
      liveStackingWideStopSlow(): Promise<unknown>;
      // Recover from a stuck session (-11501). Best-effort; never throws.
      recoverStacking(): Promise<{ issued: string[]; failed: string[] }>;
      // On-demand per-camera stacking-state query (cmd 16405). state =
      // OperationState int; label = 'idle'|'running'|'stopping'|'stopped';
      // active = running||stopping. Rejects on transport error.
      queryStackingState(): Promise<{
        tele: { state: number; label: string; active: boolean };
        wide: { state: number; label: string; active: boolean };
      }>;
    };

    // System-level commands.
    system: {
      setLocation(lon: number, lat: number): Promise<unknown>;
    };
  };

  // Local JSON-file settings store (userData/settings.json).
  settings: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
  };
}

export interface AlbumCount {
  mediaType: number;
  count: number;
}

export interface AlbumItem {
  fileName: string;
  filePath: string;
  fileSize: number;
  mediaType: number;
  modificationTime: number;
  thumbnailPath?: string;
  camId?: number;
  astroTargetName?: string;
  astroSubType?: number;
  astroImageDetails?: {
    target?: string;
    floatHourRa?: number;
    floatDegreeDec?: number;
    shotsTaken?: number;
    shotsStacked?: number;
    shotsToTake?: number;
    totalExp?: number;
    params?: { binning?: string; exp?: string; filter?: string; format?: string; gain?: string; height?: number; width?: number };
  };
}

declare global {
  interface Window {
    api: DwarfApi;
  }
}
