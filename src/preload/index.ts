import { contextBridge, ipcRenderer } from 'electron';

const IPC = {
  BLE_SCAN_START: 'ble:scan:start',
  BLE_CONNECT: 'ble:connect',
  BLE_DISCONNECT: 'ble:disconnect',
  BLE_SET_WIFI_STA: 'ble:wifi:sta',
  BLE_SET_WIFI_AP: 'ble:wifi:ap',
  BLE_GET_CONFIG: 'ble:config:get',
  BLE_GET_AP_INFO: 'ble:ap:info',
  BLE_SCAN_WIFI: 'ble:wifi:scan',
  SDK_CONNECT: 'sdk:connect',
  SDK_DISCONNECT: 'sdk:disconnect',
  SDK_CONNECTION_STATE: 'sdk:connection:state',
  SDK_DEVICE_INFO: 'sdk:device:info',
  SDK_DEVICE_STATE: 'sdk:device:state',
  SDK_CAMERA_TELE_OPEN: 'sdk:camera:tele:open',
  SDK_CAMERA_TELE_CLOSE: 'sdk:camera:tele:close',
  SDK_CAMERA_TELE_PHOTO: 'sdk:camera:tele:photo',
  SDK_CAMERA_TELE_BURST_START: 'sdk:camera:tele:burst:start',
  SDK_CAMERA_TELE_BURST_STOP: 'sdk:camera:tele:burst:stop',
  SDK_CAMERA_WIDE_OPEN: 'sdk:camera:wide:open',
  SDK_CAMERA_WIDE_CLOSE: 'sdk:camera:wide:close',
  SDK_CAMERA_WIDE_PHOTO: 'sdk:camera:wide:photo',
  SDK_CAMERA_WIDE_BURST_START: 'sdk:camera:wide:burst:start',
  SDK_CAMERA_WIDE_BURST_STOP: 'sdk:camera:wide:burst:stop',
  STREAM_PROXY_PORT: 'stream:proxy:port',
  STREAM_REARM: 'stream:rearm',

  // Shooting mode
  SDK_GET_MODES: 'sdk:mode:list',
  SDK_SWITCH_MODE: 'sdk:mode:switch',
  SDK_SWITCH_TECH: 'sdk:tech:switch',

  // Camera parameters
  SDK_SET_EXPOSURE: 'sdk:param:exposure',
  SDK_SET_GAIN: 'sdk:param:gain',
  SDK_SET_BRIGHTNESS: 'sdk:param:brightness',
  SDK_SET_CONTRAST: 'sdk:param:contrast',
  SDK_SET_SATURATION: 'sdk:param:saturation',
  SDK_SET_HUE: 'sdk:param:hue',
  SDK_SET_SHARPNESS: 'sdk:param:sharpness',
  SDK_SET_EXP_MODE: 'sdk:param:exp-mode',
  SDK_SET_GAIN_MODE: 'sdk:param:gain-mode',
  SDK_SET_IRCUT: 'sdk:param:ircut',

  // Tracking
  SDK_TRACK_STOP: 'sdk:track:stop',
  SDK_TRACK_SENTRY_START: 'sdk:track:sentry:start',
  SDK_TRACK_SENTRY_STOP: 'sdk:track:sentry:stop',
  SDK_TRACK_MOT_START: 'sdk:track:mot:start',
  SDK_TRACK_UFO_START: 'sdk:track:ufo:start',
  SDK_TRACK_UFO_STOP: 'sdk:track:ufo:stop',

  // Focus
  SDK_FOCUS_AUTO: 'sdk:focus:auto',
  SDK_FOCUS_MANUAL_START: 'sdk:focus:manual:start',
  SDK_FOCUS_MANUAL_STOP: 'sdk:focus:manual:stop',
  SDK_FOCUS_STEP: 'sdk:focus:step',
  SDK_FOCUS_ASTRO_AUTO_START: 'sdk:focus:astro:start',
  SDK_FOCUS_ASTRO_AUTO_STOP: 'sdk:focus:astro:stop',

  // Filter
  SDK_SET_FILTER: 'sdk:filter:set',

  SDK_ALBUM_COUNTS: 'sdk:album:counts',
  SDK_ALBUM_LIST: 'sdk:album:list',
  SDK_ALBUM_FILE_URL: 'sdk:album:fileUrl',
  SDK_ALBUM_DELETE: 'sdk:album:delete',
  SDK_ALBUM_DOWNLOAD: 'sdk:album:download',
  SDK_ALBUM_OPEN_EXTERNAL: 'sdk:album:openExternal',

  SDK_MOTOR_JOYSTICK: 'sdk:motor:joystick',
  SDK_MOTOR_JOYSTICK_STOP: 'sdk:motor:joystick:stop',

  SDK_TRACK_SENTRY_START_TYPED: 'sdk:track:sentry:start:typed',
  SDK_TRACK_CLICK: 'sdk:track:click',

  // Astro
  SDK_ASTRO_CALIBRATION_START: 'sdk:astro:calibration:start',
  SDK_ASTRO_CALIBRATION_STOP: 'sdk:astro:calibration:stop',
  SDK_ASTRO_EQ_SOLVING_START: 'sdk:astro:eq:start',
  SDK_ASTRO_EQ_SOLVING_STOP: 'sdk:astro:eq:stop',
  SDK_ASTRO_GOTO_DSO: 'sdk:astro:goto:dso',
  SDK_ASTRO_GOTO_SOLAR: 'sdk:astro:goto:solar',
  SDK_ASTRO_GOTO_STOP: 'sdk:astro:goto:stop',
  SDK_ASTRO_GO_LIVE: 'sdk:astro:goLive',
  SDK_ASTRO_LIVE_STACKING_TELE_START: 'sdk:astro:liveStacking:tele:start',
  SDK_ASTRO_LIVE_STACKING_TELE_STOP: 'sdk:astro:liveStacking:tele:stop',
  SDK_ASTRO_LIVE_STACKING_WIDE_START: 'sdk:astro:liveStacking:wide:start',
  SDK_ASTRO_LIVE_STACKING_WIDE_STOP: 'sdk:astro:liveStacking:wide:stop',
  SDK_ASTRO_LIVE_STACKING_TELE_STOP_SLOW: 'sdk:astro:liveStacking:tele:stop:slow',
  SDK_ASTRO_LIVE_STACKING_WIDE_STOP_SLOW: 'sdk:astro:liveStacking:wide:stop:slow',
  SDK_ASTRO_RECOVER: 'sdk:astro:recover',
  SDK_ASTRO_QUERY_STACKING: 'sdk:astro:queryStacking',

  // System
  SDK_SYSTEM_SET_LOCATION: 'sdk:system:setLocation',

  // Settings (local)
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',

  DISCOVERY_START: 'discovery:start',
  DISCOVERY_STOP: 'discovery:stop',
  DISCOVERY_DEVICE_FOUND: 'discovery:device:found',
} as const;

contextBridge.exposeInMainWorld('api', {
  discovery: {
    start: (timeout?: number) => ipcRenderer.invoke(IPC.DISCOVERY_START, timeout),
    stop: () => ipcRenderer.invoke(IPC.DISCOVERY_STOP),
    onDeviceFound: (
      callback: (device: { name: string; ip: string; mac: string; firmware: string }) => void,
    ) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        device: { name: string; ip: string; mac: string; firmware: string },
      ) => callback(device);
      ipcRenderer.on(IPC.DISCOVERY_DEVICE_FOUND, handler);
      return () => {
        ipcRenderer.removeListener(IPC.DISCOVERY_DEVICE_FOUND, handler);
      };
    },
  },
  ble: {
    scan: (timeout?: number) => ipcRenderer.invoke(IPC.BLE_SCAN_START, timeout),
    connect: (address: string) => ipcRenderer.invoke(IPC.BLE_CONNECT, address),
    setWifiSta: (ssid: string, password: string) =>
      ipcRenderer.invoke(IPC.BLE_SET_WIFI_STA, ssid, password),
    setWifiAp: (ssid: string, password: string) =>
      ipcRenderer.invoke(IPC.BLE_SET_WIFI_AP, ssid, password),
    getConfig: () => ipcRenderer.invoke(IPC.BLE_GET_CONFIG),
    getApInfo: (): Promise<{ ssid: string; password: string }> =>
      ipcRenderer.invoke(IPC.BLE_GET_AP_INFO),
    scanWifi: (): Promise<Array<{ ssid: string; signal: number; security: string }>> =>
      ipcRenderer.invoke(IPC.BLE_SCAN_WIFI),
    disconnect: () => ipcRenderer.invoke(IPC.BLE_DISCONNECT),
  },
  stream: {
    getProxyPort: (): Promise<number> => ipcRenderer.invoke(IPC.STREAM_PROXY_PORT),
    rearm: (): Promise<void> => ipcRenderer.invoke(IPC.STREAM_REARM),
  },
  sdk: {
    connect: (host: string) => ipcRenderer.invoke(IPC.SDK_CONNECT, host),
    disconnect: () => ipcRenderer.invoke(IPC.SDK_DISCONNECT),
    getDeviceInfo: () => ipcRenderer.invoke(IPC.SDK_DEVICE_INFO),
    openTeleCamera: () => ipcRenderer.invoke(IPC.SDK_CAMERA_TELE_OPEN),
    openWideCamera: () => ipcRenderer.invoke(IPC.SDK_CAMERA_WIDE_OPEN),
    closeTeleCamera: () => ipcRenderer.invoke(IPC.SDK_CAMERA_TELE_CLOSE),
    closeWideCamera: () => ipcRenderer.invoke(IPC.SDK_CAMERA_WIDE_CLOSE),
    takePhotoTele: () => ipcRenderer.invoke(IPC.SDK_CAMERA_TELE_PHOTO),
    takePhotoWide: () => ipcRenderer.invoke(IPC.SDK_CAMERA_WIDE_PHOTO),
    startBurstTele: (count: number) => ipcRenderer.invoke(IPC.SDK_CAMERA_TELE_BURST_START, count),
    stopBurstTele: () => ipcRenderer.invoke(IPC.SDK_CAMERA_TELE_BURST_STOP),
    startBurstWide: (count: number) => ipcRenderer.invoke(IPC.SDK_CAMERA_WIDE_BURST_START, count),
    stopBurstWide: () => ipcRenderer.invoke(IPC.SDK_CAMERA_WIDE_BURST_STOP),

    // Shooting mode
    getShootingModes: () => ipcRenderer.invoke(IPC.SDK_GET_MODES),
    switchMode: (mode: number) => ipcRenderer.invoke(IPC.SDK_SWITCH_MODE, mode),
    // Shooting technique (SINGLE_SHOT=1, STACKING=2, BURST=3, …). Used to enter
    // the BURST technique before startBurst (BURST_SPEC §1.4).
    switchTech: (tech: number) => ipcRenderer.invoke(IPC.SDK_SWITCH_TECH, tech),

    // Camera parameters (camera: 'tele' | 'wide')
    setExposureMode: (camera: string, mode: number) =>
      ipcRenderer.invoke(IPC.SDK_SET_EXP_MODE, camera, mode),
    setExposure: (camera: string, value: number) =>
      ipcRenderer.invoke(IPC.SDK_SET_EXPOSURE, camera, value),
    setGainMode: (camera: string, mode: number) =>
      ipcRenderer.invoke(IPC.SDK_SET_GAIN_MODE, camera, mode),
    setGain: (camera: string, value: number) =>
      ipcRenderer.invoke(IPC.SDK_SET_GAIN, camera, value),
    setBrightness: (camera: string, value: number) =>
      ipcRenderer.invoke(IPC.SDK_SET_BRIGHTNESS, camera, value),
    setContrast: (camera: string, value: number) =>
      ipcRenderer.invoke(IPC.SDK_SET_CONTRAST, camera, value),
    setSaturation: (camera: string, value: number) =>
      ipcRenderer.invoke(IPC.SDK_SET_SATURATION, camera, value),
    setHue: (camera: string, value: number) =>
      ipcRenderer.invoke(IPC.SDK_SET_HUE, camera, value),
    setSharpness: (camera: string, value: number) =>
      ipcRenderer.invoke(IPC.SDK_SET_SHARPNESS, camera, value),
    setIRCut: (camera: string, mode: number) =>
      ipcRenderer.invoke(IPC.SDK_SET_IRCUT, camera, mode),

    // Focus
    focusAuto: () => ipcRenderer.invoke(IPC.SDK_FOCUS_AUTO),
    focusManualStart: (direction: number) =>
      ipcRenderer.invoke(IPC.SDK_FOCUS_MANUAL_START, direction),
    focusManualStop: () => ipcRenderer.invoke(IPC.SDK_FOCUS_MANUAL_STOP),
    focusStep: (direction: number) => ipcRenderer.invoke(IPC.SDK_FOCUS_STEP, direction),
    focusAstroAutoStart: () => ipcRenderer.invoke(IPC.SDK_FOCUS_ASTRO_AUTO_START),
    focusAstroAutoStop: () => ipcRenderer.invoke(IPC.SDK_FOCUS_ASTRO_AUTO_STOP),

    // Filter
    setFilter: (value: number) => ipcRenderer.invoke(IPC.SDK_SET_FILTER, value),

    // Tracking
    stopTracking: () => ipcRenderer.invoke(IPC.SDK_TRACK_STOP),
    startSentry: () => ipcRenderer.invoke(IPC.SDK_TRACK_SENTRY_START),
    stopSentry: () => ipcRenderer.invoke(IPC.SDK_TRACK_SENTRY_STOP),
    startMot: () => ipcRenderer.invoke(IPC.SDK_TRACK_MOT_START),
    startUfoTrack: () => ipcRenderer.invoke(IPC.SDK_TRACK_UFO_START),
    stopUfoTrack: () => ipcRenderer.invoke(IPC.SDK_TRACK_UFO_STOP),
    onConnectionState: (callback: (state: { connected: boolean }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: { connected: boolean }) =>
        callback(state);
      ipcRenderer.on(IPC.SDK_CONNECTION_STATE, handler);
      return () => {
        ipcRenderer.removeListener(IPC.SDK_CONNECTION_STATE, handler);
      };
    },
    onDeviceState: (callback: (state: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state);
      ipcRenderer.on(IPC.SDK_DEVICE_STATE, handler);
      return () => {
        ipcRenderer.removeListener(IPC.SDK_DEVICE_STATE, handler);
      };
    },
    albumCounts: () => ipcRenderer.invoke(IPC.SDK_ALBUM_COUNTS),
    albumList: (mediaType: number, pageIndex: number, pageSize?: number) =>
      ipcRenderer.invoke(IPC.SDK_ALBUM_LIST, mediaType, pageIndex, pageSize),
    albumFileUrl: (devicePath: string): Promise<string> =>
      ipcRenderer.invoke(IPC.SDK_ALBUM_FILE_URL, devicePath),
    albumDelete: (items: Array<{ filePath: string; fileName?: string; mediaType: number; subType?: number }>) =>
      ipcRenderer.invoke(IPC.SDK_ALBUM_DELETE, items),
    albumDownload: (devicePath: string, suggestedName: string): Promise<{ ok: boolean; savedTo?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.SDK_ALBUM_DOWNLOAD, devicePath, suggestedName),
    albumOpenExternal: (devicePath: string, suggestedName: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.SDK_ALBUM_OPEN_EXTERNAL, devicePath, suggestedName),

    motorJoystick: (vectorAngle: number, vectorLength: number) =>
      ipcRenderer.invoke(IPC.SDK_MOTOR_JOYSTICK, vectorAngle, vectorLength),
    motorJoystickStop: () => ipcRenderer.invoke(IPC.SDK_MOTOR_JOYSTICK_STOP),

    trackSentryStart: (type: number) =>
      ipcRenderer.invoke(IPC.SDK_TRACK_SENTRY_START_TYPED, type),
    trackClick: (x: number, y: number, camId: number) =>
      ipcRenderer.invoke(IPC.SDK_TRACK_CLICK, x, y, camId),

    // Astro pipeline (calibration, EQ polar align, GoTo, live stacking).
    // All location-bearing methods take (lon, lat) in decimal degrees.
    astro: {
      calibrationStart: (lon: number, lat: number) =>
        ipcRenderer.invoke(IPC.SDK_ASTRO_CALIBRATION_START, lon, lat),
      calibrationStop: () => ipcRenderer.invoke(IPC.SDK_ASTRO_CALIBRATION_STOP),
      eqSolvingStart: (lon: number, lat: number) =>
        ipcRenderer.invoke(IPC.SDK_ASTRO_EQ_SOLVING_START, lon, lat),
      eqSolvingStop: () => ipcRenderer.invoke(IPC.SDK_ASTRO_EQ_SOLVING_STOP),
      gotoDso: (ra: number, dec: number, name?: string) =>
        ipcRenderer.invoke(IPC.SDK_ASTRO_GOTO_DSO, ra, dec, name),
      gotoSolar: (index: number, lon: number, lat: number, name?: string) =>
        ipcRenderer.invoke(IPC.SDK_ASTRO_GOTO_SOLAR, index, lon, lat, name),
      gotoStop: () => ipcRenderer.invoke(IPC.SDK_ASTRO_GOTO_STOP),
      goLive: () => ipcRenderer.invoke(IPC.SDK_ASTRO_GO_LIVE),
      liveStackingTeleStart: (opts?: { forceStart?: boolean; irIndex?: number }) =>
        ipcRenderer.invoke(IPC.SDK_ASTRO_LIVE_STACKING_TELE_START, opts),
      liveStackingTeleStop: () => ipcRenderer.invoke(IPC.SDK_ASTRO_LIVE_STACKING_TELE_STOP),
      liveStackingWideStart: (opts?: { forceStart?: boolean }) =>
        ipcRenderer.invoke(IPC.SDK_ASTRO_LIVE_STACKING_WIDE_START, opts),
      liveStackingWideStop: () => ipcRenderer.invoke(IPC.SDK_ASTRO_LIVE_STACKING_WIDE_STOP),
      // Slow "finalize & save" stop (flushes queued frames).
      liveStackingTeleStopSlow: () => ipcRenderer.invoke(IPC.SDK_ASTRO_LIVE_STACKING_TELE_STOP_SLOW),
      liveStackingWideStopSlow: () => ipcRenderer.invoke(IPC.SDK_ASTRO_LIVE_STACKING_WIDE_STOP_SLOW),
      // Recover from a stuck session (-11501). Returns {issued, failed}.
      recoverStacking: () => ipcRenderer.invoke(IPC.SDK_ASTRO_RECOVER),
      // On-demand per-camera stacking-state query. Returns
      // { tele:{state,label,active}, wide:{state,label,active} }.
      queryStackingState: () => ipcRenderer.invoke(IPC.SDK_ASTRO_QUERY_STACKING),
    },

    // System-level commands.
    system: {
      setLocation: (lon: number, lat: number) =>
        ipcRenderer.invoke(IPC.SDK_SYSTEM_SET_LOCATION, lon, lat),
    },
  },

  // Local JSON-file settings store (userData/settings.json).
  settings: {
    get: <T = unknown>(key: string): Promise<T | undefined> =>
      ipcRenderer.invoke(IPC.SETTINGS_GET, key),
    set: (key: string, value: unknown): Promise<void> =>
      ipcRenderer.invoke(IPC.SETTINGS_SET, key, value),
  },
});
