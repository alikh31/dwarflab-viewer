import { useState, useCallback, useEffect, useRef } from 'react';
import { MjpegStream } from './MjpegStream';
import { PipOverlay } from './PipOverlay';
import { ControlBar } from './ControlBar';
import { FocusSlider } from './FocusSlider';
import { AlbumPanel } from './AlbumPanel';
import { ToastStack } from './ToastStack';
import { DirectionPad } from './DirectionPad';
import { FocusMagnifier } from './FocusMagnifier';
import { LocationDialog } from './LocationDialog';
import { EqAlignWizard } from './astro/EqAlignWizard';
import { GotoDialog } from './astro/GotoDialog';
import { LiveStackPreview } from './astro/LiveStackPreview';
import { StackingPanel } from './astro/StackingPanel';
import { StackingResumeBanner } from './astro/StackingResumeBanner';
import { useDeviceState } from '../hooks/useDeviceState';
import { pushToast } from '../hooks/useToasts';
import { describeAstroError } from '../lib/stacking';

interface Props {
  host: string;
  onDisconnect: () => void;
}

type CameraId = 'tele' | 'wide';

interface StoredLocation { lon: number; lat: number }

export function CameraView({ host, onDisconnect }: Props) {
  const [mainCamera, setMainCamera] = useState<CameraId>('tele');
  const [swapping, setSwapping] = useState(false);
  const [proxyPort, setProxyPort] = useState<number | null>(null);
  const [albumOpen, setAlbumOpen] = useState(false);
  const [eqWizardOpen, setEqWizardOpen] = useState(false);
  const [gotoOpen, setGotoOpen] = useState(false);
  const [stackingOpen, setStackingOpen] = useState(false);
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  const [storedLocation, setStoredLocation] = useState<StoredLocation | null>(null);
  // Severe-failure banner: the main stream stayed dead even after the RTSP
  // re-arm — likely the daemon died and only a reboot recovers it (STACKING_UX
  // §4.4). Dismissible; auto-clears if the stream recovers.
  const [streamDead, setStreamDead] = useState(false);
  const [rebootBannerDismissed, setRebootBannerDismissed] = useState(false);
  const deviceState = useDeviceState();

  // Authoritative "a stack is active" signal (running OR stopping), from the
  // stackingJob descriptor — persists across the first-progress gap + reconnect.
  const stackJob = deviceState.stackingJob;
  const stackActive = stackJob != null && (stackJob.state === 'running' || stackJob.state === 'stopping');

  // PHANTOM-RESUME HARDENING (qa2): the firmware can emit a ~20s phantom cycle
  // (15208 state 1→3) with NO real frames — or re-push a stale RUNNING state on
  // reconnect. The phantom's reliable tell is stackedCount==0 for its whole life
  // (it never folds a real frame), whereas a genuine resumed job accumulates
  // frames within seconds (viewer-eng's resync seeds counts from the first
  // re-pushed 15209). So we only surface the resume banner/toast/preview once the
  // job actually has at least one stacked frame. A real job with frames surfaces
  // immediately; a phantom (always 0 frames) never does, regardless of how long
  // its RUNNING window lasts. Combined with M2 gating (can't bare-start via the
  // UI), this fully defends the reconnect/resume surfaces.
  const stackSurfaceable = stackActive && (stackJob?.stackedCount ?? 0) > 0;

  useEffect(() => {
    window.api.stream.getProxyPort().then(setProxyPort);
  }, []);

  // Keep the stored location in sync so EQ wizard always has a fresh value to
  // pass into eqSolvingStart. Refresh on mount and whenever the LocationDialog
  // closes (handled below).
  const reloadLocation = useCallback(() => {
    window.api.settings
      .get<StoredLocation>('astro.location')
      .then((loc) => setStoredLocation(loc ?? null))
      .catch(() => { /* ignore */ });
  }, []);

  useEffect(() => {
    reloadLocation();
  }, [reloadLocation]);

  // One-time "resumed" toast when an active stacking job APPEARS while the modal
  // is closed — i.e. the reconnect-mid-stack / externally-started case. If the
  // user started it via StackingPanel, the modal is open and they already saw a
  // "Stacking started" toast, so we suppress the duplicate. STACKING_UX §7.1
  // (banner is the durable signal; this toast is the attention-grab).
  const announcedJobRef = useRef(false);
  useEffect(() => {
    // Gate on stackSurfaceable (not raw stackActive) so a ~20s phantom RUNNING
    // tail never produces a spurious "resumed" toast.
    if (stackSurfaceable && !stackingOpen) {
      if (!announcedJobRef.current) {
        announcedJobRef.current = true;
        pushToast('Stacking in progress — resumed', 'ok');
      }
    } else if (!stackActive) {
      announcedJobRef.current = false;
    }
  }, [stackSurfaceable, stackActive, stackingOpen]);

  // Astro-error backstop (STACKING_UX §7.2): if the device rejects an astro op
  // with a NEED_* / BUSY code, surface ITS reason as a step-specific toast — a
  // safety net behind the hard-gate. -11501 is handled by the always-visible
  // Reset affordance + StackingPanel; here we guide the recoverable NEED_* cases
  // (notably qa2's verified -11513 bare-start). De-duped by astroError.at.
  const lastAstroErrAtRef = useRef<number>(0);
  useEffect(() => {
    const err = deviceState.astroError;
    if (!err || err.at === lastAstroErrAtRef.current) return;
    lastAstroErrAtRef.current = err.at;
    const guidance = describeAstroError(err.code);
    if (!guidance) return;
    if (guidance.fix === 'recover') {
      // -11501 stuck: the Reset affordance is already prominent; gentle warn.
      pushToast(guidance.message, 'warn');
      return;
    }
    // Precondition missing: tell the user the device's reason + jump to the fix.
    pushToast(guidance.message, 'warn');
    if (guidance.fix === 'goto') setGotoOpen(true);
    else if (guidance.fix === 'eq') setEqWizardOpen(true);
    // 'calibrate' / 'params' live in the toolbar panels; the toast guides there.
  }, [deviceState.astroError]);

  // RTSP rearm toast (STACKING_UX §4.4): the main process re-arms the RTSP
  // routes on a terminal stacking transition (the firmware drops them during
  // stacking), causing a ~1.5s stream gap. Surface a brief "Restoring live
  // view…" so that gap isn't mistaken for a freeze. Fire on active→inactive.
  // Track the SURFACEABLE transition: a phantom that never became surfaceable
  // shouldn't trigger a "Restoring live view…" toast when it self-clears.
  const wasStackSurfaceableRef = useRef(false);
  useEffect(() => {
    if (wasStackSurfaceableRef.current && !stackActive) {
      pushToast('Restoring live view…', 'ok');
    }
    wasStackSurfaceableRef.current = stackSurfaceable;
  }, [stackSurfaceable, stackActive]);

  // Use local RTSP→fMP4 proxy (ffmpeg remuxes H.265 RTSP to fragmented MP4, no transcode)
  const teleUrl = proxyPort ? `http://127.0.0.1:${proxyPort}/tele` : '';
  const wideUrl = proxyPort ? `http://127.0.0.1:${proxyPort}/wide` : '';

  const mainUrl = mainCamera === 'tele' ? teleUrl : wideUrl;
  const pipUrl = mainCamera === 'tele' ? wideUrl : teleUrl;
  const mainLabel = mainCamera === 'tele' ? 'Telephoto' : 'Wide';
  const pipLabel = mainCamera === 'tele' ? 'Wide' : 'Tele';

  const handleSwap = useCallback(() => {
    if (swapping) return;
    setSwapping(true);
    setTimeout(() => {
      setMainCamera((prev) => (prev === 'tele' ? 'wide' : 'tele'));
      setSwapping(false);
    }, 200);
  }, [swapping]);

  return (
    <div className="relative h-full w-full bg-black">
      {/* Main camera — fills entire window */}
      <div
        className={`absolute inset-0 transition-opacity duration-200 ${
          swapping ? 'opacity-0' : 'opacity-100'
        }`}
      >
        <MjpegStream
          src={mainUrl}
          alt={`${mainLabel} camera`}
          cameraId={mainCamera}
          className="h-full w-full"
          onStreamFailed={() => { setStreamDead(true); setRebootBannerDismissed(false); }}
          onStreamRecovered={() => setStreamDead(false)}
        />
      </div>

      {/* Severe-failure banner — the stream stayed dead even after RTSP re-arm;
          likely needs a device reboot (NOT an astro-reset). Dismissible. */}
      {streamDead && !rebootBannerDismissed && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 z-50 pointer-events-auto">
          <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-amber-400/15 backdrop-blur-xl border border-amber-400/30 shadow-2xl shadow-black/30">
            <svg className="w-4 h-4 text-amber-300 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <span className="text-sm text-amber-100">
              Live view unavailable — the device may need a reboot.
            </span>
            <button
              onClick={onDisconnect}
              className="px-3 py-1 rounded-full bg-white/10 hover:bg-white/20 text-xs font-medium text-white transition-colors"
              title="Disconnect and reconnect"
            >
              Reconnect
            </button>
            <button
              onClick={() => setRebootBannerDismissed(true)}
              className="text-amber-200/70 hover:text-amber-100 px-1"
              title="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Camera label */}
      <div className="absolute top-14 left-1/2 -translate-x-1/2 z-30">
        <div className="px-3 py-1 rounded-full bg-black/30 backdrop-blur-sm text-xs text-white/60 font-medium">
          {mainLabel}
        </div>
      </div>

      {/* PiP overlay — small draggable camera in bottom-left */}
      <PipOverlay src={pipUrl} label={pipLabel} cameraId={mainCamera === 'tele' ? 'wide' : 'tele'} onTap={handleSwap} />

      {/* Focus control strip — right edge */}
      <FocusSlider />

      {/* Direction pad — bottom-left, also responds to arrow keys / WASD */}
      <DirectionPad />

      {/* Focus loupe — appears bottom-right while focusing, fades out after 5s */}
      <FocusMagnifier />

      {/* Live stacking preview — floating, shown only while a stack is
          surfaceable (active + past the phantom grace) AND the modal is closed
          (the modal embeds its own copy). */}
      {stackSurfaceable && stackJob && !stackingOpen && (
        <LiveStackPreview
          host={host}
          variant="floating"
          sessionTag={`${stackJob.targetName}-${stackJob.totalCount}`}
        />
      )}

      {/* Resume banner — surfaces an active job (e.g. after reconnect mid-stack).
          Gated on stackSurfaceable so a ~20s phantom RUNNING tail never paints a
          job the user never started. Hidden while the modal is open. */}
      {stackSurfaceable && stackJob && !stackingOpen && (
        <StackingResumeBanner
          job={stackJob}
          onView={() => setStackingOpen(true)}
        />
      )}

      {/* Floating control bar */}
      <ControlBar
        deviceState={deviceState}
        mainCamera={mainCamera}
        onDisconnect={onDisconnect}
        onOpenAlbum={() => setAlbumOpen(true)}
        onOpenEqWizard={() => setEqWizardOpen(true)}
        onOpenGoto={() => setGotoOpen(true)}
        onOpenLocation={() => setLocationDialogOpen(true)}
        onOpenStacking={() => setStackingOpen(true)}
      />

      {/* Album overlay */}
      {albumOpen && <AlbumPanel onClose={() => setAlbumOpen(false)} />}

      {/* Astro overlays — z-[60]/[70], sit above ControlBar's z-50 */}
      {eqWizardOpen && (
        <EqAlignWizard
          onClose={() => setEqWizardOpen(false)}
          location={storedLocation}
        />
      )}
      {gotoOpen && <GotoDialog onClose={() => setGotoOpen(false)} />}
      {stackingOpen && (
        <StackingPanel
          host={host}
          mainCamera={mainCamera}
          onClose={() => setStackingOpen(false)}
          onOpenAlbum={() => { setStackingOpen(false); setAlbumOpen(true); }}
          onOpenGoto={() => { setStackingOpen(false); setGotoOpen(true); }}
          onOpenLocation={() => { setStackingOpen(false); setLocationDialogOpen(true); }}
        />
      )}
      {locationDialogOpen && (
        <LocationDialog
          onClose={() => {
            setLocationDialogOpen(false);
            reloadLocation();
          }}
        />
      )}

      {/* Toast notifications for command results */}
      <ToastStack />
    </div>
  );
}
