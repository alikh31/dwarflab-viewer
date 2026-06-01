import { useState, useEffect } from 'react';
import { useDeviceState } from '../../hooks/useDeviceState';

/**
 * Shooting-mode picker. Reads supported modes from the device
 * (/shootingMode/getSupportedShootingModes — order and ids verified live).
 *
 * The active mode is read from `deviceState.shootingMode`, which is updated
 * from `NOTIFY_SWITCH_SHOOTING_MODE` (15267). That means the ring lands on
 * the correct mode as soon as the device confirms — no optimistic local state.
 *
 * Sun/Moon (parent id=3) has children Sun=8, Moon=9, Planet=10. The viewer
 * shows the parent inline; tapping it expands into the three child buttons.
 * Picking a child switches the mode directly (verified live — no need to
 * switch to the parent first).
 */
interface ShootingMode {
  id: number;
  name: string;
  parentId: number;
}

interface Props {
  onClose: () => void;
}

export function ModePanel({ onClose }: Props) {
  const [modes, setModes] = useState<ShootingMode[]>([]);
  const [expandedParent, setExpandedParent] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const deviceState = useDeviceState();
  const activeMode = deviceState.shootingMode;

  useEffect(() => {
    window.api.sdk.getShootingModes().then((res: unknown) => {
      const data = res as { shootingModes?: ShootingMode[] };
      if (data?.shootingModes) setModes(data.shootingModes);
    }).catch(() => {});
  }, []);

  const topLevel = modes.filter((m) => m.parentId === -1);
  const childrenOf = (parentId: number) => modes.filter((m) => m.parentId === parentId);

  // Auto-expand the parent if a child mode is currently active
  useEffect(() => {
    if (activeMode == null) return;
    const active = modes.find((m) => m.id === activeMode);
    if (active && active.parentId !== -1) setExpandedParent(active.parentId);
  }, [activeMode, modes]);

  const switchTo = async (modeId: number) => {
    if (busy || activeMode === modeId) return;
    setBusy(true);
    try {
      await window.api.sdk.switchMode(modeId);
      // activeMode flips when the device echoes NOTIFY_SWITCH_SHOOTING_MODE
    } catch { /* ignore */ }
    setBusy(false);
    onClose();
  };

  if (modes.length === 0) {
    return <div className="text-xs text-white/40 px-2">Loading modes…</div>;
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {topLevel.map((mode) => {
        const kids = childrenOf(mode.id);
        const hasChildren = kids.length > 0;
        const isActive = activeMode === mode.id;
        const isActiveParent = hasChildren && kids.some((k) => k.id === activeMode);
        const isExpanded = expandedParent === mode.id;

        // Mode without children → simple button
        if (!hasChildren) {
          return (
            <button
              key={mode.id}
              onClick={() => switchTo(mode.id)}
              disabled={busy}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                ${isActive
                  ? 'bg-dwarf-accent text-white'
                  : 'text-white/60 hover:text-white hover:bg-white/10'
                } disabled:opacity-50`}
            >
              {mode.name}
            </button>
          );
        }

        // Mode with children → group: parent acts as expander, children appear inline when expanded
        return (
          <div key={mode.id} className="flex items-center gap-1">
            <button
              onClick={() => setExpandedParent(isExpanded ? null : mode.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                ${isActiveParent
                  ? 'bg-dwarf-accent/40 text-white ring-1 ring-dwarf-accent/50'
                  : 'text-white/60 hover:text-white hover:bg-white/10'
                }`}
            >
              {mode.name}
              <span className={`ml-1 inline-block transition-transform ${isExpanded ? 'rotate-90' : ''}`}>›</span>
            </button>
            {isExpanded && kids.map((k) => (
              <button
                key={k.id}
                onClick={() => switchTo(k.id)}
                disabled={busy}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all
                  ${activeMode === k.id
                    ? 'bg-dwarf-accent text-white'
                    : 'text-white/55 hover:text-white hover:bg-white/10'
                  } disabled:opacity-50`}
              >
                {k.name}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
