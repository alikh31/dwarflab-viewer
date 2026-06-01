import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Direction pad — continuous motor slew while one or more direction buttons
 * are held (mouse or arrow keys). Each held direction adds a unit vector;
 * the combined resultant is sent as `vectorAngle` (radians-converted-to-
 * compass-degrees) every 200 ms. Opposing keys cancel out. Diagonals fire
 * naturally — e.g. up + right resolves to angle 45° (the device's "northeast").
 *
 * Angle convention verified live on DWARF3 v1.5.0.1:
 *   wire angle 0   → moves right
 *   wire angle 90  → moves up
 *   wire angle 180 → moves left
 *   wire angle 270 → moves down
 * So the wire is math-convention (positive-X right, positive-Y up).
 */
type Direction = 'up' | 'right' | 'down' | 'left';

// Unit vectors in wire-coordinate space. Computing the resultant by summing
// these and then atan2-ing keeps the math obvious and correct for all combos.
const UNIT: Record<Direction, { x: number; y: number }> = {
  right: { x: +1, y:  0 },
  up:    { x:  0, y: +1 },
  left:  { x: -1, y:  0 },
  down:  { x:  0, y: -1 },
};

// Slew magnitude (0..1 on the wire). Shift = fast, Ctrl = fine, default in the middle.
const SLEW_NORMAL = 0.15;
const SLEW_FAST   = 0.5;
const SLEW_FINE   = 0.05;
// Case-insensitive lookup — Shift+w → "W", etc. Arrow keys are unaffected.
const KEY_TO_DIR: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowRight: 'right',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  w: 'up', W: 'up',
  d: 'right', D: 'right',
  s: 'down', S: 'down',
  a: 'left', A: 'left',
};

const REPEAT_MS = 200; // re-send joystick every 200ms while held

type Speed = 'fine' | 'normal' | 'fast';
const SLEW: Record<Speed, number> = { fine: SLEW_FINE, normal: SLEW_NORMAL, fast: SLEW_FAST };

// Read live modifier state from any KeyboardEvent / PointerEvent
function speedFor(e: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }): Speed {
  if (e.shiftKey) return 'fast';
  if (e.ctrlKey || e.metaKey) return 'fine';
  return 'normal';
}

export function DirectionPad() {
  const [active, setActive] = useState<Set<Direction>>(() => new Set());
  const [speed, setSpeed] = useState<Speed>('normal');
  const repeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Held directions + speed kept in a ref so the interval reads the latest
  // values without React closure staleness.
  const heldRef = useRef<{ dirs: Set<Direction>; speed: Speed }>({ dirs: new Set(), speed: 'normal' });

  // Compute (angle, length) for the current set of held directions. Returns
  // null when the set is empty or net zero (e.g. left + right held).
  const resultant = useCallback((dirs: Set<Direction>, sp: Speed): { angle: number; length: number } | null => {
    if (dirs.size === 0) return null;
    let x = 0, y = 0;
    for (const d of dirs) { x += UNIT[d].x; y += UNIT[d].y; }
    if (x === 0 && y === 0) return null;
    // atan2 returns radians in (-π, π], measured from +X axis counter-clockwise.
    // Wire wants the same convention (0=east, 90=north), just in degrees.
    let angle = (Math.atan2(y, x) * 180) / Math.PI;
    if (angle < 0) angle += 360;
    return { angle, length: SLEW[sp] };
  }, []);

  // Push current resultant to the device. Called on every state change and
  // every REPEAT_MS tick.
  const pushCurrent = useCallback(() => {
    const cur = heldRef.current;
    const r = resultant(cur.dirs, cur.speed);
    if (r) void window.api.sdk.motorJoystick(r.angle, r.length);
  }, [resultant]);

  // Press one direction. Idempotent — pressing the same key twice is a no-op.
  const press = useCallback((dir: Direction, sp: Speed) => {
    const cur = heldRef.current;
    if (cur.dirs.has(dir) && cur.speed === sp) return;
    const dirs = new Set(cur.dirs);
    dirs.add(dir);
    heldRef.current = { dirs, speed: sp };
    setActive(dirs);
    setSpeed(sp);
    pushCurrent();
    if (!repeatTimer.current) {
      repeatTimer.current = setInterval(() => {
        if (heldRef.current.dirs.size === 0) return;
        pushCurrent();
      }, REPEAT_MS);
    }
  }, [pushCurrent]);

  // Release one direction. If the set becomes empty, stop the slew entirely.
  const release = useCallback((dir: Direction) => {
    const cur = heldRef.current;
    if (!cur.dirs.has(dir)) return;
    const dirs = new Set(cur.dirs);
    dirs.delete(dir);
    heldRef.current = { dirs, speed: cur.speed };
    setActive(dirs);
    if (dirs.size === 0) {
      if (repeatTimer.current) {
        clearInterval(repeatTimer.current);
        repeatTimer.current = null;
      }
      void window.api.sdk.motorJoystickStop();
    } else {
      pushCurrent(); // resultant angle changed, push it now
    }
  }, [pushCurrent]);

  // Release everything (blur, click outside, etc).
  const releaseAll = useCallback(() => {
    if (heldRef.current.dirs.size === 0) return;
    if (repeatTimer.current) {
      clearInterval(repeatTimer.current);
      repeatTimer.current = null;
    }
    heldRef.current = { dirs: new Set(), speed: heldRef.current.speed };
    setActive(new Set());
    void window.api.sdk.motorJoystickStop();
  }, []);

  // Live-update speed when modifier state changes mid-hold
  const updateSpeed = useCallback((next: Speed) => {
    setSpeed(next);
    const cur = heldRef.current;
    heldRef.current = { ...cur, speed: next };
    if (cur.dirs.size > 0) pushCurrent();
  }, [pushCurrent]);

  // Arrow / WASD key handling. Each direction key independently presses /
  // releases. The resultant angle is recomputed every change so diagonals
  // (e.g. up+right) fire on the first tick after both keys are down.
  //
  // SAFETY (the "runs to max" bug): the motor must NEVER depend solely on a
  // keyup to stop — macOS drops keyups (modifier-release swallowing, focus
  // changes) and a missed keyup left the repeat-timer pushing motorJoystick
  // forever → the mount slewed to its limit. Fix: every keydown (incl. OS
  // auto-repeat, ~every 30-60ms while held) refreshes a per-direction deadline;
  // a watchdog prunes any direction whose deadline lapsed and stops the motor
  // when none remain. keyup is now just a fast-path; the deadline is the
  // guarantee. Same pattern as FocusSlider's keyboard controller.
  useEffect(() => {
    // Must exceed the OS *initial* key-repeat delay (macOS "Delay Until Repeat"
    // can be 500ms+), not just the repeat interval. If this is shorter than the
    // initial delay, the watchdog prunes the direction in the gap between the
    // first keydown and the first auto-repeat → a held key stops after the grace
    // window and never resumes. 700ms covers the slowest default.
    const HELD_GRACE_MS = 700;
    const heldUntil = new Map<Direction, number>();

    const releaseDir = (dir: Direction) => {
      heldUntil.delete(dir);
      release(dir);
    };

    const isArrow = (k: string) =>
      k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight';

    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const arrow = isArrow(e.key);
      // ARROWS = always FINE navigation, regardless of ANY modifier (Alt/Shift/
      // Ctrl/Meta). WASD keeps modifier-driven speed and yields to Alt (so Alt+
      // letters can be used elsewhere). Arrows never change the WASD speed.
      if (!arrow && (e.key === 'Shift' || e.key === 'Control' || e.key === 'Meta')) {
        updateSpeed(speedFor(e));
        return;
      }
      const dir = KEY_TO_DIR[e.key];
      if (!dir) return;
      if (!arrow && e.altKey) return; // Alt+WASD not ours; Alt+arrow IS still nav
      e.preventDefault();
      heldUntil.set(dir, Date.now() + HELD_GRACE_MS); // refresh on every repeat
      // press() is idempotent. Call it on the first keydown AND whenever the
      // direction isn't currently held — so if the watchdog ever pruned it (a
      // long repeat gap, a stutter), the next auto-repeat keydown revives the
      // slew instead of leaving it dead.
      if (!e.repeat || !heldRef.current.dirs.has(dir)) {
        press(dir, arrow ? 'fine' : speedFor(e));
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Meta') {
        updateSpeed(speedFor(e));
        return;
      }
      const dir = KEY_TO_DIR[e.key];
      if (!dir) return;
      e.preventDefault();
      releaseDir(dir);
    };
    // Watchdog: prune directions whose keydown stream stopped (keyup missed).
    const watchdog = setInterval(() => {
      if (heldUntil.size === 0) return;
      const now = Date.now();
      for (const [dir, until] of heldUntil) {
        if (now >= until) releaseDir(dir);
      }
    }, 60);
    const onBlur = () => { heldUntil.clear(); releaseAll(); };
    const onVisibility = () => { if (document.hidden) { heldUntil.clear(); releaseAll(); } };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(watchdog);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      if (repeatTimer.current) clearInterval(repeatTimer.current);
    };
  }, [press, release, releaseAll, updateSpeed]);

  // Gamepad analog stick → motorJoystick. Polls navigator.getGamepads()
  // every REPEAT_MS while a stick is deflected. Magnitude IS the speed —
  // no discrete fast/fine modifiers like the keyboard path. Dead-zone of
  // 0.15 avoids drift from worn sticks. Most controllers expose left stick
  // as axes [0]=x, [1]=y where +y is down (the standard "DOM" convention
  // matches Y-down); our wire wants math-convention (+y up), so we negate.
  const gamepadActive = useRef(false);
  const [gamepadConnected, setGamepadConnected] = useState(false);
  useEffect(() => {
    const DEAD_ZONE = 0.15;
    const POLL_MS = REPEAT_MS;

    const onConnect = (e: GamepadEvent) => {
      console.log('[Gamepad] connected:', e.gamepad.id);
      setGamepadConnected(true);
    };
    const onDisconnect = (e: GamepadEvent) => {
      console.log('[Gamepad] disconnected:', e.gamepad.id);
      // If any pads still present, stay marked connected.
      const pads = navigator.getGamepads().filter(Boolean) as Gamepad[];
      setGamepadConnected(pads.length > 0);
    };
    window.addEventListener('gamepadconnected', onConnect);
    window.addEventListener('gamepaddisconnected', onDisconnect);

    // Initial probe in case a pad was already plugged in.
    const initial = navigator.getGamepads().filter(Boolean) as Gamepad[];
    if (initial.length > 0) setGamepadConnected(true);

    // Right-stick handling: only the Y axis is used. Pushing the stick up
    // (DOM y < 0) means focus near (direction=1); pushing down means focus
    // far (direction=0). focusManualStart slews continuously and was too
    // fast on the analog stick — overshoots the focus sweet spot. Instead
    // we send focusStep at an interval whose period scales with deflection:
    // light push = slow steps, full push = fast steps. Both still slower
    // than the slider's continuous-slew, which is what we want.
    let focusDir: 0 | 1 | null = null;
    let focusStepDeadline = 0;
    const tick = setInterval(() => {
      const pads = navigator.getGamepads().filter(Boolean) as Gamepad[];
      if (pads.length === 0) return;

      // Left stick (axes 0/1) → motor. Pick the pad with the most deflection.
      let lx = 0, lyDom = 0;
      let rx = 0, ryDom = 0;
      for (const pad of pads) {
        if (pad.axes.length >= 2) {
          const ax = pad.axes[0];
          const ay = pad.axes[1];
          if (Math.hypot(ax, ay) > Math.hypot(lx, lyDom)) {
            lx = ax;
            lyDom = ay;
          }
        }
        // Right stick is typically axes 2/3 (standard mapping) or 3/4 on
        // some Xinput-via-bluez paths. Try both, prefer the larger.
        const rxA = pad.axes[2] ?? 0;
        const ryA = pad.axes[3] ?? 0;
        const rxB = pad.axes[3] ?? 0;
        const ryB = pad.axes[4] ?? 0;
        const cand = Math.hypot(rxA, ryA) >= Math.hypot(rxB, ryB)
          ? { x: rxA, y: ryA } : { x: rxB, y: ryB };
        if (Math.hypot(cand.x, cand.y) > Math.hypot(rx, ryDom)) {
          rx = cand.x;
          ryDom = cand.y;
        }
      }

      // Left stick → motor joystick
      const lMag = Math.hypot(lx, lyDom);
      if (lMag < DEAD_ZONE) {
        if (gamepadActive.current) {
          gamepadActive.current = false;
          void window.api.sdk.motorJoystickStop();
        }
      } else {
        const length = Math.min(1, (lMag - DEAD_ZONE) / (1 - DEAD_ZONE));
        const y = -lyDom;
        let angle = (Math.atan2(y, lx) * 180) / Math.PI;
        if (angle < 0) angle += 360;
        gamepadActive.current = true;
        void window.api.sdk.motorJoystick(angle, length);
      }

      // Right stick Y → focus. Only Y matters; X is ignored.
      const rMag = Math.abs(ryDom);
      const nextFocusDir: 0 | 1 | null =
        rMag < DEAD_ZONE ? null : ryDom < 0 ? 1 : 0; // up=near(1), down=far(0)
      if (nextFocusDir !== focusDir) {
        focusDir = nextFocusDir;
        focusStepDeadline = 0; // fire immediately on direction change
      }
      if (focusDir !== null) {
        // Deflection past dead-zone (0..1) maps to step period 600 ms (slow)
        // → 120 ms (max). Keeps even a fully-pushed stick gentler than the
        // slider's `focusManualStart` continuous slew.
        const deflection = Math.min(1, (rMag - DEAD_ZONE) / (1 - DEAD_ZONE));
        const periodMs = 600 - 480 * deflection;
        const now = performance.now();
        if (now >= focusStepDeadline) {
          void window.api.sdk.focusStep(focusDir);
          focusStepDeadline = now + periodMs;
        }
        // While the right stick is engaged, keep the magnifier alive — each
        // ping resets its 5s fade timer, so it stays visible during long holds.
        window.dispatchEvent(new CustomEvent('dwarf:focus-active'));
      }
    }, POLL_MS);

    return () => {
      window.removeEventListener('gamepadconnected', onConnect);
      window.removeEventListener('gamepaddisconnected', onDisconnect);
      clearInterval(tick);
      if (gamepadActive.current) {
        gamepadActive.current = false;
        void window.api.sdk.motorJoystickStop();
      }
      // Step-mode focus has no "stop" to send — leaving the loop is enough.
      focusDir = null;
    };
  }, []);

  const speedLabel = speed === 'fast' ? 'fast' : speed === 'fine' ? 'fine' : 'norm';
  const speedColor = speed === 'fast'
    ? 'text-dwarf-accent'
    : speed === 'fine'
      ? 'text-blue-300/70'
      : 'text-white/30';

  return (
    <div className="absolute bottom-6 left-6 z-40 select-none">
      <div className="grid grid-cols-3 grid-rows-3 gap-1.5 p-2 rounded-2xl
                      bg-black/40 backdrop-blur-xl border border-white/10
                      shadow-2xl shadow-black/30">
        <div />
        <PadButton dir="up"    active={active.has('up')}    onPress={press} onRelease={release} />
        <div />
        <PadButton dir="left"  active={active.has('left')}  onPress={press} onRelease={release} />
        <div className={`w-10 h-10 flex items-center justify-center text-[9px] uppercase tracking-wider font-medium ${speedColor}`}>
          {speedLabel}
        </div>
        <PadButton dir="right" active={active.has('right')} onPress={press} onRelease={release} />
        <div />
        <PadButton dir="down"  active={active.has('down')}  onPress={press} onRelease={release} />
        <div />
      </div>
      <div className="mt-1.5 px-2 text-[10px] text-white/30 text-center leading-tight">
        ↑ ↓ ← → / WASD · diagonals OK<br />
        Shift = fast · Ctrl = fine
        {gamepadConnected && (
          <>
            <br />
            <span className="text-dwarf-accent/70">🎮 L = move · R = focus</span>
          </>
        )}
      </div>
    </div>
  );
}

function PadButton({
  dir, active, onPress, onRelease,
}: {
  dir: Direction;
  active: boolean;
  onPress: (d: Direction, s: Speed) => void;
  onRelease: (d: Direction) => void;
}) {
  return (
    <button
      type="button"
      onPointerDown={(e) => { e.preventDefault(); onPress(dir, speedFor(e)); }}
      onPointerUp={(e) => { e.preventDefault(); onRelease(dir); }}
      onPointerLeave={() => { if (active) onRelease(dir); }}
      onPointerCancel={() => { if (active) onRelease(dir); }}
      className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all
        ${active
          ? 'bg-dwarf-accent/30 text-white ring-1 ring-dwarf-accent/50'
          : 'text-white/55 hover:text-white hover:bg-white/10'
        }`}
      title={`${dir} (Shift = fast, Ctrl = fine)`}
    >
      <ArrowIcon dir={dir} />
    </button>
  );
}

function ArrowIcon({ dir }: { dir: Direction }) {
  const rotate = { up: 0, right: 90, down: 180, left: 270 }[dir];
  return (
    <svg
      className="w-4 h-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: `rotate(${rotate}deg)` }}
    >
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}
