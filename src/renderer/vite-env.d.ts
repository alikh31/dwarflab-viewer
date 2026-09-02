// Vite asset-URL imports. The software HEVC decoder imports its WebAssembly
// binary with `?url` so Vite emits it as a static asset and hands back the
// runtime URL (see workers/hevc-decoder.worker.ts).
declare module '*.wasm?url' {
  const url: string;
  export default url;
}
