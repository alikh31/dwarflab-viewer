import { useState, useRef, useEffect } from 'react';
import JMuxer from 'jmuxer';
import { detectHevcDecoder, type HevcDecoderMode } from '../lib/hevc-support';
import { SoftwareHevcPlayer } from '../lib/software-hevc';
import { pushToast } from '../hooks/useToasts';

interface Props {
  src: string;
  alt: string;
  className?: string;
  /** Stable identifier so other components can find this element regardless of
   * label/title strings (which differ between main view and PiP). */
  cameraId?: 'tele' | 'wide';
  /** Show the small "software decoder" badge when the wasm fallback is active
   * (off for the PiP tile, which has no room). Default: true. */
  showDecoderBadge?: boolean;
  /** Fired when the stream enters TERMINAL failure (all retries + the RTSP
   * re-arm exhausted) — i.e. the daemon is likely dead and only a device reboot
   * recovers it. Used by CameraView to surface the §4.4 reboot banner. */
  onStreamFailed?: () => void;
  /** Fired when a previously-failed stream recovers (connects again). */
  onStreamRecovered?: () => void;
}

// One toast per session, not one per <video> (main view + PiP both mount).
let softwareDecodeAnnounced = false;
function announceSoftwareDecoding(): void {
  if (softwareDecodeAnnounced) return;
  softwareDecodeAnnounced = true;
  pushToast('No hardware H.265 decoder found — using the software decoder (higher CPU use)', 'warn', 6000);
}

/**
 * Plays a live H.265 stream.
 *
 * The proxy streams raw H.265 NAL units (Annex B format) over HTTP. Two ways
 * to get them onto the screen:
 *
 *  - native: jMuxer remuxes to fMP4 and feeds Media Source Extensions;
 *    Chromium's platform HEVC decoder (VideoToolbox on macOS, D3D11 on
 *    Windows, VA-API on Linux) does hardware decode. Chromium has no software
 *    HEVC decoder, so this only works when the GPU/driver can decode HEVC.
 *  - wasm: libde265 compiled to WebAssembly decodes in a worker and paints
 *    frames onto a canvas that backs the <video> via captureStream(). Used
 *    when MSE rejects HEVC (see lib/hevc-support.ts), or if the native path
 *    hits a decode error at runtime.
 */
export function MjpegStream({ src, alt, className, cameraId, showDecoderBadge = true, onStreamFailed, onStreamRecovered }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [mode, setMode] = useState<HevcDecoderMode>(() => detectHevcDecoder());
  const [decoderReady, setDecoderReady] = useState(false);
  const [decoderStatus, setDecoderStatus] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const jmuxerRef = useRef<JMuxer | null>(null);
  const playerRef = useRef<SoftwareHevcPlayer | null>(null);
  // Only fall back native → wasm once; if wasm fails too, show the error.
  const fellBackRef = useRef(false);

  // Notify the parent on terminal-failure / recovery transitions. Kept in an
  // effect (not the fetch logic) to avoid stale closures and to debounce to the
  // edge. `error` only goes true after all retries + the RTSP re-arm fail.
  const wasFailedRef = useRef(false);
  useEffect(() => {
    if (error && !wasFailedRef.current) {
      wasFailedRef.current = true;
      onStreamFailed?.();
    } else if (!error && wasFailedRef.current) {
      wasFailedRef.current = false;
      onStreamRecovered?.();
    }
  }, [error, onStreamFailed, onStreamRecovered]);

  // Auto-retry the fetch when the proxy isn't ready yet — e.g. the wide
  // camera's RTSP route only becomes available 1.5s+ after the WebSocket
  // session opens (after CAMERA_WIDE_OPEN_CAMERA fires). Without retry the
  // wide PiP would show "Stream connection failed" forever even though the
  // proxy comes online seconds later.
  useEffect(() => {
    const video = videoRef.current;
    const container = containerRef.current;
    if (!video || !container || !src) return;

    // Cleanup previous
    abortRef.current?.abort();
    jmuxerRef.current?.destroy();
    playerRef.current?.destroy();

    const abort = new AbortController();
    abortRef.current = abort;

    setLoaded(false);
    setError(false);
    setErrorMsg('');
    setDecoderReady(mode === 'native');
    setDecoderStatus('');

    let jmuxer: JMuxer | null = null;
    let player: SoftwareHevcPlayer | null = null;

    if (mode === 'wasm') {
      announceSoftwareDecoding();
      player = new SoftwareHevcPlayer(video, container, {
        onReady: () => { if (!abort.signal.aborted) setDecoderReady(true); },
        onFirstFrame: () => {
          if (abort.signal.aborted) return;
          setLoaded(true);
          setError(false);
        },
        onStats: (s) => {
          if (abort.signal.aborted) return;
          const ms = s.msPerFrame ? `${s.msPerFrame.toFixed(0)} ms/frame` : '';
          const drops = s.dropped ? ` · ${s.dropped} dropped` : '';
          setDecoderStatus(`Software H.265${ms ? ' · ' + ms : ''}${drops}`);
        },
        onError: (message) => {
          if (abort.signal.aborted) return;
          setError(true);
          setErrorMsg(`Software decoder failed: ${message}`);
        },
      });
      playerRef.current = player;
    } else {
      // Create jMuxer instance — it handles MSE internally
      jmuxer = new JMuxer({
        node: video,
        mode: 'video',
        videoCodec: 'H265',
        flushingTime: 0,
        fps: 30,
        maxDelay: 100,
        clearBuffer: true,
        debug: false,
        onReady: () => {},
        onError: (err: Error) => {
          void err;
          if (abort.signal.aborted) return;
          if (!fellBackRef.current) {
            // MSE accepted the codec but decoding still failed (GPU process
            // trouble, driver quirk). Retry once with the software decoder.
            fellBackRef.current = true;
            setMode('wasm');
            return;
          }
          setError(true);
          setErrorMsg('Video decode error');
        },
      });
      jmuxerRef.current = jmuxer;
    }

    // Periodically skip to live edge if the MSE buffer grows too large. Not
    // needed for the wasm path: a captureStream() <video> has no buffer.
    const catchupInterval = mode === 'native'
      ? setInterval(() => {
          if (video.buffered.length > 0 && !video.paused) {
            const end = video.buffered.end(video.buffered.length - 1);
            const lag = end - video.currentTime;
            if (lag > 0.5) {
              video.currentTime = end - 0.05;
            }
          }
        }, 1000)
      : null;

    let attempts = 0;
    let rearmFired = false;
    const MAX_ATTEMPTS = 30; // ~60s of trying
    const BASE_DELAY = 500;
    const MAX_DELAY = 4000;
    // After this many consecutive failed connect attempts, kick the device
    // to re-publish its RTSP routes. The firmware drops them after some
    // astro operations (live stacking, EQ solving); without this the stream
    // would stay frozen until the user reconnects manually.
    const REARM_AFTER_ATTEMPTS = 4;

    const scheduleRetry = (reason: string) => {
      if (abort.signal.aborted) return;
      attempts += 1;
      if (attempts === REARM_AFTER_ATTEMPTS && !rearmFired) {
        rearmFired = true;
        window.api.stream.rearm().catch(() => {});
      }
      if (attempts >= MAX_ATTEMPTS) {
        setError(true);
        setErrorMsg(reason);
        return;
      }
      // Show transient message but keep the spinner — don't switch to error
      // state until we exhaust attempts. The "Connecting..." UI implies retry.
      const delay = Math.min(BASE_DELAY * 2 ** Math.min(attempts, 4), MAX_DELAY);
      setTimeout(connect, delay);
    };

    const connect = () => {
      if (abort.signal.aborted) return;

      fetch(src, { signal: abort.signal })
        .then((res) => {
          if (!res.ok || !res.body) {
            scheduleRetry('Stream connection failed');
            return;
          }

          // Successful connection — reset attempt counter. A reconnect means
          // the byte stream restarts mid-GOP; tell the wasm decoder to resync.
          attempts = 0;
          player?.reset();
          const reader = res.body.getReader();
          let chunkCount = 0;

          function pump(): void {
            reader.read().then(({ done, value }) => {
              if (done || abort.signal.aborted) return;

              chunkCount++;

              if (player) {
                player.feed(value);
              } else {
                jmuxer?.feed({ video: new Uint8Array(value.buffer, value.byteOffset, value.byteLength) });
                if (!loaded && chunkCount > 2) {
                  setLoaded(true);
                }
              }

              pump();
            }).catch(() => {
              if (abort.signal.aborted) return;
              // Mid-stream disconnect — try to reconnect rather than giving up
              setLoaded(false);
              scheduleRetry('Stream disconnected');
            });
          }
          pump();
        })
        .catch(() => {
          scheduleRetry('Failed to connect to stream');
        });
    };

    connect();

    return () => {
      if (catchupInterval) clearInterval(catchupInterval);
      abort.abort();
      jmuxer?.destroy();
      jmuxerRef.current = null;
      player?.destroy();
      playerRef.current = null;
    };
  }, [src, mode]);

  const connectingText = mode === 'wasm' && !decoderReady
    ? 'Loading software H.265 decoder...'
    : 'Connecting to stream...';

  return (
    <div ref={containerRef} className={`relative ${className ?? ''}`}>
      <video
        ref={videoRef}
        muted
        autoPlay
        playsInline
        onCanPlay={() => { setLoaded(true); setError(false); }}
        title={alt}
        data-camera={cameraId}
        data-decoder={mode}
        className="w-full h-full object-cover"
      />
      {mode === 'wasm' && showDecoderBadge && loaded && !error && (
        <div
          className="absolute bottom-2 right-2 text-[10px] text-white/60 bg-black/40 px-1.5 py-0.5 rounded backdrop-blur-sm pointer-events-none"
          title="No hardware H.265 decoder is available on this computer, so frames are decoded on the CPU."
        >
          {decoderStatus || 'Software H.265'}
        </div>
      )}
      {!loaded && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-dwarf-bg/80">
          <div className="flex flex-col items-center gap-3">
            <div className="w-6 h-6 border-2 border-dwarf-accent border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-dwarf-muted">{connectingText}</span>
          </div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-dwarf-bg/80">
          <div className="flex flex-col items-center gap-2">
            <svg
              className="w-8 h-8 text-dwarf-muted"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              <line x1="3" y1="3" x2="21" y2="21" />
            </svg>
            <span className="text-sm text-dwarf-muted">{errorMsg || 'Stream unavailable'}</span>
          </div>
        </div>
      )}
    </div>
  );
}
