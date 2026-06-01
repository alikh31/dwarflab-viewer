import { useToasts } from '../hooks/useToasts';

const COLORS = {
  ok:   'bg-dwarf-success/15 text-dwarf-success ring-dwarf-success/30',
  warn: 'bg-yellow-500/15 text-yellow-300 ring-yellow-500/30',
  err:  'bg-dwarf-danger/20 text-dwarf-danger ring-dwarf-danger/40',
} as const;

export function ToastStack() {
  const toasts = useToasts();
  if (toasts.length === 0) return null;
  return (
    <div className="absolute bottom-28 left-1/2 -translate-x-1/2 z-[80] flex flex-col gap-2 items-center pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`px-3 py-2 rounded-lg text-xs font-medium backdrop-blur-md ring-1 shadow-lg shadow-black/30
                      animate-in fade-in slide-in-from-bottom-1 duration-150 ${COLORS[t.kind]}`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
