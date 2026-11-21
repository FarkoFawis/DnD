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
  abilityShort,
} from '@dnd/shared';
import { RollSheet } from './Dice.tsx';
import { burst } from './fx/fx.ts';
import { useFresh } from './fx/hooks.ts';
import { FlashNum, HpBar, HpFx, Num } from './fx/sheetFx.tsx';
import { HitDice } from './HitDice.tsx';
import { InspirationToken } from './Inspiration.tsx';
import { useSettings } from './settings.ts';
import { Info } from './Info.tsx';
import { LevelUp } from './creator/LevelUp.tsx';
import { HpBox, Items, type SheetActions } from './Sheet.tsx';
import { featureEntry, itemEntry, spellEntry, spellGlance } from './SheetContent.tsx';
import { useContent } from './content/useContent.ts';
import { ConcentrationBanner, ConditionBadges, DeathSaves } from './Status.tsx';
import { CastButton, SlotTracker, UsesList, actionText } from './Uses.tsx';
import { t, tj, tx } from './i18n.tsx';

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
  const seenAt = useRef(lastAt);
  useEffect(() => {
    if (lastAt === seenAt.current) return;
    seenAt.current = lastAt;
    // A roll of the dice roller has its own result sheet.
    if (c.lastAction?.roll) return;
    const text = actionText(c.lastAction);
    setFlash(text ? { text: t('Used: {what}', { what: text }) } : null);
    const timer = setTimeout(() => setFlash(null), 2500);
    return () => clearTimeout(timer);
    // Only a new action (its time) starts this: the object is a new one with every update from the
    // server, and running again would cancel the timer that takes the line away.
  }, [lastAt]);
  /** Items that arrived while the sheet was open slide in and are announced. */
  const freshItems = useFresh(c.inventory.map((i) => i.id));
  const newest = c.inventory.findLast((i) => freshItems.has(i.id));
  useEffect(() => {
    if (!newest || unlocked) return;
    setFlash({ text: t('Received: {what}', { what: `${newest.qty > 1 ? `${newest.qty}× ` : ''}${newest.name}` }), got: true });
    const timer = setTimeout(() => setFlash(null), 3000);
    return () => clearTimeout(timer);
    // Once per item: its id says whether it is a new one.
  }, [newest?.id]);
  useEffect(() => {
    if (flash?.got) burst('item', flashEl.current);
  }, [flash]);

  return (
    <article className="classic" aria-label={t("{name}'s character sheet", { name: c.name })}>
      {flash && <p key={flash.text} ref={flashEl} className={`use-flash ${flash.got ? 'got' : ''}`} role="status">{flash.text}</p>}
      {canLevelUp && (
        <button type="button" className="levelup-banner" onClick={() => setLevelling(true)}>
          <span className="grow">
            <strong>{t('You reached level {n}!', { n: c.level + 1 })}</strong>
            <span className="small block">{t('Tap to level up {name}.', { name: c.name || t('your character') })}</span>
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
          <span className="cs-name-value">{c.name || t('Unnamed')}</span>
          <span className="cs-label">{t('Character name')}</span>
        </div>
        <dl className="cs-ident">
          <Field label={t('Class & level')} value={`${tx(c.className) || '—'} ${c.level}${c.subclass ? ` (${tx(c.subclass)})` : ''}`} />
          <Field label={t('Background')} value={tx(c.background) || '—'} />
          <Field label={t('Species')} value={`${tx(c.species) || '—'}${c.subspecies ? ` (${tx(c.subspecies)})` : ''}`} />
          <Field label={t('Player')} value={playerName} />
        </dl>
      </header>

      <section className="cs-hpblock" aria-label={t('Hit points')}>
        {unlocked ? (
          <>
            <HpBox character={c} onHp={actions.adjustHp} onTemp={(v) => void actions.update({ hpTemp: v })} />
            <p className="cs-unlocked">{t('Your DM lets you track your own HP and items.')}</p>
          </>
        ) : (
          <div className="cs-hp">
            <HpFx value={c.hpCurrent} />
            <span className="cs-label">{t('Hit points')}</span>
            <span className="cs-hp-line">
              <span className={`cs-hp-now ${c.hpCurrent === 0 ? 'down' : c.hpCurrent <= c.hpMax / 4 ? 'low' : ''}`} aria-label={`${c.hpCurrent}`}><Num value={c.hpCurrent} /></span>
              {c.hpTemp > 0 && <span className="cs-hp-temp" aria-label={t('plus {n} temporary hit points', { n: c.hpTemp })}>+{c.hpTemp}</span>}
              <span className="cs-hp-max">/ {c.hpMax}</span>
            </span>
            <HpBar current={c.hpCurrent} max={c.hpMax} />
          </div>
        )}
      </section>

      <InspirationToken has={c.inspiration} onSpend={() => actions.inspiration('spend')} />

      {c.resting && (
        <section className="cs-rest" aria-label={t('Short rest')}>
          <strong className="cs-rest-title">{t('Short rest')}</strong>
          <HitDice character={c} content={content} canRoll={dice} onSpend={actions.spendHitDie} />
          <button type="button" className="secondary" onClick={() => void actions.endRest()}>{t('Done resting')}</button>
        </section>
      )}

      <DeathSaves character={c} onRoll={(r) => void actions.deathSave(r)} />
      <ConcentrationBanner character={c} content={content} onAction={(a) => void actions.concentration(a)} />
      <ConditionBadges character={c} content={content} />

      {roller && <p className="cs-hint hint">{t('Dice roller: tap an ability, a save, a skill, Initiative or an attack to roll it.')}</p>}
      <div className="cs-cols">
        <div className="cs-abilities">
          {ABILITIES.map((a) => {
            const body = (
              <>
                <span className="cs-label">{t(ABILITY_NAMES[a])}</span>
                <span className="cs-ability-mod">{formatModifier(stats.modifiers[a])}</span>
                <span className="cs-ability-score">{c.abilities[a]}</span>
              </>
            );
            return roller ? (
              <button key={a} type="button" className="cs-ability rollable" aria-label={t('Roll: {what}', { what: t('{name} check', { name: t(ABILITY_NAMES[a]) }) })} onClick={() => roller({ kind: 'ability', ability: a })}>{body}</button>
            ) : (
              <div key={a} className="cs-ability">{body}</div>
            );
          })}
        </div>
        <div className="cs-right">
          <div className="cs-pill"><span className="cs-pill-value">{formatModifier(stats.proficiencyBonus)}</span><span className="cs-label">{t('Proficiency bonus')}</span></div>
          <Box label={t('Saving throws')}>
            <ul className="cs-checks">
              {ABILITIES.map((a) => (
                <Check
                  key={a}
                  level={c.saveProficiencies.includes(a) ? 1 : 0}
                  bonus={stats.saves[a]}
                  name={t(ABILITY_NAMES[a])}
                  onRoll={roller && (() => roller({ kind: 'save', ability: a }))}
                />
              ))}
            </ul>
          </Box>
          <Box label={t('Skills')}>
            <ul className="cs-checks">
              {SKILL_KEYS.map((s) => (
                <Check
                  key={s}
                  level={c.skillExpertise.includes(s) ? 2 : c.skillProficiencies.includes(s) ? 1 : 0}
                  bonus={stats.skills[s]}
                  name={t(SKILLS[s].name)}
                  hint={abilityShort(SKILLS[s].ability).slice(0, 1) + abilityShort(SKILLS[s].ability).slice(1).toLowerCase()}
                  onRoll={roller && (() => roller({ kind: 'skill', skill: s }))}
                />
              ))}
            </ul>
          </Box>
        </div>
      </div>
      <div className="cs-pill wide"><span className="cs-pill-value">{stats.passivePerception}</span><span className="cs-label">{t('Passive Wisdom (Perception)')}</span></div>

      <section className="cs-combat">
        <div className="cs-trio">
          <div className="cs-shield"><span className="cs-big">{c.armorClass}</span><span className="cs-label">{t('Armor class')}</span></div>
          {roller ? (
            <button type="button" className="cs-stat rollable" aria-label={t('Roll Initiative')} onClick={() => roller({ kind: 'initiative' })}>
              <span className="cs-big">{formatModifier(stats.initiative)}</span><span className="cs-label">{t('Initiative')}</span>
            </button>
          ) : (
            <div className="cs-stat"><span className="cs-big">{formatModifier(stats.initiative)}</span><span className="cs-label">{t('Initiative')}</span></div>
          )}
          <div className="cs-stat"><span className="cs-big">{Math.max(0, c.speed - 5 * c.exhaustion)}<small> ft</small></span><span className="cs-label">{c.exhaustion > 0 ? t('Speed (exhausted)') : t('Speed')}</span></div>
        </div>
        <div className="cs-stat hitdice-stat">
          <span className="cs-mid">{hitDiceLeft(c)} / {c.level} <small>d{hitDieSize(c, content)}</small></span>
          <span className="cs-label">{t('Hit dice')}</span>
        </div>
      </section>

      <Box label={t('Attacks & spellcasting')}>
        {attacks.length > 0 && (
          <table className="cs-attacks">
            <thead>
              <tr><th>{t('Name')}</th><th>{t('Atk')}</th><th>{t('Damage / type')}</th><th><span className="sr-only">{t('Use')}</span></th></tr>
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
                        {roller ? t('Roll') : t('Attack')}
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
            {tj('Spell save DC {strong} ·', { strong: <strong>{stats.spellSaveDc}</strong> })}
            {roller ? (
              <button type="button" className="link rollable" onClick={() => roller({ kind: 'spellAttack' })}>
                {tj('Spell attack {strong}', { strong: <strong>{formatModifier(stats.spellAttack!)}</strong> })}
              </button>
            ) : (
              <>{tj('Spell attack {strong}', { strong: <strong>{formatModifier(stats.spellAttack!)}</strong> })}</>
            )}{' '}
            · {t(ABILITY_NAMES[c.spellcastingAbility!])}
          </p>
        )}
        <SlotTracker character={c} />
        {levels.map((lvl) => (
          <div key={lvl} className="cs-spells">
            <span className="cs-sublabel">{lvl === 0 ? t('Cantrips') : t('Level {n}##spell', { n: lvl })}</span>
            <ul>
              {spellsByLevel.filter((s) => s.level === lvl).map((s) => (
                <li key={s.id} className={`cs-spell ${s.prepared || s.level === 0 ? '' : 'unprepared'}`}>
                  <Info entry={spellEntry(content, s)} tapToOpen className="grow">
                    <span className="block">{s.name}{!s.prepared && s.level > 0 && <span className="muted small">{' '}{t('(not prepared)')}</span>}</span>
                    {spellGlance(content, s) && <span className="cs-note">{spellGlance(content, s)}</span>}
                  </Info>
                  {(s.prepared || s.level === 0) && <CastButton character={c} spell={s} content={content} onUse={actions.use} />}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {attacks.length === 0 && c.spells.length === 0 && <p className="muted small">{t('No weapons or spells.')}</p>}
        {(attacks.length > 0 || c.spells.length > 0) && <p className="cs-hint hint">{t('Tap a name to read what it does.')}</p>}
      </Box>

      <Box label={t('Equipment')}>
        {unlocked ? (
          <Items character={c} actions={actions} onCoins={(coins) => void actions.update({ coins })} readOnly={false} content={content} />
        ) : (
          <div className="cs-equipment">
            <ul className="cs-coins">
              {COINS.map((k) => (
                <li key={k}><span className="cs-coin">{t(k).toUpperCase()}</span><FlashNum value={c.coins[k]} /></li>
              ))}
            </ul>
            <ul className="cs-items">
              {c.inventory.length === 0 && <li className="muted small">{t('Nothing yet.')}</li>}
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
        <Box label={t('Limited uses')}>
          <UsesList character={c} content={content} onUse={actions.use} />
        </Box>
      )}

      <Box label={t('Features & traits')}>
        {c.features.length === 0 ? (
          <p className="muted small">{t('None listed.')}</p>
        ) : (
          <ul className="cs-features">
            {c.features.map((f) => (
              <li key={f.id}>
                <Info entry={featureEntry(content, f)} tapToOpen>
                  <strong>{f.name}</strong> <span className="cs-note inline">{tx(f.source)}</span>
                </Info>
              </li>
            ))}
          </ul>
        )}
      </Box>

      <Box label={t('Other proficiencies & languages')}>
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
      <span className={`cs-dot lvl${level}`} aria-label={[t('not proficient'), t('proficient'), t('expertise')][level]} />
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
