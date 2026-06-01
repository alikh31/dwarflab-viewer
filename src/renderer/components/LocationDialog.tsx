import { useCallback, useEffect, useState } from 'react';
import { pushToast } from '../hooks/useToasts';

interface Props {
  onClose: () => void;
}

interface StoredLocation {
  lon: number;
  lat: number;
}

/**
 * Centered modal for picking observing-site coordinates. The values are used
 * by all astro flows that need to know where the telescope is on Earth
 * (calibration, EQ polar align, GoTo). On Save, the location is persisted in
 * the local settings store *and* pushed to the device so the firmware can use
 * it for its own slewing math.
 *
 * Uses navigator.geolocation in the renderer — in Electron this triggers the
 * macOS CoreLocation permission prompt on first use. If the user denies, we
 * fall back to manual entry (which they can do at any time).
 */
export function LocationDialog({ onClose }: Props) {
  const [lat, setLat] = useState<string>('');
  const [lon, setLon] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);

  // Pre-fill from saved settings on mount.
  useEffect(() => {
    let alive = true;
    window.api.settings.get<StoredLocation>('astro.location').then((loc) => {
      if (!alive || !loc) return;
      setLat(String(loc.lat));
      setLon(String(loc.lon));
    }).catch(() => { /* settings might not exist yet */ });
    return () => { alive = false; };
  }, []);

  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleKey]);

  const handleUseMyLocation = () => {
    if (locating) return;
    if (!('geolocation' in navigator)) {
      pushToast('Geolocation not available in this build', 'err');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6));
        setLon(pos.coords.longitude.toFixed(6));
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        pushToast(`Location lookup failed: ${err.message}`, 'err');
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60_000 },
    );
  };

  const handleSave = async () => {
    if (busy) return;
    const latN = Number(lat);
    const lonN = Number(lon);
    if (!Number.isFinite(latN) || latN < -90 || latN > 90) {
      pushToast('Latitude must be between -90 and 90', 'err');
      return;
    }
    if (!Number.isFinite(lonN) || lonN < -180 || lonN > 180) {
      pushToast('Longitude must be between -180 and 180', 'err');
      return;
    }
    setBusy(true);
    try {
      await window.api.settings.set('astro.location', { lon: lonN, lat: latN });
      try {
        await window.api.sdk.system.setLocation(lonN, latN);
      } catch (e) {
        // Device might not be connected — we still saved locally.
        console.warn('setLocation to device failed:', e);
      }
      pushToast('Location saved', 'ok');
      onClose();
    } catch (e) {
      pushToast(`Save failed: ${(e as Error).message}`, 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="absolute inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center app-no-drag"
      onClick={onClose}
    >
      <div
        className="w-[28rem] max-w-[90vw] rounded-2xl bg-dwarf-surface border border-white/10 shadow-2xl shadow-black/40 p-6 app-no-drag"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-medium text-white">Observing site</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center"
            aria-label="Close"
          >
            <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18.36 5.64l-12.72 12.72" />
              <path d="M5.64 5.64l12.72 12.72" />
            </svg>
          </button>
        </div>

        <p className="text-xs text-white/50 mb-4 leading-relaxed">
          Used by polar align, plate-solve calibration and GoTo. Saved locally
          and pushed to the telescope.
        </p>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <label className="text-xs text-white/60 flex flex-col gap-1">
            Latitude
            <input
              type="number"
              step="0.0001"
              min={-90}
              max={90}
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              placeholder="37.7749"
              className="px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-white text-sm focus:outline-none focus:border-dwarf-accent/50"
            />
          </label>
          <label className="text-xs text-white/60 flex flex-col gap-1">
            Longitude
            <input
              type="number"
              step="0.0001"
              min={-180}
              max={180}
              value={lon}
              onChange={(e) => setLon(e.target.value)}
              placeholder="-122.4194"
              className="px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-white text-sm focus:outline-none focus:border-dwarf-accent/50"
            />
          </label>
        </div>

        <button
          onClick={handleUseMyLocation}
          disabled={locating}
          className="w-full mb-5 px-3 py-2 rounded-lg text-xs font-medium text-white/80 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="10" r="3" />
            <path d="M12 21s-7-6.5-7-12a7 7 0 0114 0c0 5.5-7 12-7 12z" />
          </svg>
          {locating ? 'Locating…' : 'Use my location'}
        </button>

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-medium text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={busy}
            className="px-4 py-2 rounded-lg text-xs font-medium bg-dwarf-accent text-white hover:bg-dwarf-accent-hover transition-colors disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
