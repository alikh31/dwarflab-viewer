import { useState, useEffect } from 'react';
import { StatusIndicator } from './StatusIndicator';
import { ModePanel } from './toolbar/ModePanel';
import { ParamsPanel } from './toolbar/ParamsPanel';
import { TrackingPanel } from './toolbar/TrackingPanel';
import { FilterPanel } from './toolbar/FilterPanel';
import { AstroPanel } from './toolbar/AstroPanel';
import { pushToast } from '../hooks/useToasts';
import type { DeviceStateSnapshot } from '../lib/types';

type PanelId = 'mode' | 'params' | 'tracking' | 'filter' | 'astro';

interface Props {
  deviceState: DeviceStateSnapshot;
  mainCamera: 'tele' | 'wide';
  onDisconnect: () => void;
  onOpenAlbum: () => void;
  onOpenEqWizard: () => void;
  onOpenGoto: () => void;
  onOpenLocation: () => void;
  onOpenStacking: () => void;
}

export function ControlBar({
  deviceState,
  mainCamera,
  onDisconnect,
  onOpenAlbum,
  onOpenEqWizard,
  onOpenGoto,
  onOpenLocation,
  onOpenStacking,
}: Props) {
  const [takingPhoto, setTakingPhoto] = useState(false);
  const [expanded, setExpanded] = useState<PanelId | null>(null);
  // Two-tap confirm for cancelling a *stack* via the shutter ring — a stray tap
  // shouldn't discard a long stack. Burst keeps its immediate-stop behaviour
  // (cheap to restart). Auto-resets after a few seconds.
  const [confirmStackCancel, setConfirmStackCancel] = useState(false);
  const [shotCount, setShotCount] = useState<number>(() => {
    const stored = Number(localStorage.getItem('dwarf.shotCount'));
    return Number.isFinite(stored) && stored >= 1 ? stored : 1;
  });

  // Stay in sync with ParamsPanel's shot-count slider — fired via custom event.
  useEffect(() => {
    const onShotCount = (e: Event) => {
      const n = (e as CustomEvent<number>).detail;
      if (typeof n === 'number') setShotCount(n);
    };
    window.addEventListener('dwarf:shot-count', onShotCount);
    return () => window.removeEventListener('dwarf:shot-count', onShotCount);
  }, []);

  // The shutter button represents whichever long-running capture is in
  // flight — a burst, or a live-stacking session. Both drive the same
  // progress ring; clicking the button mid-operation stops it.
  //
  // Live stacking uses the authoritative `stackingJob` (string state) — NOT
  // liveStackingProgress nullness — so the ring stays up through the gap before
  // the first progress notif and across a reconnect. Counts come from the job.
  const burst = deviceState.burstProgress;
  const job = deviceState.stackingJob;
  const stackActive = job != null && (job.state === 'running' || job.state === 'stopping');
  const activeOp: {
    kind: 'burst' | 'stack';
    completed: number;
    total: number;
  } | null = burst
    ? { kind: 'burst', completed: burst.completedCount, total: burst.totalCount }
    : stackActive
      ? { kind: 'stack', completed: job!.stackedCount, total: job!.totalCount }
      : null;

  // Auto-clear the stack-cancel confirm if the user doesn't follow through.
  useEffect(() => {
    if (!confirmStackCancel) return;
    const id = setTimeout(() => setConfirmStackCancel(false), 3000);
    return () => clearTimeout(id);
  }, [confirmStackCancel]);

  const handlePhoto = async () => {
    if (activeOp?.kind === 'burst') {
      try {
        // Stop the camera the burst is actually running on (from the progress
        // notif's cameraType: 0=tele, 1=wide), not whichever camera is
        // currently the main view — they can differ if the user switched.
        const burstCam = burst?.cameraType === 1 ? 'wide' : 'tele';
        if (burstCam === 'wide') await window.api.sdk.stopBurstWide();
        else await window.api.sdk.stopBurstTele();
      } catch (err) {
        console.error('Burst stop failed:', err);
      }
      return;
    }
    if (activeOp?.kind === 'stack') {
      // First tap arms the confirm; second tap within the window stops.
      if (!confirmStackCancel) {
        setConfirmStackCancel(true);
        return;
      }
      setConfirmStackCancel(false);
      try {
        // Cancel == fast-stop (11037/11038). Use the camera the session is on.
        if (job?.camera === 'wide') await window.api.sdk.astro.liveStackingWideStop();
        else await window.api.sdk.astro.liveStackingTeleStop();
      } catch (err) {
        console.error('Stack stop failed:', err);
      }
      return;
    }
    setTakingPhoto(true);
    try {
      const count = Number(shotCount);
      if (count > 1) {
        // Starting a burst first puts the device into the BURST shooting
        // technique (main-process ensureBurstTech, BURST_SPEC §1.4). That can
        // quietly switch the device out of whatever mode/tech it was in, so
        // surface a brief, non-blocking notice explaining the change. The
        // stack-active case never reaches here (handled above as cancel), so
        // this can't disrupt a running stack.
        pushToast('Preparing burst…', 'ok');
        if (mainCamera === 'tele') await window.api.sdk.startBurstTele(count);
        else await window.api.sdk.startBurstWide(count);
      } else {
        if (mainCamera === 'tele') await window.api.sdk.takePhotoTele();
        else await window.api.sdk.takePhotoWide();
      }
    } catch (err) {
      console.error('Photo failed:', err);
    } finally {
      setTimeout(() => setTakingPhoto(false), 300);
    }
  };

  const toggle = (panel: PanelId) => {
    setExpanded((prev) => (prev === panel ? null : panel));
  };

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2">
      {/* Expanded panel */}
      {expanded && (
        <div
          className="px-5 py-3 rounded-2xl bg-black/50 backdrop-blur-xl
                     border border-white/10 shadow-2xl shadow-black/30
                     animate-in slide-in-from-bottom-2 duration-150"
        >
          {expanded === 'mode' && <ModePanel onClose={() => setExpanded(null)} />}
          {expanded === 'params' && <ParamsPanel mainCamera={mainCamera} />}
          {expanded === 'tracking' && <TrackingPanel />}
          {expanded === 'filter' && <FilterPanel />}
          {expanded === 'astro' && (
            <AstroPanel
              onOpenEqWizard={onOpenEqWizard}
              onOpenGoto={onOpenGoto}
              onOpenLocation={onOpenLocation}
              onOpenStacking={() => { setExpanded(null); onOpenStacking(); }}
              onClose={() => setExpanded(null)}
            />
          )}
        </div>
      )}

      {/* Main toolbar */}
      <div
        className="flex items-center gap-3 px-5 py-3 rounded-full
                    bg-black/40 backdrop-blur-xl border border-white/10
                    shadow-2xl shadow-black/30"
      >
        {/* Status */}
        <StatusIndicator
          connected={deviceState.connected}
          battery={deviceState.batteryPercentage}
          charging={deviceState.charging ?? false}
        />

        <div className="w-px h-6 bg-white/10" />

        {/* Panel toggles */}
        <ToolbarButton
          label="Mode"
          active={expanded === 'mode'}
          onClick={() => toggle('mode')}
        />
        <ToolbarButton
          label="Params"
          active={expanded === 'params'}
          onClick={() => toggle('params')}
        />
        <ToolbarButton
          label="Track"
          active={expanded === 'tracking'}
          onClick={() => toggle('tracking')}
        />
        <ToolbarButton
          label="Astro"
          active={expanded === 'astro'}
          onClick={() => toggle('astro')}
        />
        <ToolbarButton
          label="Filter"
          active={expanded === 'filter'}
          onClick={() => toggle('filter')}
        />
        <button
          onClick={onOpenAlbum}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all
                     text-white/50 hover:text-white/80 hover:bg-white/5"
          title="Browse album"
        >
          Album
        </button>

        <div className="w-px h-6 bg-white/10" />

        {/* Shutter button — also doubles as Cancel for in-flight burst /
            live-stacking. Progress ring wraps the button while either is
            running. For stacks, a small "details" chevron opens StackingPanel,
            and cancelling needs a two-tap confirm. */}
        <div className="relative w-14 h-14 flex items-center justify-center">
          {activeOp && (
            <BurstRing
              total={activeOp.total}
              completed={activeOp.completed}
            />
          )}
          <button
            onClick={handlePhoto}
            disabled={takingPhoto}
            className={`w-12 h-12 rounded-full transition-all duration-150
                       flex items-center justify-center disabled:opacity-50
                       ring-2 ring-offset-2 ring-offset-transparent
                       ${activeOp
                         ? (confirmStackCancel
                             ? 'bg-dwarf-danger hover:bg-dwarf-danger ring-dwarf-danger/60 animate-pulse'
                             : 'bg-dwarf-danger hover:bg-dwarf-danger/90 ring-dwarf-danger/30')
                         : 'bg-white/90 hover:bg-white ring-white/20'}
                       ${takingPhoto ? 'scale-90' : 'active:scale-95'}`}
            title={
              activeOp
                ? (activeOp.kind === 'stack'
                    ? (confirmStackCancel
                        ? 'Tap again to stop the stack'
                        : `Stacking ${activeOp.completed}/${activeOp.total || '?'} — tap to cancel`)
                    : `Burst ${activeOp.completed}/${activeOp.total || '?'} — tap to cancel`)
                : (shotCount > 1 ? `Burst ${shotCount} shots` : 'Take photo')
            }
          >
            {activeOp ? (
              // White × glyph on a red background while a capture is in flight.
              <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            ) : (
              <div className="w-10 h-10 rounded-full border-[2.5px] border-black/15" />
            )}
          </button>
          {/* Details chevron — opens the stacking dashboard (stacks only). */}
          {activeOp?.kind === 'stack' && (
            <button
              onClick={onOpenStacking}
              className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-black/60 backdrop-blur-sm
                         border border-white/15 flex items-center justify-center
                         text-white/70 hover:text-white hover:bg-black/80 transition-colors"
              title="Stacking details"
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          )}
        </div>

        {/* Disconnect button */}
        <button
          onClick={onDisconnect}
          className="w-9 h-9 rounded-full bg-dwarf-danger/80 hover:bg-dwarf-danger
                    transition-colors flex items-center justify-center"
          title="Disconnect"
        >
          <svg
            className="w-4 h-4 text-white"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M18.36 5.64l-12.72 12.72" />
            <path d="M5.64 5.64l12.72 12.72" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function ToolbarButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all
        ${active
          ? 'bg-dwarf-accent/25 text-white'
          : 'text-white/50 hover:text-white/80 hover:bg-white/5'
        }`}
    >
      {label}
      <svg
        className={`w-3 h-3 transition-transform ${active ? 'rotate-180' : ''}`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
      >
        <path d="M18 15l-6-6-6 6" />
      </svg>
    </button>
  );
}

/**
 * Ring of green cells around the shutter button showing burst progress.
 * Each cell is a tiny rectangle placed on a circle; completed cells light
 * up green, pending cells stay dim. Built as SVG so the ring scales cleanly
 * and the cells stay sharp at any DPR.
 */
function BurstRing({ total, completed }: { total: number; completed: number }) {
  const size = 56;
  const radius = 25;
  const center = size / 2;
  const cellW = 3;
  const cellH = 6;
  // Cap at 60 visible cells — beyond that they merge into a circle anyway.
  const n = Math.max(1, Math.min(total, 60));
  const cells: { x: number; y: number; rot: number; lit: boolean }[] = [];
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * 360 - 90;
    const rad = (angle * Math.PI) / 180;
    cells.push({
      x: center + radius * Math.cos(rad),
      y: center + radius * Math.sin(rad),
      rot: angle + 90,
      lit: i < completed,
    });
  }
  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
    >
      {cells.map((c, i) => (
        <rect
          key={i}
          x={c.x - cellW / 2}
          y={c.y - cellH / 2}
          width={cellW}
          height={cellH}
          rx={1}
          fill={c.lit ? '#22c55e' : 'rgba(255,255,255,0.15)'}
          transform={`rotate(${c.rot} ${c.x} ${c.y})`}
        />
      ))}
    </svg>
  );
}
