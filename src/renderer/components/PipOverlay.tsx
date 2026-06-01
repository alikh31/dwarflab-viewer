import { MjpegStream } from './MjpegStream';
import { useDraggable } from '../hooks/useDraggable';

interface Props {
  src: string;
  label: string;
  cameraId: 'tele' | 'wide';
  onTap: () => void;
}

export function PipOverlay({ src, label, cameraId, onTap }: Props) {
  const { position, didDrag, onPointerDown, onPointerMove, onPointerUp } =
    useDraggable({ x: 20, y: 20 });

  return (
    <div
      className="absolute z-40 cursor-grab active:cursor-grabbing"
      style={{
        left: position.x,
        bottom: position.y < 0 ? 20 : undefined,
        top: position.y >= 0 ? position.y : undefined,
        width: '20%',
        minWidth: '180px',
        maxWidth: '320px',
        aspectRatio: '16 / 9',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => {
        onPointerUp();
        if (!didDrag.current) {
          onTap();
        }
      }}
    >
      <div
        className="h-full w-full rounded-2xl overflow-hidden
                    shadow-2xl shadow-black/50 border border-white/10
                    transition-transform duration-200 hover:scale-[1.02]"
      >
        <MjpegStream src={src} alt={label} cameraId={cameraId} className="h-full w-full" />
      </div>
      <div
        className="absolute bottom-2 left-3 text-xs font-medium text-white/70
                    bg-black/40 px-2 py-0.5 rounded-full backdrop-blur-sm"
      >
        {label}
      </div>
    </div>
  );
}
