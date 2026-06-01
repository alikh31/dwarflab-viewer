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

export function useDeviceState(): DeviceStateSnapshot {
  const [state, setState] = useState<DeviceStateSnapshot>(DEFAULT_STATE);

  useEffect(() => {
    const cleanupConn = window.api.sdk.onConnectionState(({ connected }) => {
      setState((prev) => ({ ...prev, connected }));
    });
    const cleanupState = window.api.sdk.onDeviceState((snapshot) => {
      setState(snapshot as DeviceStateSnapshot);
    });
    return () => {
      cleanupConn();
      cleanupState();
    };
  }, []);

  return state;
}
