import { useEffect, useRef, useState } from 'react';

/**
 * Focus assist, shown while the user is focusing. Two parts:
 *
 * 1) LOUPE — a 5× magnified crop of the centre of the tele view, bottom-right,
 *    (plain magnified image, no edge filter), with SVG connector lines from the
 *    sampled rect to the loupe corners.
 * 2) EDGE OVERLAY — a Sobel edge map painted on top of the *whole tele main
 *    view*: bright white tracer lines on in-focus edges, composited OVER the
 *    live image at full brightness (transparent everywhere else, so the real
 *    video shows through). In-focus edges are thick/crisp; defocus thins them
 *    and they fade — a strong focus signal across the whole frame.
 *
 * Trigger: any focus action dispatches a global `dwarf:focus-active`
 * CustomEvent. We fade in, sample the tele <video> at ~30 fps via rAF, and
 * fade out 5 s after the last event. The edge overlay is tele-main only (it
 * no-ops when tele is the PiP); the loupe samples tele wherever it is.
 */
// On-screen magnification of the loupe: it shows ZOOM× the live image, the
// SAME zoom regardless of window size (see the loupe sampling in tick()).
const ZOOM = 2.8; // 30% less than the prior 4× — gentler loupe magnification
const FADE_OUT_MS = 5000;
// Full-frame edge sampling buffer width. Higher = resolves FINER detail (the
// downscale to this width is what blurs away small edges before Sobel runs),
// at more cost per frame. 960px (~2× the old 480) catches fine star/feature
// detail and still runs in a few ms.
const SAMPLE_W = 960;
// |Gx|+|Gy| ≥ this → drawn as an edge. LOWER = picks up finer/weaker edges.
// Dropped from 80 to 28 so subtle texture and faint star edges register, not
// just hard high-contrast boundaries.
const EDGE_THRESHOLD = 28;

/**
 * FULL-VIEW edge overlay: build a TRANSPARENT image with OPAQUE WHITE only on
 * edge pixels, so when drawn over the <video> the live image shows through at
 * full brightness and edges sit on top. `srcImg` is the sampled frame (RGBA);
 * we write into `outImg` (same dims). Edge alpha scales lightly with magnitude
 * so stronger edges read brighter.
 */
function buildEdgeOverlay(srcImg: ImageData, outImg: ImageData, w: number, h: number): void {
  const s = srcImg.data;
  const o = outImg.data;
  const gray = new Float32Array(w * h);
  for (let i = 0, j = 0; i < s.length; i += 4, j++) {
    gray[j] = 0.299 * s[i] + 0.587 * s[i + 1] + 0.114 * s[i + 2];
  }
  // Clear to fully transparent first.
  o.fill(0);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const gx = -gray[idx - w - 1] + gray[idx - w + 1] - 2 * gray[idx - 1] + 2 * gray[idx + 1] - gray[idx + w - 1] + gray[idx + w + 1];
      const gy = -gray[idx - w - 1] - 2 * gray[idx - w] - gray[idx - w + 1] + gray[idx + w - 1] + 2 * gray[idx + w] + gray[idx + w + 1];
      const mag = Math.abs(gx) + Math.abs(gy);
      if (mag >= EDGE_THRESHOLD) {
        const i4 = idx * 4;
        o[i4] = 255; o[i4 + 1] = 255; o[i4 + 2] = 255;
        // Graded alpha so the low threshold doesn't wash the frame: faint
        // fine-detail edges show subtly (~70), strong edges ramp to full 255.
        // ~70 + 1.6×overshoot reaches opaque by mag≈145.
        o[i4 + 3] = Math.min(255, 70 + (mag - EDGE_THRESHOLD) * 1.6);
      }
    }
  }
}

interface Geom {
  src: { x: number; y: number; w: number; h: number };
  loupe: { x: number; y: number; w: number; h: number };
  teleIsMain: boolean;
}

export function FocusMagnifier() {
  const loupeCanvasRef = useRef<HTMLCanvasElement>(null);
  const loupeBoxRef = useRef<HTMLDivElement>(null);
  const edgeCanvasRef = useRef<HTMLCanvasElement>(null);
  const sampleRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [visible, setVisible] = useState(false);
  const [geom, setGeom] = useState<Geom | null>(null);

  // Loupe pixel size scales with the viewport so it stays usefully large (and
  // thus more magnified — it samples a fixed sensor fraction, so a bigger box =
  // higher effective zoom) on big / fullscreen displays. ~17% of the shorter
  // viewport edge, clamped to a sane range.
  const loupeSizeFor = () => {
    const base = Math.min(window.innerWidth, window.innerHeight) * 0.17;
    return Math.round(Math.max(200, Math.min(440, base)));
  };
  const [loupePx, setLoupePx] = useState(loupeSizeFor);
  const loupePxRef = useRef(loupePx);
  loupePxRef.current = loupePx;

  const recomputeGeom = () => {
    const video = document.querySelector<HTMLVideoElement>('video[data-camera="tele"]');
    const loupeEl = loupeBoxRef.current;
    if (!video || !loupeEl) return;
    const v = video.getBoundingClientRect();
    const l = loupeEl.getBoundingClientRect();
    if (v.width === 0 || l.width === 0) return;
    // Source rect = the on-screen region the loupe magnifies = loupe box size
    // (≈ the canvas display width) / ZOOM, in screen px. Matches the ZOOM×
    // screen-relative loupe sampling, so the dashed rect always frames exactly
    // what the loupe shows, at any window size.
    const side = Math.min(l.width / ZOOM, v.width, v.height);
    const teleIsMain = v.width > window.innerWidth / 2;
    setGeom({
      src: { x: v.left + (v.width - side) / 2, y: v.top + (v.height - side) / 2, w: side, h: side },
      loupe: { x: l.left, y: l.top, w: l.width, h: l.height },
      teleIsMain,
    });
  };

  useEffect(() => {
    if (!sampleRef.current) sampleRef.current = document.createElement('canvas');

    const tick = () => {
      const video = document.querySelector<HTMLVideoElement>('video[data-camera="tele"]');
      if (video && video.videoWidth > 0) {
        const isMain = video.getBoundingClientRect().width > window.innerWidth / 2;

        // --- LOUPE: a true ZOOM× magnification of the ON-SCREEN image, the
        // SAME zoom at any window size. The video renders object-cover, so its
        // on-screen scale (CSS px per video px) = max(dispW/videoW, dispH/videoH).
        // To show ZOOM× the displayed image in a `px`-sized loupe, we sample a
        // region of `px / ZOOM` SCREEN px → convert to video px by dividing by
        // screenScale. On fullscreen, screenScale is large → the sampled crop is
        // SMALLER → more sensor detail blown up → still ZOOM× (not "zoomed out").
        // (The old `min(videoW,videoH)/MAG` sampled a fixed sensor FRACTION, so
        // as the displayed image grew on fullscreen the same crop looked
        // un-zoomed — that was the bug.)
        const loupe = loupeCanvasRef.current;
        if (loupe) {
          const lctx = loupe.getContext('2d');
          if (lctx) {
            const px = loupePxRef.current;
            // Keep the canvas backing store matched to its display size so the
            // magnified crop is crisp, not browser-upscaled.
            if (loupe.width !== px) { loupe.width = px; loupe.height = px; }
            const dispRect = video.getBoundingClientRect();
            const screenScale = Math.max(
              dispRect.width / video.videoWidth,
              dispRect.height / video.videoHeight,
            ) || 1;
            // Region to sample, in VIDEO px, that yields ZOOM× over the display.
            let side = (px / ZOOM) / screenScale;
            side = Math.min(side, video.videoWidth, video.videoHeight); // clamp
            const sx = (video.videoWidth - side) / 2;
            const sy = (video.videoHeight - side) / 2;
            lctx.imageSmoothingEnabled = false;
            lctx.clearRect(0, 0, px, px);
            lctx.drawImage(video, sx, sy, side, side, 0, 0, px, px);
          }
        }

        // --- FULL-VIEW edge overlay (tele-main only) ---
        const edge = edgeCanvasRef.current;
        const sample = sampleRef.current;
        if (edge && sample && isMain) {
          const sw = SAMPLE_W;
          const sh = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * sw));
          if (sample.width !== sw || sample.height !== sh) { sample.width = sw; sample.height = sh; }
          if (edge.width !== sw || edge.height !== sh) { edge.width = sw; edge.height = sh; }
          const sctx = sample.getContext('2d', { willReadFrequently: true });
          const ectx = edge.getContext('2d');
          if (sctx && ectx) {
            sctx.drawImage(video, 0, 0, sw, sh);
            const srcImg = sctx.getImageData(0, 0, sw, sh);
            const outImg = ectx.createImageData(sw, sh);
            buildEdgeOverlay(srcImg, outImg, sw, sh);
            ectx.putImageData(outImg, 0, 0);
          }
        } else if (edge) {
          // Tele is PiP — clear any stale edge map.
          const ectx = edge.getContext('2d');
          ectx?.clearRect(0, 0, edge.width, edge.height);
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    const onFocusActive = () => {
      setVisible(true);
      recomputeGeom();
      if (rafRef.current === null) rafRef.current = requestAnimationFrame(tick);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => {
        setVisible(false);
        if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      }, FADE_OUT_MS);
    };

    const onResize = () => { setLoupePx(loupeSizeFor()); recomputeGeom(); };
    window.addEventListener('dwarf:focus-active', onFocusActive);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('dwarf:focus-active', onFocusActive);
      window.removeEventListener('resize', onResize);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (visible) recomputeGeom();
  }, [visible]);

  return (
    <>
      {/* Full-view edge overlay — transparent bg + white edges, composited OVER
          the live tele image at full brightness. Tele-main only (cleared on PiP). */}
      <div
        className={`absolute inset-0 z-30 pointer-events-none transition-opacity duration-300 ${
          visible && geom?.teleIsMain ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <canvas ref={edgeCanvasRef} className="w-full h-full object-cover" />
      </div>

      {/* SVG connector lines: sampled rect on the tele view → loupe corners. */}
      {geom && geom.teleIsMain && (
        <svg
          className={`fixed inset-0 z-40 pointer-events-none transition-opacity duration-500 ${
            visible ? 'opacity-80' : 'opacity-0'
          }`}
          style={{ width: '100vw', height: '100vh' }}
        >
          <rect
            x={geom.src.x} y={geom.src.y} width={geom.src.w} height={geom.src.h}
            fill="none" stroke="rgba(255,221,87,0.9)" strokeWidth={1.5} strokeDasharray="4 3"
          />
          {([
            [geom.src.x, geom.src.y, geom.loupe.x, geom.loupe.y],
            [geom.src.x + geom.src.w, geom.src.y, geom.loupe.x + geom.loupe.w, geom.loupe.y],
            [geom.src.x, geom.src.y + geom.src.h, geom.loupe.x, geom.loupe.y + geom.loupe.h],
            [geom.src.x + geom.src.w, geom.src.y + geom.src.h, geom.loupe.x + geom.loupe.w, geom.loupe.y + geom.loupe.h],
          ] as const).map(([x1, y1, x2, y2], i) => (
            <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,221,87,0.55)" strokeWidth={1} />
          ))}
        </svg>
      )}

      {/* Loupe — bottom-right 10× crop with edge highlight. */}
      <div
        ref={loupeBoxRef}
        className={`absolute bottom-6 right-6 z-40 pointer-events-none transition-opacity duration-500 ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div className="rounded-xl overflow-hidden border border-white/15 bg-black/40 backdrop-blur-xl shadow-2xl shadow-black/40">
          <canvas
            ref={loupeCanvasRef}
            width={loupePx}
            height={loupePx}
            style={{ width: loupePx, height: loupePx, display: 'block' }}
          />
          <div className="px-2 py-1 text-[10px] text-white/50 text-center tracking-wider">
{ZOOM}× FOCUS LOUPE
          </div>
        </div>
      </div>
    </>
  );
}
