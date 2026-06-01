export const IPC = {
  // Discovery
  DISCOVERY_START: 'discovery:start',
  DISCOVERY_STOP: 'discovery:stop',
  DISCOVERY_DEVICE_FOUND: 'discovery:device:found',

  // BLE
  BLE_SCAN_START: 'ble:scan:start',
  BLE_CONNECT: 'ble:connect',
  BLE_DISCONNECT: 'ble:disconnect',
  BLE_SET_WIFI_STA: 'ble:wifi:sta',
  BLE_SET_WIFI_AP: 'ble:wifi:ap',
  BLE_GET_CONFIG: 'ble:config:get',
  BLE_GET_AP_INFO: 'ble:ap:info',
  BLE_SCAN_WIFI: 'ble:wifi:scan',

  // SDK
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
  SDK_NOTIFICATION: 'sdk:notification',

  // Shooting mode
  SDK_GET_MODES: 'sdk:mode:list',
  SDK_SWITCH_MODE: 'sdk:mode:switch',
  // Shooting technique (orthogonal to mode): SINGLE_SHOT=1, STACKING=2, BURST=3,
  // VIDEO=4, TIMELAPSE=5, PANORAMA=6. Burst entry requires switching to the
  // BURST technique first (BURST_SPEC §1.4). Confirmed via the tele/wide
  // shooting-tech-state notifications (15269/15271).
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

  // Stream proxy
  STREAM_PROXY_PORT: 'stream:proxy:port',
  STREAM_REARM: 'stream:rearm',

  // Album / media
  SDK_ALBUM_COUNTS: 'sdk:album:counts',
  SDK_ALBUM_LIST: 'sdk:album:list',
  SDK_ALBUM_FILE_URL: 'sdk:album:fileUrl',
  SDK_ALBUM_DELETE: 'sdk:album:delete',
  SDK_ALBUM_DOWNLOAD: 'sdk:album:download',
  SDK_ALBUM_OPEN_EXTERNAL: 'sdk:album:openExternal',

  // Motor joystick (continuous slew)
  SDK_MOTOR_JOYSTICK: 'sdk:motor:joystick',
  SDK_MOTOR_JOYSTICK_STOP: 'sdk:motor:joystick:stop',

  // Tracking — replaces SENTRY_START/STOP/MOT/UFO with one start-with-type
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
  // Slow stop (11006 tele / 11017 wide) — flushes queued frames before ending.
  // The default *_STOP above is the FAST stop (11037/11038). This is the
  // "finalize & save" variant the UX exposes as a secondary action.
  SDK_ASTRO_LIVE_STACKING_TELE_STOP_SLOW: 'sdk:astro:liveStacking:tele:stop:slow',
  SDK_ASTRO_LIVE_STACKING_WIDE_STOP_SLOW: 'sdk:astro:liveStacking:wide:stop:slow',
  // Recover from a stuck astro session (CODE_ASTRO_FUNCTION_BUSY = -11501).
  SDK_ASTRO_RECOVER: 'sdk:astro:recover',
  // Deterministic stacking-state query (cmd 16405) — lets the renderer pull the
  // current per-camera stacking state on demand (resync also calls it internally).
  SDK_ASTRO_QUERY_STACKING: 'sdk:astro:queryStacking',

  // System
  SDK_SYSTEM_SET_LOCATION: 'sdk:system:setLocation',

  // Settings (local persistence in userData/settings.json)
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
} as const;
