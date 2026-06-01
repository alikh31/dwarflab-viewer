import { useCallback, useEffect, useRef, useState } from 'react';
import { useDeviceState } from '../../hooks/useDeviceState';
import { pushToast } from '../../hooks/useToasts';
import { LiveStackPreview } from './LiveStackPreview';
import type { DeviceStateSnapshot } from '../../lib/types';
import {
  computePreconditions,
  canStartStack,
  firstUnmet,
  isStackingMode,
  isStuckError,
  isStackActive,
  isStackTerminal,
  looksComplete,
  cameraLabel,
  formatElapsedMs,
  WEDGE_WATCHDOG_MS,
  STACK_STOPPING,
  type Precondition,
} from '../../lib/stacking';

type StackingJob = NonNullable<DeviceStateSnapshot['stackingJob']>;

interface Props {
  host: string;
  mainCamera: 'tele' | 'wide';
  onClose: () => void;
  onOpenAlbum: () => void;
  onOpenGoto: () => void;
  onOpenLocation: () => void;
}

type View = 'checklist' | 'running' | 'terminal';

/**
 * Full-screen stacking modal — the gated start + running-job dashboard.
 *
 * Mirrors the GotoDialog / EqAlignWizard overlay pattern
 * (`absolute inset-0 z-[60] bg-black/90 backdrop-blur-md`). Home for the
 * precondition checklist (gated start), the running dashboard with embedded
 * preview, cancel-with-confirm, the silent-wedge watchdog, and a secondary
 * "Reset astro" recovery footer (the PRIMARY recovery affordance is the
 * always-visible button in AstroPanel — STACKING_UX §6.1 delta).
 *
 * Lifecycle is driven by `deviceState.stackingJob` (the authoritative descriptor
 * from the viewer contract) — NOT liveStackingProgress nullness — so the panel
 * reflects device truth whether opened fresh, via the resume banner, or while a
 * job is already running. `state` is a string ('running'|'stopping'|'stopped'…).
 */
export function StackingPanel({
  host,
  mainCamera,
  onClose,
  onOpenAlbum,
  onOpenGoto,
  onOpenLocation,
}: Props) {
  const ds = useDeviceState();
  const [camera, setCamera] = useState<'tele' | 'wide'>(mainCamera);
  const [busy, setBusy] = useState(false);
  const [confirmingStop, setConfirmingStop] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [starting, setStarting] = useState(false);
  const [hasLocation, setHasLocation] = useState(false);
  const [wedgeWarning, setWedgeWarning] = useState(false);
  const [nowTick, setNowTick] = useState(() => 0); // drives the local elapsed clock
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Remember the last job so the terminal card can name target/count after the
  // job clears.
  const lastJobRef = useRef<StackingJob | null>(null);
  // Dismissable terminal card — lets "Stack again" return to the checklist.
  const [terminalDismissed, setTerminalDismissed] = useState(false);

  const job = ds.stackingJob;
  const state = job?.state ?? null;
  const active = isStackActive(state);
  const terminal = isStackTerminal(state);
  const stuck = isStuckError(ds.astroError);

  // Track the latest active job for the terminal card.
  useEffect(() => {
    if (job && isStackActive(job.state)) lastJobRef.current = job;
  }, [job]);

  // A new active job clears any stale terminal-dismissed flag.
  useEffect(() => {
    if (active) setTerminalDismissed(false);
  }, [active]);

  // ---- Location presence (settings OR device-reported) ----
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      window.api.settings
        .get<{ lon: number; lat: number }>('astro.location')
        .then((loc) => { if (alive) setHasLocation(loc != null || ds.astroLocation != null); })
        .catch(() => { if (alive) setHasLocation(ds.astroLocation != null); });
    };
    refresh();
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => { alive = false; window.removeEventListener('focus', onFocus); };
  }, [ds.astroLocation]);

  // ---- Local elapsed clock — tick once a second while a job runs ----
  useEffect(() => {
    if (!active || !job?.startedAt) return;
    setNowTick(Date.now());
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active, job?.startedAt]);

  // ---- Derived view ----
  const view: View = (() => {
    if (active) return 'running';
    if (terminal && !terminalDismissed) return 'terminal';
    if (starting && !job) return 'running'; // "Starting… waiting for first frame"
    return 'checklist';
  })();

  const preconditions = computePreconditions(ds, hasLocation);
  const startEnabled = canStartStack(ds, hasLocation) && isStackingMode(ds.shootingMode);
  const unmet = firstUnmet(ds, hasLocation);

  // ---- Watchdog: warn if a started stack produces no running job ----
  useEffect(() => {
    if (starting && !active) {
      if (watchdogRef.current) clearTimeout(watchdogRef.current);
      watchdogRef.current = setTimeout(() => setWedgeWarning(true), WEDGE_WATCHDOG_MS);
    } else {
      if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
      if (active) { setStarting(false); setWedgeWarning(false); }
    }
    return () => { if (watchdogRef.current) clearTimeout(watchdogRef.current); };
  }, [starting, active]);

  // ESC closes the modal but never stops a running job (STACKING_UX §9).
  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    if (confirmingStop) { setConfirmingStop(false); return; }
    if (confirmingReset) { setConfirmingReset(false); return; }
    onClose();
  }, [confirmingStop, confirmingReset, onClose]);

  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleKey]);

  // ---- Actions ----
  const handleStart = async () => {
    if (busy || !startEnabled) return;
    setBusy(true);
    setWedgeWarning(false);
    try {
      // The precondition chain is enforced by the gate above, so we do NOT pass
      // forceStart — a force-start past a real precondition gap silently wedges
      // the device (contract note). A synchronous -11501 lands in
      // deviceState.astroError automatically; we surface recovery off `stuck`.
      if (camera === 'tele') await window.api.sdk.astro.liveStackingTeleStart();
      else await window.api.sdk.astro.liveStackingWideStart();
      pushToast(`Stacking started (${camera})`, 'ok');
      setStarting(true);
    } catch (e) {
      pushToast(`Stacking failed: ${(e as Error).message}`, 'err');
    } finally {
      setBusy(false);
    }
  };

  // mode 'fast' = discard (11037/11038, default); 'slow' = finalize & save queued
  // frames (11006/11017, can take a minute). STACKING_UX §5.
  const doStop = async (mode: 'fast' | 'slow') => {
    setBusy(true);
    setConfirmingStop(false);
    try {
      const cam = job?.camera ?? camera;
      if (mode === 'slow') {
        if (cam === 'wide') await window.api.sdk.astro.liveStackingWideStopSlow();
        else await window.api.sdk.astro.liveStackingTeleStopSlow();
        pushToast(`Finalizing & saving (${cam})…`, 'ok');
      } else {
        if (cam === 'wide') await window.api.sdk.astro.liveStackingWideStop();
        else await window.api.sdk.astro.liveStackingTeleStop();
        pushToast(`Stacking stopped (${cam})`, 'ok');
      }
    } catch (e) {
      pushToast(`Stop failed: ${(e as Error).message}`, 'err');
    } finally {
      setBusy(false);
      setStarting(false);
    }
  };

  const doReset = async () => {
    setBusy(true);
    setConfirmingReset(false);
    try {
      // recoverStacking = the verified 6-command unstick; also clears astroError
      // and re-arms RTSP routes. Best-effort, never throws.
      const res = await window.api.sdk.astro.recoverStacking();
      setWedgeWarning(false);
      setStarting(false);
      if (res && res.failed && res.failed.length > 0) {
        pushToast(`Astro reset (with ${res.failed.length} warnings) — try again`, 'warn');
      } else {
        pushToast('Astro reset — try again', 'ok');
      }
    } catch (e) {
      pushToast(`Reset failed: ${(e as Error).message}`, 'err');
    } finally {
      setBusy(false);
    }
  };

  const stopping = state === STACK_STOPPING;

  return (
    <div className="absolute inset-0 z-[60] bg-black/90 backdrop-blur-md flex flex-col app-no-drag">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-14 pb-4 border-b border-white/10 app-no-drag">
        <div>
          <h2 className="text-lg font-medium text-white">
            Live stacking{view === 'running' && job ? ` · ${job.targetName || '(unnamed)'}` : ''}
          </h2>
          <div className="text-xs text-white/40 mt-0.5">
            {view === 'checklist' && 'Build a deep image by stacking many exposures'}
            {view === 'running' && (job
              ? (stopping ? 'Stopping…' : cameraLabel(job.camera))
              : 'Starting…')}
            {view === 'terminal' && (looksComplete(lastJobRef.current) ? 'Stack complete' : 'Stacking stopped')}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {view === 'running' && job && (
            <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-white/10 text-white/70">
              {cameraLabel(job.camera)}
            </span>
          )}
          <button
            onClick={onClose}
            className="app-no-drag w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 transition-colors flex items-center justify-center"
            aria-label="Close"
            title="Close (the job keeps running)"
          >
            <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18.36 5.64l-12.72 12.72" />
              <path d="M5.64 5.64l12.72 12.72" />
            </svg>
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-6 app-no-drag">
        {view === 'checklist' && (
          <ChecklistView
            preconditions={preconditions}
            camera={camera}
            onCamera={setCamera}
            startEnabled={startEnabled}
            unmetLabel={unmet?.label ?? null}
            busy={busy}
            stuck={stuck}
            onStart={handleStart}
            onOpenGoto={onOpenGoto}
            onOpenLocation={onOpenLocation}
            onSwitchMode={async () => {
              try { await window.api.sdk.switchMode(2); pushToast('Switched to DSO mode', 'ok'); }
              catch (e) { pushToast(`Mode switch failed: ${(e as Error).message}`, 'err'); }
            }}
            onCalibrate={onClose /* calibrate lives in AstroPanel; closing returns there */}
            onReset={() => setConfirmingReset(true)}
          />
        )}

        {view === 'running' && (
          <RunningView
            host={host}
            job={active ? job : null}
            elapsedMs={job?.startedAt ? Math.max(job.elapsedMs, nowTick - job.startedAt) : (job?.elapsedMs ?? 0)}
            progress={ds.liveStackingProgress}
            starting={starting && !active}
            stopping={stopping}
            wedgeWarning={wedgeWarning}
            onResetStuck={() => setConfirmingReset(true)}
          />
        )}

        {view === 'terminal' && (
          <TerminalCard
            complete={looksComplete(lastJobRef.current)}
            job={lastJobRef.current}
            onPrimary={looksComplete(lastJobRef.current) ? onOpenAlbum : () => setConfirmingReset(true)}
            primaryLabel={looksComplete(lastJobRef.current) ? 'View in album' : 'Reset astro'}
            onSecondary={() => { setTerminalDismissed(true); setStarting(false); }}
          />
        )}
      </div>

      {/* Footer: stop/confirm while running, secondary recovery otherwise */}
      <div className="px-6 py-3 border-t border-white/10 app-no-drag">
        {confirmingReset ? (
          <ConfirmRow
            text="This stops calibration, GoTo, EQ, and stacking to recover a stuck device. Continue?"
            cancelLabel="Cancel"
            confirmLabel={busy ? 'Resetting…' : 'Reset'}
            confirmTone="reset"
            busy={busy}
            onCancel={() => setConfirmingReset(false)}
            onConfirm={doReset}
          />
        ) : view === 'running' && active ? (
          confirmingStop ? (
            <StopConfirmRow
              busy={busy}
              stopping={stopping}
              onKeepGoing={() => setConfirmingStop(false)}
              onFinalize={() => doStop('slow')}
              onDiscard={() => doStop('fast')}
            />
          ) : (
            <div className="flex items-center justify-between">
              <button
                onClick={() => setConfirmingReset(true)}
                className="text-xs text-white/40 hover:text-white/70 transition-colors"
                title="Device stuck? Reset the astro pipeline"
              >
                Reset astro
              </button>
              <button
                onClick={() => setConfirmingStop(true)}
                disabled={busy || stopping}
                className="px-4 py-1.5 rounded-lg bg-dwarf-danger/90 hover:bg-dwarf-danger text-xs font-medium text-white transition-colors disabled:opacity-50"
              >
                {stopping ? 'Stopping…' : 'Stop stacking'}
              </button>
            </div>
          )
        ) : (
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-white/30">Trouble?</span>
            <button
              onClick={() => setConfirmingReset(true)}
              className="text-xs text-white/40 hover:text-white/70 transition-colors"
              title="Device stuck? Reset the astro pipeline"
            >
              Reset astro
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------- Checklist (gated start) -------------------- */

function ChecklistView({
  preconditions, camera, onCamera, startEnabled, unmetLabel, busy, stuck,
  onStart, onOpenGoto, onOpenLocation, onSwitchMode, onCalibrate, onReset,
}: {
  preconditions: Precondition[];
  camera: 'tele' | 'wide';
  onCamera: (c: 'tele' | 'wide') => void;
  startEnabled: boolean;
  unmetLabel: string | null;
  busy: boolean;
  stuck: boolean;
  onStart: () => void;
  onOpenGoto: () => void;
  onOpenLocation: () => void;
  onSwitchMode: () => void;
  onCalibrate: () => void;
  onReset: () => void;
}) {
  const fixFor = (id: Precondition['id']): { label: string; onClick: () => void } | null => {
    switch (id) {
      case 'location': return { label: 'Set location', onClick: onOpenLocation };
      case 'mode': return { label: 'Switch mode', onClick: onSwitchMode };
      case 'calibrated': return { label: 'Calibrate', onClick: onCalibrate };
      case 'goto': return { label: 'Choose target', onClick: onOpenGoto };
      default: return null;
    }
  };

  return (
    <div className="max-w-xl mx-auto flex flex-col gap-6">
      {/* Camera toggle */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-white/40 uppercase tracking-wider">Camera</span>
        <div className="flex rounded-lg overflow-hidden border border-white/10">
          {(['tele', 'wide'] as const).map((c) => (
            <button
              key={c}
              onClick={() => onCamera(c)}
              className={`px-4 py-1.5 text-xs font-medium transition-colors ${
                camera === c ? 'bg-dwarf-accent text-white' : 'text-white/50 hover:text-white hover:bg-white/5'
              }`}
            >
              {c === 'tele' ? 'Tele' : 'Wide'}
            </button>
          ))}
        </div>
      </div>

      {/* Precondition checklist */}
      <div className="flex flex-col gap-2">
        <span className="text-sm text-white/60">Before you can stack:</span>
        <ul className="flex flex-col gap-2">
          {preconditions.map((p) => {
            const fix = !p.done ? fixFor(p.id) : null;
            return (
              <li
                key={p.id}
                className="flex items-center gap-3 px-4 py-3 rounded-xl bg-black/40 border border-white/10"
              >
                <StatusIcon done={p.done} inProgress={p.inProgress} />
                <span className={`text-sm flex-1 ${p.done ? 'text-white' : 'text-white/60'}`}>
                  {p.label}
                </span>
                {fix && (
                  <button
                    onClick={fix.onClick}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-white/70 hover:text-white bg-white/5 hover:bg-white/10 transition-colors"
                  >
                    {fix.label}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {stuck && (
        <div className="px-4 py-3 rounded-xl bg-amber-400/10 border border-amber-400/30 flex items-center justify-between gap-3">
          <span className="text-xs text-amber-200">
            A previous stacking session is stuck.
          </span>
          <button
            onClick={onReset}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-amber-400/20 hover:bg-amber-400/30 transition-colors"
          >
            Reset astro
          </button>
        </div>
      )}

      {/* Start */}
      <div className="flex flex-col items-center gap-2">
        <button
          onClick={onStart}
          disabled={!startEnabled || busy}
          title={startEnabled ? 'Start live stacking' : (unmetLabel ? `${unmetLabel} first` : 'Complete the checklist first')}
          className="w-full px-6 py-3 rounded-full bg-dwarf-accent hover:bg-dwarf-accent-hover text-white text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy ? 'Starting…' : 'Start stacking'}
        </button>
        {!startEnabled && (
          <span className="text-xs text-white/40">
            {unmetLabel ? `${unmetLabel} first.` : 'Complete the checklist first.'}
          </span>
        )}
      </div>
    </div>
  );
}

/* -------------------- Running dashboard -------------------- */

function RunningView({
  host, job, elapsedMs, progress, starting, stopping, wedgeWarning, onResetStuck,
}: {
  host: string;
  job: StackingJob | null;
  elapsedMs: number;
  progress: DeviceStateSnapshot['liveStackingProgress'];
  starting: boolean;
  stopping: boolean;
  wedgeWarning: boolean;
  onResetStuck: () => void;
}) {
  if (starting || !job) {
    return (
      <div className="max-w-xl mx-auto flex flex-col items-center gap-6 py-8">
        <Spinner large />
        <div className="text-center">
          <h3 className="text-lg font-medium text-white">Starting…</h3>
          <p className="text-sm text-white/50 mt-1">Waiting for the first frame (this can take 10–20 s).</p>
        </div>
        {wedgeWarning && (
          <WedgeWarning onReset={onResetStuck} />
        )}
      </div>
    );
  }

  const total = job.totalCount;
  const stacked = job.stackedCount;
  // currentCount (captured) only lives on liveStackingProgress.
  const captured = progress?.currentCount ?? stacked;
  const pct = total > 0 ? Math.min(100, Math.round((stacked / total) * 100)) : null;
  const rejected = Math.max(0, captured - stacked);

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-6">
      <div className="flex flex-col md:flex-row gap-6">
        {/* Metrics */}
        <div className="flex-1 flex flex-col gap-4">
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-semibold text-white tabular-nums">{stacked}</span>
              <span className="text-lg text-white/40 tabular-nums">
                {total > 0 ? `/ ${total}` : ''} frames
              </span>
              {stopping && <span className="text-xs text-amber-200 ml-2">Stopping…</span>}
            </div>
          </div>

          {/* Progress bar */}
          {pct !== null ? (
            <div className="flex items-center gap-3">
              <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full bg-dwarf-accent transition-[width] duration-500" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-xs text-white/50 tabular-nums w-9 text-right">{pct}%</span>
            </div>
          ) : (
            <div className="h-2 rounded-full bg-white/10 overflow-hidden relative">
              <div className="absolute inset-y-0 w-1/3 bg-dwarf-accent/60 animate-pulse" />
            </div>
          )}

          <div className="flex flex-col gap-1 text-sm text-white/60 tabular-nums">
            <span>Elapsed <span className="text-white/80">{formatElapsedMs(elapsedMs)}</span></span>
            {rejected > 0 && <span className="text-white/50">Captured {captured} · {rejected} rejected</span>}
            {progress && (
              <span className="text-xs text-white/30">
                Exp idx {progress.expIndex} · Gain idx {progress.gainIndex}
              </span>
            )}
          </div>

          {wedgeWarning && <WedgeWarning onReset={onResetStuck} stalled />}
        </div>

        {/* Embedded preview */}
        <div className="md:w-[360px] shrink-0">
          <LiveStackPreview
            host={host}
            variant="embedded"
            sessionTag={`${job.targetName}-${job.totalCount}`}
          />
        </div>
      </div>
    </div>
  );
}

function WedgeWarning({ onReset, stalled }: { onReset: () => void; stalled?: boolean }) {
  return (
    <div className="px-4 py-3 rounded-xl bg-amber-400/10 border border-amber-400/30 flex items-center justify-between gap-3 w-full">
      <span className="text-xs text-amber-200">
        ⚠ {stalled ? 'Frames stalled.' : 'No frames yet.'} The device may be stuck.
      </span>
      <button
        onClick={onReset}
        className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-amber-400/20 hover:bg-amber-400/30 transition-colors whitespace-nowrap"
      >
        Stop &amp; reset astro
      </button>
    </div>
  );
}

/* -------------------- Terminal card -------------------- */

function TerminalCard({
  complete, job, onPrimary, primaryLabel, onSecondary,
}: {
  complete: boolean;
  job: StackingJob | null;
  onPrimary: () => void;
  primaryLabel: string;
  onSecondary: () => void;
}) {
  const ring = complete ? 'bg-emerald-400/15' : 'bg-amber-300/15';
  const color = complete ? 'text-emerald-400' : 'text-amber-300';
  const headline = complete ? 'Stack complete' : 'Stacking stopped';
  const stacked = job?.stackedCount ?? 0;
  return (
    <div className="max-w-md mx-auto text-center flex flex-col items-center gap-6 py-8">
      <div className={`w-24 h-24 rounded-full ${ring} flex items-center justify-center`}>
        {complete ? (
          <svg className={`w-12 h-12 ${color}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        ) : (
          <svg className={`w-12 h-12 ${color}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        )}
      </div>
      <div>
        <h3 className="text-2xl font-medium text-white mb-1">{headline}</h3>
        {job && (
          <p className="text-sm text-white/60 tabular-nums">
            {stacked} frame{stacked === 1 ? '' : 's'}
            {job.targetName ? ` of ${job.targetName}` : ''} · {cameraLabel(job.camera)}
            {!complete && ' · frames kept'}
          </p>
        )}
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={onSecondary}
          className="px-5 py-2.5 rounded-full text-sm font-medium text-white/70 hover:text-white hover:bg-white/10 transition-colors"
        >
          Stack again
        </button>
        <button
          onClick={onPrimary}
          className="px-5 py-2.5 rounded-full bg-dwarf-accent hover:bg-dwarf-accent-hover text-white text-sm font-medium transition-colors"
        >
          {primaryLabel}
        </button>
      </div>
    </div>
  );
}

/* -------------------- Shared bits -------------------- */

function ConfirmRow({
  text, cancelLabel, confirmLabel, confirmTone, busy, onCancel, onConfirm,
}: {
  text: string;
  cancelLabel: string;
  confirmLabel: string;
  confirmTone: 'danger' | 'reset';
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const confirmClass = confirmTone === 'danger'
    ? 'bg-dwarf-danger hover:bg-dwarf-danger/90'
    : 'bg-dwarf-danger/70 hover:bg-dwarf-danger/80';
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-xs text-white/60 flex-1">{text}</span>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onCancel}
          disabled={busy}
          className="px-3 py-1.5 rounded-lg text-xs font-medium text-white/60 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50"
        >
          {cancelLabel}
        </button>
        <button
          onClick={onConfirm}
          disabled={busy}
          className={`px-4 py-1.5 rounded-lg text-xs font-medium text-white transition-colors disabled:opacity-50 ${confirmClass}`}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}

/**
 * Stop confirmation with two terminal choices (STACKING_UX §5):
 *  - "Finalize & save" (slow-stop) — flushes queued frames before ending.
 *  - "Stop & discard" (fast-stop, danger) — immediate cut, loses the live stack.
 * Plus "Keep going" to dismiss.
 */
function StopConfirmRow({
  busy, stopping, onKeepGoing, onFinalize, onDiscard,
}: {
  busy: boolean;
  stopping: boolean;
  onKeepGoing: () => void;
  onFinalize: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-xs text-white/60 flex-1">
        Finalize saves the queued frames first (may take a minute); discard keeps
        already-saved frames but resets the live stack.
      </span>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onKeepGoing}
          disabled={busy}
          className="px-3 py-1.5 rounded-lg text-xs font-medium text-white/60 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50"
        >
          Keep going
        </button>
        <button
          onClick={onFinalize}
          disabled={busy || stopping}
          className="px-4 py-1.5 rounded-lg text-xs font-medium text-white bg-white/10 hover:bg-white/20 transition-colors disabled:opacity-50"
          title="Flush queued frames and save before stopping"
        >
          {stopping ? 'Finalizing…' : 'Finalize & save'}
        </button>
        <button
          onClick={onDiscard}
          disabled={busy}
          className="px-4 py-1.5 rounded-lg text-xs font-medium text-white bg-dwarf-danger hover:bg-dwarf-danger/90 transition-colors disabled:opacity-50"
        >
          Stop &amp; discard
        </button>
      </div>
    </div>
  );
}

function StatusIcon({ done, inProgress }: { done: boolean; inProgress: boolean }) {
  if (done) {
    return (
      <span className="w-5 h-5 rounded-full bg-emerald-400/20 flex items-center justify-center shrink-0">
        <svg className="w-3 h-3 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      </span>
    );
  }
  if (inProgress) return <Spinner />;
  return <span className="w-5 h-5 rounded-full border-2 border-white/20 shrink-0" />;
}

function Spinner({ large }: { large?: boolean }) {
  const size = large ? 'w-10 h-10' : 'w-5 h-5';
  return (
    <svg className={`${size} animate-spin text-dwarf-accent shrink-0`} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
