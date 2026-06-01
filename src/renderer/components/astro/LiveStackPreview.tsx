import { useEffect, useState } from 'react';

/**
 * Bottom-right floating preview of the in-progress stacked image.
 *
 * The device's firmware overwrites a small JPEG at
 *   http://<ip>/DWARF3/Astronomy/<sessionFolder>/stacked_thumbnail.jpg
 * each time it folds a new frame into the stack. We discover the current
 * session folder by listing /DWARF3/Astronomy/ (nginx autoindex HTML),
 * picking the most recent `DWARF_RAW_TELE_*` entry by timestamp suffix, and
 * polling the thumbnail every 5 s with a cache-bust query.
 *
 * Visible only while liveStackingProgress is non-null. Auto-rediscovers the
 * folder if the user starts a new session — the polling loop is restarted
 * via the `sessionTag` dep, which is derived from the progress object.
 */
interface Props {
  host: string;
  // Used to (re-)kick off folder discovery whenever a new session begins.
  // The simplest stable signal is the (target, totalCount) tuple from the
  // progress notification.
  sessionTag: string;
  /**
   * Placement variant (STACKING_UX §4.2):
   *  - 'floating' (default): bottom-right pinned overlay with a hide-✕,
   *    self-positioned. Used by CameraView when the modal is closed.
   *  - 'embedded': in-flow card (no absolute positioning, no hide-✕, wider),
   *    used inside the StackingPanel dashboard.
   */
  variant?: 'floating' | 'embedded';
}

// Folder name format: DWARF_RAW_<scope>_<target>_EXP_<x>_GAIN_<y>_<YYYY-MM-DD-HH-MM-SS-mmm>
// We sort lexically on the timestamp tail to find newest.
const FOLDER_PREFIX = 'DWARF_RAW_';

export function LiveStackPreview({ host, sessionTag, variant = 'floating' }: Props) {
  const embedded = variant === 'embedded';
  const [sessionFolder, setSessionFolder] = useState<string | null>(null);
  const [cacheBust, setCacheBust] = useState(() => Date.now());
  const [hidden, setHidden] = useState(false);

  // Step 1: discover the active session folder by scraping nginx autoindex.
  useEffect(() => {
    let cancelled = false;
    setSessionFolder(null);

    const discover = async () => {
      try {
        const res = await fetch(`http://${host}/DWARF3/Astronomy/`);
        if (!res.ok) return;
        const html = await res.text();
        if (cancelled) return;

        // Pull every <a href="...">; nginx wraps folder names with a trailing
        // slash. Decode percent-encoded spaces. Keep only `DWARF_RAW_*`
        // entries (filters out `CALI_FRAME/` and `DWARF_DARK/`).
        const candidates = Array.from(
          html.matchAll(/href="([^"]+)\/"/g),
          (m) => decodeURIComponent(m[1]),
        ).filter((name) => name.startsWith(FOLDER_PREFIX));

        if (candidates.length === 0) return;

        // Sort by the trailing timestamp YYYY-MM-DD-HH-MM-SS-mmm, NOT by the
        // whole folder name — lex-sorting the whole name puts "WIDE" after
        // "TELE" regardless of date, so the newest TELE session loses to an
        // ancient WIDE one. Extract just the date tail and compare.
        const TIMESTAMP_RE = /(\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-\d{3})$/;
        const ranked = candidates
          .map((name) => ({ name, ts: name.match(TIMESTAMP_RE)?.[1] ?? '' }))
          .filter((x) => x.ts)
          .sort((a, b) => a.ts.localeCompare(b.ts));
        if (ranked.length === 0) return;
        const newest = ranked[ranked.length - 1].name;

        // Verify the newest folder actually has a stacked_thumbnail.jpg
        // before committing to it. Stale sessions don't have one — without
        // this check the <img> would 404 forever on an old folder.
        const probe = await fetch(
          `http://${host}/DWARF3/Astronomy/${encodeURIComponent(newest)}/stacked_thumbnail.jpg`,
          { method: 'HEAD' },
        ).catch(() => null);
        if (cancelled) return;
        if (!probe || !probe.ok) {
          // No preview yet — could be a brand-new session that hasn't written
          // its first frame, or an old session without one. Try again on the
          // next discovery tick.
          return;
        }
        setSessionFolder(newest);
      } catch {
        // Device unreachable — try again on next poll tick.
      }
    };

    discover();
    // Re-discover periodically too — a new session might have started after
    // the user clicked Start, and the first stacked_thumbnail.jpg can take
    // 10-20 s to appear after the first frame is captured.
    const id = setInterval(discover, 3_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [host, sessionTag]);

  // Step 2: tick the cache-bust so the <img> reloads every 5 s.
  useEffect(() => {
    if (!sessionFolder) return;
    setCacheBust(Date.now());
    const id = setInterval(() => setCacheBust(Date.now()), 5_000);
    return () => clearInterval(id);
  }, [sessionFolder]);

  // Embedded keeps a placeholder so the dashboard layout doesn't collapse while
  // the first thumbnail is still being written. Floating stays self-hiding.
  if (!sessionFolder) {
    if (!embedded) return null;
    return (
      <div className="rounded-xl overflow-hidden border border-white/10 bg-black/40">
        <div className="px-2 py-1 text-[10px] tracking-wider text-dwarf-accent/90">STACKED</div>
        <div className="aspect-[4/3] w-full bg-black flex items-center justify-center text-xs text-white/30">
          Waiting for first frame…
        </div>
      </div>
    );
  }
  if (!embedded && hidden) return null;

  const encodedFolder = encodeURIComponent(sessionFolder).replace(/'/g, '%27');
  const url = `http://${host}/DWARF3/Astronomy/${encodedFolder}/stacked_thumbnail.jpg?t=${cacheBust}`;

  const imgWidth = embedded ? 360 : 260;

  const card = (
    <div className="rounded-xl overflow-hidden border border-white/15 bg-black/40 backdrop-blur-xl shadow-2xl shadow-black/40">
      <div className="px-2 py-1 flex items-center justify-between gap-2 text-[10px] tracking-wider">
        <span className="text-dwarf-accent/90">STACKED</span>
        <span className="text-white/40 truncate max-w-[180px]" title={sessionFolder}>
          {sessionFolder.replace(FOLDER_PREFIX, '').slice(0, 22)}…
        </span>
        {/* Hide-✕ only on the floating variant. */}
        {!embedded && (
          <button
            onClick={() => setHidden(true)}
            className="text-white/40 hover:text-white/80 px-1"
            title="Hide preview"
          >
            ×
          </button>
        )}
      </div>
      <img
        src={url}
        alt="Stacked preview"
        width={imgWidth}
        className="block bg-black w-full"
        // Hide the broken-image icon while the firmware is still writing
        // the first thumbnail (~10 s after start).
        onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }}
        onLoad={(e) => { (e.target as HTMLImageElement).style.visibility = 'visible'; }}
      />
    </div>
  );

  if (embedded) return card;

  return (
    <div className="absolute bottom-24 right-4 z-40 pointer-events-auto">
      {card}
    </div>
  );
}
