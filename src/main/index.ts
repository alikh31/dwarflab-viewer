import { app, BrowserWindow, shell, ipcMain } from 'electron';
import { join } from 'path';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import { BleService } from './services/ble-service';
import { SdkService } from './services/sdk-service';
import { DiscoveryService } from './services/discovery-service';
import { StreamProxyService } from './services/stream-proxy-service';
import { registerBleHandlers } from './ipc/ble-handlers';
import { registerSdkHandlers } from './ipc/sdk-handlers';
import { registerDiscoveryHandlers } from './ipc/discovery-handlers';
import { IPC } from './ipc/channels';

let mainWindow: BrowserWindow | null = null;
const bleService = new BleService();
const sdkService = new SdkService();
const discoveryService = new DiscoveryService();
const streamProxy = new StreamProxyService();
sdkService.setStreamProxy(streamProxy);

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#0a0a0f',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.dwarflab.viewer');

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  registerBleHandlers(bleService);
  registerSdkHandlers(sdkService, () => mainWindow!);
  registerDiscoveryHandlers(discoveryService, () => mainWindow!);

  // Stream proxy: start local MJPEG server
  streamProxy.start().catch((err) => console.error('[StreamProxy] Failed to start:', err));

  ipcMain.handle(IPC.STREAM_PROXY_PORT, () => streamProxy.port);
  ipcMain.handle(IPC.STREAM_REARM, () => sdkService.rearmStreams());

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  sdkService.disconnect();
  streamProxy.destroy();
  discoveryService.stopDiscovery();
  bleService.disconnect().catch(() => {});
  if (process.platform !== 'darwin') app.quit();
});
