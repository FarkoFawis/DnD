import { useEffect, useState, type ReactNode } from 'react';
import { StatusPill } from '../StatusPill.tsx';
import type { Game } from '../useGame.ts';

/**
 * The sidebar that slides in from the left: about a third of the screen,
 * wider on phones. It holds what would otherwise sit in a bar at the top
 * (app title, connection status) and whatever the screen adds below.
 * Used on the home screen and, through SessionDrawer, during a session.
 */
export function Drawer(props: { game: Game; open: boolean; onClose: () => void; children: ReactNode }) {
  const { open, onClose } = props;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  return (
    <>
      <div className={`drawer-backdrop ${open ? 'open' : ''}`} onClick={onClose} aria-hidden />
      <aside className={`drawer ${open ? 'open' : ''}`} aria-hidden={!open} inert={!open}>
        <div className="drawer-head">
          <h1>DnD Table</h1>
          <button className="drawer-close" aria-label="Close menu" onClick={onClose}>✕</button>
        </div>
        <StatusPill status={props.game.status} />
        {props.children}
      </aside>
    </>
  );
}

/**
 * During a running session the screen belongs to the game. Everything else
 * (app title, connection status, session info, leaving) lives in the drawer,
 * opened with the menu button at the top left. Used by the DM and by players.
 */
export function SessionDrawer(props: {
  game: Game;
  /** Shown next to the menu button. */
  title: string;
  /** Puts a dot on the menu button: something in the drawer wants attention. */
  attention?: boolean;
  /** The drawer's content, under the title and the connection status. `close` shuts the drawer. */
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <div className="dm-topbar">
        <button className="menu-toggle" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}>
          <span /><span /><span />
          {props.attention && <i className="menu-dot" aria-label="New" />}
        </button>
        <span className="dm-topbar-title">{props.title}</span>
      </div>
      <Drawer game={props.game} open={open} onClose={close}>
        {props.children(close)}
      </Drawer>
    </>
  );
}
