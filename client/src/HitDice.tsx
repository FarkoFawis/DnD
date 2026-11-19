/**
 * Hit Dice (2024: Hit Point Dice): one per level, spent on a Short Rest to
 * heal the die's roll plus the Constitution modifier, all back after a Long
 * Rest. The player throws a real die and types in what it shows; with the dice
 * roller switched on in Settings the app can throw it instead.
 */
import { useState } from 'react';
import {
  HIT_DICE_ID,
  abilityModifier,
  hitDiceLeft,
  hitDieSize,
  used,
  type CharacterData,
  type Content,
  type HitDieSpent,
} from '@dnd/shared';
import { Pips } from './Uses.tsx';

export function HitDice({
  character: c,
  content,
  onSpend,
  onRestore,
  canRoll,
}: {
  character: CharacterData;
  content: Content | null;
  /** Without it the dice are only shown. Resolves to what the die did, or null when refused. */
  onSpend?: (roll?: number) => Promise<HitDieSpent | null>;
  /** DM (or the owner outside sessions): tap an empty pip to give one back. */
  onRestore?: () => void;
  /** Offer "Roll for me" next to typing in a real die. */
  canRoll?: boolean;
}) {
  const die = hitDieSize(c, content);
  const left = hitDiceLeft(c);
  const mod = abilityModifier(c.abilities.con);
  const [roll, setRoll] = useState('');
  const [last, setLast] = useState<HitDieSpent | null>(null);
  const [busy, setBusy] = useState(false);
  const n = Number(roll);
  const valid = roll !== '' && Number.isInteger(n) && n >= 1 && n <= die;
  const plus = mod === 0 ? '' : mod > 0 ? ` + ${mod}` : ` - ${-mod}`;

  const spend = async (value?: number) => {
    if (!onSpend) return;
    setBusy(true);
    const spent = await onSpend(value);
    setBusy(false);
    if (spent) {
      setLast(spent);
      setRoll('');
    }
  };

  return (
    <div className="hitdice">
      <div className="hitdice-head">
        <span className="grow">
          <strong>Hit Dice</strong> <span className="muted small">d{die} · {left} of {c.level} left</span>
        </span>
        <Pips max={c.level} spent={used(c, HIT_DICE_ID)} onRestore={onRestore} label="Hit Die" />
      </div>
      {onSpend &&
        (left === 0 ? (
          <p className="muted small">None left. They come back after a Long Rest.</p>
        ) : c.hpCurrent >= c.hpMax ? (
          <p className="muted small">At full HP, nothing to heal.</p>
        ) : (
          <>
            <p className="muted small">On a Short Rest each one heals a d{die} roll{plus}{mod !== 0 && ' (Constitution)'}, at least 1 HP.</p>
            <form
              className="hitdice-spend"
              onSubmit={(e) => {
                e.preventDefault();
                if (valid && !busy) void spend(n);
              }}
            >
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={die}
                placeholder={`Your d${die} roll`}
                aria-label={`What your d${die} shows`}
                value={roll}
                onChange={(e) => setRoll(e.target.value)}
              />
              <button type="submit" className="use-button" disabled={!valid || busy}>Heal</button>
              {canRoll && (
                <button type="button" className="use-button" disabled={busy} onClick={() => void spend()}>Roll for me</button>
              )}
            </form>
          </>
        ))}
      {last && (
        <p className="hitdice-result" role="status">
          Rolled {last.roll}{last.modifier === 0 ? '' : last.modifier > 0 ? ` + ${last.modifier}` : ` - ${-last.modifier}`}: <strong>+{last.healed} HP</strong>
        </p>
      )}
    </div>
  );
}
