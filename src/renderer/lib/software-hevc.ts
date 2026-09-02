import type { DecoderStats, WorkerInbound, WorkerOutbound } from '../workers/hevc-decoder.worker';

export interface SoftwareHevcEvents {
  onReady?: (version: string) => void;
  onFirstFrame?: (width: number, height: number) => void;
  onStats?: (stats: DecoderStats) => void;
  onError?: (message: string) => void;
}

/**
 * Plays raw Annex B H.265 into a <video> through the WebAssembly decoder
 * worker. Frames are painted on an OffscreenCanvas; the <video> shows it via
 * captureStream(), so consumers of the <video> element work unchanged.
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
    // The placeholder canvas must stay in the document for captureStream() to receive frames.
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
    video.play().catch(() => {});
  }

  feed(chunk: Uint8Array): void {
    if (this.closed) return;
    const buffer = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer;
    this.send({ type: 'data', buffer, sentAt: Date.now() }, [buffer]);
  }

  /** Drop queued data and resync at the next keyframe (after a stream reconnect). */
  reset(): void {
    if (this.closed) return;
    this.send({ type: 'reset' });
  }

  destroy(): void {
    if (this.closed) return;
    this.closed = true;
    try { this.send({ type: 'close' }); } catch { /* worker already gone */ }
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
