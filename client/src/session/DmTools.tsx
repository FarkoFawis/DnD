import { useState } from 'react';
import { formatModifier, type Combat, type CombatAction, type Combatant, type Npc, type SessionState } from '@dnd/shared';
import { CampaignConfig, npcSummary, type ConfigTab } from '../prep/CampaignConfig.tsx';
import { NumberField } from '../prep/NumberField.tsx';
import { usePrep } from '../prep/usePrep.ts';
import type { Game } from '../useGame.ts';

type NpcPick = { npcId: string; count: number };

/**
 * The DM's table tools during a running session: start a fight, track
 * initiative and turns, show handouts, look things up in the campaign prep.
 */
export function DmTools({ game, session }: { game: Game; session: SessionState }) {
  const [panel, setPanel] = useState<ConfigTab | null>(null);
  const [setup, setSetup] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (run: Parameters<typeof game.call<object>>[0]) => {
    const res = await game.call<object>(run);
    setError(res.ok ? null : res.error);
    return res.ok;
  };

  return (
    <>
      <section className="card dm-tools">
        {error && <p className="error" role="alert" onClick={() => setError(null)}>{error}</p>}
        {session.handout && (
          <p className="notice showing-note">
            <span className="grow">Players see “{session.handout.title}”.</span>
            <button className="link" onClick={() => void send((s, done) => s.emit('handout:show', { handoutId: null }, done))}>Hide</button>
          </p>
        )}
        {session.combat ? (
          <CombatTracker
            combat={session.combat}
            act={(action) => send((s, done) => s.emit('combat:action', action, done))}
            onAdd={() => setSetup(true)}
            onEnd={() => {
              if (window.confirm('End the fight?')) void send((s, done) => s.emit('combat:end', done));
            }}
          />
        ) : (
          <button className="primary fight-button" onClick={() => setSetup(true)}>⚔ Initiate fight</button>
        )}
        <div className="tool-row">
          <button className="secondary" onClick={() => setPanel('handouts')}>Handouts</button>
          <button className="secondary" onClick={() => setPanel('npcs')}>NPCs</button>
          <button className="secondary" onClick={() => setPanel('log')}>Log</button>
        </div>
      </section>

      {setup && (
        <FightSetup
          game={game}
          session={session}
          onCancel={() => setSetup(false)}
          onGo={async (npcs, characterIds) => {
            const ok = session.combat
              ? await send((s, done) => s.emit('combat:add', { npcs, characterIds }, done))
              : await send((s, done) => s.emit('combat:start', { npcs }, done));
            if (ok) setSetup(false);
          }}
        />
      )}
      {panel && (
        <CampaignConfig
          game={game}
          campaign={session.campaign}
          session={session}
          initialTab={panel}
          backLabel="Back to the table"
          onBack={() => setPanel(null)}
        />
      )}
    </>
  );
}

/** Who is in the fight: all players, plus the NPCs the DM ticks (several copies possible). */
function FightSetup(props: {
  game: Game;
  session: SessionState;
  onCancel: () => void;
  onGo: (npcs: NpcPick[], characterIds: string[]) => void;
}) {
  const { session } = props;
  const { prep, error } = usePrep(props.game, session.campaign.id);
  const adding = session.combat !== null;
  /** npcId -> how many. Starts empty: the DM ticks who shows up. */
  const [counts, setCounts] = useState<Record<string, number>>({});
  const inFight = new Set(session.combat?.combatants.filter((c) => c.kind === 'player').map((c) => c.ref));
  const missing = session.players.filter((p) => !inFight.has(p.characterId));
  const picks = Object.entries(counts).flatMap(([npcId, count]) => (count > 0 ? [{ npcId, count }] : []));
  const total = picks.reduce((n, p) => n + p.count, 0);
  const bump = (n: Npc, by: number) => setCounts((c) => ({ ...c, [n.id]: Math.max(0, Math.min(20, (c[n.id] ?? 0) + by)) }));
  const sorted = [...(prep?.npcs ?? [])].sort((a, b) => Number(a.role === 'npc') - Number(b.role === 'npc'));

  return (
    <div className="info-backdrop" onClick={props.onCancel}>
      <div className="info-sheet fight-setup" role="dialog" aria-modal aria-label="Start a fight" onClick={(e) => e.stopPropagation()}>
        <h2 className="info-title">{adding ? 'Add to the fight' : 'Who is fighting?'}</h2>
        <p className="muted small mb">
          {adding
            ? missing.length > 0
              ? `${missing.map((p) => p.character.name).join(', ')} joined late and will be added too.`
              : 'Pick who joins the fight.'
            : session.players.length > 0
              ? `All ${session.players.length === 1 ? 'players are' : `${session.players.length} players are`} in. Pick the opponents.`
              : 'Pick the opponents.'}
        </p>
        {error && <p className="error">{error}</p>}
        {prep === null ? (
          <p className="muted">Loading…</p>
        ) : sorted.length === 0 ? (
          <p className="notice">No NPCs or opponents planned yet. You can start anyway and add them later under NPCs.</p>
        ) : (
          <ul className="list">
            {sorted.map((n) => {
              const count = counts[n.id] ?? 0;
              return (
                <li key={n.id} className={`prep-row pick-row ${count > 0 ? 'picked' : ''}`}>
                  <button className="prep-main" onClick={() => bump(n, count > 0 ? -count : 1)} aria-pressed={count > 0}>
                    <span className="grow">
                      <strong>{n.name}</strong> {n.role === 'npc' && <span className="role-tag npc">NPC</span>}
                      <span className="muted small block">{npcSummary(n)}</span>
                    </span>
                  </button>
                  <span className="stepper">
                    <button aria-label={`One ${n.name} less`} disabled={count === 0} onClick={() => bump(n, -1)}>−</button>
                    <span className="qty" aria-label="How many">{count}</span>
                    <button aria-label={`One ${n.name} more`} onClick={() => bump(n, 1)}>+</button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <button
          className="primary wide fight-button"
          disabled={adding && total === 0 && missing.length === 0}
          onClick={() => props.onGo(picks, missing.map((p) => p.characterId))}
        >
          {adding ? 'Add to the fight' : `⚔ Start the fight${total > 0 ? ` (${total} ${total === 1 ? 'opponent' : 'opponents'})` : ''}`}
        </button>
        {!adding && <p className="muted small center mt">Everyone's phone pulses red and buzzes.</p>}
        <button className="ghost" onClick={props.onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function CombatTracker(props: {
  combat: Combat;
  act: (action: CombatAction) => Promise<boolean>;
  onAdd: () => void;
  onEnd: () => void;
}) {
  const { combat, act } = props;
  const [openId, setOpenId] = useState<string | null>(null);
  const unrolled = combat.combatants.filter((c) => c.initiative === null);
  const noneRolled = unrolled.length === combat.combatants.length;

  return (
    <div className="tracker">
      <h2 className="card-title">
        Fight <span className="muted small">{combat.activeId ? `Round ${combat.round}` : 'Initiative'}</span>
      </h2>
      <div className="tool-row">
        <button
          className={noneRolled ? 'primary' : 'secondary'}
          onClick={() => {
            if (noneRolled || window.confirm('Roll again for everyone? This replaces all initiative values.')) void act({ type: 'roll' });
          }}
        >
          🎲 Roll for everyone
        </button>
        {!noneRolled && unrolled.length > 0 && (
          <button className="primary" onClick={() => void act({ type: 'roll', ids: unrolled.map((c) => c.id) })}>
            🎲 Roll the missing {unrolled.length}
          </button>
        )}
      </div>
      <p className="muted small">Or type each initiative in. Tap a name for more.</p>
      {combat.combatants.length === 0 && <p className="muted mt">Nobody is in this fight yet.</p>}
      <ol className="turn-list">
        {combat.combatants.map((c) => (
          <CombatRow key={c.id} c={c} active={c.id === combat.activeId} open={openId === c.id} onToggle={() => setOpenId(openId === c.id ? null : c.id)} act={act} />
        ))}
      </ol>
      <div className="tool-row">
        {combat.activeId && <button className="secondary narrow" aria-label="Previous turn" onClick={() => void act({ type: 'prev' })}>‹</button>}
        <button className="primary grow" disabled={combat.combatants.length === 0} onClick={() => void act({ type: 'next' })}>
          {combat.activeId ? 'Next turn ›' : 'Start first turn ›'}
        </button>
      </div>
      <div className="tool-row">
        <button className="secondary" onClick={props.onAdd}>+ Add</button>
        <button className="secondary danger-text" onClick={props.onEnd}>End fight</button>
      </div>
    </div>
  );
}

function CombatRow(props: { c: Combatant; active: boolean; open: boolean; onToggle: () => void; act: (a: CombatAction) => Promise<boolean> }) {
  const { c, act } = props;
  const [amount, setAmount] = useState<number | null>(null);
  const hit = (sign: 1 | -1) => {
    if (!amount) return;
    void act({ type: 'hp', id: c.id, delta: sign * amount });
    setAmount(null);
  };
  const down = c.hp?.current === 0;
  return (
    <li className={`turn-row dm ${props.active ? 'active' : ''} ${c.kind} ${down ? 'down' : ''}`}>
      <div className="turn-main">
        <NumberField
          className="turn-init-input"
          aria-label={`Initiative of ${c.name}`}
          placeholder="–"
          value={c.initiative}
          min={-50}
          max={99}
          commitOnBlur
          onChange={(value) => void act({ type: 'set', id: c.id, value })}
          onClear={() => void act({ type: 'set', id: c.id, value: null })}
        />
        <button className="turn-name grow" aria-expanded={props.open} onClick={props.onToggle}>
          <strong>{c.name}</strong>
          <span className="muted small block">
            {c.d20 !== null ? `🎲 ${c.d20} ${formatModifier(c.bonus)}` : `${formatModifier(c.bonus)} initiative${c.initiative !== null ? ' · entered by hand' : ''}`}
            {c.armorClass !== undefined && ` · AC ${c.armorClass}`}
          </span>
        </button>
        {c.hp && <span className={`hp-text ${down ? 'muted' : ''}`}>{down ? 'Down' : `${c.hp.current}/${c.hp.max}`}</span>}
        {props.active && <span className="badge">Turn</span>}
      </div>
      {props.open && (
        <div className="turn-more">
          {c.hp && (
            <div className="amount-row">
              <NumberField aria-label="Amount" placeholder="Amount" value={amount} min={1} max={9999} onChange={setAmount} onClear={() => setAmount(null)} />
              <button className="damage" disabled={!amount} onClick={() => hit(-1)}>Damage</button>
              <button className="heal" disabled={!amount} onClick={() => hit(1)}>Heal</button>
            </div>
          )}
          <div className="tool-row">
            <button className="secondary" onClick={() => void act({ type: 'roll', ids: [c.id] })}>🎲 Roll again</button>
            <button
              className="secondary danger-text"
              onClick={() => {
                if (window.confirm(`Take ${c.name} out of the fight?`)) void act({ type: 'remove', id: c.id });
              }}
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
