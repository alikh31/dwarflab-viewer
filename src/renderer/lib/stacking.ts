/**
 * Stacking UI constants & helpers.
 *
 * Aligned with the FINAL viewer data contract (STACKING_VIEWER_CONTRACT.md,
 * task #3) and STACKING_UX.md. Values still genuinely pending the analyst's
 * STACKING_SPEC.md (task #1) are flagged [SPEC] and centralized HERE so a
 * one-line change updates the whole UI.
 *
 * The renderer reads `stackingJob` (string `state`), `astroError`, and
 * `liveStackingProgress` off DeviceStateSnapshot, and calls
 * `window.api.sdk.astro.*`. We intentionally do NOT import the SDK enum into
 * the renderer — viewer-eng surfaces `state` as the SDK's string vocabulary
 * (`describeLiveStackingState`), so we match strings and keep the renderer
 * bundle free of main-process deps.
 */

import type { DeviceStateSnapshot } from './types';

// ---- Shooting modes ---------------------------------------------------------
// Verified: DSO = 2. [SPEC] Milky Way (id=4) applicability TBC by analyst
// (STACKING_UX §2.3 / §10 Q1). Listed but NOT yet enabled until confirmed.
export const DSO_MODE = 2;
export const MILKY_WAY_MODE = 4;

/** Modes in which stacking is meaningful. [SPEC] add MILKY_WAY_MODE if confirmed. */
export const STACKING_MODES: readonly number[] = [DSO_MODE];

export function isStackingMode(mode: number | null): boolean {
  return mode !== null && STACKING_MODES.includes(mode);
}

// ---- GoTo tracking state ----------------------------------------------------
// [SPEC] which gotoState.state int means "locked on target, safe to stack"?
// (STACKING_UX §2.1 / §10 Q3). Until confirmed we treat any non-null gotoState
// whose state is in this set as "tracking". Centralised for a one-line flip.
export const GOTO_TRACKING_STATES: readonly number[] = [1, 2];

export function isTrackingState(state: number | null | undefined): boolean {
  return state != null && GOTO_TRACKING_STATES.includes(state);
}

// ---- Live-stacking state (string vocabulary from the contract) --------------
// stackingJob.state is one of these strings (from the SDK's
// describeLiveStackingState). 'unknown(<n>)' is possible for unmapped ints.
export const STACK_RUNNING = 'running';
export const STACK_STOPPING = 'stopping';
export const STACK_STOPPED = 'stopped';
export const STACK_IDLE = 'idle';

/** Active = a job is accumulating or finishing (RUNNING or STOPPING). */
export function isStackActive(state: string | null | undefined): boolean {
  return state === STACK_RUNNING || state === STACK_STOPPING;
}

/** Terminal = the job has ended (STOPPED). IDLE = never really started. */
export function isStackTerminal(state: string | null | undefined): boolean {
  return state === STACK_STOPPED;
}

type StackingJob = NonNullable<DeviceStateSnapshot['stackingJob']>;

/**
 * Did the stack reach its planned frame count? The firmware cannot distinguish
 * success from failure (both report 'stopped'), so we INFER a "complete" tone
 * from the counts (STACKING_UX §4.4 / reconciliation): completed iff a target
 * count was set and we met it. Otherwise show a neutral "stopped" tone — never
 * label it "failed", since we can't prove failure.
 */
export function looksComplete(job: StackingJob | null): boolean {
  if (!job) return false;
  return job.totalCount > 0 && job.stackedCount >= job.totalCount;
}

// ---- Error codes ------------------------------------------------------------
// Astro response codes (verified live).
// These land in deviceState.astroError {code,cmd,at} (set by the main process) AND
// are embedded in the start-call's thrown message ("...code -11513"). The UI
// watches astroError?.code as the primary signal.
//
// qa2 LIVE FINDING (B2): a bare start without GoTo replies -11513 (NEED_GOTO) and
// emits a ~20s PHANTOM run/stop cycle with no real frames — NOT a -11501 wedge.
// So the NEED_* codes are "precondition missing, recoverable by doing the step"
// and must map to step-specific guidance; only -11501 means a stuck session that
// needs the recover sequence.
export const CODE_ASTRO_FUNCTION_BUSY = -11501; // stuck session → Reset astro
export const CODE_NEED_CALIBRATION = -11511;
export const CODE_NEED_GOTO = -11513;
export const CODE_NEED_ADJUST_SHOOT_PARAM = -11514;
export const CODE_NEED_GOTO_DSO = -11518;
export const CODE_NEED_EQ = -11528;

/** Codes meaning "a precondition is missing" (recoverable by completing the step). */
export const PRECONDITION_ERROR_CODES: readonly number[] = [
  CODE_NEED_CALIBRATION,
  CODE_NEED_GOTO,
  CODE_NEED_GOTO_DSO,
  CODE_NEED_ADJUST_SHOOT_PARAM,
  CODE_NEED_EQ,
];

export function isStuckError(astroError: DeviceStateSnapshot['astroError']): boolean {
  return astroError?.code === CODE_ASTRO_FUNCTION_BUSY;
}

export function isPreconditionError(code: number | null | undefined): boolean {
  return code != null && PRECONDITION_ERROR_CODES.includes(code);
}

/**
 * Maps an astro error code to a step-specific user message + which precondition
 * to point the user at (for opening the relevant fix). Used as a backstop to the
 * hard-gate: should rarely fire, but if the device disagrees with our client view
 * we surface ITS reason instead of silently confusing the user (qa2's phantom
 * cycle). Returns null for unmapped codes.
 */
export interface AstroErrorGuidance {
  message: string;
  /** Which precondition / panel this error points at, if any. */
  fix: 'calibrate' | 'goto' | 'params' | 'eq' | 'recover' | null;
}

export function describeAstroError(code: number | null | undefined): AstroErrorGuidance | null {
  switch (code) {
    case CODE_ASTRO_FUNCTION_BUSY:
      return { message: 'A previous astro session is stuck — reset astro to recover.', fix: 'recover' };
    case CODE_NEED_CALIBRATION:
      return { message: 'Calibrate first.', fix: 'calibrate' };
    case CODE_NEED_GOTO:
    case CODE_NEED_GOTO_DSO:
      return { message: 'GoTo a target first.', fix: 'goto' };
    case CODE_NEED_ADJUST_SHOOT_PARAM:
      return { message: 'Adjust exposure / gain — the image may be overexposed.', fix: 'params' };
    case CODE_NEED_EQ:
      return { message: 'Polar-align (EQ) required first.', fix: 'eq' };
    default:
      return null;
  }
}

// ---- Watchdog ---------------------------------------------------------------
// [SPEC] confirm a real "no frames within X s => wedged" figure (STACKING_UX
// §3.3 / §10 Q8). Design default: 30 s.
export const WEDGE_WATCHDOG_MS = 30_000;

// ---- Camera -----------------------------------------------------------------
export function cameraLabel(camera: 'tele' | 'wide' | null | undefined): 'Tele' | 'Wide' {
  return camera === 'wide' ? 'Wide' : 'Tele';
}

// liveStackingProgress.cameraType is still a number (0 tele / 1 wide).
export function cameraTypeLabel(cameraType: number | null | undefined): 'Tele' | 'Wide' {
  return cameraType === 1 ? 'Wide' : 'Tele';
}

// ---- Precondition chain -----------------------------------------------------
// The verified gate: a stack must NOT be startable without location + DSO mode +
// calibration + GoTo-tracking (STACKING_UX §2.1). `hasLocation` is sourced from
// the local astro.location setting OR ds.astroLocation, so it's passed in.
export interface Precondition {
  id: 'location' | 'mode' | 'calibrated' | 'goto';
  label: string;
  done: boolean;
  /** True while this step is actively in progress (shows a spinner). */
  inProgress: boolean;
}

export function computePreconditions(
  ds: DeviceStateSnapshot,
  hasLocation: boolean,
): Precondition[] {
  return [
    {
      id: 'location',
      label: 'Location set',
      done: hasLocation,
      inProgress: false,
    },
    {
      id: 'mode',
      label: 'DSO mode',
      done: isStackingMode(ds.shootingMode),
      inProgress: false,
    },
    {
      id: 'calibrated',
      label: 'Calibrate',
      done: ds.calibrationResult !== null,
      inProgress: ds.calibrationState !== null && ds.calibrationResult === null,
    },
    {
      id: 'goto',
      label: 'GoTo a target',
      done: ds.gotoState !== null && isTrackingState(ds.gotoState.state),
      inProgress: ds.gotoState !== null && !isTrackingState(ds.gotoState.state),
    },
  ];
}

/** True iff every precondition is satisfied — the gate for the Start button. */
export function canStartStack(ds: DeviceStateSnapshot, hasLocation: boolean): boolean {
  return computePreconditions(ds, hasLocation).every((p) => p.done);
}

/** First unmet precondition's label, for the disabled-Start tooltip. */
export function firstUnmet(ds: DeviceStateSnapshot, hasLocation: boolean): Precondition | null {
  return computePreconditions(ds, hasLocation).find((p) => !p.done) ?? null;
}

// ---- Elapsed formatting -----------------------------------------------------
/** Format ms as m:ss or h:mm:ss. */
export function formatElapsedMs(ms: number): string {
  const s = Math.max(0, Math.floor((ms || 0) / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`;
}
