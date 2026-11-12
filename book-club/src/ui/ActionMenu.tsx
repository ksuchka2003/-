import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';

/** Native disclosure keeps secondary actions keyboard-accessible without a second modal. */
export function ActionMenu({
  label,
  children,
  className = '',
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const position = () => {
    const root = menu.current,
      list = panel.current;
    if (!root || !list || !root.open) return;
    const trigger = root.querySelector('summary')!.getBoundingClientRect();
    const modal = root.closest('.modal')?.getBoundingClientRect();
    const left = Math.max(12, (modal?.left || 0) + 12);
    const right = Math.min(innerWidth - 12, (modal?.right || innerWidth) - 12);
    const top = Math.max(12, (modal?.top || 0) + 12);
    const bottom =
      Math.min(window.visualViewport?.height || innerHeight, modal?.bottom || innerHeight) - 12;
    const width = Math.min(250, right - left);
    const below = bottom - trigger.bottom - 8,
      above = trigger.top - top - 8;
    const up = below < Math.min(list.scrollHeight || 180, 240) && above > below;
    list.style.width = width + 'px';
    list.style.left =
      Math.max(left, Math.min(trigger.right - width, right - width)) -
      root.getBoundingClientRect().left +
      'px';
    list.style.top = up ? 'auto' : 'calc(100% + 6px)';
    list.style.bottom = up ? 'calc(100% + 6px)' : 'auto';
    list.style.maxHeight = Math.max(80, Math.min(360, up ? above : below)) + 'px';
  };
  useEffect(() => {
    const closeOutside = (event: Event) => {
      if (menu.current?.open && !menu.current.contains(event.target as Node))
        menu.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && menu.current?.open) {
        event.preventDefault();
        event.stopPropagation();
        menu.current.open = false;
        menu.current.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('focusin', closeOutside);
    document.addEventListener('keydown', escape, true);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('focusin', closeOutside);
      document.removeEventListener('keydown', escape, true);
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, []);
  return (
    <details
      ref={menu}
      className={`action-menu ${className}`}
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
        if (event.currentTarget.open) requestAnimationFrame(position);
      }}
    >
      <summary
        role="button"
        aria-label={label}
        aria-expanded={open}
        title={label}
        onClick={position}
      >
        <MoreHorizontal size={21} aria-hidden="true" />
      </summary>
      <div
        ref={panel}
        className="action-menu-panel"
        role="group"
        aria-label={label}
        onClick={(event) => {
          if ((event.target as Element).closest('button,a') && menu.current)
            menu.current.open = false;
        }}
      >
        {children}
      </div>
    </details>
  );
}
