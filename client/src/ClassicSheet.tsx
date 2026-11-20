/**
 * What a player sees during a session: their sheet laid out like the classic
 * paper character sheet (abilities down the left with saves and skills, the
 * combat block, attacks & spellcasting, equipment with coins, features),
 * adapted to a phone. Read-only, except HP and items when the DM unlocked them.
 * Tap anything with a description (spell, item, feature, attack) to read it.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ABILITIES,
  ABILITY_NAMES,
  COINS,
  SKILLS,
  SKILL_KEYS,
  deriveStats,
  formatModifier,
  hitDiceLeft,
  hitDieSize,
  limitedUses,
  weaponAttacks,
  type CharacterData,
  type RollRequest,
} from '@dnd/shared';
import { RollSheet } from './Dice.tsx';
import { burst } from './fx/fx.ts';
import { useFresh } from './fx/hooks.ts';
import { FlashNum, HpBar, HpFx, Num } from './fx/sheetFx.tsx';
import { HitDice } from './HitDice.tsx';
import { useSettings } from './settings.ts';
import { Info } from './Info.tsx';
import { LevelUp } from './creator/LevelUp.tsx';
import { HpBox, Items, type SheetActions } from './Sheet.tsx';
import { featureEntry, itemEntry, spellEntry, spellGlance } from './SheetContent.tsx';
import { useContent } from './content/useContent.ts';
import { ConcentrationBanner, ConditionBadges, DeathSaves } from './Status.tsx';
import { CastButton, SlotTracker, UsesList, actionText } from './Uses.tsx';

export function ClassicSheet({
  character: c,
  actions,
  playerName,
  portrait,
  inSession = true,
}: {
  character: CharacterData;
  actions: SheetActions;
  playerName: string;
  /** The character's picture, shown next to the name. */
  portrait?: ReactNode;
  /** A DM is watching: rolls of the dice roller are shown to them. */
  inSession?: boolean;
}) {
  const content = useContent();
  /** The dice roller (Settings): abilities, saves, skills and attacks become buttons that roll. */
  const { dice } = useSettings();
  const [rolling, setRolling] = useState<RollRequest | null>(null);
  const roller = dice ? setRolling : undefined;
  const stats = deriveStats(c);
  const attacks = content ? weaponAttacks(c, content) : [];
  const unlocked = c.hpItemsUnlocked;
  const spellsByLevel = [...c.spells].sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  const levels = [...new Set(spellsByLevel.map((s) => s.level))];
  const hasUses = limitedUses(c).length > 0;
  /** The DM said this character levels up: the player runs the wizard here, on their own phone. */
  const [levelling, setLevelling] = useState(false);
  const canLevelUp = c.levelUpReady && c.level < 20;

  // Short confirmation after something is used ("Magic Missile · 1st-level slot")
  // or handed over by the DM ("Received: Potion of Healing").
  const [flash, setFlash] = useState<{ text: string; got?: boolean } | null>(null);
  const flashEl = useRef<HTMLParagraphElement>(null);
  const lastAt = c.lastAction?.at;
  const [seenAt, setSeenAt] = useState(lastAt);
  useEffect(() => {
    if (lastAt === seenAt) return;
    setSeenAt(lastAt);
    // A roll of the dice roller has its own result sheet.
    if (c.lastAction?.roll) return;
    const text = actionText(c.lastAction);
    setFlash(text ? { text: `Used: ${text}` } : null);
    const t = setTimeout(() => setFlash(null), 2500);
    return () => clearTimeout(t);
  }, [lastAt, seenAt, c.lastAction]);
  /** Items that arrived while the sheet was open slide in and are announced. */
  const freshItems = useFresh(c.inventory.map((i) => i.id));
  const newest = c.inventory.findLast((i) => freshItems.has(i.id));
  useEffect(() => {
    if (!newest || unlocked) return;
    setFlash({ text: `Received: ${newest.qty > 1 ? `${newest.qty}× ` : ''}${newest.name}`, got: true });
    const t = setTimeout(() => setFlash(null), 3000);
    return () => clearTimeout(t);
    // Once per item: its id says whether it is a new one.
  }, [newest?.id]);
  useEffect(() => {
    if (flash?.got) burst('item', flashEl.current);
  }, [flash]);

  return (
    <article className="classic" aria-label={`${c.name}'s character sheet`}>
      {flash && <p key={flash.text} ref={flashEl} className={`use-flash ${flash.got ? 'got' : ''}`} role="status">{flash.text}</p>}
      {canLevelUp && (
        <button type="button" className="levelup-banner" onClick={() => setLevelling(true)}>
          <span className="grow">
            <strong>You reached level {c.level + 1}!</strong>
            <span className="small block">Tap to level up {c.name || 'your character'}.</span>
          </span>
          <span aria-hidden>⬆</span>
        </button>
      )}
      {rolling && (
        <RollSheet character={c} content={content} request={rolling} roll={actions.roll} shared={inSession} onClose={() => setRolling(null)} />
      )}
      {levelling && canLevelUp && (
        <LevelUp
          character={c}
          onCancel={() => setLevelling(false)}
          onDone={async (choices) => {
            const ok = await actions.levelUp(choices);
            if (ok) setLevelling(false);
            return ok;
          }}
        />
      )}
      <header className={`cs-banner ${portrait ? 'with-portrait' : ''}`}>
        {portrait && <div className="cs-portrait">{portrait}</div>}
        <div className="cs-name">
          <span className="cs-name-value">{c.name || 'Unnamed'}</span>
          <span className="cs-label">Character name</span>
        </div>
        <dl className="cs-ident">
          <Field label="Class & level" value={`${c.className || '—'} ${c.level}${c.subclass ? ` (${c.subclass})` : ''}`} />
          <Field label="Background" value={c.background || '—'} />
          <Field label="Species" value={`${c.species || '—'}${c.subspecies ? ` (${c.subspecies})` : ''}`} />
          <Field label="Player" value={playerName} />
        </dl>
      </header>

      <section className="cs-hpblock" aria-label="Hit points">
        {unlocked ? (
          <>
            <HpBox character={c} onHp={actions.adjustHp} onTemp={(v) => void actions.update({ hpTemp: v })} />
            <p className="cs-unlocked">Your DM lets you track your own HP and items.</p>
          </>
        ) : (
          <div className="cs-hp">
            <HpFx value={c.hpCurrent} />
            <span className="cs-label">Hit points</span>
            <span className="cs-hp-line">
              <span className={`cs-hp-now ${c.hpCurrent === 0 ? 'down' : c.hpCurrent <= c.hpMax / 4 ? 'low' : ''}`} aria-label={`${c.hpCurrent}`}><Num value={c.hpCurrent} /></span>
              {c.hpTemp > 0 && <span className="cs-hp-temp" aria-label={`plus ${c.hpTemp} temporary hit points`}>+{c.hpTemp}</span>}
              <span className="cs-hp-max">/ {c.hpMax}</span>
            </span>
            <HpBar current={c.hpCurrent} max={c.hpMax} />
          </div>
        )}
      </section>

      {c.resting && (
        <section className="cs-rest" aria-label="Short rest">
          <strong className="cs-rest-title">Short rest</strong>
          <HitDice character={c} content={content} canRoll={dice} onSpend={actions.spendHitDie} />
          <button type="button" className="secondary" onClick={() => void actions.endRest()}>Done resting</button>
        </section>
      )}

      <DeathSaves character={c} onRoll={(r) => void actions.deathSave(r)} />
      <ConcentrationBanner character={c} content={content} onAction={(a) => void actions.concentration(a)} />
      <ConditionBadges character={c} content={content} />

      {roller && <p className="cs-hint hint">Dice roller: tap an ability, a save, a skill, Initiative or an attack to roll it.</p>}
      <div className="cs-cols">
        <div className="cs-abilities">
          {ABILITIES.map((a) => {
            const body = (
              <>
                <span className="cs-label">{ABILITY_NAMES[a]}</span>
                <span className="cs-ability-mod">{formatModifier(stats.modifiers[a])}</span>
                <span className="cs-ability-score">{c.abilities[a]}</span>
              </>
            );
            return roller ? (
              <button key={a} type="button" className="cs-ability rollable" aria-label={`Roll a ${ABILITY_NAMES[a]} check`} onClick={() => roller({ kind: 'ability', ability: a })}>{body}</button>
            ) : (
              <div key={a} className="cs-ability">{body}</div>
            );
          })}
        </div>
        <div className="cs-right">
          <div className="cs-pill"><span className="cs-pill-value">{formatModifier(stats.proficiencyBonus)}</span><span className="cs-label">Proficiency bonus</span></div>
          <Box label="Saving throws">
            <ul className="cs-checks">
              {ABILITIES.map((a) => (
                <Check
                  key={a}
                  level={c.saveProficiencies.includes(a) ? 1 : 0}
                  bonus={stats.saves[a]}
                  name={ABILITY_NAMES[a]}
                  onRoll={roller && (() => roller({ kind: 'save', ability: a }))}
                />
              ))}
            </ul>
          </Box>
          <Box label="Skills">
            <ul className="cs-checks">
              {SKILL_KEYS.map((s) => (
                <Check
                  key={s}
                  level={c.skillExpertise.includes(s) ? 2 : c.skillProficiencies.includes(s) ? 1 : 0}
                  bonus={stats.skills[s]}
                  name={SKILLS[s].name}
                  hint={SKILLS[s].ability.slice(0, 1).toUpperCase() + SKILLS[s].ability.slice(1)}
                  onRoll={roller && (() => roller({ kind: 'skill', skill: s }))}
                />
              ))}
            </ul>
          </Box>
        </div>
      </div>
      <div className="cs-pill wide"><span className="cs-pill-value">{stats.passivePerception}</span><span className="cs-label">Passive Wisdom (Perception)</span></div>

      <section className="cs-combat">
        <div className="cs-trio">
          <div className="cs-shield"><span className="cs-big">{c.armorClass}</span><span className="cs-label">Armor class</span></div>
          {roller ? (
            <button type="button" className="cs-stat rollable" aria-label="Roll Initiative" onClick={() => roller({ kind: 'initiative' })}>
              <span className="cs-big">{formatModifier(stats.initiative)}</span><span className="cs-label">Initiative</span>
            </button>
          ) : (
            <div className="cs-stat"><span className="cs-big">{formatModifier(stats.initiative)}</span><span className="cs-label">Initiative</span></div>
          )}
          <div className="cs-stat"><span className="cs-big">{Math.max(0, c.speed - 5 * c.exhaustion)}<small> ft</small></span><span className="cs-label">Speed{c.exhaustion > 0 ? ' (exhausted)' : ''}</span></div>
        </div>
        <div className="cs-stat hitdice-stat">
          <span className="cs-mid">{hitDiceLeft(c)} / {c.level} <small>d{hitDieSize(c, content)}</small></span>
          <span className="cs-label">Hit dice</span>
        </div>
      </section>

      <Box label="Attacks & spellcasting">
        {attacks.length > 0 && (
          <table className="cs-attacks">
            <thead>
              <tr><th>Name</th><th>Atk</th><th>Damage / type</th><th><span className="sr-only">Use</span></th></tr>
            </thead>
            <tbody>
              {attacks.map((a) => {
                const def = content?.item(a.ref);
                const entry = def ? itemEntry(content, { id: a.itemId, name: a.name, qty: 1, notes: '', ref: a.ref }) : null;
                return (
                  <tr key={a.itemId}>
                    <td><Info entry={entry} tapToOpen>{a.name}</Info>{a.notes && <span className="cs-note">{a.notes}</span>}</td>
                    <td className="num">{formatModifier(a.toHit)}</td>
                    <td>{a.damage}</td>
                    <td className="use-cell">
                      <button
                        type="button"
                        className="use-button"
                        onClick={() => (roller ? roller({ kind: 'attack', itemId: a.itemId }) : void actions.use({ kind: 'attack', name: a.name }))}
                      >
                        {roller ? 'Roll' : 'Attack'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {stats.spellSaveDc !== null && (
          <p className="cs-spellline">
            Spell save DC <strong>{stats.spellSaveDc}</strong> ·{' '}
            {roller ? (
              <button type="button" className="link rollable" onClick={() => roller({ kind: 'spellAttack' })}>
                Spell attack <strong>{formatModifier(stats.spellAttack!)}</strong>
              </button>
            ) : (
              <>Spell attack <strong>{formatModifier(stats.spellAttack!)}</strong></>
            )}{' '}
            · {ABILITY_NAMES[c.spellcastingAbility!]}
          </p>
        )}
        <SlotTracker character={c} />
        {levels.map((lvl) => (
          <div key={lvl} className="cs-spells">
            <span className="cs-sublabel">{lvl === 0 ? 'Cantrips' : `Level ${lvl}`}</span>
            <ul>
              {spellsByLevel.filter((s) => s.level === lvl).map((s) => (
                <li key={s.id} className={`cs-spell ${s.prepared || s.level === 0 ? '' : 'unprepared'}`}>
                  <Info entry={spellEntry(content, s)} tapToOpen className="grow">
                    <span className="block">{s.name}{!s.prepared && s.level > 0 && <span className="muted small"> (not prepared)</span>}</span>
                    {spellGlance(content, s) && <span className="cs-note">{spellGlance(content, s)}</span>}
                  </Info>
                  {(s.prepared || s.level === 0) && <CastButton character={c} spell={s} content={content} onUse={actions.use} />}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {attacks.length === 0 && c.spells.length === 0 && <p className="muted small">No weapons or spells.</p>}
        {(attacks.length > 0 || c.spells.length > 0) && <p className="cs-hint hint">Tap a name to read what it does.</p>}
      </Box>

      <Box label="Equipment">
        {unlocked ? (
          <Items character={c} actions={actions} onCoins={(coins) => void actions.update({ coins })} readOnly={false} content={content} />
        ) : (
          <div className="cs-equipment">
            <ul className="cs-coins">
              {COINS.map((k) => (
                <li key={k}><span className="cs-coin">{k.toUpperCase()}</span><FlashNum value={c.coins[k]} /></li>
              ))}
            </ul>
            <ul className="cs-items">
              {c.inventory.length === 0 && <li className="muted small">Nothing yet.</li>}
              {c.inventory.map((i) => (
                <li key={i.id} className={freshItems.has(i.id) ? 'fresh' : undefined}>
                  <Info entry={itemEntry(content, i)} tapToOpen>
                    {i.qty > 1 && <span className="cs-qty"><FlashNum value={i.qty} />×</span>} {i.name}
                  </Info>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Box>

      {hasUses && (
        <Box label="Limited uses">
          <UsesList character={c} content={content} onUse={actions.use} />
        </Box>
      )}

      <Box label="Features & traits">
        {c.features.length === 0 ? (
          <p className="muted small">None listed.</p>
        ) : (
          <ul className="cs-features">
            {c.features.map((f) => (
              <li key={f.id}>
                <Info entry={featureEntry(content, f)} tapToOpen>
                  <strong>{f.name}</strong> <span className="cs-note inline">{f.source}</span>
                </Info>
              </li>
            ))}
          </ul>
        )}
      </Box>

      <Box label="Other proficiencies & languages">
        {c.notes ? <p className="cs-notes">{c.notes}</p> : <p className="muted small">—</p>}
      </Box>
    </article>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="cs-field">
      <dd>{value}</dd>
      <dt className="cs-label">{label}</dt>
    </div>
  );
}

function Box({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="cs-box">
      <div className="cs-box-body">{children}</div>
      <h3 className="cs-label cs-box-label">{label}</h3>
    </section>
  );
}

function Check({ level, bonus, name, hint, onRoll }: { level: 0 | 1 | 2; bonus: number; name: string; hint?: string; onRoll?: () => void }) {
  const body = (
    <>
      <span className={`cs-dot lvl${level}`} aria-label={['not proficient', 'proficient', 'expertise'][level]} />
      <span className="cs-bonus">{formatModifier(bonus)}</span>
      <span className="grow">{name}{hint && <span className="cs-hintab"> ({hint})</span>}</span>
    </>
  );
  return onRoll ? (
    <li><button type="button" className="cs-check rollable" onClick={onRoll}>{body}</button></li>
  ) : (
    <li className="cs-check">{body}</li>
  );
}
