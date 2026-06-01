import { useCallback, useEffect } from 'react';
import { useDeviceState } from '../../hooks/useDeviceState';
import { pushToast } from '../../hooks/useToasts';

interface Props {
  onClose: () => void;
  location: { lon: number; lat: number } | null;
}

// EQ polar-align state machine values from the firmware proto enum.
// 0..8, matching the order the device steps through.
const STATE_NAMES: Record<number, string> = {
  0: 'Get ready',
  1: 'Rough setup',
  2: 'Focusing',
  3: 'Plate solving',
  4: 'Adjust both axes',
  5: 'Adjust azimuth',
  6: 'Adjust altitude',
  7: 'Excellent',
  8: 'Perfect',
};

/**
 * Full-screen overlay wizard for EQ polar alignment.
 *
 * **Algorithm matches the official app's polar-alignment math**:
 *
 *   `NOTIFY_CALIBRATION_RESULT` (15256) carries raw plate-solve azimuth/
 *   altitude. The polar-axis error is computed CLIENT-SIDE from those plus
 *   the user's latitude:
 *
 *     isNorth = latitude >= 0   // northern hemisphere ⇒ aim at +Z polar
 *     d2      = (isNorth ? 0 : 180) - azi
 *     aziErr  = (|d2| > 180) ? (d2 > 0 ? 360 - d2 : 360 + d2) : d2
 *     altErr  = |latitude| - alt
 *
 *   Both errors are **in degrees**, signed. The official app rounds to
 *   nearest int — ie `(int) Math.rint(value)` — to round to whole degrees
 *   for state classification:
 *
 *     |altErr° rounded| == 0 && |aziErr° rounded| == 0    → Perfect (8)
 *     sqrt(altErr² + aziErr²) < 5°                        → Excellent (7)
 *     both rounded errors > 0°                            → CarefulBoth (4)
 *     alt rounded > 0, azi rounded == 0                   → CarefulPitch (6)
 *     alt rounded == 0, azi rounded > 0                   → CarefulYaw (5)
 *
 *   The wizard ignores the device's `eqSolvingState.state` for states 4-8
 *   (post-solve) because the device just sits at "ready" until we manually
 *   re-solve — the official app drives the state transitions from the
 *   client side after each CalibrationResult arrives.
 */
// Computes (aziErr°, altErr°) from raw plate-solve azi/alt and latitude.
// Verified live.
function polarErrors(
  rawAzi: number,
  rawAlt: number,
  latDeg: number,
): { aziErr: number; altErr: number; totalErr: number } {
  const isNorth = latDeg >= 0;
  const d2 = (isNorth ? 0 : 180) - rawAzi;
  let aziErr: number;
  if (Math.abs(d2) > 180) aziErr = d2 > 0 ? 360 - d2 : 360 + d2;
  else aziErr = d2;
  const altErr = Math.abs(latDeg) - rawAlt;
  const totalErr = Math.sqrt(altErr * altErr + aziErr * aziErr);
  return { aziErr, altErr, totalErr };
}

// Round to nearest int (matches the official app).
function rintAbs(x: number): number {
  return Math.abs(Math.round(x));
}

export function EqAlignWizard({ onClose, location }: Props) {
  const ds = useDeviceState();
  const deviceState = ds.eqSolvingState?.state ?? null;
  const result = ds.calibrationResult;
  const plateSolves = ds.calibrationState?.plateSolvingTimes ?? 0;

  // Transformed polar errors (degrees, signed). Null until a calibration
  // result arrives.
  const errors = result && location
    ? polarErrors(result.azi, result.alt, location.lat)
    : null;

  // Compute the effective wizard state. While the firmware is in states 0-3
  // (idle / setup / focusing / solving) trust it. Once a CalibrationResult
  // arrives, derive state client-side from the transformed errors — same as
  // the official app does.
  let state: number | null = deviceState;
  if (errors && (deviceState === null || deviceState <= 0 || deviceState >= 4)) {
    if (rintAbs(errors.altErr) === 0 && rintAbs(errors.aziErr) === 0) state = 8;     // Perfect
    else if (errors.totalErr < 5) state = 7;                                          // Excellent
    else if (rintAbs(errors.altErr) > 0 && rintAbs(errors.aziErr) > 0) state = 4;     // Both
    else if (rintAbs(errors.altErr) > 0 && rintAbs(errors.aziErr) === 0) state = 6;   // Pitch only
    else if (rintAbs(errors.altErr) === 0 && rintAbs(errors.aziErr) > 0) state = 5;   // Yaw only
  }

  // ESC → cancel
  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') handleCancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleKey]);

  const handleStart = async () => {
    if (!location) {
      pushToast('Set your observing location first', 'warn');
      return;
    }
    try {
      await window.api.sdk.astro.eqSolvingStart(location.lon, location.lat);
      pushToast('EQ solving started', 'ok');
    } catch (e) {
      pushToast(`Start failed: ${(e as Error).message}`, 'err');
    }
  };

  const handleResolve = async () => {
    if (!location) return;
    try {
      await window.api.sdk.astro.eqSolvingStart(location.lon, location.lat);
    } catch (e) {
      pushToast(`Re-solve failed: ${(e as Error).message}`, 'err');
    }
  };

  const handleCancel = async () => {
    try {
      await window.api.sdk.astro.eqSolvingStop();
    } catch { /* ignore */ }
    onClose();
  };

  return (
    <div className="absolute inset-0 z-[60] bg-black/90 backdrop-blur-md flex flex-col app-no-drag">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-14 pb-4 border-b border-white/10 app-no-drag">
        <div>
          <h2 className="text-lg font-medium text-white">Polar align</h2>
          <div className="text-xs text-white/40 mt-0.5">
            {state !== null ? `Step ${state}/8 · ${STATE_NAMES[state] ?? 'Unknown'}` : 'Ready'}
          </div>
        </div>
        <button
          onClick={handleCancel}
          className="app-no-drag w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 transition-colors flex items-center justify-center"
          aria-label="Close"
        >
          <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18.36 5.64l-12.72 12.72" />
            <path d="M5.64 5.64l12.72 12.72" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 flex items-center justify-center px-6 py-8 app-no-drag">
        {(state === null || state === 0) && (
          <Step0 onStart={handleStart} hasLocation={location !== null} />
        )}
        {state === 1 && <Step1Rough />}
        {state === 2 && <Step2Focus />}
        {state === 3 && <Step3Solving plateSolves={plateSolves} />}
        {state === 4 && <StepAdjust both errors={errors} onResolve={handleResolve} />}
        {state === 5 && <StepAdjust azOnly errors={errors} onResolve={handleResolve} />}
        {state === 6 && <StepAdjust altOnly errors={errors} onResolve={handleResolve} />}
        {state === 7 && <StepDone tone="excellent" errors={errors} onContinue={onClose} />}
        {state === 8 && <StepDone tone="perfect" errors={errors} onContinue={onClose} />}
      </div>

      {/* Bottom bar */}
      <div className="px-6 py-3 border-t border-white/10 flex items-center justify-between text-xs text-white/60 app-no-drag">
        <div className="flex items-center gap-4">
          <span>{state !== null ? STATE_NAMES[state] ?? `state ${state}` : 'idle'}</span>
          {errors && (
            <span className="text-white/40">
              az {fmtSigned(errors.aziErr)}° · alt {fmtSigned(errors.altErr)}° · total {errors.totalErr.toFixed(2)}°
            </span>
          )}
          {!errors && result && (
            <span className="text-white/30">
              raw az {fmtSigned(result.azi)}° · alt {fmtSigned(result.alt)}°
            </span>
          )}
        </div>
        <button
          onClick={handleCancel}
          className="px-4 py-1.5 rounded-lg text-xs font-medium text-white/70 hover:text-white hover:bg-white/10 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/* -------------------- Step components -------------------- */

function Step0({ onStart, hasLocation }: { onStart: () => void; hasLocation: boolean }) {
  return (
    <div className="max-w-md text-center flex flex-col items-center gap-6">
      <div className="w-20 h-20 rounded-full bg-dwarf-accent/15 flex items-center justify-center">
        <svg className="w-10 h-10 text-dwarf-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 3v18M3 12h18" />
        </svg>
      </div>
      <div>
        <h3 className="text-xl font-medium text-white mb-2">Polar align</h3>
        <p className="text-sm text-white/60 leading-relaxed">
          This will rough-align your DWARF3 to celestial north using plate-solving.
          The telescope will point at a bright star, plate-solve the sky, then
          show how far off the polar axis is. You'll nudge the mount until the
          error is within tolerance.
        </p>
      </div>
      {!hasLocation && (
        <div className="text-xs text-amber-300 bg-amber-300/10 border border-amber-300/30 rounded-lg px-3 py-2">
          Set your observing location first — close this and tap "Set Location".
        </div>
      )}
      <button
        onClick={onStart}
        disabled={!hasLocation}
        className="px-6 py-3 rounded-full bg-dwarf-accent hover:bg-dwarf-accent-hover text-white text-sm font-medium transition-colors disabled:opacity-50"
      >
        Start
      </button>
    </div>
  );
}

function Step1Rough() {
  return (
    <div className="max-w-md text-center flex flex-col items-center gap-6">
      {/* Simple N + level diagram */}
      <svg width="160" height="160" viewBox="0 0 160 160" className="text-dwarf-accent">
        <circle cx="80" cy="80" r="60" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" fill="none" />
        {/* North arrow */}
        <path d="M80 30 L80 80" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M72 42 L80 30 L88 42" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <text x="80" y="22" textAnchor="middle" fill="currentColor" fontSize="14" fontWeight="600">N</text>
        {/* Level indicator */}
        <line x1="40" y1="115" x2="120" y2="115" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="80" cy="115" r="4" fill="currentColor" />
      </svg>
      <div>
        <h3 className="text-xl font-medium text-white mb-2">Rough setup</h3>
        <p className="text-sm text-white/60 leading-relaxed">
          Roughly point the telescope north and level it. Precision isn't
          needed — plate-solving will pick up from there.
        </p>
      </div>
      <Spinner large />
    </div>
  );
}

function Step2Focus() {
  return (
    <div className="text-center flex flex-col items-center gap-6">
      <Spinner large />
      <div>
        <h3 className="text-xl font-medium text-white mb-2">Focusing</h3>
        <p className="text-sm text-white/60">Auto-focusing on a star…</p>
      </div>
    </div>
  );
}

function Step3Solving({ plateSolves }: { plateSolves: number }) {
  return (
    <div className="text-center flex flex-col items-center gap-6">
      <Spinner large />
      <div>
        <h3 className="text-xl font-medium text-white mb-2">Plate solving</h3>
        <p className="text-sm text-white/60">
          Matching the sky against the catalogue…
        </p>
        {plateSolves > 0 && (
          <p className="text-xs text-white/40 mt-2">
            {plateSolves} solve{plateSolves === 1 ? '' : 's'} so far
          </p>
        )}
      </div>
    </div>
  );
}

interface AdjustProps {
  errors: { aziErr: number; altErr: number; totalErr: number } | null;
  onResolve: () => void;
  both?: boolean;
  azOnly?: boolean;
  altOnly?: boolean;
}

// Convention (verified live):
//   aziErr > 0 → mount's polar axis is east of true polar axis → rotate the
//                wedge counter-clockwise (looking down on it) which moves
//                the indicator left.
//   altErr > 0 → mount's altitude is below the latitude angle → raise it.
function StepAdjust({ errors, onResolve, both, azOnly, altOnly }: AdjustProps) {
  const aziErr = errors?.aziErr ?? 0;
  const altErr = errors?.altErr ?? 0;
  const showAz = both || azOnly;
  const showAlt = both || altOnly;

  const azDir = aziErr > 0 ? 'left (CCW)' : 'right (CW)';
  const altDir = altErr > 0 ? 'up' : 'down';

  return (
    <div className="max-w-2xl w-full flex flex-col items-center gap-8">
      <h3 className="text-xl font-medium text-white">
        {both ? 'Adjust altitude and azimuth' : azOnly ? 'Adjust azimuth' : 'Adjust altitude'}
      </h3>

      <div className="flex items-center justify-center gap-12">
        {showAz && (
          <AxisArrow
            label="Az"
            value={aziErr}
            unit="degrees"
            // aziErr > 0 (mount east of pole) → arrow points left to indicate
            // "rotate the wedge that direction".
            direction={aziErr > 0 ? 'left' : 'right'}
            hint={`Rotate ${azDir}`}
          />
        )}
        {showAlt && (
          <AxisArrow
            label="Alt"
            value={altErr}
            unit="degrees"
            // altErr > 0 (mount tilted too low) → arrow points up.
            direction={altErr > 0 ? 'up' : 'down'}
            hint={`Tilt ${altDir}`}
          />
        )}
      </div>

      <button
        onClick={onResolve}
        className="px-5 py-2 rounded-full bg-dwarf-accent hover:bg-dwarf-accent-hover text-white text-sm font-medium transition-colors"
      >
        Re-solve
      </button>
    </div>
  );
}

function AxisArrow({
  label, value, unit, direction, hint,
}: {
  label: string;
  value: number;
  unit: string;
  direction: 'up' | 'down' | 'left' | 'right';
  hint: string;
}) {
  const rotation = direction === 'up' ? 0 : direction === 'right' ? 90 : direction === 'down' ? 180 : 270;
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="text-xs text-white/40 uppercase tracking-wider">{label}</div>
      <div
        className="w-24 h-24 rounded-full bg-dwarf-accent/15 flex items-center justify-center"
        style={{ transform: `rotate(${rotation}deg)`, transition: 'transform 200ms ease' }}
      >
        <svg className="w-12 h-12 text-dwarf-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
      </div>
      <div className="text-2xl font-semibold text-white tabular-nums">
        {value >= 0 ? '+' : ''}{value.toFixed(1)}
      </div>
      <div className="text-xs text-white/40">{unit}</div>
      <div className="text-xs text-dwarf-accent">{hint}</div>
    </div>
  );
}

function StepDone({
  tone, errors, onContinue,
}: {
  tone: 'excellent' | 'perfect';
  errors: { aziErr: number; altErr: number; totalErr: number } | null;
  onContinue: () => void;
}) {
  const color = tone === 'perfect' ? 'text-amber-300' : 'text-emerald-400';
  const ring = tone === 'perfect' ? 'bg-amber-300/15' : 'bg-emerald-400/15';
  const headline = tone === 'perfect' ? 'Perfect alignment' : 'Excellent alignment';

  return (
    <div className="text-center flex flex-col items-center gap-6">
      <div className={`w-24 h-24 rounded-full ${ring} flex items-center justify-center`}>
        <svg className={`w-12 h-12 ${color}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      </div>
      <div>
        <h3 className="text-2xl font-medium text-white mb-2">{headline}</h3>
        {errors && (
          <p className="text-sm text-white/60">Within {errors.totalErr.toFixed(2)}° of the celestial pole</p>
        )}
      </div>
      <button
        onClick={onContinue}
        className="px-6 py-3 rounded-full bg-dwarf-accent hover:bg-dwarf-accent-hover text-white text-sm font-medium transition-colors"
      >
        {tone === 'perfect' ? 'Done' : 'Continue'}
      </button>
    </div>
  );
}

function Spinner({ large }: { large?: boolean }) {
  const size = large ? 'w-10 h-10' : 'w-4 h-4';
  return (
    <svg className={`${size} animate-spin text-dwarf-accent`} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function fmtSigned(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}`;
}
