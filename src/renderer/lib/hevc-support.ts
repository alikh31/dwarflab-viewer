/**
 * Decides how the H.265 (HEVC) live streams are decoded in this renderer.
 *
 * The telescope only streams H.265, and Chromium ships no software HEVC
 * decoder: Media Source Extensions accept HEVC only when a *hardware* decoder
 * is available (GPU + driver). On PCs without one (older GPUs, generic display
 * drivers, remote-desktop sessions, GPU acceleration disabled) the stream never
 * starts — the main process happily forwards frames, but <video> stays black.
 *
 * In that case we decode in software with libde265 compiled to WebAssembly
 * (see workers/hevc-decoder.worker.ts). It costs CPU instead of GPU, but it
 * works everywhere.
 */
export type HevcDecoderMode = 'native' | 'wasm';

/**
 * Representative HEVC Main-profile codec strings. The DWARF 3 streams
 * 1920x1080 Main @ Level 4.0 (`hvc1.1.6.L120.80`); the second string is a
 * common lower level in case a platform is picky about the exact level.
 */
const HEVC_PROBE_TYPES = [
  'video/mp4; codecs="hvc1.1.6.L120.80"',
  'video/mp4; codecs="hvc1.1.6.L93.B0"',
];

/**
 * localStorage key for a manual override ('native' | 'wasm'). Useful to try the
 * software path on a machine that does have hardware decoding, e.g. from the
 * DevTools console: localStorage.setItem('dwarflab.hevcDecoder', 'wasm').
 */
export const HEVC_DECODER_OVERRIDE_KEY = 'dwarflab.hevcDecoder';

/** True when Chromium can play HEVC through MSE (i.e. a hardware decoder exists). */
export function nativeHevcSupported(): boolean {
  if (typeof MediaSource === 'undefined' || typeof MediaSource.isTypeSupported !== 'function') {
    return false;
  }
  try {
    return HEVC_PROBE_TYPES.some((type) => MediaSource.isTypeSupported(type));
  } catch {
    return false;
  }
}

/** Pick the decoder for this session: manual override first, then capability probe. */
export function detectHevcDecoder(): HevcDecoderMode {
  try {
    const override = window.localStorage.getItem(HEVC_DECODER_OVERRIDE_KEY);
    if (override === 'native' || override === 'wasm') return override;
  } catch {
    // storage unavailable — fall through to detection
  }
  return nativeHevcSupported() ? 'native' : 'wasm';
}
