import { useState, useEffect } from 'react';
import { useDeviceState } from '../../hooks/useDeviceState';

// Verified live on firmware v1.5.0.1: filterType accepts values [0, 1, 2].
// "Dark" exists in the official app but not on this hardware — firmware silently drops 3.
const FILTERS = [
  { id: 0, label: 'VIS', description: 'Visible' },
  { id: 1, label: 'Astro', description: 'Narrowband' },
  { id: 2, label: 'Duo', description: 'Dual-band' },
] as const;

export function FilterPanel() {
  // `confirmed` is what the device says it's on (NOTIFY_GENERAL_INT_PARAM echo).
  // `pending` is what we just clicked but haven't seen confirmed yet.
  const deviceState = useDeviceState();
  const confirmed = deviceState.filterType;
  const [pending, setPending] = useState<number | null>(null);

  // Clear the pending state once the device echoes the change.
  useEffect(() => {
    if (pending !== null && confirmed === pending) setPending(null);
  }, [confirmed, pending]);

  const active = pending ?? confirmed ?? 0;

  const handleSelect = async (filterId: number) => {
    if (filterId === active) return;
    setPending(filterId);
    try {
      await window.api.sdk.setFilter(filterId);
      // No toast — user sees the pending pulse + the ring settling once the
      // device echoes 15264. A toast on every successful filter change is noise.
    } catch {
      setPending(null);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-white/40 uppercase tracking-wider mr-1">Filter</span>
      {FILTERS.map((f) => {
        const isActive = active === f.id;
        const isPending = pending === f.id;
        return (
          <button
            key={f.id}
            onClick={() => handleSelect(f.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all
              ${isActive
                ? 'bg-dwarf-accent/25 text-white ring-1 ring-dwarf-accent/30'
                : 'text-white/50 hover:text-white/80 hover:bg-white/10'
              }
              ${isPending ? 'animate-pulse' : ''}`}
            title={f.description}
          >
            {f.label}
          </button>
        );
      })}
    </div>
  );
}
