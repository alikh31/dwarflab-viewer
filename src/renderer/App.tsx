import { useState, useEffect } from 'react';
import { ConnectionModal } from './components/ConnectionModal';
import { CameraView } from './components/CameraView';

type AppState = 'connecting' | 'connected';

export function App() {
  const [appState, setAppState] = useState<AppState>('connecting');
  const [deviceHost, setDeviceHost] = useState<string | null>(null);

  useEffect(() => {
    // Only return to the connection modal after a sustained disconnect.
    // The SDK auto-reconnects (`reconnect: true`), so brief WS drops emit
    // disconnect → connect within ~1s. Bouncing back to the modal on every
    // blip causes a reconnect storm because the modal triggers a fresh
    // sdkService.connect() which closes the just-reconnected socket.
    let disconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = window.api.sdk.onConnectionState(({ connected }) => {
      if (!connected && appState === 'connected') {
        if (disconnectTimer) clearTimeout(disconnectTimer);
        disconnectTimer = setTimeout(() => {
          setAppState('connecting');
          setDeviceHost(null);
        }, 4000);
      } else if (connected) {
        if (disconnectTimer) {
          clearTimeout(disconnectTimer);
          disconnectTimer = null;
        }
      }
    });
    return () => {
      if (disconnectTimer) clearTimeout(disconnectTimer);
      cleanup();
    };
  }, [appState]);

  const handleConnected = (host: string) => {
    setDeviceHost(host);
    setAppState('connected');
  };

  const handleDisconnect = async () => {
    await window.api.sdk.disconnect();
    setAppState('connecting');
    setDeviceHost(null);
  };

  return (
    <div className="h-screen w-screen bg-dwarf-bg text-dwarf-text overflow-hidden">
      {/* Drag region for frameless window */}
      <div className="absolute top-0 left-0 right-0 h-12 app-drag-region z-50" />

      {appState === 'connecting' && (
        <ConnectionModal onConnected={handleConnected} />
      )}

      {appState === 'connected' && deviceHost && (
        <CameraView host={deviceHost} onDisconnect={handleDisconnect} />
      )}
    </div>
  );
}
