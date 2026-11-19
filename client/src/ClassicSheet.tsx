/**
 * What a player sees during a session: their sheet laid out like the classic
 * paper character sheet (abilities down the left with saves and skills, the
 * combat block, attacks & spellcasting, equipment with coins, features),
 * adapted to a phone. Read-only, except HP and items when the DM unlocked them.
 * Tap anything with a description (spell, item, feature, attack) to read it.
 */
import { useEffect, useState, type ReactNode } from 'react';
import {
  ABILITIES,
  ABILITY_NAMES,
  COINS,
  SKILLS,
  SKILL_KEYS,
  deriveStats,
  formatModifier,
  limitedUses,
  weaponAttacks,
  type CharacterData,
} from '@dnd/shared';
import { Info } from './Info.tsx';
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
}: {
  character: CharacterData;
  actions: SheetActions;
  playerName: string;
  /** The character's picture, shown next to the name. */
  portrait?: ReactNode;
}) {
  const content = useContent();
  const stats = deriveStats(c);
  const cls = content?.classes.find((x) => x.name.toLowerCase() === c.className.trim().toLowerCase());
  const attacks = content ? weaponAttacks(c, content) : [];
  const unlocked = c.hpItemsUnlocked;
  const spellsByLevel = [...c.spells].sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  const levels = [...new Set(spellsByLevel.map((s) => s.level))];
  const hasUses = limitedUses(c).length > 0;

  // Short confirmation after something is used ("Magic Missile · 1st-level slot").
  const [flash, setFlash] = useState<string | null>(null);
  const lastAt = c.lastAction?.at;
  const [seenAt, setSeenAt] = useState(lastAt);
  useEffect(() => {
    if (lastAt === seenAt) return;
    setSeenAt(lastAt);
    setFlash(actionText(c.lastAction));
    const t = setTimeout(() => setFlash(null), 2500);
    return () => clearTimeout(t);
  }, [lastAt, seenAt, c.lastAction]);

  return (
    <article className="classic" aria-label={`${c.name}'s character sheet`}>
      {flash && <p className="use-flash" role="status">Used: {flash}</p>}
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
            <span className="cs-label">Hit points</span>
            <span className="cs-hp-line">
              <span className={`cs-hp-now ${c.hpCurrent === 0 ? 'down' : c.hpCurrent <= c.hpMax / 4 ? 'low' : ''}`}>{c.hpCurrent}</span>
              {c.hpTemp > 0 && <span className="cs-hp-temp" aria-label={`plus ${c.hpTemp} temporary hit points`}>+{c.hpTemp}</span>}
              <span className="cs-hp-max">/ {c.hpMax}</span>
            </span>
            <span className="hpbar" aria-hidden>
              <span style={{ width: `${Math.max(0, Math.min(100, (c.hpCurrent / c.hpMax) * 100))}%` }} className={c.hpCurrent <= c.hpMax / 4 ? 'low' : ''} />
            </span>
          </div>
        )}
      </section>

      <DeathSaves character={c} onRoll={(r) => void actions.deathSave(r)} />
      <ConcentrationBanner character={c} content={content} onAction={(a) => void actions.concentration(a)} />
      <ConditionBadges character={c} content={content} />

      <div className="cs-cols">
        <div className="cs-abilities">
          {ABILITIES.map((a) => (
            <div key={a} className="cs-ability">
              <span className="cs-label">{ABILITY_NAMES[a]}</span>
              <span className="cs-ability-mod">{formatModifier(stats.modifiers[a])}</span>
              <span className="cs-ability-score">{c.abilities[a]}</span>
            </div>
          ))}
        </div>
        <div className="cs-right">
          <div className="cs-pill"><span className="cs-pill-value">{formatModifier(stats.proficiencyBonus)}</span><span className="cs-label">Proficiency bonus</span></div>
          <Box label="Saving throws">
            <ul className="cs-checks">
              {ABILITIES.map((a) => (
                <Check key={a} level={c.saveProficiencies.includes(a) ? 1 : 0} bonus={stats.saves[a]} name={ABILITY_NAMES[a]} />
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
          <div className="cs-stat"><span className="cs-big">{formatModifier(stats.initiative)}</span><span className="cs-label">Initiative</span></div>
          <div className="cs-stat"><span className="cs-big">{Math.max(0, c.speed - 5 * c.exhaustion)}<small> ft</small></span><span className="cs-label">Speed{c.exhaustion > 0 ? ' (exhausted)' : ''}</span></div>
        </div>
        {cls && (
          <div className="cs-stat hitdice"><span className="cs-mid">{c.level}d{cls.hitDie}</span><span className="cs-label">Hit dice</span></div>
        )}
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
                      <button type="button" className="use-button" onClick={() => void actions.use({ kind: 'attack', name: a.name })}>Attack</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {stats.spellSaveDc !== null && (
          <p className="cs-spellline">
            Spell save DC <strong>{stats.spellSaveDc}</strong> · Spell attack <strong>{formatModifier(stats.spellAttack!)}</strong> · {ABILITY_NAMES[c.spellcastingAbility!]}
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
        {(attacks.length > 0 || c.spells.length > 0) && <p className="cs-hint">Tap a name to read what it does.</p>}
      </Box>

      <Box label="Equipment">
        {unlocked ? (
          <Items character={c} actions={actions} onCoins={(coins) => void actions.update({ coins })} readOnly={false} content={content} />
        ) : (
          <div className="cs-equipment">
            <ul className="cs-coins">
              {COINS.map((k) => (
                <li key={k}><span className="cs-coin">{k.toUpperCase()}</span><span>{c.coins[k]}</span></li>
              ))}
            </ul>
            <ul className="cs-items">
              {c.inventory.length === 0 && <li className="muted small">Nothing yet.</li>}
              {c.inventory.map((i) => (
                <li key={i.id}>
                  <Info entry={itemEntry(content, i)} tapToOpen>
                    {i.qty > 1 && <span className="cs-qty">{i.qty}×</span>} {i.name}
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

function Check({ level, bonus, name, hint }: { level: 0 | 1 | 2; bonus: number; name: string; hint?: string }) {
  return (
    <li className="cs-check">
      <span className={`cs-dot lvl${level}`} aria-label={['not proficient', 'proficient', 'expertise'][level]} />
      <span className="cs-bonus">{formatModifier(bonus)}</span>
      <span className="grow">{name}{hint && <span className="cs-hintab"> ({hint})</span>}</span>
    </li>
  );
}
