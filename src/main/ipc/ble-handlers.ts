import { ipcMain } from 'electron';
import { IPC } from './channels';
import type { BleService } from '../services/ble-service';

export function registerBleHandlers(bleService: BleService): void {
  ipcMain.handle(IPC.BLE_SCAN_START, async (_event, timeout?: number) => {
    return await bleService.scan(timeout);
  });

  ipcMain.handle(IPC.BLE_CONNECT, async (_event, address: string) => {
    await bleService.connect(address);
  });

  ipcMain.handle(IPC.BLE_GET_CONFIG, async () => {
    return await bleService.getConfig();
  });

  ipcMain.handle(IPC.BLE_SET_WIFI_STA, async (_event, ssid: string, password: string) => {
    await bleService.setStaMode(ssid, password);
  });

  ipcMain.handle(IPC.BLE_SET_WIFI_AP, async (_event, ssid: string, password: string) => {
    await bleService.setApMode(ssid, password);
  });

  ipcMain.handle(IPC.BLE_GET_AP_INFO, async () => {
    return await bleService.getApInfo();
  });

  ipcMain.handle(IPC.BLE_SCAN_WIFI, async () => {
    return await bleService.scanWifi();
  });

  ipcMain.handle(IPC.BLE_DISCONNECT, async () => {
    await bleService.disconnect();
  });
}
