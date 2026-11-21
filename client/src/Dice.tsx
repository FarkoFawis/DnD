/**
 * The optional dice roller (Settings → Dice roller). A tap on a skill, save or
 * attack opens `RollSheet`: pick Normal, Advantage or Disadvantage, the server
 * throws the dice and the DM gets the result (`RollToasts` on the DM's screen,
 * and the last roll on the player's party card).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
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
  naturalText,
} from '@dnd/shared';
import { BottomSheet } from './BottomSheet.tsx';
import { burst, move } from './fx/fx.ts';
import { motionOn } from './settings.ts';
import { t, tx } from './i18n.tsx';

type Roll = (req: RollRequest, mode: RollMode) => Promise<DiceRoll | null>;

const isAttack = (r: { kind: RollRequest['kind'] }) => r.kind === 'attack' || r.kind === 'spellAttack';

/** What a natural 20 or 1 means for this roll, if anything. */
function naturalLine(r: DiceRoll): string | null {
  if (r.natural === null) return null;
  if (isAttack(r)) return r.natural === 20 ? t('Natural 20: a critical hit!') : t('Natural 1: a miss.');
  return t('Natural {n}.', { n: r.natural });
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
          {twoHanded ? t('Two-handed') : crit ? t('Roll critical damage') : t('Roll damage')} <span className="small">{planFormula(p)}</span>
        </button>
      );
    };
    return <div className="roll-next">{option(false)}{weapon?.versatileDice && option(true)}</div>;
  };

  return (
    <BottomSheet label={plan?.label ?? t('Roll')} className="roll-sheet" onClose={onClose}>
      {(close) => (
        <>
        <h3 className="info-title">{latest ? tx(latest.label) : (plan?.label ?? t('Roll'))}</h3>
        {!latest && plan && (
          <>
            <p className="roll-formula">{planFormula(plan)}</p>
            {plan.parts.length > 0 && (
              <p className="muted small roll-parts">
                {plan.parts.map((p) => `${p.label} ${p.value > 0 ? '+' : '-'}${Math.abs(p.value)}`).join(' · ')}
              </p>
            )}
            <div className="roll-modes" role="group" aria-label={t('How to roll')}>
              <button type="button" className="secondary" disabled={busy} onClick={() => void run(request, 'disadvantage')}>{t('Disadvantage')}</button>
              <button type="button" className="primary" disabled={busy} onClick={() => void run(request, 'normal')}>{t('Roll')}</button>
              <button type="button" className="secondary" disabled={busy} onClick={() => void run(request, 'advantage')}>{t('Advantage')}</button>
            </div>
            <p className="muted small hint roll-note">{t('Advantage and Disadvantage roll two d20 and keep the higher or the lower one.')}</p>
          </>
        )}
        {!latest && !plan && <p className="muted">{t('Loading…')}</p>}
        {latest && (
          <div className="roll-result" role="status" aria-live="polite">
            {latest.kind === 'damage' && attack && (
              <p className="muted small roll-earlier">{tx(attack.label)}: {attack.total}{attack.natural === 20 ? `, ${t('critical hit')}` : ''}</p>
            )}
            <RollTotal key={latest.id} roll={latest} />
            <p className="roll-breakdown">
              {rollBreakdown(latest)}
              {latest.mode !== 'normal' && <span className="muted"> · {t(latest.mode)}</span>}
            </p>
            {naturalLine(latest) && <p className={`roll-natural ${latest.natural === 20 ? 'high' : 'low'}`}>{naturalLine(latest)}</p>}
            {damageButtons()}
            {shared && <p className="muted small roll-note">{t('Your DM sees this roll.')}</p>}
          </div>
        )}
        <button className="secondary info-close" onClick={close}>{t('Close')}</button>
        </>
      )}
    </BottomSheet>
  );
}

/** How long the number tumbles before it lands. */
const TUMBLE_MS = 520;

/**
 * The big number of a roll. It tumbles through other numbers for half a
 * second, with a die spinning behind it, and then lands on the result the
 * server rolled: a natural 20 bursts into rays, a natural 1 shudders.
 */
function RollTotal({ roll }: { roll: DiceRoll }) {
  const [tumbling, setTumbling] = useState(motionOn);
  const [fake, setFake] = useState(roll.total);
  const el = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (!tumbling) return;
    // Only for show: any number the dice could plausibly land on.
    const top = roll.kind === 'damage' ? Math.max(4, roll.total * 2) : Math.max(20, roll.total + 4);
    const spin = setInterval(() => setFake(1 + Math.floor(Math.random() * top)), 60);
    const land = setTimeout(() => {
      setTumbling(false);
      if (roll.natural === 20) burst('crit', el.current);
      if (roll.natural === 1) move(el.current, 'shake');
    }, TUMBLE_MS);
    return () => {
      clearInterval(spin);
      clearTimeout(land);
    };
    // Each roll gets a RollTotal of its own (keyed by its id), so this runs once.
  }, []);
  const mood = roll.natural === 20 ? 'high' : roll.natural === 1 ? 'low' : '';
  return (
    <p ref={el} className={`roll-total ${tumbling ? 'tumbling' : `landed ${mood}`}`} aria-hidden={tumbling || undefined}>
      <svg className="roll-die" viewBox="0 0 200 220" aria-hidden>
        <path d="M100 10 182 58v104l-82 48-82-48V58zM100 10 60 82h80zM60 82 18 58M140 82l42-24M60 82l40 76 40-76M100 158v52M60 82 18 162M140 82l42 80M100 158l-82 4M100 158l82 4" />
      </svg>
      <span className="roll-number">{tumbling ? fake : roll.total}</span>
      {roll.note && !tumbling && <span className="roll-unit"> {tx(roll.note.toLowerCase())}</span>}
    </p>
  );
}

const TOAST_MS = 8000;

/** DM: each roll a player makes pops up at the top of the screen for a few seconds. */
export function RollToasts({ rolls }: { rolls: DiceRoll[] }) {
  const [shown, setShown] = useState<DiceRoll[]>([]);
  /** Toasts on their way out: they slide away first, then they are taken off the page. */
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  /** Rolls that were already there when the screen opened are old news. */
  const seen = useRef(new Set(rolls.map((r) => r.id)));
  const dismiss = useCallback((id: string) => {
    const remove = () => {
      setShown((list) => list.filter((x) => x.id !== id));
      setLeaving((set) => new Set([...set].filter((x) => x !== id)));
    };
    if (!motionOn()) return remove();
    setLeaving((set) => new Set(set).add(id));
    setTimeout(remove, 220);
  }, []);
  useEffect(() => {
    const fresh = rolls.filter((r) => !seen.current.has(r.id));
    if (fresh.length === 0) return;
    for (const r of fresh) {
      seen.current.add(r.id);
      setTimeout(() => dismiss(r.id), TOAST_MS);
    }
    setShown((list) => [...list, ...fresh].slice(-3));
  }, [rolls, dismiss]);
  if (shown.length === 0) return null;
  return (
    <div className="roll-toasts" role="log" aria-live="polite" aria-label={t('Dice rolls')}>
      {shown.map((r) => (
        <button
          key={r.id}
          type="button"
          className={`roll-toast ${r.natural === 20 ? 'high' : r.natural === 1 ? 'low' : ''} ${leaving.has(r.id) ? 'leaving' : ''}`}
          onClick={() => dismiss(r.id)}
        >
          <span className="roll-toast-total">{r.total}</span>
          <span className="grow">
            <strong>{r.who}</strong> · {tx(r.label)}
            <span className="muted small block">
              {rollBreakdown(r)}
              {r.note && ` ${tx(r.note.toLowerCase())}`}
              {r.mode !== 'normal' && ` · ${t(r.mode)}`}
              {r.natural !== null && ` · ${naturalText(r)}`}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
