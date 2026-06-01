import { useEffect, useState } from 'react';
import { useDeviceState } from '../../hooks/useDeviceState';
import { pushToast } from '../../hooks/useToasts';

interface Props {
  onOpenEqWizard: () => void;
  onOpenGoto: () => void;
  onOpenLocation: () => void;
  onOpenStacking: () => void;
  onClose: () => void;
}

interface StoredLocation { lon: number; lat: number }

const DSO_MODE = 2;

/**
 * Inline toolbar panel for astro flows. State machine isn't local — every
 * "active" indicator (Calibrating spinner, GoTo target, Stacking N/M) is
 * derived from `useDeviceState()` which is fed by the device's NOTIFY_* stream.
 *
 * Stacking and Calibrate require DSO shooting mode (id=2). The buttons stay
 * visible but disabled with a tooltip explaining why.
 */
export function AstroPanel({ onOpenEqWizard, onOpenGoto, onOpenLocation, onOpenStacking, onClose }: Props) {
  const ds = useDeviceState();
  const [location, setLocation] = useState<StoredLocation | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      window.api.settings
        .get<StoredLocation>('astro.location')
        .then((loc) => { if (alive) setLocation(loc ?? null); })
        .catch(() => { /* ignore */ });
    };
    refresh();
    // Refresh on focus — picks up changes from LocationDialog.
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => { alive = false; window.removeEventListener('focus', onFocus); };
  }, []);

  const inDso = ds.shootingMode === DSO_MODE;
  const hasLocation = location !== null;

  const calibrating = ds.calibrationState !== null;
  const slewing = ds.gotoState !== null;
  // A stack is active per the authoritative stackingJob (running OR stopping) —
  // not liveStackingProgress nullness.
  const job = ds.stackingJob;
  const stacking = job != null && (job.state === 'running' || job.state === 'stopping');
  // Burst ↔ stacking are MUTUALLY EXCLUSIVE at the firmware level (BURST_SPEC
  // §6: they share one ExclusiveCameraState `oneof` slot, so the device cannot
  // be bursting and stacking at once). While a burst is in flight, gate the
  // astro capture launchers (Calibrate / GoTo / Stack) so the user can't start
  // an astro op that the firmware would reject — and surface why. The reverse
  // direction (start burst while stacking) is already prevented by the shared
  // shutter in ControlBar, which shows the stack's cancel ✕ instead of a
  // burst trigger while a stack is active.
  const bursting = ds.burstProgress != null;
  // -11501 stuck-session signal surfaced by the main process.
  const stuck = ds.astroError?.code === -11501;

  const calibrateDisabledReason = bursting
    ? 'Stop the burst first'
    : !hasLocation
      ? 'Set your observing location first'
      : !inDso
        ? 'Switch to DSO mode first'
        : null;

  // The "Stack…" launcher is gated on mode here — the full precondition chain
  // (calibrate + GoTo) is enforced inside StackingPanel where Start lives, so
  // the user can still open the modal to see what's missing. While a stack is
  // already running the button stays enabled (opens the running dashboard).
  // A burst blocks opening stacking entirely (mutually exclusive, see above).
  const stackDisabledReason = bursting
    ? 'Stop the burst first'
    : !inDso && !stacking
      ? 'Switch to DSO mode first'
      : null;

  const handleCalibrate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (calibrating) {
        await window.api.sdk.astro.calibrationStop();
        pushToast('Calibration stopped', 'ok');
      } else {
        if (!location) {
          pushToast('Set location first', 'warn');
          return;
        }
        await window.api.sdk.astro.calibrationStart(location.lon, location.lat);
        pushToast('Calibrating…', 'ok');
      }
    } catch (e) {
      pushToast(`Calibration failed: ${(e as Error).message}`, 'err');
    } finally {
      setBusy(false);
    }
  };

  const handleGoto = async () => {
    if (busy) return;
    if (slewing) {
      setBusy(true);
      try {
        await window.api.sdk.astro.gotoStop();
        pushToast('Slew cancelled', 'ok');
      } catch (e) {
        pushToast(`Stop failed: ${(e as Error).message}`, 'err');
      } finally {
        setBusy(false);
      }
      return;
    }
    onOpenGoto();
  };

  // Recovery: ALWAYS available whenever connected (the wedged state often does
  // NOT show in deviceState — device stuck, stackingJob null — so this can't be
  // gated on an active job or mode). Wired to recoverStacking() (the verified
  // 6-cmd unstick; clears astroError + re-arms RTSP). STACKING_UX §6.1.
  const handleReset = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await window.api.sdk.astro.recoverStacking();
      if (res && res.failed && res.failed.length > 0) {
        pushToast(`Astro reset (with ${res.failed.length} warnings)`, 'warn');
      } else {
        pushToast('Astro reset', 'ok');
      }
    } catch (e) {
      pushToast(`Reset failed: ${(e as Error).message}`, 'err');
    } finally {
      setBusy(false);
    }
  };

  const calRes = ds.calibrationResult;
  const calProgress = ds.calibrationState?.plateSolvingTimes ?? 0;

  return (
    <div className="flex items-center gap-2 flex-wrap max-w-[44rem]">
      <span className="text-[10px] text-white/40 uppercase tracking-wider mr-1">Astro</span>

      {/* Calibrate / Stop calibration */}
      <button
        onClick={handleCalibrate}
        disabled={busy || (!calibrating && calibrateDisabledReason !== null)}
        title={calibrateDisabledReason ?? (calibrating ? 'Stop calibration' : 'Start plate-solve calibration')}
        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all
          ${calibrating
            ? 'bg-dwarf-accent text-white ring-1 ring-dwarf-accent/50'
            : 'text-white/60 hover:text-white hover:bg-white/10'
          } disabled:opacity-50`}
      >
        {calibrating ? (
          <span className="flex items-center gap-1.5">
            <Spinner />
            Stop
            {calProgress > 0 && (
              <span className="text-white/70">· {calProgress} solve{calProgress === 1 ? '' : 's'}</span>
            )}
          </span>
        ) : (
          'Calibrate'
        )}
      </button>
      {calRes && !calibrating && (
        <span className="text-[10px] text-white/40">
          az ±{Math.abs(calRes.azi).toFixed(1)}' · alt ±{Math.abs(calRes.alt).toFixed(1)}'
        </span>
      )}

      {/* Polar align wizard */}
      <button
        onClick={onOpenEqWizard}
        className="px-3 py-1.5 rounded-lg text-xs font-medium text-white/60 hover:text-white hover:bg-white/10 transition-all"
        title="Polar align wizard"
      >
        Polar Align
      </button>

      {/* GoTo — blocked while a burst is in flight (mutually exclusive). */}
      <button
        onClick={handleGoto}
        disabled={(busy && !slewing) || (bursting && !slewing)}
        title={bursting && !slewing ? 'Stop the burst first' : slewing ? 'Cancel slew' : 'Open GoTo catalog'}
        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all
          ${slewing
            ? 'bg-dwarf-accent text-white ring-1 ring-dwarf-accent/50'
            : 'text-white/60 hover:text-white hover:bg-white/10'
          } disabled:opacity-50`}
      >
        {slewing ? (
          <span className="flex items-center gap-1.5">
            <StopIcon />
            <span className="truncate max-w-[8rem]">Tracking {ds.gotoState?.targetName || '…'}</span>
          </span>
        ) : (
          'GoTo'
        )}
      </button>

      {/* Stack… — single gated launcher that opens StackingPanel. The full
          precondition chain (calibrate + GoTo) is enforced by the modal's Start
          button; this button only gates on DSO mode. Shows a spinner + "Stacking"
          label while a job is running (tap to open the running dashboard). */}
      <button
        onClick={onOpenStacking}
        disabled={stackDisabledReason !== null}
        title={stackDisabledReason ?? (stacking ? 'View running stack' : 'Open live stacking')}
        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all
          ${stacking
            ? 'bg-dwarf-accent text-white ring-1 ring-dwarf-accent/50'
            : 'text-white/60 hover:text-white hover:bg-white/10'
          } disabled:opacity-50`}
      >
        {stacking ? (
          <span className="flex items-center gap-1.5">
            <Spinner />
            Stacking…
          </span>
        ) : (
          'Stack…'
        )}
      </button>

      <div className="w-px h-5 bg-white/10 mx-1" />

      {/* Location */}
      <button
        onClick={onOpenLocation}
        className="px-3 py-1.5 rounded-lg text-xs font-medium text-white/60 hover:text-white hover:bg-white/10 transition-all"
        title={location ? `${location.lat.toFixed(2)}°, ${location.lon.toFixed(2)}°` : 'Set observing location'}
      >
        {location ? 'Location ✓' : 'Set Location'}
      </button>

      <div className="w-px h-5 bg-white/10 mx-1" />

      {/* Reset astro — ALWAYS available when connected (the canonical recovery
          affordance; a wedged device often shows no state to gate on). Glows
          amber when a -11501 stuck session is detected. */}
      <button
        onClick={handleReset}
        disabled={busy || !ds.connected}
        title="Device stuck? Reset the astro pipeline (calibration, GoTo, EQ, stacking)"
        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 disabled:opacity-40
          ${stuck
            ? 'bg-amber-400/20 text-amber-100 ring-1 ring-amber-400/40'
            : 'text-white/60 hover:text-white hover:bg-white/10'
          }`}
      >
        <ResetIcon />
        {stuck ? 'Reset (stuck)' : 'Reset'}
      </button>

      {/* Suppress the unused warning — keeping `onClose` in the API so the
          panel can self-dismiss in the future. */}
      <span className="hidden" aria-hidden onClick={onClose} />
    </div>
  );
}

function Spinner() {
  return (
    <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </svg>
  );
}

function ResetIcon() {
  return (
    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}
