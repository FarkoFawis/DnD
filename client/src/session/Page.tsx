import type { ReactNode } from 'react';

/**
 * A full-screen page that slides in over the middle page from one side
 * (see usePager). `shown`: 0 = away, 1 = fully in.
 */
export function Page(props: { side: 'left' | 'right'; shown: number; dragging: boolean; open: boolean; children: ReactNode }) {
  const away = (1 - props.shown) * 100;
  return (
    <>
    {/* The page underneath dims as this one comes over it. */}
    <div className={`page-scrim ${props.dragging ? '' : 'settle'}`} style={{ opacity: props.shown * 0.55 }} aria-hidden />
    <div
      className={`party-panel from-${props.side} ${props.dragging ? '' : 'settle'}`}
      style={{
        transform: `translateX(${props.side === 'left' ? -away : away}%)`,
        visibility: props.shown > 0 || props.dragging ? 'visible' : 'hidden',
      }}
      aria-hidden={!props.open}
      inert={!props.open && !props.dragging}
    >
      {props.children}
    </div>
    </>
  );
}
