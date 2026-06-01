import { useState } from 'react';

/**
 * Sentry tracking. Pick an object type → device runs detection on the live
 * feed and slews to follow whatever it finds. Stop ends the sentry session.
 *
 * Verified live on firmware v1.5.0.1: SENTRY_MODE_START (14802) silently drops
 * requests without a `type` payload. Types from the device's sentry object types (third
 * enum arg = wire value): 1=UFO, 2=Bird, 3=Person, 4=Animal, 5=Vehicle,
 * 6=Flying, 7=Boat. MOT (14804) and UFO (14806) start commands also silently
 * drop on this firmware in Normal mode — likely require Auto-Track shooting
 * mode (id=6) plus a target-selection step we don't have UI for yet.
 */
const SENTRY_TYPES = [
  { type: 1, label: 'UFO' },
  { type: 2, label: 'Bird' },
  { type: 3, label: 'Person' },
  { type: 4, label: 'Animal' },
  { type: 5, label: 'Vehicle' },
  { type: 6, label: 'Flying' },
  { type: 7, label: 'Boat' },
] as const;

export function TrackingPanel() {
  const [active, setActive] = useState<number | null>(null); // active sentry type, null = stopped
  const [busy, setBusy] = useState(false);

  const start = async (type: number) => {
    if (busy || active === type) return;
    setBusy(true);
    try {
      if (active !== null) await window.api.sdk.stopSentry();
      await window.api.sdk.trackSentryStart(type);
      setActive(type);
    } catch { /* ignore */ }
    setBusy(false);
  };

  const stop = async () => {
    if (busy || active === null) return;
    setBusy(true);
    try {
      await window.api.sdk.stopSentry();
      setActive(null);
    } catch { /* ignore */ }
    setBusy(false);
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[10px] text-white/40 uppercase tracking-wider mr-1">Sentry</span>
      <button
        onClick={stop}
        disabled={busy || active === null}
        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all
          ${active === null
            ? 'bg-white/15 text-white'
            : 'text-white/60 hover:text-white hover:bg-white/10'
          } disabled:opacity-40`}
      >
        Off
      </button>
      {SENTRY_TYPES.map((s) => (
        <button
          key={s.type}
          onClick={() => start(s.type)}
          disabled={busy}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all
            ${active === s.type
              ? 'bg-dwarf-accent text-white ring-1 ring-dwarf-accent/50'
              : 'text-white/60 hover:text-white hover:bg-white/10'
            } disabled:opacity-50`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
