/**
 * Chromium has no software HEVC decoder: MSE plays H.265 only when the GPU
 * driver provides a hardware decoder. Without one we decode in WebAssembly.
 */
export type HevcDecoderMode = 'native' | 'wasm';

const HEVC_PROBE_TYPES = [
  'video/mp4; codecs="hvc1.1.6.L120.80"', // DWARF 3: Main profile, level 4.0
  'video/mp4; codecs="hvc1.1.6.L93.B0"',
];

/** localStorage override for testing: 'native' | 'wasm'. */
export const HEVC_DECODER_OVERRIDE_KEY = 'dwarflab.hevcDecoder';

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

export function detectHevcDecoder(): HevcDecoderMode {
  try {
    const override = window.localStorage.getItem(HEVC_DECODER_OVERRIDE_KEY);
    if (override === 'native' || override === 'wasm') return override;
  } catch {
    // storage unavailable
  }
  return nativeHevcSupported() ? 'native' : 'wasm';
}
