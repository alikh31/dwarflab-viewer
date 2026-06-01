import { useState, useCallback, useRef, useEffect } from 'react';
import { pushToast } from '../hooks/useToasts';
import { useDeviceState } from '../hooks/useDeviceState';

// Shooting modes that need plate-solving-aware autofocus instead of the
// regular sensor-contrast AF. Values match the firmware mode enum:
// 2 = DSO (deep-sky), 4 = Milky Way panorama. Both expose long exposures
// where regular AF tends to fail with code -15100/-15101.
const ASTRO_AF_MODES = new Set([2, 4]);

// Friendly mapping for the focus-error range (-15100..-15108).
function focusErrorMessage(code: number): string {
  switch (code) {
    case -15100: return 'Astro autofocus failed (slow)';
    case -15101: return 'Astro autofocus failed (fast)';
    case -15106: return 'Autofocus needs shorter exposure';
    case -15107: return 'Infinity position not set';
    case -15108: return 'Focus position read failed';
    default:     return `Focus error (code ${code})`;
  }
}

/**
 * Vertical focus control strip on the right edge.
 *
 *   [AF]   — auto-focus
 *   [near] — tap to step one click closer, hold to slew continuously closer
 *   [far]  — tap to step toward infinity, hold to slew continuously farther
 *
 * Keyboard: R = near (focus in), F = far (focus out). Tap = step, hold = continuous slew.
 *
 * Direction values: 0 = far (infinity), 1 = near (close).
 */
const HOLD_TO_CONTINUOUS_MS = 200;

// Tell FocusMagnifier that focus is happening so it pops up the loupe.
function pingFocusActive() {
  window.dispatchEvent(new CustomEvent('dwarf:focus-active'));
}

export function FocusSlider() {
  const [focusing, setFocusing] = useState(false);
  const [active, setActive] = useState<0 | 1 | null>(null); // direction currently held
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heldDirection = useRef<0 | 1 | null>(null);
  const ds = useDeviceState();
  const useAstroAf = ASTRO_AF_MODES.has(ds.shootingMode ?? -1);

  // In DSO / Milky Way modes, regular contrast-AF tends to time out on
  // long exposures (code -15100/-15101). Fall back to the dedicated
  // ASTRO_AUTO_FOCUS (15004) path which uses star detection. Progress
  // arrives via NOTIFY_ASTRO_AUTO_FOCUS_STATE (15278) — that just toasts
  // for now, not a state-machine UI.
  const handleAutoFocus = useCallback(async () => {
    setFocusing(true);
    pingFocusActive();
    try {
      if (useAstroAf) {
        await window.api.sdk.focusAstroAutoStart();
        pushToast('Astro auto-focusing…', 'ok');
      } else {
        const reply = (await window.api.sdk.focusAuto()) as { code?: number } | null;
        const code = reply?.code ?? 0;
        if (code < 0) pushToast(focusErrorMessage(code), 'err', 3500);
        else pushToast('Auto-focusing…', 'ok');
      }
    } catch (e) {
      pushToast(`Auto-focus failed: ${(e as Error).message}`, 'err');
    }
    setTimeout(() => setFocusing(false), 1500);
  }, [useAstroAf]);

  // Tap-vs-hold are mutually exclusive: tap fires a single step on release if
  // the press was shorter than HOLD_TO_CONTINUOUS_MS, otherwise the press
  // started continuous slew at the 200ms mark and release stops it.
  // Firing BOTH step and continuous-slew for the same gesture caused the focus
  // to overshoot — the motor briefly slewed even though we sent stop straight
  // after start.
  const continuousActive = useRef(false);
  // Safety watchdog: if a continuous slew is somehow never released (macOS can
  // DROP the keyup of a modified key when Alt is lifted first — then our
  // release() never fires and the motor slews to its limit, i.e. "focus jumps
  // to max"), force-stop after this long. Far longer than any deliberate hold.
  const slewWatchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const SLEW_MAX_MS = 4000;

  const press = useCallback((direction: 0 | 1) => {
    if (heldDirection.current === direction) return; // already pressed
    heldDirection.current = direction;
    setActive(direction);
    continuousActive.current = false;
    pingFocusActive();
    holdTimer.current = setTimeout(() => {
      if (heldDirection.current === direction) {
        continuousActive.current = true;
        window.api.sdk.focusManualStart(direction).catch(() => {});
        // Arm the watchdog: if release() never arrives (dropped keyup), the
        // slew is force-stopped instead of running to the limit.
        if (slewWatchdog.current) clearTimeout(slewWatchdog.current);
        slewWatchdog.current = setTimeout(() => {
          if (continuousActive.current) {
            continuousActive.current = false;
            heldDirection.current = null;
            setActive(null);
            window.api.sdk.focusManualStop().catch(() => {});
          }
        }, SLEW_MAX_MS);
      }
    }, HOLD_TO_CONTINUOUS_MS);
  }, []);

  const release = useCallback(() => {
    const dir = heldDirection.current;
    if (dir === null) return;
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    if (slewWatchdog.current) { clearTimeout(slewWatchdog.current); slewWatchdog.current = null; }
    heldDirection.current = null;
    setActive(null);
    if (continuousActive.current) {
      // Was a hold — stop the slew.
      continuousActive.current = false;
      window.api.sdk.focusManualStop().catch(() => {});
    } else {
      // Was a tap — fire a single step instead.
      window.api.sdk.focusStep(dir).catch(() => {});
    }
    pingFocusActive();
  }, []);

  // Keyboard FOCUS keys: R = focus near/in (+), F = focus far/out (−), with NO
  // modifier required and regardless of any modifier combination. (Arrows are
  // now reserved for fine mount navigation in DirectionPad, so focus moved to
  // dedicated R/F keys.) Press-and-hold for continuous slew. Use `e.code`
  // (physical key) for layout-independence.
  useEffect(() => {
    const codeToDir = (code: string): 0 | 1 | null => {
      if (code === 'KeyR') return 1; // near / focus in / +
      if (code === 'KeyF') return 0; // far  / focus out / −
      return null;
    };
    // KEYBOARD FOCUS — single centralized controller, ONE source of truth.
    //
    // Why this shape: continuous slew (focusManualStart) is the only command
    // that visibly moves focus on this firmware, but it runs until stopped.
    // Earlier designs leaked the stop (relying on keyup, which macOS drops when
    // Alt lifts first; and a duty-cycle whose nested restart-timeout fired AFTER
    // a release-stop) → "slides to max". The robust model: a steady 50ms tick is
    // the ONLY thing that ever sends start/stop. It compares two booleans —
    // "should be slewing" (a key is held, refreshed by keydown/repeat) vs.
    // "is slewing" — and issues exactly one start or one stop to reconcile them.
    // Release just lets `heldUntil` lapse; the next tick stops. No nested timers,
    // no event→command path that can leak. For ARROW keys (fine focus) we slew
    // only ~70% of the ticks → ~30% slower; W/S slew every tick (full speed).
    const TICK_MS = 50;
    // Must exceed the OS *initial* key-repeat delay (macOS "Delay Until Repeat"
    // can be 500ms+). If shorter, heldUntil lapses in the gap between the first
    // keydown and the first auto-repeat → the ticker stops the slew and a held
    // key never resumes. 700ms covers the slowest default; release still stops
    // within one tick (≤50ms) because keyup/blur expire heldUntil immediately.
    const HOLD_GRACE_MS = 700;   // key counts as held for this long after last keydown
    const SLOW_ON_TICKS = 7;     // arrows: slew 7 of every 10 ticks → 30% slower
    const SLOW_PERIOD = 10;

    let wantDir: 0 | 1 | null = null; // direction the user is currently holding
    let wantSlow = false;             // arrow (fine) vs W/S (coarse)
    let heldUntil = 0;                // ms timestamp; >now means "still held"
    let isSlewing = false;            // does the firmware currently have a slew running
    let slewDir: 0 | 1 | null = null; // direction we last commanded
    let tickN = 0;

    const hardStop = () => {
      if (isSlewing) {
        isSlewing = false;
        slewDir = null;
        window.api.sdk.focusManualStop().catch(() => {});
      }
    };

    const tick = () => {
      tickN++;
      const dir = wantDir;
      const held = dir !== null && Date.now() < heldUntil;
      if (!held || dir === null) {
        // Not held anymore → ensure stopped, clear UI highlight.
        if (isSlewing) hardStop();
        if (wantDir !== null) { wantDir = null; setActive(null); }
        return;
      }
      // Held. Direction change → restart in the new direction.
      if (isSlewing && slewDir !== dir) { hardStop(); }
      // Fine (arrow) duty: skip the "off" ticks so the motor pauses ~30%.
      const dutyOff = wantSlow && (tickN % SLOW_PERIOD) >= SLOW_ON_TICKS;
      if (dutyOff) {
        if (isSlewing) hardStop();      // pause phase of the duty cycle
      } else if (!isSlewing) {
        isSlewing = true;
        slewDir = dir;
        window.api.sdk.focusManualStart(dir).catch(() => {});
      }
    };
    const ticker = setInterval(tick, TICK_MS);

    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const dir = codeToDir(e.code); // R/F only — no modifier gate
      if (dir === null) return;
      e.preventDefault();
      wantDir = dir;
      wantSlow = false; // R/F are normal-speed; arrows (fine) are nav now
      heldUntil = Date.now() + HOLD_GRACE_MS;
      setActive(dir);
      pingFocusActive();
      // The ticker does the actual start — keeps a single command source.
    };

    // Keyup/blur/hidden release immediately by expiring the hold; the next tick
    // (≤50ms) stops. We also hard-stop right away for snappiness.
    const releaseNow = () => { heldUntil = 0; wantDir = null; setActive(null); hardStop(); };
    const onKeyUp = (e: KeyboardEvent) => {
      if (codeToDir(e.code) !== null) releaseNow();
    };
    const onBlur = () => releaseNow();
    const onVisibility = () => { if (document.hidden) releaseNow(); };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(ticker);
      hardStop();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <div className="absolute right-4 top-1/2 -translate-y-1/2 z-40">
      <div
        className="flex flex-col items-center gap-1.5 px-2 py-3 rounded-2xl
                    bg-black/40 backdrop-blur-xl border border-white/10
                    shadow-2xl shadow-black/30"
      >
        {/* Auto focus */}
        <button
          onClick={handleAutoFocus}
          disabled={focusing}
          className={`w-12 h-9 rounded-lg flex items-center justify-center text-[10px] font-bold tracking-wider transition-all
            ${focusing
              ? 'bg-dwarf-accent text-white animate-pulse'
              : 'text-white/60 hover:text-white hover:bg-white/10'
            }`}
          title="Auto Focus"
        >
          AF
        </button>

        <div className="w-7 h-px bg-white/10" />

        {/* Near (toward close, direction=1) */}
        <FocusButton
          label="+"
          active={active === 1}
          onPress={() => press(1)}
          onRelease={release}
          hint="Focus near · Alt+W or Alt+↑ · tap = step, hold = slew"
        />

        {/* Far (toward infinity, direction=0) */}
        <FocusButton
          label="−"
          active={active === 0}
          onPress={() => press(0)}
          onRelease={release}
          hint="Focus far · Alt+S or Alt+↓ · tap = step, hold = slew"
        />
      </div>
    </div>
  );
}

function FocusButton({
  label, active, onPress, onRelease, hint,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  onRelease: () => void;
  hint: string;
}) {
  return (
    <button
      onPointerDown={(e) => { e.preventDefault(); onPress(); }}
      onPointerUp={(e) => { e.preventDefault(); onRelease(); }}
      onPointerLeave={() => { if (active) onRelease(); }}
      onPointerCancel={() => { if (active) onRelease(); }}
      className={`w-12 h-9 rounded-lg flex items-center justify-center text-lg font-semibold leading-none transition-all
        ${active
          ? 'bg-dwarf-accent/30 text-white ring-1 ring-dwarf-accent/50'
          : 'text-white/55 hover:text-white hover:bg-white/10'
        }`}
      title={hint}
    >
      {label}
    </button>
  );
}
