/**
 * The optional dice roller (Settings → Dice roller). A tap on a skill, save or
 * attack opens `RollSheet`: pick Normal, Advantage or Disadvantage, the server
 * throws the dice and the DM gets the result (`RollToasts` on the DM's screen,
 * and the last roll on the player's party card).
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  planFormula,
  planRoll,
  rollBreakdown,
  weaponAttacks,
  type CharacterData,
  type Content,
  type DiceRoll,
  type RollMode,
  type RollPlan,
  type RollRequest,
} from '@dnd/shared';

type Roll = (req: RollRequest, mode: RollMode) => Promise<DiceRoll | null>;

const isAttack = (r: { kind: RollRequest['kind'] }) => r.kind === 'attack' || r.kind === 'spellAttack';

/** What a natural 20 or 1 means for this roll, if anything. */
function naturalText(r: DiceRoll): string | null {
  if (r.natural === null) return null;
  if (isAttack(r)) return r.natural === 20 ? 'Natural 20: a critical hit!' : 'Natural 1: a miss.';
  return `Natural ${r.natural}.`;
}

function tryPlan(c: CharacterData, req: RollRequest, content: Content | null): RollPlan | null {
  if (!content) return null;
  try {
    return planRoll(c, req, content);
  } catch {
    return null;
  }
}

export function RollSheet({
  character: c,
  content,
  request,
  roll,
  shared,
  onClose,
}: {
  character: CharacterData;
  content: Content | null;
  request: RollRequest;
  roll: Roll;
  /** In a session: tell the player that the DM sees the roll. */
  shared: boolean;
  onClose: () => void;
}) {
  const plan = tryPlan(c, request, content);
  /** Everything rolled in this sheet, newest last: an attack, then its damage. */
  const [results, setResults] = useState<DiceRoll[]>([]);
  const [busy, setBusy] = useState(false);
  const latest = results.at(-1);
  const attack = results.find((r) => r.kind === 'attack');
  const weapon = request.kind === 'attack' && content ? weaponAttacks(c, content).find((a) => a.itemId === request.itemId) : undefined;

  const run = async (req: RollRequest, mode: RollMode) => {
    setBusy(true);
    const result = await roll(req, mode);
    setBusy(false);
    if (result) setResults((list) => [...list, result]);
    else onClose(); // the reason is shown as the app's error message
  };

  const damageButtons = () => {
    if (request.kind !== 'attack' || !attack || attack.natural === 1 || latest?.kind === 'damage') return null;
    const crit = attack.natural === 20;
    const option = (twoHanded: boolean) => {
      const req: RollRequest = { kind: 'damage', itemId: request.itemId, crit, twoHanded };
      const p = tryPlan(c, req, content);
      if (!p) return null;
      return (
        <button key={String(twoHanded)} type="button" className="secondary" disabled={busy} onClick={() => void run(req, 'normal')}>
          {twoHanded ? 'Two-handed' : crit ? 'Roll critical damage' : 'Roll damage'} <span className="small">{planFormula(p)}</span>
        </button>
      );
    };
    return <div className="roll-next">{option(false)}{weapon?.versatileDice && option(true)}</div>;
  };

  return createPortal(
    <div className="info-backdrop" onClick={onClose}>
      <div className="info-sheet roll-sheet" role="dialog" aria-label={plan?.label ?? 'Roll'} onClick={(e) => e.stopPropagation()}>
        <h3 className="info-title">{latest?.label ?? plan?.label ?? 'Roll'}</h3>
        {!latest && plan && (
          <>
            <p className="roll-formula">{planFormula(plan)}</p>
            {plan.parts.length > 0 && (
              <p className="muted small roll-parts">
                {plan.parts.map((p) => `${p.label} ${p.value > 0 ? '+' : '-'}${Math.abs(p.value)}`).join(' · ')}
              </p>
            )}
            <div className="roll-modes" role="group" aria-label="How to roll">
              <button type="button" className="secondary" disabled={busy} onClick={() => void run(request, 'disadvantage')}>Disadvantage</button>
              <button type="button" className="primary" disabled={busy} onClick={() => void run(request, 'normal')}>Roll</button>
              <button type="button" className="secondary" disabled={busy} onClick={() => void run(request, 'advantage')}>Advantage</button>
            </div>
            <p className="muted small hint roll-note">Advantage and Disadvantage roll two d20 and keep the higher or the lower one.</p>
          </>
        )}
        {!latest && !plan && <p className="muted">Loading…</p>}
        {latest && (
          <div className="roll-result" role="status" aria-live="polite">
            {latest.kind === 'damage' && attack && (
              <p className="muted small roll-earlier">{attack.label}: {attack.total}{attack.natural === 20 ? ', critical hit' : ''}</p>
            )}
            <p key={latest.id} className={`roll-total ${latest.natural === 20 ? 'high' : latest.natural === 1 ? 'low' : ''}`}>
              {latest.total}
              {latest.note && <span className="roll-unit"> {latest.note.toLowerCase()}</span>}
            </p>
            <p className="roll-breakdown">
              {rollBreakdown(latest)}
              {latest.mode !== 'normal' && <span className="muted"> · {latest.mode}</span>}
            </p>
            {naturalText(latest) && <p className={`roll-natural ${latest.natural === 20 ? 'high' : 'low'}`}>{naturalText(latest)}</p>}
            {damageButtons()}
            {shared && <p className="muted small roll-note">Your DM sees this roll.</p>}
          </div>
        )}
        <button className="secondary info-close" onClick={onClose}>Close</button>
      </div>
    </div>,
    document.body,
  );
}

const TOAST_MS = 8000;

/** DM: each roll a player makes pops up at the top of the screen for a few seconds. */
export function RollToasts({ rolls }: { rolls: DiceRoll[] }) {
  const [shown, setShown] = useState<DiceRoll[]>([]);
  /** Rolls that were already there when the screen opened are old news. */
  const seen = useRef(new Set(rolls.map((r) => r.id)));
  useEffect(() => {
    const fresh = rolls.filter((r) => !seen.current.has(r.id));
    if (fresh.length === 0) return;
    for (const r of fresh) {
      seen.current.add(r.id);
      setTimeout(() => setShown((list) => list.filter((x) => x.id !== r.id)), TOAST_MS);
    }
    setShown((list) => [...list, ...fresh].slice(-3));
  }, [rolls]);
  if (shown.length === 0) return null;
  return (
    <div className="roll-toasts" role="log" aria-live="polite" aria-label="Dice rolls">
      {shown.map((r) => (
        <button
          key={r.id}
          type="button"
          className={`roll-toast ${r.natural === 20 ? 'high' : r.natural === 1 ? 'low' : ''}`}
          onClick={() => setShown((list) => list.filter((x) => x.id !== r.id))}
        >
          <span className="roll-toast-total">{r.total}</span>
          <span className="grow">
            <strong>{r.who}</strong> · {r.label}
            <span className="muted small block">
              {rollBreakdown(r)}
              {r.note && ` ${r.note.toLowerCase()}`}
              {r.mode !== 'normal' && ` · ${r.mode}`}
              {r.natural !== null && ` · ${isAttack(r) ? (r.natural === 20 ? 'critical hit' : 'natural 1') : `natural ${r.natural}`}`}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
