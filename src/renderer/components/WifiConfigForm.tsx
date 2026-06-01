import { useState, useEffect } from 'react';

interface Props {
  onSubmit: (ssid: string, password: string, mode: 'sta' | 'ap') => void;
  onBack: () => void;
}

interface WifiNetwork {
  ssid: string;
  signal: number;
  security: string;
}

export function WifiConfigForm({ onSubmit, onBack }: Props) {
  const [mode, setMode] = useState<'sta' | 'ap'>('sta');
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [networks, setNetworks] = useState<WifiNetwork[]>([]);
  const [scanning, setScanning] = useState(false);
  const [apInfo, setApInfo] = useState<{ ssid: string; password: string } | null>(null);

  // Load AP info and scan WiFi on mount
  useEffect(() => {
    window.api.ble.getApInfo().then(setApInfo).catch(() => {});
    scanNetworks();
  }, []);

  const scanNetworks = async () => {
    setScanning(true);
    try {
      const results = await window.api.ble.scanWifi();
      setNetworks(results.filter((n) => n.ssid));
    } catch {
      // ignore
    }
    setScanning(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'ap') {
      onSubmit('', '', 'ap');
    } else {
      if (!ssid.trim()) return;
      onSubmit(ssid.trim(), password, 'sta');
    }
  };

  const signalBars = (signal: number) => {
    const abs = Math.abs(signal);
    if (abs <= 50) return 4;
    if (abs <= 65) return 3;
    if (abs <= 75) return 2;
    return 1;
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-dwarf-muted hover:text-dwarf-text transition-colors"
        >
          Back
        </button>
        <span className="text-sm font-medium">WiFi Configuration</span>
        <div className="w-8" />
      </div>

      {/* Mode toggle */}
      <div className="flex rounded-xl bg-dwarf-bg p-1">
        <button
          type="button"
          onClick={() => setMode('sta')}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
            mode === 'sta'
              ? 'bg-dwarf-accent text-white'
              : 'text-dwarf-muted hover:text-dwarf-text'
          }`}
        >
          Join WiFi
        </button>
        <button
          type="button"
          onClick={() => setMode('ap')}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
            mode === 'ap'
              ? 'bg-dwarf-accent text-white'
              : 'text-dwarf-muted hover:text-dwarf-text'
          }`}
        >
          Hotspot (AP)
        </button>
      </div>

      {mode === 'ap' && (
        <div className="space-y-3">
          <p className="text-xs text-dwarf-muted">
            Switch the telescope to its built-in hotspot. Connect your computer to this network afterward.
          </p>
          {apInfo && (
            <div className="p-3 rounded-lg bg-dwarf-bg border border-dwarf-border">
              <div className="text-xs text-dwarf-muted mb-1">Hotspot credentials</div>
              <div className="font-medium">{apInfo.ssid}</div>
              <div className="text-sm text-dwarf-muted font-mono">{apInfo.password}</div>
            </div>
          )}
          <button
            type="submit"
            className="w-full py-3 bg-dwarf-accent hover:bg-dwarf-accent-hover rounded-xl font-medium transition-colors"
          >
            Switch to Hotspot
          </button>
        </div>
      )}

      {mode === 'sta' && (
        <div className="space-y-3">
          <p className="text-xs text-dwarf-muted">
            Connect the telescope to your WiFi network so both devices are on the same network.
          </p>

          {/* WiFi network list */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-sm text-dwarf-muted">Available Networks</label>
              <button
                type="button"
                onClick={scanNetworks}
                disabled={scanning}
                className="text-xs text-dwarf-accent hover:text-dwarf-accent-hover disabled:opacity-50"
              >
                {scanning ? 'Scanning...' : 'Refresh'}
              </button>
            </div>
            <div className="max-h-36 overflow-y-auto rounded-lg border border-dwarf-border bg-dwarf-bg">
              {scanning && networks.length === 0 && (
                <div className="p-3 text-center text-xs text-dwarf-muted">
                  <div className="inline-block w-3 h-3 border border-dwarf-accent border-t-transparent rounded-full animate-spin mr-1" />
                  Scanning...
                </div>
              )}
              {networks.map((net) => (
                <button
                  type="button"
                  key={net.ssid}
                  onClick={() => setSsid(net.ssid)}
                  className={`w-full flex items-center justify-between px-3 py-2 text-left text-sm hover:bg-dwarf-surface-hover transition-colors ${
                    ssid === net.ssid ? 'bg-dwarf-accent/10 text-white' : ''
                  }`}
                >
                  <span className="truncate">{net.ssid}</span>
                  <div className="flex gap-0.5 ml-2 flex-shrink-0">
                    {[1, 2, 3, 4].map((bar) => (
                      <div
                        key={bar}
                        className={`w-1 rounded-sm ${
                          bar <= signalBars(net.signal) ? 'bg-dwarf-accent' : 'bg-dwarf-border'
                        }`}
                        style={{ height: `${bar * 3 + 2}px` }}
                      />
                    ))}
                  </div>
                </button>
              ))}
              {!scanning && networks.length === 0 && (
                <div className="p-3 text-center text-xs text-dwarf-muted">No networks found</div>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm text-dwarf-muted mb-1">Network Name</label>
            <input
              type="text"
              value={ssid}
              onChange={(e) => setSsid(e.target.value)}
              placeholder="WiFi SSID"
              className="w-full px-4 py-3 bg-dwarf-bg border border-dwarf-border rounded-xl text-dwarf-text placeholder-dwarf-muted/50 focus:outline-none focus:border-dwarf-accent"
              required
            />
          </div>

          <div>
            <label className="block text-sm text-dwarf-muted mb-1">Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="w-full px-4 py-3 bg-dwarf-bg border border-dwarf-border rounded-xl text-dwarf-text placeholder-dwarf-muted/50 focus:outline-none focus:border-dwarf-accent pr-12"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-dwarf-muted hover:text-dwarf-text text-xs"
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="w-full py-3 bg-dwarf-accent hover:bg-dwarf-accent-hover rounded-xl font-medium transition-colors"
          >
            Connect to WiFi
          </button>
        </div>
      )}
    </form>
  );
}
