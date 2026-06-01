import { createSocket, type Socket } from 'dgram';
import type { BrowserWindow } from 'electron';
import { proto } from '@alikh/dwarflab-sdk';
import { IPC } from '../ipc/channels';

const DISCOVERY_PORT = 9900;
const MAGIC = Buffer.from([0x74, 0x78, 0x74, 0x6c]); // "txtl"
const VT_PING = 1;
const VT_ECHO = 2;
const PROBE_INTERVAL_MS = 1000;

export interface DiscoveredDevice {
  name: string;
  ip: string;
  mac: string;
  firmware: string;
}

function ipv4BytesToString(bytes: Uint8Array): string {
  if (!bytes || bytes.length < 4) return '';
  return `${bytes[0]}.${bytes[1]}.${bytes[2]}.${bytes[3]}`;
}

function macBytesToString(bytes: Uint8Array): string {
  if (!bytes || bytes.length === 0) return '';
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join(':');
}

function buildPingPacket(): Buffer {
  const ping = proto.ble.DwarfPing.encode({
    vocaltype: VT_PING,
    timestamp: Date.now(),
    magic: MAGIC,
    vocals: [],
    mutes: [],
  }).finish();
  return Buffer.from(ping);
}

export class DiscoveryService {
  private socket: Socket | null = null;
  private probeTimer: ReturnType<typeof setInterval> | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private devices = new Map<string, DiscoveredDevice>();

  async startDiscovery(window: BrowserWindow, timeoutMs = 8000): Promise<void> {
    this.stopDiscovery();
    this.devices.clear();

    const socket = createSocket({ type: 'udp4', reuseAddr: true });
    this.socket = socket;

    socket.on('message', (msg) => {
      try {
        // First check if it's an echo message
        const header = proto.ble.ComDwarfMsg.decode(msg);
        if (header.vocaltype !== VT_ECHO) return;

        // Parse the full echo
        const echo = proto.ble.DwarfEcho.decode(msg);

        // Validate magic
        if (echo.magic) {
          const echoMagic = new Uint8Array(echo.magic);
          if (echoMagic.length !== MAGIC.length) return;
          for (let i = 0; i < MAGIC.length; i++) {
            if (echoMagic[i] !== MAGIC[i]) return;
          }
        }

        // Extract IP: prefer STA (home network) over AP (hotspot)
        let ip = '';
        if (echo.sta?.ipv4) {
          const staIp = ipv4BytesToString(new Uint8Array(echo.sta.ipv4));
          if (staIp && staIp !== '0.0.0.0') ip = staIp;
        }
        if (!ip && echo.ap?.ipv4) {
          const apIp = ipv4BytesToString(new Uint8Array(echo.ap.ipv4));
          if (apIp && apIp !== '0.0.0.0') ip = apIp;
        }
        if (!ip) ip = '192.168.88.1'; // Default AP IP

        const mac = echo.macAddress ? macBytesToString(new Uint8Array(echo.macAddress)) : '';
        const device: DiscoveredDevice = {
          name: echo.name || 'DWARF',
          ip,
          mac,
          firmware: echo.fwVersion || '',
        };

        const key = mac || ip;
        if (!this.devices.has(key)) {
          this.devices.set(key, device);
          window.webContents.send(IPC.DISCOVERY_DEVICE_FOUND, device);
        }
      } catch {
        // Ignore unparseable packets
      }
    });

    return new Promise<void>((resolve, reject) => {
      socket.on('error', (err) => {
        this.stopDiscovery();
        reject(err);
      });

      socket.bind(DISCOVERY_PORT, () => {
        socket.setBroadcast(true);

        // Send initial ping immediately
        const pingPacket = buildPingPacket();
        socket.send(pingPacket, 0, pingPacket.length, DISCOVERY_PORT, '255.255.255.255');

        // Send periodic probes
        this.probeTimer = setInterval(() => {
          const pkt = buildPingPacket();
          socket.send(pkt, 0, pkt.length, DISCOVERY_PORT, '255.255.255.255');
        }, PROBE_INTERVAL_MS);

        // Auto-stop after timeout
        this.stopTimer = setTimeout(() => {
          this.stopDiscovery();
        }, timeoutMs);

        resolve();
      });
    });
  }

  stopDiscovery(): void {
    if (this.probeTimer) {
      clearInterval(this.probeTimer);
      this.probeTimer = null;
    }
    if (this.stopTimer) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // ignore
      }
      this.socket = null;
    }
  }
}
