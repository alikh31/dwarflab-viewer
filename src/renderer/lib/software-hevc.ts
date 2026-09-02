import type { DecoderStats, WorkerInbound, WorkerOutbound } from '../workers/hevc-decoder.worker';

export interface SoftwareHevcEvents {
  /** The wasm decoder is loaded and accepting data. */
  onReady?: (version: string) => void;
  /** First picture painted — the <video> now has content. */
  onFirstFrame?: (width: number, height: number) => void;
  /** Periodic throughput / drop counters (about once a second). */
  onStats?: (stats: DecoderStats) => void;
  /** Unrecoverable failure (wasm failed to load, worker crashed, bad stream). */
  onError?: (message: string) => void;
}

/**
 * Plays raw Annex B H.265 into a <video> element using the WebAssembly
 * decoder worker — the fallback for machines without hardware HEVC decoding.
 *
 * Decoding and painting happen off the main thread on an OffscreenCanvas. The
 * <video> element shows that canvas via captureStream(), so consumers that
 * read the <video> (videoWidth, drawImage for the focus loupe, …) work exactly
 * as they do with the native MSE path.
 */
export class SoftwareHevcPlayer {
  private readonly worker: Worker;
  private readonly canvas: HTMLCanvasElement;
  private readonly stream: MediaStream;
  private closed = false;

  constructor(
    private readonly video: HTMLVideoElement,
    container: HTMLElement,
    private readonly events: SoftwareHevcEvents = {},
  ) {
    // The placeholder canvas stays in the document (1px, invisible) so the
    // frames committed by the worker keep flowing into captureStream().
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1920;
    this.canvas.height = 1080;
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';
    container.appendChild(this.canvas);
    const offscreen = this.canvas.transferControlToOffscreen();

    this.worker = new Worker(new URL('../workers/hevc-decoder.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<WorkerOutbound>) => this.onMessage(ev.data);
    this.worker.onerror = (ev) => this.fail(ev.message || 'decoder worker crashed');
    this.send({ type: 'init', canvas: offscreen }, [offscreen]);

    this.stream = this.canvas.captureStream(30);
    video.srcObject = this.stream;
    video.play().catch(() => { /* autoplay is muted; play() may still reject before frames exist */ });
  }

  /** Feed one chunk of Annex B H.265 as delivered by the stream proxy. */
  feed(chunk: Uint8Array): void {
    if (this.closed) return;
    // Copy into a standalone buffer so it can be transferred without touching the reader's memory.
    const buffer = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer;
    // sentAt lets the worker notice when it falls behind real time (see its back-pressure notes).
    this.send({ type: 'data', buffer, sentAt: Date.now() }, [buffer]);
  }

  /** Drop everything queued and resynchronise at the next keyframe (e.g. after a stream reconnect). */
  reset(): void {
    if (this.closed) return;
    this.send({ type: 'reset' });
  }

  destroy(): void {
    if (this.closed) return;
    this.closed = true;
    try { this.send({ type: 'close' }); } catch { /* worker may already be gone */ }
    this.worker.terminate();
    for (const track of this.stream.getTracks()) track.stop();
    if (this.video.srcObject === this.stream) this.video.srcObject = null;
    this.canvas.remove();
  }

  private onMessage(msg: WorkerOutbound): void {
    if (this.closed) return;
    switch (msg.type) {
      case 'ready': this.events.onReady?.(msg.version); break;
      case 'first-frame': this.events.onFirstFrame?.(msg.width, msg.height); break;
      case 'stats': this.events.onStats?.(msg.stats); break;
      case 'error': this.fail(msg.message); break;
    }
  }

  private fail(message: string): void {
    if (this.closed) return;
    this.events.onError?.(message);
  }

  private send(message: WorkerInbound, transfer: Transferable[] = []): void {
    this.worker.postMessage(message, transfer);
  }
}
