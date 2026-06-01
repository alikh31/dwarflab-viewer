import { Socket } from 'net';
import { EventEmitter } from 'events';

/**
 * Lightweight RTSP client using TCP interleaved mode.
 *
 * Connects to an RTSP server, negotiates the session (OPTIONS, DESCRIBE,
 * SETUP, PLAY), and emits reassembled H.265 NAL units from RTP packets.
 *
 * No ffmpeg dependency — pure Node.js TCP sockets.
 */

export interface RtspCodecParams {
  vps: Buffer;  // Video Parameter Set
  sps: Buffer;  // Sequence Parameter Set
  pps: Buffer;  // Picture Parameter Set
  width: number;
  height: number;
}

export interface NalUnit {
  data: Buffer;       // Complete NAL unit (without start code)
  timestamp: number;  // RTP timestamp (90kHz clock)
  isKeyframe: boolean;
  marker: boolean;    // RTP marker bit (last packet of frame)
}

interface SdpResult {
  codec: RtspCodecParams;
  trackUrl: string;   // The control URL for the video track (needed for SETUP)
}

export class RtspClient extends EventEmitter {
  private socket: Socket | null = null;
  private cseq = 0;
  private sessionId = '';
  private url: string;
  private codecParams: RtspCodecParams | null = null;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  // Buffer for incoming TCP data
  private tcpBuffer = Buffer.alloc(0);
  private inRtspResponse = true; // Start expecting text responses

  // Fragmented NAL reassembly
  private fuBuffer: Buffer[] = [];
  private fuNalType = 0;

  constructor(url: string) {
    super();
    this.url = url;
  }

  get codec(): RtspCodecParams | null {
    return this.codecParams;
  }

  async connect(): Promise<RtspCodecParams> {
    const urlObj = new URL(this.url);
    const host = urlObj.hostname;
    const port = parseInt(urlObj.port) || 554;

    return new Promise((resolve, reject) => {
      this.socket = new Socket();
      this.socket.setNoDelay(true);

      this.socket.connect(port, host, async () => {
        try {
          await this.sendOptions();
          const sdp = await this.sendDescribe();
          const { codec, trackUrl } = this.parseSdp(sdp);
          this.codecParams = codec;

          // SETUP must use the track control URL from SDP, not the base URL
          await this.sendSetup(trackUrl);
          await this.sendPlay();

          // Switch to binary parsing mode after PLAY response
          this.inRtspResponse = false;

          // Keep-alive every 30s
          this.keepAliveTimer = setInterval(() => {
            this.sendOptionsNoWait();
          }, 30000);

          resolve(this.codecParams);
        } catch (e) {
          reject(e);
        }
      });

      this.socket.on('data', (data) => this.onData(data));

      this.socket.on('error', (err) => {
        if (!this.destroyed) {
          this.emit('error', err);
        }
        reject(err);
      });

      this.socket.on('close', () => {
        if (!this.destroyed) {
          this.emit('close');
        }
      });
    });
  }

  destroy(): void {
    this.destroyed = true;
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
    if (this.socket) {
      try {
        this.sendRaw(
          `TEARDOWN ${this.url} RTSP/1.0\r\nCSeq: ${++this.cseq}\r\nSession: ${this.sessionId}\r\n\r\n`,
        );
      } catch {
        // ignore
      }
      this.socket.destroy();
      this.socket = null;
    }
  }

  // --- RTSP Commands ---

  private sendRaw(data: string): void {
    this.socket?.write(data);
  }

  private async sendRequest(
    method: string,
    headers: Record<string, string> = {},
    urlOverride?: string,
  ): Promise<string> {
    const seq = ++this.cseq;
    const reqUrl = urlOverride || this.url;
    let req = `${method} ${reqUrl} RTSP/1.0\r\nCSeq: ${seq}\r\n`;
    for (const [k, v] of Object.entries(headers)) {
      req += `${k}: ${v}\r\n`;
    }
    req += '\r\n';

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`RTSP ${method} timeout`)), 5000);

      const onResponse = (response: string) => {
        clearTimeout(timeout);
        if (!response.startsWith('RTSP/1.0 200')) {
          reject(new Error(`RTSP ${method} failed: ${response.split('\r\n')[0]}`));
          return;
        }
        resolve(response);
      };

      this.once('rtsp-response', onResponse);
      this.sendRaw(req);
    });
  }

  private async sendOptions(): Promise<void> {
    await this.sendRequest('OPTIONS');
  }

  private sendOptionsNoWait(): void {
    const seq = ++this.cseq;
    this.sendRaw(`OPTIONS ${this.url} RTSP/1.0\r\nCSeq: ${seq}\r\n\r\n`);
  }

  private async sendDescribe(): Promise<string> {
    const response = await this.sendRequest('DESCRIBE', {
      Accept: 'application/sdp',
    });

    const bodyStart = response.indexOf('\r\n\r\n');
    if (bodyStart < 0) throw new Error('No SDP body in DESCRIBE response');
    return response.slice(bodyStart + 4);
  }

  private async sendSetup(trackUrl: string): Promise<void> {
    // SETUP must target the track control URL from SDP (e.g. .../track1)
    const response = await this.sendRequest(
      'SETUP',
      { Transport: 'RTP/AVP/TCP;unicast;interleaved=0-1' },
      trackUrl,
    );

    const sessionMatch = response.match(/Session:\s*([^;\r\n]+)/i);
    if (sessionMatch) {
      this.sessionId = sessionMatch[1].trim();
    }
  }

  private async sendPlay(): Promise<void> {
    await this.sendRequest('PLAY', {
      Session: this.sessionId,
      Range: 'npt=0.000-',
    });
  }

  // --- Data Parsing ---

  private onData(data: Buffer): void {
    this.tcpBuffer = Buffer.concat([this.tcpBuffer, data]);

    if (this.inRtspResponse) {
      this.parseTextResponses();
    } else {
      this.parseInterleavedRtp();
    }
  }

  private parseTextResponses(): void {
    const str = this.tcpBuffer.toString('utf8');

    const headerEnd = str.indexOf('\r\n\r\n');
    if (headerEnd < 0) return;

    const headers = str.slice(0, headerEnd);
    const clMatch = headers.match(/Content-Length:\s*(\d+)/i);
    const contentLength = clMatch ? parseInt(clMatch[1]) : 0;

    const totalLength = headerEnd + 4 + contentLength;
    if (this.tcpBuffer.length < totalLength) return;

    const response = this.tcpBuffer.subarray(0, totalLength).toString('utf8');
    this.tcpBuffer = this.tcpBuffer.subarray(totalLength);
    this.emit('rtsp-response', response);
  }

  private parseInterleavedRtp(): void {
    while (this.tcpBuffer.length >= 4) {
      // RTSP text responses can arrive mixed with binary data (e.g. keep-alive replies)
      if (this.tcpBuffer[0] !== 0x24) {
        const textEnd = this.tcpBuffer.indexOf(Buffer.from('\r\n\r\n'));
        if (textEnd >= 0) {
          this.tcpBuffer = this.tcpBuffer.subarray(textEnd + 4);
          continue;
        }
        break;
      }

      const channel = this.tcpBuffer[1];
      const length = this.tcpBuffer.readUInt16BE(2);

      if (this.tcpBuffer.length < 4 + length) break;

      if (channel === 0 && length >= 12) {
        const rtp = this.tcpBuffer.subarray(4, 4 + length);
        this.parseRtpPacket(rtp);
      }

      this.tcpBuffer = this.tcpBuffer.subarray(4 + length);
    }

    // Prevent unbounded growth
    if (this.tcpBuffer.length > 4 * 1024 * 1024) {
      this.tcpBuffer = this.tcpBuffer.subarray(this.tcpBuffer.length - 64 * 1024);
    }
  }

  private parseRtpPacket(rtp: Buffer): void {
    const marker = !!(rtp[1] & 0x80);
    const cc = rtp[0] & 0x0f;
    const hasExtension = !!(rtp[0] & 0x10);
    const timestamp = rtp.readUInt32BE(4);

    let offset = 12 + cc * 4;

    if (hasExtension && rtp.length > offset + 4) {
      const extLength = rtp.readUInt16BE(offset + 2);
      offset += 4 + extLength * 4;
    }

    if (offset >= rtp.length) return;

    const payload = rtp.subarray(offset);
    this.parseH265Payload(payload, timestamp, marker);
  }

  private parseH265Payload(payload: Buffer, timestamp: number, marker: boolean): void {
    if (payload.length < 2) return;

    const nalType = (payload[0] >> 1) & 0x3f;

    if (nalType < 48) {
      // Single NAL unit packet
      const isKeyframe = nalType >= 16 && nalType <= 21;
      this.emit('nal', {
        data: payload,
        timestamp,
        isKeyframe,
        marker,
      } as NalUnit);
    } else if (nalType === 48) {
      // AP (Aggregation Packet)
      let pos = 2;
      while (pos + 2 <= payload.length) {
        const nalSize = payload.readUInt16BE(pos);
        pos += 2;
        if (pos + nalSize > payload.length) break;
        const nal = payload.subarray(pos, pos + nalSize);
        const innerType = (nal[0] >> 1) & 0x3f;
        const isKeyframe = innerType >= 16 && innerType <= 21;
        this.emit('nal', {
          data: nal,
          timestamp,
          isKeyframe,
          marker,
        } as NalUnit);
        pos += nalSize;
      }
    } else if (nalType === 49) {
      // FU (Fragmentation Unit)
      if (payload.length < 3) return;
      const fuHeader = payload[2];
      const startBit = !!(fuHeader & 0x80);
      const endBit = !!(fuHeader & 0x40);
      const fuType = fuHeader & 0x3f;

      if (startBit) {
        this.fuBuffer = [];
        this.fuNalType = fuType;
        const nalHeader = Buffer.alloc(2);
        nalHeader[0] = (payload[0] & 0x81) | (fuType << 1);
        nalHeader[1] = payload[1];
        this.fuBuffer.push(nalHeader);
      }

      this.fuBuffer.push(payload.subarray(3));

      if (endBit && this.fuBuffer.length > 0) {
        const complete = Buffer.concat(this.fuBuffer);
        const isKeyframe = this.fuNalType >= 16 && this.fuNalType <= 21;
        this.emit('nal', {
          data: complete,
          timestamp,
          isKeyframe,
          marker,
        } as NalUnit);
        this.fuBuffer = [];
      }
    }
  }

  // --- SDP Parsing ---

  private parseSdp(sdp: string): SdpResult {
    let vps = Buffer.alloc(0);
    let sps = Buffer.alloc(0);
    let pps = Buffer.alloc(0);
    let width = 1920;
    let height = 1080;
    let trackUrl = this.url; // fallback to base URL
    let inMediaSection = false;

    for (const line of sdp.split('\n')) {
      const trimmed = line.trim();

      // Track when we enter the m=video section
      if (trimmed.startsWith('m=video')) {
        inMediaSection = true;
        continue;
      }
      // Another m= line would end the video section
      if (trimmed.startsWith('m=') && !trimmed.startsWith('m=video')) {
        inMediaSection = false;
        continue;
      }

      if (trimmed.startsWith('a=fmtp:')) {
        const vpsMatch = trimmed.match(/sprop-vps=([A-Za-z0-9+/=]+)/);
        const spsMatch = trimmed.match(/sprop-sps=([A-Za-z0-9+/=]+)/);
        const ppsMatch = trimmed.match(/sprop-pps=([A-Za-z0-9+/=]+)/);

        if (vpsMatch) vps = Buffer.from(vpsMatch[1], 'base64');
        if (spsMatch) sps = Buffer.from(spsMatch[1], 'base64');
        if (ppsMatch) pps = Buffer.from(ppsMatch[1], 'base64');
      }

      // The track-level a=control is the one under m=video
      if (inMediaSection && trimmed.startsWith('a=control:')) {
        trackUrl = trimmed.slice('a=control:'.length).trim();
      }

      if (trimmed.startsWith('a=framesize:')) {
        const m = trimmed.match(/(\d+)-(\d+)/);
        if (m) {
          width = parseInt(m[1]);
          height = parseInt(m[2]);
        }
      }
    }

    return {
      codec: { vps, sps, pps, width, height },
      trackUrl,
    };
  }
}
