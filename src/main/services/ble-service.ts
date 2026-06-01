import type { BleConnection } from '@alikh/dwarflab-ble';

interface CachedDevice {
  name: string;
  address: string;
  rssi: number;
  /** The full BleDevice object from scan (contains non-serializable peripheral) */
  bleDevice: unknown;
}

export class BleService {
  private connection: BleConnection | null = null;
  private devices: CachedDevice[] = [];
  private ble: unknown = null;

  async scan(timeout = 10000): Promise<Array<{ name: string; address: string; rssi: number }>> {
    const { DwarfBle } = await import('@alikh/dwarflab-ble');
    // Reuse or create a single DwarfBle instance so peripheral references persist
    if (!this.ble) {
      this.ble = new DwarfBle();
    }
    const ble = this.ble as InstanceType<typeof DwarfBle>;
    const results = await ble.scan({ timeout });
    this.devices = results.map((d) => ({
      name: d.name,
      address: d.address,
      rssi: d.rssi,
      bleDevice: d,
    }));
    return this.devices.map(({ name, address, rssi }) => ({ name, address, rssi }));
  }

  async connect(address: string): Promise<void> {
    const device = this.devices.find((d) => d.address === address);
    if (!device) throw new Error(`Device ${address} not found in scan results`);

    const { DwarfBle } = await import('@alikh/dwarflab-ble');
    // Reuse the same DwarfBle instance that scanned
    if (!this.ble) {
      this.ble = new DwarfBle();
    }
    const ble = this.ble as InstanceType<typeof DwarfBle>;

    // Pass the original BleDevice object (with its peripheral reference intact)
    this.connection = await ble.connect(device.bleDevice as Parameters<typeof ble.connect>[0]);
  }

  async getConfig(): Promise<unknown> {
    if (!this.connection) throw new Error('Not connected via BLE');
    return this.connection.getConfig();
  }

  async setStaMode(ssid: string, password: string): Promise<void> {
    if (!this.connection) throw new Error('Not connected via BLE');
    await this.connection.setStaMode({ ssid, password });
  }

  async setApMode(ssid: string, password: string): Promise<void> {
    if (!this.connection) throw new Error('Not connected via BLE');
    await this.connection.setApMode({ ssid, password });
  }

  async getApInfo(): Promise<{ ssid: string; password: string }> {
    if (!this.connection) throw new Error('Not connected via BLE');
    return this.connection.getApInfo();
  }

  async scanWifi(): Promise<Array<{ ssid: string; signal: number; security: string }>> {
    if (!this.connection) throw new Error('Not connected via BLE');
    return this.connection.scanWifi();
  }

  async disconnect(): Promise<void> {
    if (this.connection) {
      await this.connection.disconnect();
      this.connection = null;
    }
  }
}
