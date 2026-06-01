import { cameraLabel } from '../../lib/stacking';
import { pushToast } from '../../hooks/useToasts';
import type { DeviceStateSnapshot } from '../../lib/types';

type StackingJob = NonNullable<DeviceStateSnapshot['stackingJob']>;

interface Props {
  job: StackingJob;
  onView: () => void;
}

/**
 * Top-of-camera-view banner that surfaces a stacking job already in progress —
 * the case where the app reconnects mid-stack and the device re-pushes / the
 * main process re-queries the job (STACKING_UX §7.1). Mirrors GotoDialog's
 * "Currently slewing" banner styling.
 *
 * Driven by `stackingJob` (the authoritative descriptor), so it appears with
 * zero user action after a reconnect. "View" opens StackingPanel into the
 * running dashboard; "Stop" fast-stops the job (no confirm here — the banner is
 * a glanceable affordance; the modal carries the discard-confirm).
 */
export function StackingResumeBanner({ job, onView }: Props) {
  const { targetName, stackedCount, totalCount, camera, state } = job;
  const stopping = state === 'stopping';
  // On a fresh reconnect the job is seeded (camera+state) but counts/target only
  // fill in once the first re-pushed progress notif arrives (~seconds later).
  // Until then, show a simpler headline so we don't flash "0 / 0" / empty target.
  const hasDetail = stackedCount > 0 || !!targetName;

  const handleStop = async () => {
    try {
      if (camera === 'wide') await window.api.sdk.astro.liveStackingWideStop();
      else await window.api.sdk.astro.liveStackingTeleStop();
      pushToast(`Stacking stopped (${camera})`, 'ok');
    } catch (e) {
      pushToast(`Stop failed: ${(e as Error).message}`, 'err');
    }
  };

  return (
    <div className="absolute top-24 left-1/2 -translate-x-1/2 z-40 pointer-events-auto">
      <div className="flex items-center gap-3 px-4 py-2.5 rounded-full bg-dwarf-accent/15 backdrop-blur-xl border border-dwarf-accent/30 shadow-2xl shadow-black/30">
        <span className="w-2 h-2 rounded-full bg-dwarf-accent animate-pulse shrink-0" />
        <span className="text-sm text-white">
          {stopping ? 'Stopping stack' : 'Stacking'}
          {hasDetail ? (
            <>
              {' '}
              <b className="tabular-nums">{stackedCount}{totalCount > 0 ? ` / ${totalCount}` : ''}</b>
              {targetName ? <> of <b>{targetName}</b></> : ''}
            </>
          ) : (
            ' in progress'
          )}
          <span className="text-white/50"> · {cameraLabel(camera)}</span>
        </span>
        <button
          onClick={onView}
          className="px-3 py-1 rounded-full bg-white/10 hover:bg-white/20 text-xs font-medium text-white transition-colors"
        >
          View
        </button>
        <button
          onClick={handleStop}
          disabled={stopping}
          className="px-3 py-1 rounded-full bg-dwarf-danger/80 hover:bg-dwarf-danger text-xs font-medium text-white transition-colors disabled:opacity-50"
        >
          {stopping ? 'Stopping…' : 'Stop'}
        </button>
      </div>
    </div>
  );
}
