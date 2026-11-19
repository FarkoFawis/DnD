/**
 * The party during a session, as a grid of tall portrait cards: the picture,
 * the character's name, the player's name, HP, the last thing they used and
 * their conditions.
 *
 * - DM (`DmParty`): the grid is the middle page (session/DmSession.tsx);
 *   tapping a card opens that player's sheet under it.
 * - Players: the grid is a page next to their sheet (session/PlayerSession.tsx).
 *   Swipe right-to-left on the sheet to slide it in. Their own card is highlighted.
 */
import { useEffect, useRef, useState } from 'react';
import type { SessionPlayer, SessionState } from '@dnd/shared';
import { isDead } from '@dnd/shared';
import { Portrait } from './Portrait.tsx';
import { Sheet, sheetActions } from './Sheet.tsx';
import { StatusChips } from './Status.tsx';
import { actionText } from './Uses.tsx';
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
        {c.levelUpReady && <span className="action-chip party-action">⬆ Can level up</span>}
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

/** DM: the party grid and the sheet of the player whose card is tapped. Nothing else is on this page. */
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
    </section>
  );
}
