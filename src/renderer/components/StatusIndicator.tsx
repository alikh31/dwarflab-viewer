interface Props {
  connected: boolean;
  battery: number | null;
  charging: boolean;
}

// Minimal status: just connection dot + battery. Anything richer lives in the
// dedicated panels (Mode, Album, …) so the toolbar stays readable.
export function StatusIndicator({ connected, battery, charging }: Props) {
  return (
    <div className="flex items-center gap-2 text-xs text-white/60 tabular-nums">
      <div
        className={`w-2.5 h-2.5 rounded-full ${connected ? 'bg-dwarf-success' : 'bg-dwarf-danger'}`}
        title={connected ? 'Connected' : 'Disconnected'}
      />
      {battery !== null && (
        <span title={`Battery ${battery}%${charging ? ' (charging)' : ''}`}>
          {battery}%{charging ? '+' : ''}
        </span>
      )}
    </div>
  );
}
