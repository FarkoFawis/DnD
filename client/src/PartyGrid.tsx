/**
 * The party during a session, as a grid of tall portrait cards: the picture,
 * the character's name, the player's name, HP, the last thing they used and
 * their conditions.
 *
 * - DM (`DmParty`): the grid is the main screen; tapping a card opens that
 *   player's sheet under it.
 * - Players (`PartyPanel`): the grid is a second page next to their sheet.
 *   Swipe right-to-left on the sheet to slide it in, left-to-right to go back
 *   (or tap the tab at the screen edge). Their own card is highlighted.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { SessionPlayer, SessionState } from '@dnd/shared';
import { isDead } from '@dnd/shared';
import { Portrait } from './Portrait.tsx';
import { Sheet, sheetActions } from './Sheet.tsx';
import { StatusChips } from './Status.tsx';
import { RestButtons, actionText } from './Uses.tsx';
import type { Game } from './useGame.ts';

function PartyCard({ player, isMe, selected, onClick }: { player: SessionPlayer; isMe: boolean; selected?: boolean; onClick?: () => void }) {
  const c = player.character;
  const pct = Math.max(0, Math.min(100, (c.hpCurrent / c.hpMax) * 100));
  const action = actionText(c.lastAction);
  const body = (
    <>
      <Portrait characterId={player.characterId} character={c} className="party-art" />
      <span className="party-shade" aria-hidden />
      {isMe && <span className="party-you">You</span>}
      {!player.online && <span className="party-offline">Offline</span>}
      <span className="party-info">
        <span className="party-name">{c.name || player.user.username}</span>
        <span className="party-sub">{[c.species, c.className, `Lv ${c.level}`].filter(Boolean).join(' · ')}</span>
        <span className="party-rule" aria-hidden><span /></span>
        <span className="party-player">{player.user.username}</span>
        <span className="party-hp">
          <span className="hpbar" aria-hidden>
            <span style={{ width: `${pct}%` }} className={pct <= 25 ? 'low' : ''} />
          </span>
          <span className="hp-text">
            {c.hpCurrent}/{c.hpMax}
            {c.hpTemp > 0 && <span className="small"> +{c.hpTemp}</span>}
            <span className="party-ac"> · AC {c.armorClass}</span>
          </span>
        </span>
        {action && <span className="action-chip party-action">{action}</span>}
        <StatusChips character={c} />
      </span>
    </>
  );
  const cls = `party-card ${isMe ? 'me' : ''} ${selected ? 'selected' : ''} ${player.online ? '' : 'away'} ${isDead(c) ? 'dead' : ''}`;
  return onClick ? (
    <button type="button" className={cls} aria-pressed={selected} onClick={onClick}>{body}</button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function PartyGrid({
  players,
  myId,
  selectedId,
  onSelect,
}: {
  players: SessionPlayer[];
  myId: string;
  selectedId?: string | null;
  onSelect?: (userId: string) => void;
}) {
  if (players.length === 0) return <p className="muted">No players in this session.</p>;
  return (
    <ul className="party-grid">
      {players.map((p) => (
        <li key={p.user.id}>
          <PartyCard
            player={p}
            isMe={p.user.id === myId}
            selected={selectedId === p.user.id}
            onClick={onSelect && (() => onSelect(p.user.id))}
          />
        </li>
      ))}
    </ul>
  );
}

/** DM: the party grid, rests, and the sheet of the player whose card is tapped. */
export function DmParty({ game, session, myId }: { game: Game; session: SessionState; myId: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = session.players.find((p) => p.user.id === openId);
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (openId) sheet.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [openId]);
  return (
    <section className="party">
      <h2 className="party-title">Party</h2>
      {session.players.length > 0 && <p className="muted small mb">Tap a player to open their sheet: change HP, give or take items, edit anything.</p>}
      <PartyGrid players={session.players} myId={myId} selectedId={openId} onSelect={(id) => setOpenId(openId === id ? null : id)} />
      {open && (
        <div className="dm-sheet" ref={sheet}>
          <Sheet
            key={open.characterId}
            title={
              <span className="dm-sheet-title">
                <span className="grow">{open.character.name}'s sheet</span>
                <button type="button" className="link" onClick={() => setOpenId(null)}>Close</button>
              </span>
            }
            character={open.character}
            actions={sheetActions(game, open.characterId)}
            dmUnlock
          />
        </div>
      )}
      {session.players.length > 0 && <RestButtons who="the whole party" onRest={(k) => void game.partyRest(k)} />}
    </section>
  );
}

/**
 * Players: the party as a page that slides in from the right over the sheet.
 * The drag follows the finger; letting go past a third of the way (or with a
 * quick flick) finishes the move.
 */
export function PartyPanel({ session, myId, footer }: { session: SessionState; myId: string; footer?: ReactNode }) {
  const [open, setOpen] = useState(false);
  /** 0 = sheet, 1 = party, while a finger is dragging; null otherwise. */
  const [drag, setDrag] = useState<number | null>(null);
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    let start: { x: number; y: number; t: number } | null = null;
    let horizontal: boolean | null = null;
    let progress: number | null = null;
    const blocked = (target: EventTarget | null) =>
      target instanceof Element && target.closest('input, textarea, select, [role="dialog"], .info-backdrop, .picker-backdrop, .drawer') !== null;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || blocked(e.target)) return (start = null);
      const t = e.touches[0]!;
      start = { x: t.clientX, y: t.clientY, t: Date.now() };
      horizontal = null;
      progress = null;
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      const t = e.touches[0]!;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (horizontal === null) {
        if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
        horizontal = Math.abs(dx) > Math.abs(dy) * 1.5;
        if (!horizontal) return (start = null);
      }
      const width = window.innerWidth || 1;
      const base = openRef.current ? 1 : 0;
      progress = Math.max(0, Math.min(1, base - dx / width));
      setDrag(progress);
    };
    const onEnd = () => {
      if (start && horizontal && progress !== null) {
        const quick = Date.now() - start.t < 300;
        const was = openRef.current ? 1 : 0;
        const moved = progress - was;
        setOpen(quick && Math.abs(moved) > 0.08 ? moved > 0 : progress > (was ? 0.67 : 0.33));
      }
      start = null;
      setDrag(null);
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const shown = drag ?? (open ? 1 : 0);
  const visible = shown > 0;
  return (
    <>
      <div
        className={`party-panel ${drag === null ? 'settle' : ''}`}
        style={{ transform: `translateX(${(1 - shown) * 100}%)`, visibility: visible || drag !== null ? 'visible' : 'hidden' }}
        aria-hidden={!open}
        inert={!open && drag === null}
      >
        <div className="party-panel-head">
          <button type="button" className="link back-link" onClick={() => setOpen(false)}>‹ My sheet</button>
          <h2 className="party-title grow">Party</h2>
          <span className="muted small">{session.campaign.name}</span>
        </div>
        <PartyGrid players={session.players} myId={myId} />
        {footer}
      </div>
      <nav className="pager" aria-label="Sheet or party">
        <button type="button" className={`pager-tab ${open ? '' : 'on'}`} aria-pressed={!open} onClick={() => setOpen(false)}>My sheet</button>
        <button type="button" className={`pager-tab ${open ? 'on' : ''}`} aria-pressed={open} onClick={() => setOpen(true)}>Party ›</button>
      </nav>
    </>
  );
}
