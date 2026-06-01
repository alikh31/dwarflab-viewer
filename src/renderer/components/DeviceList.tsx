import type { DiscoveredDevice } from '../lib/types';

interface Props {
  devices: DiscoveredDevice[];
  onSelect: (ip: string) => void;
  onRescan: () => void;
  onManual: () => void;
  onConfigure?: (device: DiscoveredDevice) => void;
}

export function DeviceList({ devices, onSelect, onRescan, onManual, onConfigure }: Props) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Discovered Devices</h3>
        <div className="inline-block w-4 h-4 border-2 border-dwarf-accent border-t-transparent rounded-full animate-spin" />
      </div>

      {devices.length === 0 && (
        <div className="text-center py-6">
          <p className="text-dwarf-muted text-sm">Searching for telescopes on your network...</p>
        </div>
      )}

      <div className="space-y-2 max-h-64 overflow-y-auto">
        {devices.map((device) => (
          <div
            key={device.mac || device.ip}
            className="w-full flex items-center gap-3 p-3 rounded-xl bg-dwarf-bg hover:bg-dwarf-surface-hover border border-dwarf-border transition-colors"
          >
            {/* Telescope icon */}
            <div className="w-10 h-10 rounded-full bg-dwarf-accent/15 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-dwarf-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 2v4m0 12v4M2 12h4m12 0h4" />
                <path d="m4.93 4.93 2.83 2.83m8.48 8.48 2.83 2.83m-2.83-14.14 2.83-2.83M4.93 19.07l2.83-2.83" />
              </svg>
            </div>

            <button
              onClick={() => onSelect(device.ip)}
              className="flex-1 min-w-0 text-left"
            >
              <div className="font-medium truncate">{device.name}</div>
              <div className="text-xs text-dwarf-muted flex items-center gap-2">
                <span>{device.ip}</span>
                {device.firmware && (
                  <>
                    <span className="text-dwarf-border">|</span>
                    <span>v{device.firmware}</span>
                  </>
                )}
              </div>
            </button>

            {/* WiFi settings gear */}
            {onConfigure && (
              <button
                onClick={(e) => { e.stopPropagation(); onConfigure(device); }}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-dwarf-muted hover:text-dwarf-text hover:bg-dwarf-border/50 transition-colors flex-shrink-0"
                title="WiFi settings"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </button>
            )}

            {/* Connect arrow */}
            <button
              onClick={() => onSelect(device.ip)}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-dwarf-muted hover:text-dwarf-accent transition-colors flex-shrink-0"
              title="Connect"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          onClick={onRescan}
          className="flex-1 py-2 bg-dwarf-surface-hover hover:bg-dwarf-border rounded-xl text-sm font-medium transition-colors"
        >
          Rescan
        </button>
        <button
          onClick={onManual}
          className="flex-1 py-2 bg-dwarf-surface-hover hover:bg-dwarf-border rounded-xl text-sm font-medium transition-colors text-dwarf-muted"
        >
          Enter IP Manually
        </button>
      </div>
    </div>
  );
}
