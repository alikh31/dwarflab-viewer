// jmuxer ships no type declarations and has no @types package. The library is
// only used by MjpegStream.tsx to remux the fMP4 stream for <video>. We give it
// a minimal ambient declaration so the web typecheck (tsconfig.web.json) passes
// without `any`-leaking the whole module. Loosely typed on purpose — the runtime
// API surface we use is small (constructor + feed + destroy).
declare module 'jmuxer' {
  interface JMuxerOptions {
    node: string | HTMLElement;
    mode?: 'video' | 'audio' | 'both';
    flushingTime?: number;
    fps?: number;
    clearBuffer?: boolean;
    debug?: boolean;
    onReady?: () => void;
    onError?: (err: Error) => void;
    [key: string]: unknown;
  }
  interface JMuxerFeedData {
    video?: Uint8Array;
    audio?: Uint8Array;
    duration?: number;
  }
  export default class JMuxer {
    constructor(options: JMuxerOptions);
    feed(data: JMuxerFeedData): void;
    reset(): void;
    destroy(): void;
  }
}
