/**
 * Level-up wizard: the same step-by-step flow as character creation, one level
 * at a time. Only the steps this level needs are shown (HP always; subclass,
 * feat and new spells when the level grants them). The rules live in
 * shared/src/levelup.ts and the server applies the result in one go.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  ABILITIES,
  ABILITY_NAMES,
  ASI_FEAT,
  abilityModifier,
  emptyLevelUp,
  featInfo,
  featOptions,
  formatModifier,
  hpGain,
  levelUpPlan,
  levelUpProblems,
  levelUpSpellOptions,
  ordinal,
  scoresAfter,
  subclassInfo,
  type Ability,
  type CharacterData,
  type Content,
  type LevelUpChoices,
  type LevelUpPlan,
  type LevelUpStep,
} from '@dnd/shared';
import { Info } from '../Info.tsx';
import { CUSTOM_VALUE, MultiPicker, Picker } from '../Picker.tsx';
import { useContent } from '../content/useContent.ts';
import { spellPickerOptions } from './CharacterCreator.tsx';
import { msg, plural, t, tj, tx } from '../i18n.tsx';

const TITLES: Record<LevelUpStep, string> = {
  overview: msg('Level up!'),
  hp: msg('Hit points'),
  subclass: msg('Subclass'),
  feat: msg('Feat'),
  spells: msg('New spells'),
  review: msg('Review'),
};
const TAGLINES: Record<LevelUpStep, string> = {
  overview: msg('Here is what the new level brings.'),
  hp: msg('You get tougher with every level.'),
  subclass: msg('Time to choose your path.'),
  feat: msg('Sharpen an ability, or learn something new.'),
  spells: msg('Your magic grows.'),
  review: msg('Check everything, then level up.'),
};

export function LevelUp({
  character: c,
  onDone,
  onCancel,
}: {
  character: CharacterData;
  /** Resolves true when the server accepted the level-up. */
  onDone: (choices: LevelUpChoices) => Promise<boolean>;
  onCancel: () => void;
}) {
  const content = useContent();
  const [choices, setChoices] = useState<LevelUpChoices>(emptyLevelUp);
  const [stepIndex, setStepIndexRaw] = useState(0);
  const [direction, setDirection] = useState<'fwd' | 'back'>('fwd');
  const [busy, setBusy] = useState(false);
  // The plan is for the level the wizard was opened at, even if the sheet updates meanwhile.
  const [from] = useState(c);
  const set = (patch: Partial<LevelUpChoices>) => setChoices((prev) => ({ ...prev, ...patch }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const plan = content ? levelUpPlan(from, content) : null;
  let body: ReactNode;
  if (!content) body = <p className="muted">{t('Loading the rulebook…')}</p>;
  else if (!plan) body = <p className="muted">{t('Level 20 is the highest level.')}</p>;
  else {
    const steps = plan.steps;
    const step = steps[Math.min(stepIndex, steps.length - 1)]!;
    const problems = levelUpProblems(step, from, plan, choices, content);
    const last = step === 'review';
    const setStepIndex = (i: number) => {
      setDirection(i < stepIndex ? 'back' : 'fwd');
      setStepIndexRaw(i);
    };
    const props: StepProps = { c: from, plan, choices, set, content };
    body = (
      <>
        <div className="progress" aria-label={t('Step {n} of {total}', { n: stepIndex + 1, total: steps.length })}>
          {steps.map((s, i) => (
            <button
              key={s}
              type="button"
              className={`progress-seg ${i === stepIndex ? 'now' : i < stepIndex ? 'done' : ''}`}
              aria-label={t('Step {n}: {title}', { n: i + 1, title: t(TITLES[s]) })}
              disabled={i > stepIndex}
              onClick={() => setStepIndex(i)}
            />
          ))}
        </div>
        <div key={step} className={`step-body slide-${direction}`}>
          <p className="step-count">{t('Step {n} of {total}', { n: stepIndex + 1, total: steps.length })}</p>
          <h3 className="step-title">{step === 'overview' ? t('Level {n}!', { n: plan.newLevel }) : t(TITLES[step])}</h3>
          <p className="step-tagline">{t(TAGLINES[step])}</p>
          {step === 'overview' && <Overview {...props} />}
          {step === 'hp' && <HpStep {...props} />}
          {step === 'subclass' && <SubclassStep {...props} />}
          {step === 'feat' && <FeatStep {...props} />}
          {step === 'spells' && <SpellsStep {...props} />}
          {step === 'review' && <Review {...props} />}
        </div>
        {problems.length > 0 && (
          <ul className="todo">
            {problems.map((p) => <li key={p}>{tx(p)}</li>)}
          </ul>
        )}
        <div className="creator-nav">
          {last ? (
            <button
              type="button"
              className="primary next-button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onDone(choices);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t('✦ Level up to {n}', { n: plan.newLevel })}
            </button>
          ) : (
            <button type="button" className="primary next-button" disabled={problems.length > 0} onClick={() => setStepIndex(stepIndex + 1)}>
              {t('Next: {step}', { step: t(TITLES[steps[stepIndex + 1]!]) })} ›
            </button>
          )}
        </div>
      </>
    );
  }

  return createPortal(
    <div className="levelup-overlay" role="dialog" aria-modal aria-label={t('Level up {name}', { name: from.name })}>
      <section className="card creator levelup">
        <div className="creator-head">
          {stepIndex > 0 ? (
            <button type="button" className="link back-link" onClick={() => { setDirection('back'); setStepIndexRaw(stepIndex - 1); }}>{t('‹ Back')}</button>
          ) : (
            <span className="muted small">{from.name || t('Character')}</span>
          )}
          <span className="grow" />
          <button type="button" className="link" onClick={onCancel}>{t('Cancel')}</button>
        </div>
        {body}
      </section>
    </div>,
    document.body,
  );
}

interface StepProps {
  c: CharacterData;
  plan: LevelUpPlan;
  choices: LevelUpChoices;
  set: (p: Partial<LevelUpChoices>) => void;
  content: Content;
}

function Row({ k, children }: { k: ReactNode; children: ReactNode }) {
  return (
    <div className="review-row">
      <span className="muted small">{k}</span>
      <div className="review-value">{children}</div>
    </div>
  );
}

function FeatureChips({ plan }: { plan: LevelUpPlan }) {
  const all = [
    ...plan.features.map((f) => ({ f, from: tx(plan.cls?.name ?? '') })),
    ...plan.subclassFeatures.map((f) => ({ f, from: tx(plan.subclass?.name ?? '') })),
  ];
  if (all.length === 0) return <span className="muted small">{t('No new features at this level.')}</span>;
  return (
    <>
      {all.map(({ f, from }) => (
        <Info key={f.name} entry={{ title: f.name, subtitle: `${from} ${f.level}`, body: f.description }} tapToOpen>
          <span className="chip">{f.name}</span>
        </Info>
      ))}
    </>
  );
}

function Overview({ c, plan }: StepProps) {
  return (
    <div className="review">
      <Row k={t('Level')}>
        <strong>{tx(c.className) || t('Character')} {c.level} → {plan.newLevel}</strong>
      </Row>
      <Row k={t('Hit points')}>{t('One more d{die} Hit Die: roll it or take {fixed}, plus your Constitution modifier.', { die: plan.hitDie, fixed: plan.fixedHp })}</Row>
      {plan.pbTo !== plan.pbFrom && (
        <Row k={t('Proficiency bonus')}>{formatModifier(plan.pbFrom)} → <strong>{formatModifier(plan.pbTo)}</strong></Row>
      )}
      <Row k={<>{t('New features')} <span className="hint">{t('(tap to read)')}</span></>}><FeatureChips plan={plan} /></Row>
      {plan.needsSubclass && <Row k={t('Subclass')}>{t('You choose your subclass.')}</Row>}
      {plan.feat && (
        <Row k={t('Feat')}>{plan.feat === 'epic-boon' ? t('You choose an Epic Boon.') : t('You choose a feat, such as Ability Score Improvement.')}</Row>
      )}
      {plan.slots.length > 0 && (
        <Row k={t('Spell slots')}>
          {plan.slots.map((s) => `${s.pact ? `${t('Pact')} ` : ''}${t('{nth} level', { nth: ordinal(s.level) })}: ${s.max}`).join(' · ')}
        </Row>
      )}
      {plan.spells && plan.spells.newCantrips + plan.spells.newPrepared > 0 && (
        <Row k={t('Spells')}>
          {[plan.spells.newCantrips > 0 && plural(plan.spells.newCantrips, '{n} new cantrip', '{n} new cantrips'), plan.spells.newPrepared > 0 && plural(plan.spells.newPrepared, '{n} more prepared spell', '{n} more prepared spells')]
            .filter(Boolean)
            .join(` ${t('and')} `)}
        </Row>
      )}
      {!plan.cls && (
        <p className="notice">{t("This class isn't in the rulebook data, so only level and hit points are filled in. Add its new features on the sheet.")}</p>
      )}
    </div>
  );
}

function HpStep({ c, plan, choices, set }: StepProps) {
  const rolled = choices.hpRoll !== null;
  const con = abilityModifier(scoresAfter(c, choices).con);
  const valid = !rolled || (Number.isInteger(choices.hpRoll) && choices.hpRoll! >= 1 && choices.hpRoll! <= plan.hitDie);
  const gain = valid ? hpGain(c, plan, choices) : null;
  return (
    <>
      <div className="choice-cards" role="radiogroup" aria-label={t('How to gain hit points')}>
        <button type="button" role="radio" aria-checked={!rolled} className={`choice-card ${!rolled ? 'on' : ''}`} onClick={() => set({ hpRoll: null })}>
          <strong>{t('Take {n}', { n: plan.fixedHp })}</strong>
          <span className="muted small">{t('The fixed value. No risk.')}</span>
        </button>
        <button type="button" role="radio" aria-checked={rolled} className={`choice-card ${rolled ? 'on' : ''}`} onClick={() => !rolled && set({ hpRoll: plan.fixedHp })}>
          <strong>{t('Roll the d{die}', { die: plan.hitDie })}</strong>
          <span className="muted small">{t('Roll your die at the table and enter it.')}</span>
        </button>
      </div>
      {rolled && (
        <label>
          {t('What did you roll on the d{die}?', { die: plan.hitDie })}
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={plan.hitDie}
            value={Number.isFinite(choices.hpRoll) ? choices.hpRoll! : ''}
            onChange={(e) => set({ hpRoll: e.target.value === '' ? NaN : Number(e.target.value) })}
          />
        </label>
      )}
      {gain !== null && (
        <p className="notice good">
          {rolled ? choices.hpRoll : plan.fixedHp} {con >= 0 ? '+' : '−'} {tj('{con} (Constitution) = {gain}. Maximum {before} → {after}.', { con: Math.abs(con), gain: <strong>{t('+{n} HP', { n: gain })}</strong>, before: c.hpMax, after: <strong>{c.hpMax + gain}</strong> })}
        </p>
      )}
    </>
  );
}

function SubclassStep({ plan, choices, set, content }: StepProps) {
  const sub = plan.subclassOptions.find((s) => s.id === choices.subclassId);
  return (
    <>
      <Picker
        label={t('{name} subclass', { name: tx(plan.cls?.name ?? '') })}
        value={choices.subclassId}
        allowCustom
        options={plan.subclassOptions.map((s) => ({ value: s.id, label: tx(s.name), hint: s.summary, info: subclassInfo(s) }))}
        onChange={(subclassId) => set({ subclassId })}
      />
      {choices.subclassId === CUSTOM_VALUE && (
        <>
          <label>{t('Subclass name')}<input value={choices.customSubclass} maxLength={40} onChange={(e) => set({ customSubclass: e.target.value })} /></label>
          <p className="muted small hint">{t("Add its features on the sheet's Features tab afterwards.")}</p>
        </>
      )}
      {sub && (
        <div className="review">
          <Row k={<>{t('You get')} <span className="hint">{t('(tap to read)')}</span></>}>
            {sub.features.filter((f) => f.level <= plan.newLevel).map((f) => (
              <Info key={f.name} entry={{ title: f.name, subtitle: `${tx(sub.name)} ${f.level}`, body: f.description }} tapToOpen>
                <span className="chip">{f.name}</span>
              </Info>
            ))}
          </Row>
        </div>
      )}
      {plan.subclassOptions.length <= 1 && content.packs.length <= 1 && (
        <p className="muted small hint">{t("The free SRD has one subclass per class. Others from your Player's Handbook can be added later, or use Homebrew.")}</p>
      )}
    </>
  );
}

function FeatStep({ c, plan, choices, set, content }: StepProps) {
  const options = featOptions(plan, content);
  const isAsi = choices.featId === ASI_FEAT;
  const points = ABILITIES.reduce((n, a) => n + (choices.asi[a] ?? 0), 0);
  const bump = (a: Ability, d: number) => set({ asi: { ...choices.asi, [a]: Math.max(0, (choices.asi[a] ?? 0) + d) } });
  const single = ABILITIES.find((a) => (choices.asi[a] ?? 0) > 0) ?? '';
  return (
    <>
      <Picker
        label={plan.feat === 'epic-boon' ? t('Epic Boon or feat') : t('Feat')}
        value={choices.featId}
        allowCustom
        customLabel={t('Another feat (from your book or homebrew)')}
        options={options.map((f) => ({
          value: f.id,
          label: f.name,
          hint: f.prerequisite ? t('Needs: {what}', { what: f.prerequisite }) : undefined,
          group: f.category === 'epic-boon' ? t('Epic Boons') : t('General feats'),
          info: featInfo(f),
        }))}
        onChange={(featId) => set({ featId, asi: {} })}
      />
      {choices.featId === CUSTOM_VALUE && (
        <label>{t('Feat name')}<input value={choices.customFeat} maxLength={80} placeholder={t('e.g. Great Weapon Master')} onChange={(e) => set({ customFeat: e.target.value })} /></label>
      )}
      {isAsi && (
        <>
          <p className="muted small">{t('Raise one ability by 2, or two abilities by 1 (20 at most).')} {2 - points > 0 ? t('{n} left.', { n: 2 - points }) : t('Done.')}</p>
          <ul className="asi-list">
            {ABILITIES.map((a) => {
              const add = choices.asi[a] ?? 0;
              return (
                <li key={a}>
                  <span className="grow">{t(ABILITY_NAMES[a])}</span>
                  <button type="button" aria-label={t('Lower {ability}', { ability: t(ABILITY_NAMES[a]) })} disabled={add === 0} onClick={() => bump(a, -1)}>−</button>
                  <span className={`asi-score ${add > 0 ? 'up' : ''}`}>{c.abilities[a] + add}</span>
                  <button type="button" aria-label={t('Raise {ability}', { ability: t(ABILITY_NAMES[a]) })} disabled={points >= 2 || c.abilities[a] + add >= 20} onClick={() => bump(a, 1)}>+</button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {choices.featId && !isAsi && (
        <label>
          {t('Does the feat raise an ability by 1? (Most do; read the feat.)')}
          <select value={single} onChange={(e) => set({ asi: e.target.value ? { [e.target.value]: 1 } : {} })}>
            <option value="">{t('No ability increase')}</option>
            {ABILITIES.map((a) => (
              <option key={a} value={a}>{t(ABILITY_NAMES[a])} {c.abilities[a]} → {c.abilities[a] + 1}</option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}

function SpellsStep({ c, plan, choices, set, content }: StepProps) {
  const sp = plan.spells!;
  const options = levelUpSpellOptions(c, plan, content);
  const levelOf = (id: string) => options.find((s) => s.id === id)?.level ?? 0;
  const cantrips = choices.spells.filter((id) => levelOf(id) === 0);
  const leveled = choices.spells.filter((id) => levelOf(id) > 0);
  return (
    <>
      <p className="muted small">
        {t("At level {level} you have {cantrips} and {prepared}, spells up to level {max}. You can pick fewer now and add the rest on the sheet's Spells tab.", { level: plan.newLevel, cantrips: plural(sp.cantrips, '{n} cantrip', '{n} cantrips'), prepared: plural(sp.prepared, '{n} prepared spell', '{n} prepared spells'), max: sp.maxLevel })}
      </p>
      {sp.newCantrips > 0 && (
        <MultiPicker
          label={plural(sp.newCantrips, '{n} new cantrip', '{n} new cantrips')}
          max={sp.newCantrips}
          values={cantrips}
          options={spellPickerOptions(options.filter((s) => s.level === 0))}
          onChange={(v) => set({ spells: [...v, ...leveled] })}
        />
      )}
      {sp.newPrepared > 0 && (
        <MultiPicker
          label={plural(sp.newPrepared, '{n} new prepared spell', '{n} new prepared spells')}
          max={sp.newPrepared}
          values={leveled}
          options={spellPickerOptions(options.filter((s) => s.level > 0))}
          onChange={(v) => set({ spells: [...cantrips, ...v] })}
        />
      )}
    </>
  );
}

function Review({ c, plan, choices, content }: StepProps) {
  const gain = hpGain(c, plan, plan.feat ? choices : { ...choices, asi: {} });
  const after = scoresAfter(c, choices);
  const raised = plan.feat ? ABILITIES.filter((a) => after[a] !== c.abilities[a]) : [];
  const sub = plan.subclassOptions.find((s) => s.id === choices.subclassId);
  const feat = content.feat(choices.featId);
  return (
    <div className="review">
      <Row k={t('Level')}><strong>{tx(c.className)} {plan.newLevel}</strong></Row>
      <Row k={t('Hit points')}>{tj('+{gain} HP, maximum {max}', { gain, max: <strong>{c.hpMax + gain}</strong> })}</Row>
      {plan.pbTo !== plan.pbFrom && <Row k={t('Proficiency bonus')}><strong>{formatModifier(plan.pbTo)}</strong></Row>}
      {plan.needsSubclass && <Row k={t('Subclass')}><strong>{sub ? tx(sub.name) : choices.customSubclass}</strong></Row>}
      {plan.feat && <Row k={t('Feat')}><strong>{feat?.name ?? choices.customFeat}</strong></Row>}
      {raised.length > 0 && (
        <Row k={t('Abilities')}>{raised.map((a) => `${t(ABILITY_NAMES[a])} ${c.abilities[a]} → ${after[a]}`).join(' · ')}</Row>
      )}
      <Row k={t('New features')}><FeatureChips plan={plan} /></Row>
      {choices.spells.length > 0 && (
        <Row k={t('New spells')}>
          {choices.spells.map((id) => <span key={id} className="chip">{content.spell(id)?.name ?? id}</span>)}
        </Row>
      )}
    </div>
  );
}
