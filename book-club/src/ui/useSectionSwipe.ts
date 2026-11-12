import { useRef, type PointerEvent } from 'react';

/** Horizontal touch only; native vertical scrolling, text selection and Telegram edge gestures win. */
export function useSectionSwipe<T extends string>(
  sections: readonly T[],
  selected: T,
  onChange: (next: T) => void,
) {
  const start = useRef<{ x: number; y: number; time: number; id: number } | null>(null);
  return {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      const target = event.target as Element;
      if (
        event.pointerType !== 'touch' ||
        !event.isPrimary ||
        event.clientX < 24 ||
        event.clientX > innerWidth - 24 ||
        target.closest('button,a,input,textarea,select,summary,[contenteditable="true"]') ||
        target.closest('[role="dialog"]') !== event.currentTarget.closest('[role="dialog"]')
      ) {
        start.current = null;
        return;
      }
      start.current = {
        x: event.clientX,
        y: event.clientY,
        time: event.timeStamp,
        id: event.pointerId,
      };
    },
    onPointerCancel() {
      start.current = null;
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      const from = start.current;
      start.current = null;
      if (
        !from ||
        event.pointerId !== from.id ||
        event.timeStamp - from.time > 700 ||
        window.getSelection()?.toString()
      )
        return;
      const dx = event.clientX - from.x,
        dy = event.clientY - from.y;
      if (Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
      const next = sections[sections.indexOf(selected) + (dx < 0 ? 1 : -1)];
      if (next) onChange(next);
    },
  };
}
