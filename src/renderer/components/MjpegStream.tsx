import { useState, useRef, useEffect } from 'react';
import JMuxer from 'jmuxer';

interface Props {
  src: string;
  alt: string;
  className?: string;
  /** Stable identifier so other components can find this element regardless of
   * label/title strings (which differ between main view and PiP). */
  cameraId?: 'tele' | 'wide';
  /** Fired when the stream enters TERMINAL failure (all retries + the RTSP
   * re-arm exhausted) — i.e. the daemon is likely dead and only a device reboot
   * recovers it. Used by CameraView to surface the §4.4 reboot banner. */
  onStreamFailed?: () => void;
  /** Fired when a previously-failed stream recovers (connects again). */
  onStreamRecovered?: () => void;
}

/**
 * Plays a live H.265 stream using jMuxer for fMP4 muxing + MSE playback.
 *
 * The proxy streams raw H.265 NAL units (Annex B format) over HTTP.
 * jMuxer handles all fMP4 box generation and MSE SourceBuffer management.
 * Chromium's native HEVC decoder (VideoToolbox on macOS) does HW decode.
 */
export function MjpegStream({ src, alt, className, cameraId, onStreamFailed, onStreamRecovered }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const jmuxerRef = useRef<JMuxer | null>(null);

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
    if (!video || !src) return;

    // Cleanup previous
    abortRef.current?.abort();
    jmuxerRef.current?.destroy();

    const abort = new AbortController();
    abortRef.current = abort;

    setLoaded(false);
    setError(false);
    setErrorMsg('');

    // Create jMuxer instance — it handles MSE internally
    const jmuxer = new JMuxer({
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
        if (!abort.signal.aborted) {
          setError(true);
          setErrorMsg('Video decode error');
        }
      },
    });
    jmuxerRef.current = jmuxer;

    // Periodically skip to live edge if buffer grows too large
    const catchupInterval = setInterval(() => {
      if (video.buffered.length > 0 && !video.paused) {
        const end = video.buffered.end(video.buffered.length - 1);
        const lag = end - video.currentTime;
        if (lag > 0.5) {
          video.currentTime = end - 0.05;
        }
      }
    }, 1000);

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

          // Successful connection — reset attempt counter
          attempts = 0;
          const reader = res.body.getReader();
          let chunkCount = 0;

          function pump(): void {
            reader.read().then(({ done, value }) => {
              if (done || abort.signal.aborted) return;

              chunkCount++;

              jmuxer.feed({ video: new Uint8Array(value.buffer, value.byteOffset, value.byteLength) });

              if (!loaded && chunkCount > 2) {
                setLoaded(true);
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
      clearInterval(catchupInterval);
      abort.abort();
      jmuxer.destroy();
      jmuxerRef.current = null;
    };
  }, [src]);

  return (
    <div className={`relative ${className ?? ''}`}>
      <video
        ref={videoRef}
        muted
        autoPlay
        playsInline
        onCanPlay={() => { setLoaded(true); setError(false); }}
        title={alt}
        data-camera={cameraId}
        className="w-full h-full object-cover"
      />
      {!loaded && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-dwarf-bg/80">
          <div className="flex flex-col items-center gap-3">
            <div className="w-6 h-6 border-2 border-dwarf-accent border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-dwarf-muted">Connecting to stream...</span>
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
