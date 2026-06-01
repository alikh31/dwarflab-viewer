import { useEffect, useState, useCallback } from 'react';

export interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'warn' | 'err';
  expires: number;
}

let nextId = 1;
const listeners = new Set<(toasts: Toast[]) => void>();
let active: Toast[] = [];

function emit() {
  for (const l of listeners) l(active);
}

/** Global toast publisher — call from anywhere in the renderer. */
export function pushToast(text: string, kind: Toast['kind'] = 'ok', durationMs = 2500): void {
  const t: Toast = { id: nextId++, text, kind, expires: Date.now() + durationMs };
  active = [...active, t];
  emit();
  setTimeout(() => {
    active = active.filter((x) => x.id !== t.id);
    emit();
  }, durationMs);
}

/** Hook returning the current toast list. */
export function useToasts(): Toast[] {
  const [toasts, setToasts] = useState<Toast[]>(active);
  const onChange = useCallback((next: Toast[]) => setToasts(next), []);
  useEffect(() => {
    listeners.add(onChange);
    return () => { listeners.delete(onChange); };
  }, [onChange]);
  return toasts;
}
