import { useRef, useCallback, useState } from 'react';

interface Position {
  x: number;
  y: number;
}

export function useDraggable(initialPosition: Position) {
  const [position, setPosition] = useState<Position>(initialPosition);
  const dragging = useRef(false);
  const didDrag = useRef(false);
  const offset = useRef({ x: 0, y: 0 });

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      dragging.current = true;
      didDrag.current = false;
      offset.current = {
        x: e.clientX - position.x,
        y: e.clientY - position.y,
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [position],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    didDrag.current = true;
    setPosition({
      x: e.clientX - offset.current.x,
      y: e.clientY - offset.current.y,
    });
  }, []);

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  return {
    position,
    didDrag,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}
