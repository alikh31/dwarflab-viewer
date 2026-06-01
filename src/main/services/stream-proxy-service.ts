import { createServer, IncomingMessage, ServerResponse, Server } from 'http';
import { RtspClient, NalUnit } from './rtsp-client';

/**
 * Proxies RTSP H.265 streams from the telescope as raw Annex B NAL units.
 *
 * NO FFMPEG — pure Node.js implementation:
 *   1. RtspClient connects to telescope RTSP (port 554), receives raw H.265 NALs
 *   2. HTTP server streams raw NAL units (with Annex B start codes) to the renderer
 *   3. jMuxer in the renderer handles fMP4 muxing + MSE playback
 */

const ANNEX_B_START = Buffer.from([0x00, 0x00, 0x00, 0x01]);

interface StreamEntry {
  rtsp: RtspClient | null;
  clients: Set<ServerResponse>;
  connected: boolean;
  gotKeyframe: boolean;
  // Frame batching: accumulate NALs until RTP marker bit signals end-of-frame
  pendingNals: Buffer[];
  lastTimestamp: number;
}

export class StreamProxyService {
  private server: Server | null = null;
  private streams = new Map<string, StreamEntry>();
  private host: string | null = null;
  private _port = 0;

  get port(): number {
    return this._port;
  }

  async start(): Promise<number> {
    if (this.server) return this._port;

    // Use a fixed port so the renderer's cached `getProxyPort()` value stays
    // valid across main-process HMR. With port 0 (random), every main reload
    // picked a new port but the renderer kept fetching from the old one,
    // producing ERR_CONNECTION_REFUSED. 47829 is in the IANA ephemeral range
    // and unlikely to clash.
    const FIXED_PORT = 47829;
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => this.handleRequest(req, res));
      const onError = (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          // A prior dev run is still holding the port — fall back to a random
          // ephemeral. The renderer will refetch on its next fetchProxyPort()
          // call. This branch should only fire during dev HMR transitions.
          console.log(`[StreamProxy] port ${FIXED_PORT} in use, falling back to ephemeral`);
          this.server!.listen(0, '127.0.0.1', () => {
            const addr = this.server!.address();
            this._port = typeof addr === 'object' && addr ? addr.port : 0;
            console.log(`[StreamProxy] listening on ${this._port}`);
            resolve(this._port);
          });
        } else {
          reject(err);
        }
      };
      this.server.once('error', onError);
      this.server.listen(FIXED_PORT, '127.0.0.1', () => {
        this.server!.removeListener('error', onError);
        this.server!.on('error', () => {});
        this._port = FIXED_PORT;
        console.log(`[StreamProxy] listening on ${this._port}`);
        resolve(this._port);
      });
    });
  }

  startStreams(host: string): void {
    console.log(`[StreamProxy] startStreams host=${host}`);
    this.stopStreams();
    this.host = host;

    // Create persistent entries — HTTP clients attach here and survive RTSP reconnects
    this.streams.set('tele', { rtsp: null, clients: new Set(), connected: false, gotKeyframe: false, pendingNals: [], lastTimestamp: -1 });
    this.streams.set('wide', { rtsp: null, clients: new Set(), connected: false, gotKeyframe: false, pendingNals: [], lastTimestamp: -1 });

    this.connectRtsp('tele', `rtsp://${host}:554/ch0/stream0`);
    this.connectRtsp('wide', `rtsp://${host}:554/ch1/stream0`);
  }

  stopStreams(): void {
    for (const [, entry] of this.streams) {
      entry.rtsp?.destroy();
      for (const res of entry.clients) {
        res.end();
      }
      entry.clients.clear();
    }
    this.streams.clear();
    this.host = null;
  }

  destroy(): void {
    this.stopStreams();
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  private connectRtsp(name: string, rtspUrl: string): void {
    const entry = this.streams.get(name);
    if (!entry) return;

    // Clean up old connection
    entry.rtsp?.destroy();
    entry.rtsp = null;
    entry.connected = false;
    entry.gotKeyframe = false;
    entry.pendingNals = [];
    entry.lastTimestamp = -1;

    const rtsp = new RtspClient(rtspUrl);
    entry.rtsp = rtsp;

    rtsp.connect().then(() => {
      entry.connected = true;
      console.log(`[StreamProxy] ${name} RTSP connected ${rtspUrl}`);
    }).catch((err) => {
      console.log(`[StreamProxy] ${name} RTSP connect failed: ${(err as Error).message}`);
      this.retryRtsp(name, 3000);
    });

    let nalCount = 0;
    rtsp.on('nal', (nal: NalUnit) => {
      nalCount++;
      if (nalCount === 1 || nalCount === 10 || nalCount === 100) {
        console.log(`[StreamProxy] ${name} got ${nalCount} NALs (latest isKeyframe=${nal.isKeyframe} marker=${nal.marker} size=${nal.data.length})`);
      }
      this.onNal(entry, nal);
    });

    rtsp.on('error', (err: Error) => {
      console.log(`[StreamProxy] ${name} RTSP error: ${err.message}`);
    });

    rtsp.on('close', () => {
      console.log(`[StreamProxy] ${name} RTSP closed`);
      entry.connected = false;
      entry.gotKeyframe = false;
      this.retryRtsp(name, 2000);
    });
  }

  private retryRtsp(name: string, delayMs: number): void {
    if (!this.host || !this.streams.has(name)) return;
    const host = this.host;
    setTimeout(() => {
      if (this.host === host && this.streams.has(name)) {
        const channel = name === 'tele' ? 'ch0' : 'ch1';
        this.connectRtsp(name, `rtsp://${host}:554/${channel}/stream0`);
      }
    }, delayMs);
  }

  /**
   * Batch NAL units per frame and flush to HTTP clients when marker bit is set.
   * This sends one large write per video frame instead of many tiny NAL writes.
   *
   * Gating: forward from the first IRAP-class NAL or parameter set onwards.
   * HEVC NAL types 16-23 (BLA/IDR/CRA) are random-access entry points.
   * 32/33/34 (VPS/SPS/PPS) must also be forwarded — the IDR alone is
   * undecodable without the parameter sets for that GOP. The firmware sends
   * VPS+SPS+PPS+IDR at each GOP boundary, so once we see any of those we
   * pass everything through. Without this gate jMuxer rejects mid-GOP P-slices.
   */
  private onNal(entry: StreamEntry, nal: NalUnit): void {
    if (entry.clients.size === 0) return;

    if (!entry.gotKeyframe) {
      const nalType = (nal.data[0] >> 1) & 0x3f;
      const isIrap = nalType >= 16 && nalType <= 23;
      const isParamSet = nalType >= 32 && nalType <= 34;
      if (!isIrap && !isParamSet) return;
      entry.gotKeyframe = true;
      console.log(`[StreamProxy] first forwardable NAL type=${nalType} (irap=${isIrap} paramSet=${isParamSet})`);
    }

    // Accumulate NALs with Annex B start codes
    entry.pendingNals.push(ANNEX_B_START, nal.data);

    // Flush when RTP marker bit signals end-of-frame
    if (nal.marker && entry.pendingNals.length > 0) {
      const frame = Buffer.concat(entry.pendingNals);
      entry.pendingNals = [];

      for (const res of entry.clients) {
        try {
          res.write(frame);
        } catch {
          entry.clients.delete(res);
        }
      }
    }
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url || '/';

    let streamName: string | null = null;
    if (url.startsWith('/tele')) streamName = 'tele';
    else if (url.startsWith('/wide')) streamName = 'wide';

    if (!streamName) {
      res.writeHead(404);
      res.end('Not found. Use /tele or /wide');
      return;
    }

    // If the entry doesn't exist yet, wait for it. The renderer's CameraView
    // mounts and fetches /tele right after WS connects, but startStreams runs
    // ~2.5s later (after openCamera + RTSP warmup). Returning 503 here would
    // make the renderer retry with exponential backoff and spam console errors.
    // Instead, poll briefly and attach the response stream once startStreams
    // creates the entry. Bounded so a truly absent stream doesn't hang forever.
    const attachWhenReady = (attemptsLeft: number) => {
      const entry = this.streams.get(streamName!);
      if (entry) {
        console.log(`[StreamProxy] HTTP ${url} -> 200 (client attached, rtsp connected=${entry.connected}, gotKey=${entry.gotKeyframe})`);
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Access-Control-Allow-Origin': '*',
        });
        res.socket?.setNoDelay(true);
        entry.clients.add(res);
        req.on('close', () => entry.clients.delete(res));
        return;
      }
      if (attemptsLeft <= 0) {
        console.log(`[StreamProxy] HTTP ${url} -> 503 (entry never appeared)`);
        res.writeHead(503);
        res.end('Stream not active');
        return;
      }
      setTimeout(() => attachWhenReady(attemptsLeft - 1), 200);
    };
    attachWhenReady(50); // up to ~10s wait
  }

}
