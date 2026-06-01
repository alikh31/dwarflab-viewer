import { ipcMain, type BrowserWindow } from 'electron';
import type { DiscoveryService } from '../services/discovery-service';
import { IPC } from './channels';

export function registerDiscoveryHandlers(
  service: DiscoveryService,
  getWindow: () => BrowserWindow,
): void {
  ipcMain.handle(IPC.DISCOVERY_START, async (_event, timeout?: number) => {
    await service.startDiscovery(getWindow(), timeout);
  });

  ipcMain.handle(IPC.DISCOVERY_STOP, () => {
    service.stopDiscovery();
  });
}
