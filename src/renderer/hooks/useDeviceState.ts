import { useState, useEffect } from 'react';
import type { DeviceStateSnapshot } from '../lib/types';

const DEFAULT_STATE: DeviceStateSnapshot = {
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
  teleStreamDead: false,
  calibrationState: null,
  gotoState: null,
  eqSolvingState: null,
  liveStackingProgress: null,
  stackingJob: null,
  astroError: null,
  calibrationResult: null,
  astroLocation: null,
  burstProgress: null,
};

// Last snapshot seen by any instance, so a component mounted later (e.g. a
// toolbar panel) doesn't start from defaults until the next push arrives.
let lastSnapshot: DeviceStateSnapshot = DEFAULT_STATE;

export function useDeviceState(): DeviceStateSnapshot {
  const [state, setState] = useState<DeviceStateSnapshot>(lastSnapshot);

  useEffect(() => {
    const cleanupConn = window.api.sdk.onConnectionState(({ connected }) => {
      lastSnapshot = { ...lastSnapshot, connected };
      setState(lastSnapshot);
    });
    const cleanupState = window.api.sdk.onDeviceState((snapshot) => {
      lastSnapshot = snapshot as DeviceStateSnapshot;
      setState(lastSnapshot);
    });
    return () => {
      cleanupConn();
      cleanupState();
    };
  }, []);

  return state;
}
