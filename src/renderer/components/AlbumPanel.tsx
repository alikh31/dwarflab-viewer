import { useEffect, useState, useCallback } from 'react';
import type { AlbumCount, AlbumItem } from '../lib/types';
import { pushToast } from '../hooks/useToasts';

interface Props {
  onClose: () => void;
}

const MEDIA_TYPE_LABELS: Record<number, string> = {
  0: 'All',
  1: 'Photos',
  2: 'Videos',
  3: 'Burst',
  4: 'Astro',
  5: 'Timelapse',
};

// The macOS traffic-light buttons (and the whole h-12 drag-region declared
// in App.tsx) intercept clicks in the top 48px of the window. Push our header
// below that, and mark interactive elements as `-webkit-app-region: no-drag`
// via the .app-no-drag utility from global.css.
const HEADER_TOP_PADDING = 'pt-14'; // 48px traffic-light + a little breathing room

const FALLBACK_TILE = (
  <div className="w-full h-full flex items-center justify-center text-white/30 text-xs">no preview</div>
);

export function AlbumPanel({ onClose }: Props) {
  const [counts, setCounts] = useState<AlbumCount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<number>(0);
  const [items, setItems] = useState<AlbumItem[] | null>(null);
  const [selected, setSelected] = useState<AlbumItem | null>(null);
  const [loading, setLoading] = useState(false);

  const reloadCounts = useCallback(() => {
    window.api.sdk.albumCounts().then(setCounts).catch((e: Error) => setError(e.message));
  }, []);

  const reloadItems = useCallback(() => {
    setLoading(true);
    setItems(null);
    window.api.sdk
      .albumList(filter, 0, 50)
      .then(setItems)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => { reloadCounts(); }, [reloadCounts]);
  useEffect(() => { reloadItems(); }, [reloadItems]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (selected) setSelected(null);
      else onClose();
    }
  }, [selected, onClose]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleDelete = useCallback(async (item: AlbumItem) => {
    const basename = item.filePath.split('/').pop() || item.fileName;
    const ok = window.confirm(`Delete "${item.astroTargetName ?? basename}" from the device?`);
    if (!ok) return;
    try {
      const res = await window.api.sdk.albumDelete([{
        filePath: item.filePath,
        fileName: item.fileName,
        mediaType: item.mediaType,
        subType: item.astroSubType,
      }]) as Array<{ isSuccess: boolean }> | unknown;
      const arr = Array.isArray(res) ? res : [];
      const allOk = arr.length > 0 && arr.every((r) => r.isSuccess);
      if (allOk) {
        pushToast('Deleted from device', 'ok');
        setSelected(null);
        reloadCounts();
        reloadItems();
      } else {
        pushToast('Device rejected the delete', 'err');
      }
    } catch (e) {
      pushToast(`Delete failed: ${(e as Error).message}`, 'err');
    }
  }, [reloadCounts, reloadItems]);

  const handleDownload = useCallback(async (item: AlbumItem) => {
    const name = item.filePath.split('/').pop() || item.fileName;
    try {
      const res = await window.api.sdk.albumDownload(item.filePath, name);
      if (res.ok && res.savedTo) pushToast(`Saved to ${res.savedTo}`, 'ok', 3500);
      else if (res.error) pushToast(`Download failed: ${res.error}`, 'err');
    } catch (e) {
      pushToast(`Download failed: ${(e as Error).message}`, 'err');
    }
  }, []);

  // The album overlay sits at z-[60]; the drag-region is z-50. The pt-14
  // header offset keeps clickable buttons out of the OS drag-intercept zone.
  return (
    <div className="absolute inset-0 z-[60] bg-black/85 backdrop-blur-md flex flex-col">
      {/* Header */}
      <div className={`flex items-center justify-between px-6 ${HEADER_TOP_PADDING} pb-4 border-b border-white/10 app-no-drag`}>
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-medium text-white">Album</h2>
          {counts && (
            <div className="text-xs text-white/40">
              {counts.reduce((acc, c) => acc + c.count, 0)} items total
            </div>
          )}
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

      {/* Filter tabs */}
      <div className="flex gap-2 px-6 py-3 border-b border-white/5 app-no-drag">
        {counts?.map((c) => (
          <button
            key={c.mediaType}
            onClick={() => setFilter(c.mediaType)}
            className={`app-no-drag px-3 py-1.5 rounded-full text-xs font-medium transition-all
              ${filter === c.mediaType
                ? 'bg-dwarf-accent/25 text-white'
                : 'text-white/40 hover:text-white/70 hover:bg-white/5'
              }`}
          >
            {MEDIA_TYPE_LABELS[c.mediaType] ?? `Type ${c.mediaType}`}
            <span className="ml-1.5 text-white/30">{c.count}</span>
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6 app-no-drag">
        {error && <div className="text-red-400 text-sm">Error: {error}</div>}
        {loading && <div className="text-white/40 text-sm">Loading…</div>}
        {!loading && items && items.length === 0 && (
          <div className="text-white/30 text-sm">No items in this category.</div>
        )}
        {items && items.length > 0 && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
            {items.map((item) => (
              <Tile
                key={item.filePath}
                item={item}
                onSelect={() => setSelected(item)}
                onDelete={() => handleDelete(item)}
                onDownload={() => handleDownload(item)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Detail overlay */}
      {selected && (
        <ItemDetail
          item={selected}
          onClose={() => setSelected(null)}
          onDelete={() => handleDelete(selected)}
          onDownload={() => handleDownload(selected)}
        />
      )}
    </div>
  );
}

function Tile({
  item, onSelect, onDelete, onDownload,
}: {
  item: AlbumItem;
  onSelect: () => void;
  onDelete: () => void;
  onDownload: () => void;
}) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (item.thumbnailPath) {
      window.api.sdk.albumFileUrl(item.thumbnailPath).then((u) => { if (alive) setThumbUrl(u); });
    }
    return () => { alive = false; };
  }, [item.thumbnailPath]);

  // Prefer astro target; otherwise use the path basename (the device's
  // fileName field is sometimes a parent folder rather than the real name).
  const basename = item.filePath.split('/').pop() || item.fileName;
  const label = item.astroTargetName ?? basename.replace(/^DWARF[3]?_(RAW_)?(TELE_|WIDE_)?/, '').replace(/\.(mp4|jpg|jpeg|png)$/i, '');
  // Detect video by the actual file extension on filePath. The device's
  // `fileName` field is unreliable for videos — it returns the literal string
  // "Videos" (the parent folder) instead of the actual file name. mediaType=2
  // also signals video; use either as a hint.
  const isVideo = item.filePath.toLowerCase().endsWith('.mp4') || item.mediaType === 2;

  return (
    <div className="group relative flex flex-col gap-1.5 rounded-lg overflow-hidden bg-white/5 hover:bg-white/10 ring-1 ring-white/10 hover:ring-dwarf-accent/40 transition-all">
      <button onClick={onSelect} className="text-left">
        <div className="aspect-square bg-black/40 relative overflow-hidden">
          {thumbUrl ? (
            <img src={thumbUrl} alt={item.fileName} className="w-full h-full object-cover" loading="lazy" />
          ) : FALLBACK_TILE}
          {isVideo && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center">
                <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
            </div>
          )}
        </div>
        <div className="px-2 pb-2">
          <div className="text-xs text-white/80 truncate">{label}</div>
          {item.astroImageDetails?.shotsStacked != null && (
            <div className="text-[10px] text-white/40">
              stacked {item.astroImageDetails.shotsStacked}/{item.astroImageDetails.shotsToTake} · {item.astroImageDetails.totalExp}s
            </div>
          )}
        </div>
      </button>
      {/* Tile-level actions: appear on hover, top-right */}
      <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <IconButton title="Download" onClick={(e) => { e.stopPropagation(); onDownload(); }}>
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v12m-4-4l4 4 4-4M5 21h14" />
          </svg>
        </IconButton>
        <IconButton title="Delete" onClick={(e) => { e.stopPropagation(); onDelete(); }} danger>
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m1 0v14a2 2 0 01-2 2H8a2 2 0 01-2-2V6h12z" />
          </svg>
        </IconButton>
      </div>
    </div>
  );
}

function IconButton({
  children, onClick, title, danger,
}: {
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
  title: string;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-7 h-7 rounded-full backdrop-blur-md flex items-center justify-center transition-all
        ${danger
          ? 'bg-red-500/40 hover:bg-red-500/70 text-white'
          : 'bg-black/50 hover:bg-black/80 text-white/80'
        }`}
    >
      {children}
    </button>
  );
}

function ItemDetail({
  item, onClose, onDelete, onDownload,
}: {
  item: AlbumItem;
  onClose: () => void;
  onDelete: () => void;
  onDownload: () => void;
}) {
  const [fullUrl, setFullUrl] = useState<string | null>(null);
  const [imgErr, setImgErr] = useState<string | null>(null);
  const [openingExternal, setOpeningExternal] = useState(false);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);     // blob: URL
  const [videoErr, setVideoErr] = useState<string | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);

  const astro = item.astroImageDetails;
  // Detect video by the actual file extension on filePath. The device's
  // `fileName` field is unreliable for videos — it returns the literal string
  // "Videos" (the parent folder) instead of the actual file name. mediaType=2
  // also signals video; use either as a hint.
  const isVideo = item.filePath.toLowerCase().endsWith('.mp4') || item.mediaType === 2;

  useEffect(() => {
    let alive = true;
    setImgErr(null);
    setFullUrl(null);
    setVideoSrc(null);
    setVideoErr(null);
    window.api.sdk.albumFileUrl(item.filePath).then((u) => { if (alive) setFullUrl(u); });
    return () => { alive = false; };
  }, [item.filePath]);

  // For videos: fetch the whole file and feed it to <video> via blob: URL.
  // The device's MP4s have moov at the end (not "faststart"), so direct
  // streaming hits a Chromium edge case where it gives up looking for the
  // index. A Blob is in-memory so the player can seek freely.
  // Apple Silicon Macs decode H.265 in HW via Electron 34, so playback is
  // smooth once it has the data.
  useEffect(() => {
    if (!isVideo || !fullUrl) return;
    let alive = true;
    let createdUrl: string | null = null;
    setVideoLoading(true);
    setVideoErr(null);
    fetch(fullUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (!alive) return;
        createdUrl = URL.createObjectURL(blob);
        setVideoSrc(createdUrl);
      })
      .catch((e: Error) => { if (alive) setVideoErr(e.message); })
      .finally(() => { if (alive) setVideoLoading(false); });
    return () => {
      alive = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [isVideo, fullUrl]);

  const handleOpenExternal = async () => {
    if (openingExternal) return;
    setOpeningExternal(true);
    const name = item.filePath.split('/').pop() || item.fileName;
    const res = await window.api.sdk.albumOpenExternal(item.filePath, name);
    if (!res.ok && res.error) pushToast(`Open failed: ${res.error}`, 'err');
    setOpeningExternal(false);
  };

  return (
    <div className="absolute inset-0 z-[70] bg-black/95 flex flex-col app-no-drag" onClick={onClose}>
      {/* Detail header — also needs to clear the traffic-light drag region */}
      <div className={`flex items-center justify-between px-6 ${HEADER_TOP_PADDING} pb-4 border-b border-white/10 app-no-drag`} onClick={(e) => e.stopPropagation()}>
        <div className="min-w-0">
          <div className="text-sm text-white truncate">{astro?.target ?? item.astroTargetName ?? (item.filePath.split('/').pop() || item.fileName)}</div>
          <div className="text-xs text-white/40">{new Date(item.modificationTime * 1000).toLocaleString()}</div>
        </div>
        <div className="flex items-center gap-2 app-no-drag">
          <button
            onClick={onDownload}
            className="app-no-drag h-8 px-3 rounded-full bg-white/10 hover:bg-white/20 text-xs text-white/80 flex items-center gap-1.5"
            title="Save to disk"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v12m-4-4l4 4 4-4M5 21h14" />
            </svg>
            Download
          </button>
          <button
            onClick={onDelete}
            className="app-no-drag h-8 px-3 rounded-full bg-red-500/30 hover:bg-red-500/60 text-xs text-white flex items-center gap-1.5"
            title="Delete from device"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m1 0v14a2 2 0 01-2 2H8a2 2 0 01-2-2V6h12z" />
            </svg>
            Delete
          </button>
          <button
            onClick={onClose}
            className="app-no-drag w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center"
            title="Close (Esc)"
          >
            <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18.36 5.64l-12.72 12.72" />
              <path d="M5.64 5.64l12.72 12.72" />
            </svg>
          </button>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center p-6 app-no-drag" onClick={(e) => e.stopPropagation()}>
        {fullUrl == null && <div className="text-white/40">Loading…</div>}
        {fullUrl != null && !isVideo && !imgErr && (
          <img
            src={fullUrl}
            alt={item.fileName}
            className="max-w-full max-h-full object-contain"
            onError={() => setImgErr(`Failed to load ${fullUrl}`)}
          />
        )}
        {imgErr && (
          <div className="text-red-300 text-xs max-w-md text-center">
            {imgErr}
            <div className="mt-2 text-white/40">The device may have moved or deleted the file.</div>
          </div>
        )}
        {isVideo && videoLoading && !videoSrc && (
          <div className="text-white/40 text-xs">Buffering video…</div>
        )}
        {isVideo && videoSrc && !videoErr && (
          // H.265 / hvc1 decode is provided by macOS hardware on Apple Silicon
          // via Electron 34. Feeding the file as a blob: URL is the magic
          // bit — the device's MP4s have `moov` at the end of the file, so
          // streaming over HTTP confuses Chromium's media stack.
          <video
            src={videoSrc}
            controls
            autoPlay
            playsInline
            preload="auto"
            className="max-w-full max-h-full bg-black"
            onError={(e) => {
              const el = e.currentTarget;
              setVideoErr(el.error ? `code=${el.error.code} ${el.error.message}` : 'video error');
            }}
          />
        )}
        {isVideo && videoErr && (
          <div className="flex flex-col items-center gap-3 text-center max-w-md">
            <div className="text-xs text-red-300">Inline playback failed: {videoErr}</div>
            <button
              onClick={handleOpenExternal}
              disabled={openingExternal}
              className="h-9 px-4 rounded-full bg-dwarf-accent hover:bg-dwarf-accent/90 text-white text-xs font-medium disabled:opacity-50 flex items-center gap-2"
            >
              {openingExternal ? 'Opening…' : 'Open in OS player'}
            </button>
          </div>
        )}
      </div>
      {astro && (
        <div className="px-6 py-4 border-t border-white/10 text-xs text-white/70 flex flex-wrap gap-x-6 gap-y-1" onClick={(e) => e.stopPropagation()}>
          {astro.target && <span>target: <b className="text-white">{astro.target}</b></span>}
          {astro.floatHourRa != null && <span>RA: {astro.floatHourRa.toFixed(3)}h</span>}
          {astro.floatDegreeDec != null && <span>Dec: {astro.floatDegreeDec.toFixed(3)}°</span>}
          {astro.params?.exp && <span>exp: {astro.params.exp}s × {astro.shotsStacked}/{astro.shotsToTake}</span>}
          {astro.params?.gain && <span>gain: {astro.params.gain}</span>}
          {astro.params?.filter && <span>filter: {astro.params.filter}</span>}
          {astro.params?.width && astro.params?.height && <span>{astro.params.width}×{astro.params.height}</span>}
          {astro.totalExp != null && <span>total exp: {astro.totalExp}s</span>}
        </div>
      )}
    </div>
  );
}
