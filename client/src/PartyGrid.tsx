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
import type { Content, SessionPlayer, SessionState } from '@dnd/shared';
import { isDead } from '@dnd/shared';
import { useContent } from './content/useContent.ts';
import { useChanges } from './fx/hooks.ts';
import { ActionRing, HpBar, HpFx, Num } from './fx/sheetFx.tsx';
import { InspirationStar } from './Inspiration.tsx';
import { PartyChecks } from './PartyChecks.tsx';
import { Portrait } from './Portrait.tsx';
import { Sheet, sheetActions } from './Sheet.tsx';
import { StatusChips } from './Status.tsx';
import { actionText } from './Uses.tsx';
import type { Game } from './useGame.ts';

function PartyCard({ player, isMe, selected, content, onClick }: { player: SessionPlayer; isMe: boolean; selected?: boolean; content: Content | null; onClick?: () => void }) {
  const c = player.character;
  const action = actionText(c.lastAction);
  /** How often this character did something since the screen opened: the chip pops in anew each time. */
  const acted = useChanges(c.lastAction?.at);
  /** Heroic Inspiration just arrived: its star pops in. */
  const inspired = useChanges(c.inspiration);
  const body = (
    <>
      <Portrait characterId={player.characterId} character={c} className="party-art" />
      <span className="party-shade" aria-hidden />
      {/* Hit or healed: the card flashes and the amount floats up. Cast or used something: a ring of light. */}
      <HpFx value={c.hpCurrent} />
      <ActionRing character={c} content={content} />
      {isMe && <span className="party-you">You</span>}
      {!player.online && <span className="party-offline">Offline</span>}
      {c.inspiration && (
        <span key={inspired} className={`party-star ${inspired > 0 ? 'fresh' : ''}`} role="img" aria-label="Has Heroic Inspiration">
          <InspirationStar />
        </span>
      )}
      <span className="party-info">
        <span className="party-name">{c.name || player.user.username}</span>
        <span className="party-sub">{[c.species, c.className, `Lv ${c.level}`].filter(Boolean).join(' · ')}</span>
        <span className="party-rule" aria-hidden><span /></span>
        <span className="party-player">{player.user.username}</span>
        <span className="party-hp">
          <HpBar current={c.hpCurrent} max={c.hpMax} />
          <span className="hp-text">
            <Num value={c.hpCurrent} />/{c.hpMax}
            {c.hpTemp > 0 && <span className="small"> +{c.hpTemp}</span>}
            <span className="party-ac"> · AC {c.armorClass}</span>
          </span>
        </span>
        {c.levelUpReady && <span className="action-chip party-action">⬆ Can level up</span>}
        {c.resting && <span className="action-chip party-action">Short rest · spending Hit Dice</span>}
        {action && <span key={acted} className={`action-chip party-action ${acted > 0 ? 'fresh' : ''}`}>{action}</span>}
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
  content,
}: {
  players: SessionPlayer[];
  myId: string;
  /** For the colour of a spell's effect (its school of magic). */
  content: Content | null;
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
            content={content}
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
  const content = useContent();
  const [ranking, setRanking] = useState(false);
  useEffect(() => {
    if (openId) sheet.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [openId]);
  return (
    <section className="party">
      <div className="party-head">
        <h2 className="party-title grow">Party</h2>
        {session.players.length > 0 && <button type="button" className="link" onClick={() => setRanking(true)}>Who is best at…</button>}
      </div>
      {session.players.length > 0 && <p className="muted small mb hint">Tap a player to open their sheet: change HP, give or take items, edit anything.</p>}
      {ranking && <PartyChecks players={session.players} onClose={() => setRanking(false)} />}
      <PartyGrid players={session.players} myId={myId} content={content} selectedId={openId} onSelect={(id) => setOpenId(openId === id ? null : id)} />
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
