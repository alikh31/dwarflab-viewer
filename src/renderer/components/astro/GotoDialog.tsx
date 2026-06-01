import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDeviceState } from '../../hooks/useDeviceState';
import { pushToast } from '../../hooks/useToasts';
import {
  TARGETS,
  formatRa,
  formatDec,
  matchesQuery,
  type CatalogTarget,
} from '../../lib/catalog';

interface Props {
  onClose: () => void;
}

const TYPE_LABELS: Record<CatalogTarget['type'], string> = {
  galaxy: 'Galaxy',
  nebula: 'Nebula',
  cluster: 'Cluster',
  'double-cluster': 'Double cluster',
  planet: 'Planet',
  moon: 'Moon',
};

const TYPE_COLORS: Record<CatalogTarget['type'], string> = {
  galaxy: 'bg-purple-400/20 text-purple-200',
  nebula: 'bg-rose-400/20 text-rose-200',
  cluster: 'bg-sky-400/20 text-sky-200',
  'double-cluster': 'bg-sky-400/20 text-sky-200',
  planet: 'bg-amber-400/20 text-amber-200',
  moon: 'bg-slate-400/20 text-slate-200',
};

/**
 * Full-screen GoTo dialog. Top-of-list confirm popover for catalog picks,
 * collapsible manual-entry section at the bottom. Reads `gotoState` to show a
 * "currently slewing" banner with a cancel button.
 */
export function GotoDialog({ onClose }: Props) {
  const ds = useDeviceState();
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState<CatalogTarget | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualRa, setManualRa] = useState('');
  const [manualDec, setManualDec] = useState('');
  const [manualName, setManualName] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [busy, setBusy] = useState(false);

  // Debounce the search query a touch so big-list filtering stays smooth.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 80);
    return () => clearTimeout(t);
  }, [query]);

  const results = useMemo(() => {
    return TARGETS
      .filter((t) => matchesQuery(t, debouncedQuery))
      .slice(0, 200);
  }, [debouncedQuery]);

  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (pending) setPending(null);
      else onClose();
    }
  }, [pending, onClose]);

  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleKey]);

  const handleSlew = async (ra: number, dec: number, name?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await window.api.sdk.astro.gotoDso(ra, dec, name);
      pushToast(`Slewing to ${name ?? 'target'}`, 'ok');
      onClose();
    } catch (e) {
      pushToast(`Slew failed: ${(e as Error).message}`, 'err');
    } finally {
      setBusy(false);
    }
  };

  const handleManualSlew = async () => {
    const ra = parseRa(manualRa);
    const dec = parseDec(manualDec);
    if (ra === null) {
      pushToast('Invalid RA. Use HH:MM:SS or decimal hours (0..24)', 'err');
      return;
    }
    if (dec === null) {
      pushToast("Invalid Dec. Use +DD:MM:SS or decimal degrees (-90..90)", 'err');
      return;
    }
    await handleSlew(ra, dec, manualName.trim() || undefined);
  };

  const handleStop = async () => {
    try {
      await window.api.sdk.astro.gotoStop();
      pushToast('Slew cancelled', 'ok');
    } catch (e) {
      pushToast(`Stop failed: ${(e as Error).message}`, 'err');
    }
  };

  return (
    <div className="absolute inset-0 z-[60] bg-black/90 backdrop-blur-md flex flex-col app-no-drag">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-14 pb-4 border-b border-white/10 app-no-drag">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-medium text-white">GoTo</h2>
          <div className="text-xs text-white/40">{results.length} of {TARGETS.length} targets</div>
        </div>
        <button
          onClick={onClose}
          className="app-no-drag w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 transition-colors flex items-center justify-center"
          aria-label="Close"
        >
          <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18.36 5.64l-12.72 12.72" />
            <path d="M5.64 5.64l12.72 12.72" />
          </svg>
        </button>
      </div>

      {/* Currently slewing banner */}
      {ds.gotoState && (
        <div className="mx-6 mt-4 px-4 py-3 rounded-lg bg-dwarf-accent/15 border border-dwarf-accent/30 flex items-center justify-between app-no-drag">
          <div className="flex items-center gap-3">
            <Spinner />
            <div className="text-sm text-white">
              Currently slewing to <b>{ds.gotoState.targetName || '(unnamed)'}</b>
            </div>
          </div>
          <button
            onClick={handleStop}
            className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-medium text-white transition-colors"
          >
            Cancel slew
          </button>
        </div>
      )}

      {/* Pending confirm */}
      {pending && (
        <div className="mx-6 mt-4 px-4 py-3 rounded-lg bg-white/5 border border-white/15 flex items-center justify-between app-no-drag">
          <div className="text-sm text-white">
            Slew to <b>{pending.name}</b>?
            <span className="ml-2 text-white/50 text-xs">
              RA {pending.ra.toFixed(3)}h · Dec {pending.dec.toFixed(2)}°
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPending(null)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => handleSlew(pending.ra, pending.dec, pending.name)}
              disabled={busy}
              className="px-4 py-1.5 rounded-lg bg-dwarf-accent hover:bg-dwarf-accent-hover text-xs font-medium text-white transition-colors disabled:opacity-50"
            >
              {busy ? 'Slewing…' : 'Slew'}
            </button>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="px-6 py-4 app-no-drag">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Messier, NGC, or common name…"
          autoFocus
          className="w-full px-4 py-2.5 rounded-lg bg-black/40 border border-white/10 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-dwarf-accent/50"
        />
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto px-6 app-no-drag">
        {results.length === 0 ? (
          <div className="text-white/40 text-sm py-8 text-center">
            No targets match "{query}".
          </div>
        ) : (
          <ul className="space-y-1">
            {results.map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => setPending(t)}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/5 transition-colors flex items-center gap-3"
                >
                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-medium ${TYPE_COLORS[t.type]}`}>
                    {TYPE_LABELS[t.type]}
                  </span>
                  <span className="text-sm text-white font-medium min-w-[5rem]">{t.name}</span>
                  {t.alt && t.alt.length > 0 && (
                    <span className="text-xs text-white/50 truncate">{t.alt[0]}</span>
                  )}
                  <span className="flex-1" />
                  <span className="text-xs text-white/40 tabular-nums">mag {t.magnitude.toFixed(1)}</span>
                  <span className="text-xs text-white/50 tabular-nums">{formatRa(t.ra)}</span>
                  <span className="text-xs text-white/50 tabular-nums">{formatDec(t.dec)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Manual entry */}
      <div className="border-t border-white/10 app-no-drag">
        <button
          onClick={() => setManualOpen((v) => !v)}
          className="w-full px-6 py-3 text-left text-xs text-white/60 hover:text-white hover:bg-white/5 transition-colors flex items-center justify-between"
        >
          <span>Manual entry</span>
          <span className={`transition-transform ${manualOpen ? 'rotate-180' : ''}`}>
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </span>
        </button>
        {manualOpen && (
          <div className="px-6 pb-5 space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <label className="text-xs text-white/60 flex flex-col gap-1">
                RA
                <input
                  type="text"
                  value={manualRa}
                  onChange={(e) => setManualRa(e.target.value)}
                  placeholder="HH:MM:SS or 5.5881"
                  className="px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-white text-sm focus:outline-none focus:border-dwarf-accent/50"
                />
              </label>
              <label className="text-xs text-white/60 flex flex-col gap-1">
                Dec
                <input
                  type="text"
                  value={manualDec}
                  onChange={(e) => setManualDec(e.target.value)}
                  placeholder="±DD:MM:SS or -5.391"
                  className="px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-white text-sm focus:outline-none focus:border-dwarf-accent/50"
                />
              </label>
              <label className="text-xs text-white/60 flex flex-col gap-1">
                Name (optional)
                <input
                  type="text"
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  placeholder="My target"
                  className="px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-white text-sm focus:outline-none focus:border-dwarf-accent/50"
                />
              </label>
            </div>
            <div className="flex justify-end">
              <button
                onClick={handleManualSlew}
                disabled={busy}
                className="px-4 py-2 rounded-lg bg-dwarf-accent hover:bg-dwarf-accent-hover text-xs font-medium text-white transition-colors disabled:opacity-50"
              >
                {busy ? 'Slewing…' : 'Slew'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="w-4 h-4 animate-spin text-dwarf-accent" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/* -------------------- RA / Dec parsing -------------------- */

/**
 * Parse RA as decimal hours (0..24). Accepts:
 *   "5:35:17"      → 5 + 35/60 + 17/3600
 *   "5:35"         → 5 + 35/60
 *   "5h35m17s"     → same
 *   "5.5881"       → 5.5881
 *
 * Returns null if input is invalid or out of range.
 */
export function parseRa(input: string): number | null {
  const s = input.trim();
  if (!s) return null;
  // Try decimal first.
  const dec = Number(s);
  if (Number.isFinite(dec) && s.match(/^[0-9.]+$/)) {
    return clampRange(dec, 0, 24);
  }
  // Sexagesimal with colons or h/m/s separators.
  const parts = s.replace(/[hms]/gi, ':').split(':').filter((p) => p.length > 0);
  if (parts.length < 2 || parts.length > 3) return null;
  const [hh, mm, ss = '0'] = parts;
  const h = Number(hh);
  const m = Number(mm);
  const sec = Number(ss);
  if (![h, m, sec].every(Number.isFinite)) return null;
  if (h < 0 || h >= 24 || m < 0 || m >= 60 || sec < 0 || sec >= 60) return null;
  return h + m / 60 + sec / 3600;
}

/**
 * Parse Dec as decimal degrees (-90..90). Accepts:
 *   "+30:39:17"   → 30 + 39/60 + 17/3600
 *   "-5:23:28"    → -(5 + 23/60 + 28/3600)
 *   "30d39m17s"   → same
 *   "-5.391"      → -5.391
 */
export function parseDec(input: string): number | null {
  const s = input.trim();
  if (!s) return null;
  const sign = s.startsWith('-') ? -1 : 1;
  const body = s.replace(/^[+-]/, '');
  // Decimal first.
  const dec = Number(body);
  if (Number.isFinite(dec) && body.match(/^[0-9.]+$/)) {
    return clampRange(sign * dec, -90, 90);
  }
  const parts = body.replace(/[d°m's]/gi, ':').split(':').filter((p) => p.length > 0);
  if (parts.length < 2 || parts.length > 3) return null;
  const [dd, mm, ss = '0'] = parts;
  const d = Number(dd);
  const m = Number(mm);
  const sec = Number(ss);
  if (![d, m, sec].every(Number.isFinite)) return null;
  if (d < 0 || d > 90 || m < 0 || m >= 60 || sec < 0 || sec >= 60) return null;
  const value = sign * (d + m / 60 + sec / 3600);
  return clampRange(value, -90, 90);
}

function clampRange(n: number, lo: number, hi: number): number | null {
  if (n < lo || n > hi) return null;
  return n;
}
