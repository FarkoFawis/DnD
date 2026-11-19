import { useEffect, useState } from 'react';
import type { Combat, SessionState } from '@dnd/shared';

/** What the DM adds to a player's screen: the handout being shown and the turn order of a fight. */
export function PlayerExtras({ session, myCharacterId }: { session: SessionState; myCharacterId?: string }) {
  return (
    <>
      <HandoutView handout={session.handout} />
      {session.combat && <TurnOrder combat={session.combat} myCharacterId={myCharacterId} />}
    </>
  );
}

/** Pops up full-screen whenever the DM shows a handout; can be put away and reopened while it is shown. */
function HandoutView({ handout }: { handout: SessionState['handout'] }) {
  const [closedAt, setClosedAt] = useState<number | null>(null);
  const open = handout !== null && closedAt !== handout.shownAt;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && handout && setClosedAt(handout.shownAt);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, handout]);
  if (!handout) return null;
  if (!open) {
    return (
      <button className="handout-chip" onClick={() => setClosedAt(null)}>
        <span aria-hidden>📜</span> {handout.title} <span className="muted small">· tap to look again</span>
      </button>
    );
  }
  return (
    <div className="handout-overlay" role="dialog" aria-modal aria-label={handout.title}>
      <div className="handout-scroll">
        <h2 className="handout-title">{handout.title}</h2>
        {handout.imageUrl && <img className="handout-image" src={handout.imageUrl} alt={handout.title} />}
        {handout.text && <p className="handout-text">{handout.text}</p>}
      </div>
      <button className="primary handout-close" onClick={() => setClosedAt(handout.shownAt)}>Close</button>
    </div>
  );
}

/** Read-only turn order for players. */
export function TurnOrder({ combat, myCharacterId }: { combat: Combat; myCharacterId?: string }) {
  const rolled = combat.combatants.some((c) => c.initiative !== null);
  const active = combat.combatants.find((c) => c.id === combat.activeId);
  const myTurn = !!active && active.kind === 'player' && active.ref === myCharacterId;
  return (
    <section className={`card combat-card ${myTurn ? 'my-turn' : ''}`}>
      <h2 className="card-title">
        Fight <span className="muted small">{combat.activeId ? `Round ${combat.round}` : rolled ? 'Turn order' : 'Roll for initiative!'}</span>
      </h2>
      {myTurn && <p className="notice good your-turn">It's your turn!</p>}
      <ol className="turn-list">
        {combat.combatants.map((c) => (
          <li key={c.id} className={`turn-row ${c.id === combat.activeId ? 'active' : ''} ${c.kind}`}>
            <span className="turn-init">{c.initiative ?? '–'}</span>
            <span className="grow">
              {c.name}
              {c.kind === 'player' && c.ref === myCharacterId && <span className="muted small"> (you)</span>}
            </span>
            {c.id === combat.activeId && <span className="badge">Turn</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}
