/**
 * Software H.265 decoder worker — libde265 compiled to WebAssembly.
 *
 * Used when Chromium has no hardware HEVC decoder (see lib/hevc-support.ts).
 * The main thread hands us an OffscreenCanvas plus raw Annex B H.265 chunks
 * exactly as the stream proxy emits them (one write per frame, VPS/SPS/PPS
 * before every IDR). We decode, wrap each picture in a VideoFrame (I420) and
 * paint it onto the canvas; the <video> element on the main thread shows the
 * canvas through captureStream(), so nothing else in the UI has to change.
 *
 * Protocol (main → worker): WorkerInbound; (worker → main): WorkerOutbound.
 *
 * Back-pressure: decoding is CPU-bound and single-threaded. On a slow CPU the
 * chunks queue up (in this worker's event loop, where we cannot count them),
 * and latency would grow without bound. Every chunk therefore carries the
 * time it was sent; when we get to a chunk that is older than MAX_LATENCY_MS
 * we are behind, and from the next keyframe on we decode only keyframes
 * (dropping the P-frames of each GOP) until we are current again. That keeps
 * the picture live at ~1 fps under overload instead of minutes behind.
 * Dropped frames are reported in the periodic stats.
 */
import createLibde265 from '@yume-chan/libde265';
import type { MainModule, Decoder, Image as De265Image } from '@yume-chan/libde265';
import libde265WasmUrl from '@yume-chan/libde265/libde265.wasm?url';

export type WorkerInbound =
  | { type: 'init'; canvas: OffscreenCanvas }
  | { type: 'data'; buffer: ArrayBuffer; sentAt: number }
  | { type: 'reset' }
  | { type: 'close' };

export interface DecoderStats {
  decoded: number;
  dropped: number;
  /** Age of the most recently processed chunk when it was decoded (ms). */
  latencyMs: number;
  /** Average wall-clock milliseconds spent decoding+painting one chunk (recent window). */
  msPerFrame: number;
}

export type WorkerOutbound =
  | { type: 'ready'; version: string }
  | { type: 'first-frame'; width: number; height: number }
  | { type: 'stats'; stats: DecoderStats }
  | { type: 'error'; message: string };

// The renderer tsconfig only includes the DOM lib; describe the little we need
// of the worker global scope instead of pulling in lib.webworker (which
// conflicts with lib.dom in one compilation unit).
interface WorkerScope {
  postMessage(message: WorkerOutbound, transfer?: Transferable[]): void;
  onmessage: ((ev: MessageEvent<WorkerInbound>) => void) | null;
  close(): void;
}
const scope = self as unknown as WorkerScope;
const post = (message: WorkerOutbound): void => scope.postMessage(message);

/** A chunk older than this when we reach it means we are not keeping up. */
const MAX_LATENCY_MS = 1000;
const STATS_INTERVAL_MS = 1000;

interface QueuedChunk {
  data: Uint8Array;
  sentAt: number;
}

let libde265: MainModule | null = null;
let decoder: Decoder | null = null;
let canvas: OffscreenCanvas | null = null;
let ctx2d: OffscreenCanvasRenderingContext2D | null = null;

let queue: QueuedChunk[] = [];
let pumping = false;
/** Dropping non-keyframe chunks until the next random-access point. */
let skipping = true;
let closed = false;

let seq = 0n;
let decoded = 0;
let dropped = 0;
let latencyMs = 0;
let announcedFirstFrame = false;
let windowFrames = 0;
let windowMs = 0;
let lastStatsAt = 0;
let staging: Uint8Array | null = null; // reusable I420 staging buffer

/** Does this Annex B chunk contain an IRAP slice (types 16–21) or a VPS (32)? */
function hasRandomAccessPoint(chunk: Uint8Array): boolean {
  const n = chunk.length;
  for (let i = 0; i + 3 < n; i++) {
    if (chunk[i] === 0 && chunk[i + 1] === 0 && chunk[i + 2] === 1) {
      const nalType = (chunk[i + 3] >> 1) & 0x3f;
      if ((nalType >= 16 && nalType <= 21) || nalType === 32) return true;
      i += 2;
    }
  }
  return false;
}

// Yield between chunks so incoming messages interleave with decoding,
// without setTimeout's clamping.
const yieldThen = (() => {
  const channel = new MessageChannel();
  let pending: (() => void) | null = null;
  channel.port1.onmessage = () => {
    const fn = pending;
    pending = null;
    fn?.();
  };
  return (fn: () => void) => {
    pending = fn;
    channel.port2.postMessage(null);
  };
})();

function paint(image: De265Image): void {
  if (!canvas || !ctx2d) return;
  if (image.chromaFormat !== 1 || image.getBitsPerPixel(0) !== 8) {
    throw new Error(`unsupported picture format (chroma=${image.chromaFormat}, bits=${image.getBitsPerPixel(0)})`);
  }
  const y = image.getImagePlane(0);
  const u = image.getImagePlane(1);
  const v = image.getImagePlane(2);
  const width = image.getWidth(0);
  const height = image.getHeight(0);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const ySize = y.stride * height;
  const chromaHeight = image.getHeight(1);
  const uSize = u.stride * chromaHeight;
  const vSize = v.stride * chromaHeight;
  const total = ySize + uSize + vSize;
  if (!staging || staging.length < total) staging = new Uint8Array(total);
  staging.set(y.bytes.subarray(0, ySize), 0);
  staging.set(u.bytes.subarray(0, uSize), ySize);
  staging.set(v.bytes.subarray(0, vSize), ySize + uSize);

  const frame = new VideoFrame(staging, {
    format: 'I420',
    codedWidth: width,
    codedHeight: height,
    timestamp: decoded * 33333,
    layout: [
      { offset: 0, stride: y.stride },
      { offset: ySize, stride: u.stride },
      { offset: ySize + uSize, stride: v.stride },
    ],
  });
  try {
    ctx2d.drawImage(frame, 0, 0);
  } finally {
    frame.close();
  }

  decoded++;
  if (!announcedFirstFrame) {
    announcedFirstFrame = true;
    post({ type: 'first-frame', width, height });
  }
}

function drainPictures(): void {
  if (!decoder) return;
  let image: De265Image | null;
  while ((image = decoder.getNextPicture())) {
    try {
      paint(image);
    } finally {
      image.delete();
    }
  }
}

function decodeChunk(chunk: Uint8Array): void {
  if (!decoder || !libde265) return;
  const t0 = performance.now();
  decoder.pushData(chunk, seq++);
  for (;;) {
    const result = decoder.decode();
    drainPictures();
    if (!libde265.isOk(result.error)) {
      // WAITING_FOR_INPUT_DATA just means "give me the next chunk". Anything
      // else is a bitstream warning libde265 already recovered from.
      break;
    }
    if (!result.more) break;
  }
  windowMs += performance.now() - t0;
  windowFrames++;
}

function maybePostStats(): void {
  const now = performance.now();
  if (now - lastStatsAt < STATS_INTERVAL_MS) return;
  lastStatsAt = now;
  post({
    type: 'stats',
    stats: {
      decoded,
      dropped,
      latencyMs,
      msPerFrame: windowFrames ? windowMs / windowFrames : 0,
    },
  });
  windowFrames = 0;
  windowMs = 0;
}

/** Decide what to do with the next chunk: decode it, or drop it to catch up. */
function processChunk(item: QueuedChunk): void {
  const age = Date.now() - item.sentAt;
  latencyMs = age;
  const keyframe = hasRandomAccessPoint(item.data);

  if (keyframe) {
    if (skipping) {
      // Resuming after drops (or first data): start clean at this IRAP.
      decoder?.reset();
    }
    // Behind by more than the budget? Decode this keyframe but drop the rest
    // of its GOP — the cheapest way to get back to the live edge without
    // corrupting references (P-frames need every frame before them).
    skipping = age > MAX_LATENCY_MS;
    decodeChunk(item.data);
    return;
  }

  if (skipping) {
    dropped++;
    return;
  }
  decodeChunk(item.data);
}

function pump(): void {
  if (pumping || closed || !decoder) return;
  const item = queue.shift();
  if (!item) return;
  pumping = true;
  try {
    processChunk(item);
    maybePostStats();
  } catch (err) {
    post({ type: 'error', message: (err as Error).message ?? String(err) });
    closed = true;
    return;
  } finally {
    pumping = false;
  }
  if (queue.length > 0) yieldThen(pump);
}

async function init(offscreen: OffscreenCanvas): Promise<void> {
  canvas = offscreen;
  ctx2d = offscreen.getContext('2d', { alpha: false, desynchronized: true });
  if (!ctx2d) {
    post({ type: 'error', message: 'OffscreenCanvas 2D context unavailable' });
    return;
  }
  if (typeof VideoFrame === 'undefined') {
    post({ type: 'error', message: 'VideoFrame API unavailable in this Chromium' });
    return;
  }
  try {
    libde265 = await createLibde265({
      // Vite emits the wasm as a static asset; point Emscripten at it.
      locateFile: (file: string) => (file.endsWith('.wasm') ? libde265WasmUrl : file),
    });
    decoder = new libde265.Decoder();
    const version = `${libde265.get_version_major()}.${libde265.get_version_minor()}.${libde265.get_version_maintenance()}`;
    post({ type: 'ready', version });
    lastStatsAt = performance.now();
    pump();
  } catch (err) {
    post({ type: 'error', message: `libde265 failed to load: ${(err as Error).message ?? String(err)}` });
  }
}

scope.onmessage = (ev: MessageEvent<WorkerInbound>) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'init':
      void init(msg.canvas);
      break;

    case 'data':
      if (closed) break;
      queue.push({ data: new Uint8Array(msg.buffer), sentAt: msg.sentAt });
      pump();
      break;

    case 'reset':
      // Stream (re)connected mid-GOP: wait for the next keyframe.
      queue = [];
      skipping = true;
      break;

    case 'close':
      closed = true;
      queue = [];
      decoder?.delete();
      decoder = null;
      scope.close();
      break;
  }
};
