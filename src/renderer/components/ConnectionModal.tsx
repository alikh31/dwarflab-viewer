import { useState, useEffect, useRef } from 'react';
import { DeviceList } from './DeviceList';
import { WifiConfigForm } from './WifiConfigForm';
import type { DiscoveredDevice, SerializedBleDevice } from '../lib/types';

type Step = 'discovering' | 'connecting' | 'manual' | 'ble-scan' | 'wifi-config' | 'wifi-applying';

interface Props {
  onConnected: (host: string) => void;
}

export function ConnectionModal({ onConnected }: Props) {
  const [step, setStep] = useState<Step>('discovering');
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [manualHost, setManualHost] = useState('192.168.88.1');
  const [statusText, setStatusText] = useState('');
  const [bleDevices, setBleDevices] = useState<SerializedBleDevice[]>([]);
  const [configDevice, setConfigDevice] = useState<DiscoveredDevice | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Auto-start discovery on mount; cleanup on unmount.
  useEffect(() => {
    handleDiscover();
    return () => {
      cleanupRef.current?.();
      window.api.discovery.stop().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDiscover = async () => {
    setStep('discovering');
    setError(null);
    setDevices([]);

    // Listen for devices as they're found
    cleanupRef.current?.();
    cleanupRef.current = window.api.discovery.onDeviceFound((device) => {
      setDevices((prev) => {
        // Deduplicate by IP
        if (prev.some((d) => d.ip === device.ip)) return prev;
        return [...prev, device];
      });
    });

    try {
      await window.api.discovery.start(10000);
    } catch (err) {
      setError(`Discovery failed: ${String(err)}`);
    }
  };

  const handleStopDiscovery = async () => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    await window.api.discovery.stop().catch(() => {});
  };

  const connectToTelescope = async (host: string) => {
    await handleStopDiscovery();
    setStep('connecting');
    setError(null);
    try {
      setStatusText('Connecting to telescope...');
      await window.api.sdk.connect(host);

      setStatusText('Opening cameras...');
      await window.api.sdk.openTeleCamera();
      await window.api.sdk.openWideCamera();

      onConnected(host);
    } catch (err) {
      setError(`Connection failed: ${String(err)}`);
      setStep('discovering');
      handleDiscover();
    }
  };

  const handleConfigure = async (device: DiscoveredDevice) => {
    await handleStopDiscovery();
    setConfigDevice(device);
    setStep('ble-scan');
    setError(null);
    setBleDevices([]);
    setStatusText('Scanning for telescope via Bluetooth...');

    try {
      const found = await window.api.ble.scan(8000);
      setBleDevices(found);

      if (found.length === 0) {
        setError('No telescopes found via Bluetooth. Make sure the telescope is powered on and nearby.');
        setStep('discovering');
        setConfigDevice(null);
        handleDiscover();
        return;
      }

      // Auto-connect if only one device, or match by name
      const match = found.find((b) =>
        device.name && b.name.toLowerCase().includes(device.name.toLowerCase().replace('dwarf_', 'dwarf'))
      ) || found[0];

      setStatusText(`Connecting to ${match.name} via Bluetooth...`);
      await window.api.ble.connect(match.address);

      setStep('wifi-config');
    } catch (err) {
      setError(`Bluetooth error: ${String(err)}`);
      setStep('discovering');
      setConfigDevice(null);
      handleDiscover();
    }
  };

  const handleWifiSubmit = async (ssid: string, password: string, mode: 'sta' | 'ap') => {
    setStep('wifi-applying');
    setError(null);

    try {
      setStatusText(`Setting WiFi to ${mode === 'ap' ? 'hotspot' : 'station'} mode...`);

      if (mode === 'ap') {
        await window.api.ble.setWifiAp(ssid, password);
      } else {
        await window.api.ble.setWifiSta(ssid, password);
      }

      await window.api.ble.disconnect();

      setStatusText('WiFi configured! Telescope is restarting...');

      // Wait for telescope to reboot and come back on new network
      await new Promise((r) => setTimeout(r, 5000));

      setStatusText('Searching for telescope on network...');
      // Re-discover to find it on the new network
      setStep('discovering');
      setConfigDevice(null);
      handleDiscover();
    } catch (err) {
      setError(`WiFi configuration failed: ${String(err)}`);
      await window.api.ble.disconnect().catch(() => {});
      setStep('discovering');
      setConfigDevice(null);
      handleDiscover();
    }
  };

  const handleWifiBack = async () => {
    await window.api.ble.disconnect().catch(() => {});
    setConfigDevice(null);
    setStep('discovering');
    handleDiscover();
  };

  return (
    <div className="h-full w-full flex items-center justify-center">
      <div className="w-full max-w-md mx-4">
        {/* Logo / Title */}
        <div className="text-center mb-8 pt-12">
          <h1 className="text-3xl font-bold tracking-tight">DWARFLAB</h1>
          <p className="text-dwarf-muted mt-1">Connect to your telescope</p>
        </div>

        {/* Card */}
        <div className="bg-dwarf-surface rounded-2xl border border-dwarf-border p-6 shadow-xl">
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-dwarf-danger/10 border border-dwarf-danger/20 text-dwarf-danger text-sm">
              {error}
            </div>
          )}

          {step === 'discovering' && (
            <div>
              <DeviceList
                devices={devices}
                onSelect={(ip) => connectToTelescope(ip)}
                onConfigure={handleConfigure}
                onRescan={handleDiscover}
                onManual={async () => {
                  await handleStopDiscovery();
                  setStep('manual');
                }}
              />
            </div>
          )}

          {(step === 'connecting' || step === 'ble-scan' || step === 'wifi-applying') && (
            <div className="text-center py-8">
              <div className="inline-block w-8 h-8 border-2 border-dwarf-accent border-t-transparent rounded-full animate-spin mb-4" />
              <p className="text-dwarf-muted">{statusText}</p>
            </div>
          )}

          {step === 'wifi-config' && (
            <div>
              {configDevice && (
                <p className="text-xs text-dwarf-muted mb-3 text-center">
                  Configuring WiFi for {configDevice.name}
                </p>
              )}
              <WifiConfigForm
                onSubmit={handleWifiSubmit}
                onBack={handleWifiBack}
              />
            </div>
          )}

          {step === 'manual' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-dwarf-muted mb-1">Telescope IP Address</label>
                <input
                  type="text"
                  value={manualHost}
                  onChange={(e) => setManualHost(e.target.value)}
                  placeholder="192.168.88.1"
                  className="w-full px-4 py-3 bg-dwarf-bg border border-dwarf-border rounded-xl text-dwarf-text placeholder-dwarf-muted/50 focus:outline-none focus:border-dwarf-accent"
                />
              </div>
              <button
                onClick={() => connectToTelescope(manualHost)}
                className="w-full py-3 bg-dwarf-accent hover:bg-dwarf-accent-hover rounded-xl font-medium transition-colors"
              >
                Connect
              </button>
              <button
                onClick={() => {
                  setStep('discovering');
                  handleDiscover();
                }}
                className="w-full py-2 text-dwarf-muted hover:text-dwarf-text text-sm transition-colors"
              >
                Back
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
