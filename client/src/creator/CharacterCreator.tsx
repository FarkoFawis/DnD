import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ABILITIES,
  ABILITY_NAMES,
  CUSTOM,
  EXTRA_LANGUAGES,
  MAGIC_INITIATE_LISTS,
  POINT_BUY_BUDGET,
  POINT_BUY_COST,
  SKILLS,
  SKILL_KEYS,
  STANDARD_ARRAY,
  STEPS,
  abilityModifier,
  backgroundInfo,
  buildCharacter,
  chosenBackground,
  chosenClass,
  chosenSpecies,
  classInfo,
  emptyChoices,
  equipmentSources,
  featInfo,
  formatModifier,
  itemInfo,
  magicInitiateList,
  originFeats,
  pointBuySpent,
  scoresWithBonuses,
  speciesInfo,
  spellAllowance,
  spellInfo,
  spellLevelText,
  spellOptions,
  stepProblems,
  subclassInfo,
  type Ability,
  type CharacterData,
  type Content,
  type CreationChoices,
  type EquipmentOption,
  type InfoEntry,
  type Skill,
  type SpellDef,
  type Step,
  abilityShort,
} from '@dnd/shared';
import { Info } from '../Info.tsx';
import { NewPortraitInput } from '../Portrait.tsx';
import { MultiPicker, Picker, type PickerOption } from '../Picker.tsx';
import { useContent } from '../content/useContent.ts';
import { diceText, msg, t, tj, tx } from '../i18n.tsx';

/** In English (like STEP_TAGLINES): drawn with t(). */
const STEP_TITLES: Record<Step, string> = {
  class: msg('Class'),
  background: msg('Background'),
  species: msg('Species'),
  abilities: msg('Ability scores'),
  equipment: msg('Equipment'),
  spells: msg('Spells'),
  details: msg('Name & review'),
};

const STEP_TAGLINES: Record<Step, string> = {
  class: msg('What kind of adventurer are you?'),
  background: msg('What did you do before adventuring?'),
  species: msg('Where do you come from?'),
  abilities: msg('How strong, quick and clever are you?'),
  equipment: msg('What do you carry on the road?'),
  spells: msg('Which magic have you mastered?'),
  details: msg('Who are you? Check everything, then create.'),
};

const DRAFT_KEY = 'dnd.creatorDraft';
/** Choices survive Back, leaving the creator, and reloads until the character is created. */
function loadDraft(): { choices: CreationChoices; step: number } | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as { choices: Partial<CreationChoices>; step: number };
    return { choices: { ...emptyChoices(), ...d.choices }, step: Number(d.step) || 0 };
  } catch {
    return null;
  }
}
/** Has a character been started in the creator and not finished? */
export function hasCreatorDraft(): boolean {
  const d = loadDraft();
  return !!d && (d.step > 0 || !!d.choices.classId);
}
function saveDraft(d: { choices: CreationChoices; step: number } | null) {
  try {
    if (d) localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* storage blocked: the draft just isn't kept */
  }
}

const abilityOptions = (): PickerOption[] => ABILITIES.map((a) => ({ value: a, label: t(ABILITY_NAMES[a]) }));
const skillOption = (s: Skill): PickerOption => ({ value: s, label: t(SKILLS[s].name), hint: t(ABILITY_NAMES[SKILLS[s].ability]) });

/**
 * Step-by-step character creation (2024 rules). Every choice is a dropdown of
 * the official SRD options plus extra content packs, with a homebrew escape
 * hatch. Hold (phone) or hover (PC) any option to read it.
 */
export function CharacterCreator({
  onDone,
  onCancel,
}: {
  /** Return false if saving failed, so the draft is kept. */
  onDone: (data: Partial<CharacterData> & { name: string }, portrait: Blob | null) => Promise<boolean | void> | boolean | void;
  onCancel: () => void;
}) {
  const content = useContent();
  const [initial] = useState(loadDraft);
  const [c, setC] = useState<CreationChoices>(initial?.choices ?? emptyChoices);
  const [stepIndex, setStepIndexRaw] = useState(initial?.step ?? 0);
  const [direction, setDirection] = useState<'fwd' | 'back'>('fwd');
  const [busy, setBusy] = useState(false);
  /** Chosen picture; uploaded once the character exists. Not kept across reloads. */
  const [portrait, setPortrait] = useState<Blob | null>(null);
  const set = (patch: Partial<CreationChoices>) => setC((prev) => ({ ...prev, ...patch }));
  const setStepIndex = (i: number) => {
    setDirection(i < stepIndex ? 'back' : 'fwd');
    setStepIndexRaw(i);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  useEffect(() => saveDraft({ choices: c, step: stepIndex }), [c, stepIndex]);

  if (!content) return <section className="card"><p className="muted">{t('Loading the rulebook…')}</p></section>;

  const allowance = spellAllowance(c, content);
  const hasSpellStep = allowance.cantrips + allowance.prepared > 0;
  const steps = STEPS.filter((s) => s !== 'spells' || hasSpellStep);
  const step = steps[Math.min(stepIndex, steps.length - 1)]!;
  const problems = stepProblems(step, c, content);
  const last = step === 'details';

  const finish = async () => {
    setBusy(true);
    try {
      if ((await onDone(buildCharacter(c, content, newId), portrait)) !== false) saveDraft(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card creator">
      <div className="creator-head">
        {stepIndex > 0 ? (
          <button type="button" className="link back-link" onClick={() => setStepIndex(stepIndex - 1)}>{t('‹ Back')}</button>
        ) : (
          <span className="muted small">{t('New character')}</span>
        )}
        <span className="grow" />
        {(stepIndex > 0 || c.classId) && (
          <button type="button" className="link" onClick={() => { if (window.confirm(t('Throw away these choices and start over?'))) { setC(emptyChoices()); setStepIndex(0); } }}>{t('Start over')}</button>
        )}
        <button type="button" className="link" onClick={onCancel}>{t('Close')}</button>
      </div>
      <div className="progress" aria-label={t('Step {n} of {total}', { n: stepIndex + 1, total: steps.length })}>
        {steps.map((s, i) => {
          const reachable = i <= stepIndex || !steps.slice(0, i).some((p) => stepProblems(p, c, content).length > 0);
          return (
            <button
              key={s}
              type="button"
              className={`progress-seg ${i === stepIndex ? 'now' : i < stepIndex ? 'done' : ''}`}
              title={t(STEP_TITLES[s])}
              aria-label={t('Step {n}: {title}', { n: i + 1, title: t(STEP_TITLES[s]) })}
              disabled={!reachable}
              onClick={() => setStepIndex(i)}
            />
          );
        })}
      </div>
      <div key={step} className={`step-body slide-${direction}`}>
      <p className="step-count">{t('Step {n} of {total}', { n: stepIndex + 1, total: steps.length })}</p>
      <h3 className="step-title">{t(STEP_TITLES[step])}</h3>
      <p className="step-tagline">{t(STEP_TAGLINES[step])}</p>

      {step === 'class' && <ClassStep c={c} set={set} content={content} />}
      {step === 'background' && <BackgroundStep c={c} set={set} content={content} />}
      {step === 'species' && <SpeciesStep c={c} set={set} content={content} />}
      {step === 'abilities' && <AbilityStep c={c} set={set} content={content} />}
      {step === 'equipment' && <EquipmentStep c={c} set={set} content={content} />}
      {step === 'spells' && <SpellStep c={c} set={set} content={content} />}
      {step === 'details' && <ReviewStep c={c} set={set} content={content} portrait={portrait} setPortrait={setPortrait} />}

      </div>
      {problems.length > 0 && (
        <ul className="todo">
          {problems.map((p) => <li key={p}>{tx(p)}</li>)}
        </ul>
      )}
      <div className="creator-nav">
        {last ? (
          <button type="button" className="primary next-button" disabled={problems.length > 0 || busy} onClick={() => void finish()}>
            {t('✦ Create character')}
          </button>
        ) : (
          <button type="button" className="primary next-button" disabled={problems.length > 0} onClick={() => setStepIndex(stepIndex + 1)}>
            {t('Next: {step}', { step: t(STEP_TITLES[steps[stepIndex + 1]!]) })} ›
          </button>
        )}
      </div>
      <p className="credit">
        {tj('Rules text from the System Reference Document 5.2 by Wizards of the Coast LLC, licensed {a}.', { a: <a href="https://creativecommons.org/licenses/by/4.0/legalcode" target="_blank" rel="noreferrer">CC-BY-4.0</a> })}
      </p>
    </section>
  );
}

type StepProps = { c: CreationChoices; set: (p: Partial<CreationChoices>) => void; content: Content };

// ---------- 1. class ----------

function ClassStep({ c, set, content }: StepProps) {
  const cls = chosenClass(c, content);
  const subclasses = c.classId && c.classId !== CUSTOM ? content.subclassesOf(c.classId) : [];
  const needsSub = cls && c.level >= cls.subclassLevel;
  return (
    <>
      <Picker
        label={t('Class')}
        value={c.classId}
        allowCustom
        options={content.classes.map((x) => ({ value: x.id, label: tx(x.name), hint: `${diceText(`d${x.hitDie}`)} · ${tx(x.primaryAbility)}`, info: withSource(classInfo(x), content, 'classes', x.id) }))}
        onChange={(classId) => set({ classId, subclassId: '', classSkills: [], classEquipment: '', equipmentPicks: {}, cantrips: [], preparedSpells: [] })}
      />
      {c.classId === CUSTOM && (
        <div className="custom-box">
          <label>{t('Class name')}<input value={c.customClass.name} maxLength={40} onChange={(e) => set({ customClass: { ...c.customClass, name: e.target.value } })} /></label>
          <label>{t('Hit die')}
            <select value={c.customClass.hitDie} onChange={(e) => set({ customClass: { ...c.customClass, hitDie: Number(e.target.value) } })}>
              {[6, 8, 10, 12].map((d) => <option key={d} value={d}>d{d}</option>)}
            </select>
          </label>
          <MultiPicker label={t('Saving throws')} max={2} values={c.customClass.saves} options={abilityOptions()} onChange={(saves) => set({ customClass: { ...c.customClass, saves: saves as Ability[] } })} />
          <label>{t('Spellcasting')}
            <select value={c.customClass.spellAbility ?? ''} onChange={(e) => set({ customClass: { ...c.customClass, spellAbility: (e.target.value || null) as Ability | null } })}>
              <option value="">{t("Doesn't cast spells")}</option>
              {ABILITIES.map((a) => <option key={a} value={a}>{t('Casts with {ability}', { ability: t(ABILITY_NAMES[a]) })}</option>)}
            </select>
          </label>
          <p className="muted small hint">{t("Add the class's features on the sheet's Features tab afterwards.")}</p>
        </div>
      )}
      <label>{t('Starting level')}
        <select value={c.level} onChange={(e) => set({ level: Number(e.target.value), cantrips: [], preparedSpells: [] })}>
          {Array.from({ length: 20 }, (_, i) => i + 1).map((l) => <option key={l} value={l}>{t('Level {n}', { n: l })}</option>)}
        </select>
      </label>
      {cls && needsSub && (
        <>
          <Picker
            label={t('Subclass')}
            value={c.subclassId}
            allowCustom
            options={subclasses.map((s) => ({ value: s.id, label: tx(s.name), hint: s.summary, info: withSource(subclassInfo(s), content, 'subclasses', s.id) }))}
            onChange={(subclassId) => set({ subclassId })}
          />
          {c.subclassId === CUSTOM && (
            <label>{t('Subclass name')}<input value={c.customSubclass} maxLength={40} onChange={(e) => set({ customSubclass: e.target.value })} /></label>
          )}
          {c.classId !== CUSTOM && subclasses.length === 1 && (
            <p className="muted small hint">{t("The free SRD has one subclass per class. Others from your Player's Handbook can be added later, or use Homebrew.")}</p>
          )}
        </>
      )}
      {cls && (
        <MultiPicker
          label={t('Class skills')}
          max={cls.skillChoices.choose}
          values={c.classSkills}
          options={cls.skillChoices.from.map(skillOption)}
          onChange={(v) => set({ classSkills: v as Skill[] })}
        />
      )}
      {cls && cls.id !== CUSTOM && (
        <Info entry={classInfo(cls)}>
          <p className="summary">
            {tj('{name}: Hit Die d{die}, saves {saves}.', { name: <strong>{tx(cls.name)}</strong>, die: cls.hitDie, saves: cls.saves.map((a) => abilityShort(a)).join(' & ') })}
            {cls.spellcasting ? ` ${t('Casts spells with {ability}.', { ability: t(ABILITY_NAMES[cls.spellcasting.ability]) })}` : ''} <span className="muted hint">{t('Hold for details.')}</span>
          </p>
        </Info>
      )}
    </>
  );
}

// ---------- 2. background ----------

function BackgroundStep({ c, set, content }: StepProps) {
  const bg = chosenBackground(c, content);
  const originOptions = featOptions(content, 'origin');
  return (
    <>
      <Picker
        label={t('Background')}
        value={c.backgroundId}
        allowCustom
        options={content.backgrounds.map((b) => ({
          value: b.id,
          label: tx(b.name),
          hint: `${b.abilities.map((a) => abilityShort(a)).join(', ')} · ${content.feat(b.feat)?.name ?? b.feat}`,
          info: withSource(backgroundInfo(b, content), content, 'backgrounds', b.id),
        }))}
        onChange={(backgroundId) => set({ backgroundId, backgroundEquipment: '', plus2: '', plus1: '', skilledPicks: [], magicInitiate: emptyChoices().magicInitiate })}
      />
      {c.backgroundId === CUSTOM && (
        <div className="custom-box">
          <label>{t('Background name')}<input value={c.customBackground.name} maxLength={40} onChange={(e) => set({ customBackground: { ...c.customBackground, name: e.target.value } })} /></label>
          <MultiPicker label={t('Abilities it can raise')} max={3} values={c.customBackground.abilities} options={abilityOptions()} onChange={(v) => set({ customBackground: { ...c.customBackground, abilities: v as Ability[] }, plus2: '', plus1: '' })} />
          <MultiPicker label={t('Skills')} max={2} values={c.customBackground.skills} options={SKILL_KEYS.map(skillOption)} onChange={(v) => set({ customBackground: { ...c.customBackground, skills: v as Skill[] } })} />
          <label>{t('Tool proficiency')}<input value={c.customBackground.tool} maxLength={40} onChange={(e) => set({ customBackground: { ...c.customBackground, tool: e.target.value } })} /></label>
          <Picker label={t('Origin feat')} value={c.backgroundFeat} options={originOptions} onChange={(backgroundFeat) => set({ backgroundFeat })} />
          <p className="muted small hint">{t("Starting equipment for a homebrew background: add it on the sheet's Items tab.")}</p>
        </div>
      )}
      {bg && c.backgroundId !== CUSTOM && (
        <Info entry={backgroundInfo(content.background(bg.id)!, content)}>
          <p className="summary">
            {t('Skills: {skills}. Tool: {tool}.', { skills: bg.skills.map((s) => t(SKILLS[s].name)).join(', '), tool: bg.tool || t('none') })} <span className="muted hint">{t('Hold for details.')}</span>
          </p>
        </Info>
      )}
      {bg && <FeatChoices c={c} set={set} content={content} feat={bg.feat} from="background" />}
    </>
  );
}

/** Extra picks some origin feats need (Skilled, Magic Initiate). */
function FeatChoices({ c, set, content, feat, from }: StepProps & { feat: string; from: 'background' | 'species' }) {
  const def = content.feat(feat);
  if (!def) return null;
  const header = (
    <Info entry={featInfo(def)}>
      <p className="summary"><strong>{from === 'background' ? t('Background feat: {name}', { name: def.name }) : t('Species feat: {name}', { name: def.name })}</strong> <span className="muted hint">{t('(hold to read)')}</span></p>
    </Info>
  );
  if (feat === 'skilled') {
    return (
      <div className="custom-box">
        {header}
        <MultiPicker label={t('Skilled: pick 3 skills')} max={3} values={c.skilledPicks} options={SKILL_KEYS.map(skillOption)} onChange={(v) => set({ skilledPicks: v as Skill[] })} />
      </div>
    );
  }
  if (feat === 'magic-initiate') {
    const fixed = magicInitiateList(c, content);
    const list = fixed ?? c.magicInitiate.list;
    const mi = c.magicInitiate;
    const spells = list ? content.spellsFor(list, 1) : [];
    return (
      <div className="custom-box">
        {header}
        {fixed ? (
          <p className="muted small">{t('Spell list: {list} (set by your background).', { list: tx(cap(fixed)) })}</p>
        ) : (
          <Picker label={t('Spell list')} value={mi.list} options={MAGIC_INITIATE_LISTS.map((l) => ({ value: l, label: tx(cap(l)) }))} onChange={(l) => set({ magicInitiate: { ...mi, list: l, cantrips: [], spell: '' } })} />
        )}
        <Picker label={t('Spellcasting ability for these spells')} value={mi.ability} options={(['int', 'wis', 'cha'] as Ability[]).map((a) => ({ value: a, label: t(ABILITY_NAMES[a]) }))} onChange={(a) => set({ magicInitiate: { ...mi, ability: a as Ability } })} />
        {list && (
          <>
            <MultiPicker label={t('2 cantrips')} max={2} values={mi.cantrips} options={spellPickerOptions(spells.filter((s) => s.level === 0))} onChange={(v) => set({ magicInitiate: { ...mi, cantrips: v } })} />
            <Picker label={t('Level 1 spell (once per long rest for free)')} value={mi.spell} searchable options={spellPickerOptions(spells.filter((s) => s.level === 1))} onChange={(spell) => set({ magicInitiate: { ...mi, spell } })} />
          </>
        )}
      </div>
    );
  }
  return header;
}

// ---------- 3. species ----------

function SpeciesStep({ c, set, content }: StepProps) {
  const sp = chosenSpecies(c, content);
  const bgFeat = chosenBackground(c, content)?.feat;
  return (
    <>
      <Picker
        label={t('Species')}
        value={c.speciesId}
        allowCustom
        options={content.species.map((s) => ({ value: s.id, label: tx(s.name), hint: `${tx(s.size)} · ${s.speed} ft.`, info: withSource(speciesInfo(s), content, 'species', s.id) }))}
        onChange={(speciesId) => set({ speciesId, subspeciesId: '', size: '', speciesSkill: '', speciesFeat: '' })}
      />
      {c.speciesId === CUSTOM && (
        <div className="custom-box">
          <label>{t('Species name')}<input value={c.customSpecies.name} maxLength={40} onChange={(e) => set({ customSpecies: { ...c.customSpecies, name: e.target.value } })} /></label>
          <div className="grid2">
            <label>{t('Size')}
              <select value={c.customSpecies.size} onChange={(e) => set({ customSpecies: { ...c.customSpecies, size: e.target.value } })}>
                <option value="Small">{t('Small')}</option><option value="Medium">{t('Medium')}</option>
              </select>
            </label>
            <label>{t('Speed (ft.)')}
              <select value={c.customSpecies.speed} onChange={(e) => set({ customSpecies: { ...c.customSpecies, speed: Number(e.target.value) } })}>
                {[25, 30, 35, 40].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </div>
          <label>{t('Traits (from your book)')}<textarea rows={4} maxLength={4000} value={c.customSpecies.traits} onChange={(e) => set({ customSpecies: { ...c.customSpecies, traits: e.target.value } })} /></label>
        </div>
      )}
      {sp?.subspecies && (
        <Picker
          label={tx(sp.subspecies.label)}
          value={c.subspeciesId}
          options={sp.subspecies.options.map((o) => ({ value: o.id, label: o.name, info: { title: o.name, subtitle: tx(sp.subspecies!.label), body: o.description } }))}
          onChange={(subspeciesId) => set({ subspeciesId })}
        />
      )}
      {sp?.size.includes(' or ') && (
        <Picker label={t('Size')} value={c.size} options={sp.size.split(' or ').map((s) => ({ value: s, label: tx(s) }))} onChange={(size) => set({ size })} />
      )}
      {sp?.skillChoice && (
        <Picker label={t('Skillful: one extra skill')} value={c.speciesSkill} options={SKILL_KEYS.map(skillOption)} onChange={(s) => set({ speciesSkill: s as Skill })} />
      )}
      {sp?.originFeatChoice && (
        <>
          <Picker label={t('Versatile: an origin feat')} value={c.speciesFeat} options={featOptions(content, 'origin')} onChange={(speciesFeat) => set({ speciesFeat })} />
          {c.speciesFeat && c.speciesFeat !== bgFeat && <FeatChoices c={c} set={set} content={content} feat={c.speciesFeat} from="species" />}
        </>
      )}
      {sp && sp.id !== CUSTOM && (
        <Info entry={speciesInfo(sp)}>
          <p className="summary">{t('Traits: {names}.', { names: sp.traits.map((trait) => trait.name).join(', ') })} <span className="muted hint">{t('Hold for details.')}</span></p>
        </Info>
      )}
      <MultiPicker
        label={t('Languages (you know Common + {n})', { n: EXTRA_LANGUAGES })}
        max={EXTRA_LANGUAGES}
        values={c.languages}
        options={content.languages.filter((l) => l.id !== 'common').map((l) => ({ value: l.id, label: t(`${l.name}##language`), group: l.rare ? t('Rare (ask your DM)') : t('Standard##languages'), rare: l.rare }))
          .sort((a, b) => Number(a.rare) - Number(b.rare) || a.label.localeCompare(b.label))}
        onChange={(languages) => set({ languages })}
      />
    </>
  );
}

// ---------- 4. abilities ----------

function AbilityStep({ c, set, content }: StepProps) {
  const bg = chosenBackground(c, content);
  const final = scoresWithBonuses(c, content);
  const method = c.abilityMethod;
  const setMethod = (m: CreationChoices['abilityMethod']) =>
    set({
      abilityMethod: m,
      baseScores: Object.fromEntries(ABILITIES.map((a) => [a, m === 'standard' ? 0 : m === 'pointbuy' ? 8 : 10])) as CreationChoices['baseScores'],
    });
  const used = ABILITIES.map((a) => c.baseScores[a]);
  const bgAbilities = bg?.abilities ?? [];
  const cls = chosenClass(c, content);
  return (
    <>
      <label>{t('How do you get your scores?')}
        <select value={method} onChange={(e) => setMethod(e.target.value as CreationChoices['abilityMethod'])}>
          <option value="standard">{t('Standard array (15, 14, 13, 12, 10, 8)')}</option>
          <option value="pointbuy">{t('Point buy (27 points)')}</option>
          <option value="manual">{t('Rolled dice (type in your rolls)')}</option>
        </select>
      </label>
      {cls?.primaryAbility && <p className="muted small hint">{t('Tip: put your highest score in {ability} (the main ability of the {name}).', { ability: tx(cls.primaryAbility), name: tx(cls.name) })}</p>}
      {method === 'pointbuy' && (
        <p className={pointBuySpent(c.baseScores) > POINT_BUY_BUDGET ? 'error small' : 'muted small'}>
          {t('Points spent: {n} / {max}', { n: pointBuySpent(c.baseScores), max: POINT_BUY_BUDGET })}
        </p>
      )}
      <div className="score-grid">
        {ABILITIES.map((a) => (
          <div key={a} className="score-row">
            <span className="score-name">{ABILITY_NAMES[a]}</span>
            {method === 'standard' ? (
              <select aria-label={t(ABILITY_NAMES[a])} value={c.baseScores[a] || ''} onChange={(e) => set({ baseScores: { ...c.baseScores, [a]: Number(e.target.value) || 0 } })}>
                <option value="">–</option>
                {STANDARD_ARRAY.map((n) => (
                  <option key={n} value={n} disabled={used.includes(n) && c.baseScores[a] !== n}>{n}</option>
                ))}
              </select>
            ) : method === 'pointbuy' ? (
              <select aria-label={t(ABILITY_NAMES[a])} value={c.baseScores[a]} onChange={(e) => set({ baseScores: { ...c.baseScores, [a]: Number(e.target.value) } })}>
                {Object.entries(POINT_BUY_COST).map(([n, cost]) => <option key={n} value={n}>{t('{n} (cost {cost})', { n, cost })}</option>)}
              </select>
            ) : (
              <select aria-label={t(ABILITY_NAMES[a])} value={c.baseScores[a]} onChange={(e) => set({ baseScores: { ...c.baseScores, [a]: Number(e.target.value) } })}>
                {Array.from({ length: 16 }, (_, i) => i + 3).map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            )}
            <span className="score-final">{c.baseScores[a] ? `${final[a]} (${formatModifier(abilityModifier(final[a]))})` : ''}</span>
          </div>
        ))}
      </div>
      {bg && (
        <div className="custom-box">
          <p className="summary">{t('Your background ({name}) raises {abilities}.', { name: tx(bg.name), abilities: bgAbilities.map((a) => t(ABILITY_NAMES[a])).join(', ') })}</p>
          <label>{t('Bonus')}
            <select value={c.bonusMode} onChange={(e) => set({ bonusMode: e.target.value as CreationChoices['bonusMode'], plus2: '', plus1: '' })}>
              <option value="2-1">{t('+2 to one and +1 to another')}</option>
              <option value="1-1-1">{t('+1 to all three')}</option>
            </select>
          </label>
          {c.bonusMode === '2-1' && (
            <div className="grid2">
              <label>{t('+2 to')}
                <select value={c.plus2} onChange={(e) => set({ plus2: e.target.value as Ability })}>
                  <option value="">{t('Choose…')}</option>
                  {bgAbilities.map((a) => <option key={a} value={a} disabled={a === c.plus1}>{ABILITY_NAMES[a]}</option>)}
                </select>
              </label>
              <label>{t('+1 to')}
                <select value={c.plus1} onChange={(e) => set({ plus1: e.target.value as Ability })}>
                  <option value="">{t('Choose…')}</option>
                  {bgAbilities.map((a) => <option key={a} value={a} disabled={a === c.plus2}>{ABILITY_NAMES[a]}</option>)}
                </select>
              </label>
            </div>
          )}
          <p className="muted small">{t("Scores can't go above 20.")}</p>
        </div>
      )}
    </>
  );
}

// ---------- 5. equipment ----------

function EquipmentStep({ c, set, content }: StepProps) {
  const sources = equipmentSources(c, content);
  const any = sources.some(([, opts]) => opts.length > 0);
  if (!any) return <p className="muted">{t("Nothing to pick here. Add your gear on the sheet's Items tab afterwards.")}</p>;
  return (
    <>
      {sources.map(([src, opts, chosen]) =>
        opts.length === 0 ? null : (
          <div key={src} className="custom-box">
            <Picker
              label={t('{name} equipment', { name: tx((src === 'class' ? chosenClass(c, content)?.name : chosenBackground(c, content)?.name) ?? '') })}
              value={chosen}
              options={opts.map((o) => ({ value: o.label, label: t('Option {letter}', { letter: o.label }), hint: optionText(o, content), info: optionInfo(o, content) }))}
              onChange={(label) => set(src === 'class' ? { classEquipment: label } : { backgroundEquipment: label })}
            />
            {opts.find((o) => o.label === chosen)?.items.map((it, i) => {
              if (!('choose' in it)) return null;
              const key = `${src}:${chosen}:${i}`;
              return (
                <Picker
                  key={key}
                  label={t('Pick: {what}', { what: tx(it.choose) })}
                  value={c.equipmentPicks[key] ?? ''}
                  options={it.from.map((id) => content.item(id)).filter((d) => !!d).map((d) => ({ value: d!.id, label: d!.name, hint: d!.cost && tx(d!.cost), info: itemInfo(d!) }))}
                  onChange={(v) => set({ equipmentPicks: { ...c.equipmentPicks, [key]: v } })}
                />
              );
            })}
            <ItemChips option={opts.find((o) => o.label === chosen)} content={content} />
          </div>
        ),
      )}
    </>
  );
}

function ItemChips({ option, content }: { option?: EquipmentOption; content: Content }) {
  if (!option) return null;
  return (
    <div className="chips">
      {option.items.map((it, i) => {
        if (!('ref' in it)) return null;
        const d = content.item(it.ref);
        return (
          <Info key={i} entry={d ? itemInfo(d) : null}>
            <span className="chip">{it.qty > 1 ? `${it.qty}× ` : ''}{d?.name ?? it.ref}{it.note ? ` (${it.note})` : ''}</span>
          </Info>
        );
      })}
      {option.gp > 0 && <span className="chip">{option.gp} {t('gp').toUpperCase()}</span>}
    </div>
  );
}

function optionText(o: EquipmentOption, content: Content): string {
  const parts = o.items.map((it) => ('ref' in it ? `${it.qty > 1 ? `${it.qty} ` : ''}${content.item(it.ref)?.name ?? it.ref}` : tx(it.choose)));
  if (o.gp) parts.push(`${o.gp} ${t('gp').toUpperCase()}`);
  return parts.join(', ');
}

function optionInfo(o: EquipmentOption, content: Content): InfoEntry {
  return {
    title: t('Option {letter}', { letter: o.label }),
    body: o.items
      .map((it) => {
        if ('choose' in it) return `**${tx(it.choose)}.** ${t('One of your choice.')}`;
        const d = content.item(it.ref);
        return `**${it.qty > 1 ? `${it.qty}× ` : ''}${d?.name ?? it.ref}.** ${d?.summary ?? tx(d?.category ?? '')}`;
      })
      .concat(o.gp ? [`**${t('Gold.')}** ${o.gp} ${t('gp').toUpperCase()}`] : [])
      .join('\n'),
  };
}

// ---------- 6. spells ----------

function SpellStep({ c, set, content }: StepProps) {
  const allow = spellAllowance(c, content);
  const options = spellOptions(c, content, allow.maxLevel);
  const cantrips = options.filter((s) => s.level === 0);
  const leveled = options.filter((s) => s.level > 0);
  const cls = chosenClass(c, content);
  return (
    <>
      <p className="muted small">
        {t('{name} level {level}: {cantrips} cantrips and {prepared} prepared spells (spells up to level {max}). You can swap prepared spells after a long rest on the sheet.', { name: tx(cls?.name ?? ''), level: c.level, cantrips: allow.cantrips, prepared: allow.prepared, max: allow.maxLevel })}
      </p>
      {allow.cantrips > 0 && (
        <MultiPicker label={t('Cantrips')} max={allow.cantrips} values={c.cantrips} options={spellPickerOptions(cantrips)} onChange={(cantrips) => set({ cantrips })} />
      )}
      {allow.prepared > 0 && (
        <MultiPicker label={t('Prepared spells')} max={allow.prepared} values={c.preparedSpells} options={spellPickerOptions(leveled)} onChange={(preparedSpells) => set({ preparedSpells })} />
      )}
    </>
  );
}

// ---------- 7. review ----------

function ReviewStep({ c, set, content, portrait, setPortrait }: StepProps & { portrait: Blob | null; setPortrait: (p: Blob | null) => void }) {
  const preview = useMemo(() => buildCharacter(c, content, newId), [c, content]);
  const feats = originFeats(c, content).map((f) => content.feat(f)).filter((f) => !!f);
  return (
    <>
      <label>{t('Character name')}<input value={c.name} maxLength={40} placeholder={t('e.g. Elara Moonwhisper')} onChange={(e) => set({ name: e.target.value })} /></label>
      <NewPortraitInput character={{ name: c.name, className: preview.className ?? '' }} value={portrait} onChange={setPortrait} />
      <div className="review">
        <Row k={t('Class')}>{tx(preview.className ?? '')}{preview.subclass ? ` (${tx(preview.subclass)})` : ''}, {t('Level {n}', { n: preview.level ?? 1 })}</Row>
        <Row k={t('Species')}>{tx(preview.species ?? '')}{preview.subspecies ? ` (${tx(preview.subspecies)})` : ''}</Row>
        <Row k={t('Background')}>{tx(preview.background ?? '')}</Row>
        <Row k={t('Feats')}>
          {feats.map((f, i) => (
            <Info key={f!.id + i} entry={featInfo(f!)}><span className="chip">{f!.name}</span></Info>
          ))}
        </Row>
        <Row k={t('HP / AC / Speed')}>{t('{hp} HP · AC {ac} · {speed} ft.', { hp: preview.hpMax ?? 0, ac: preview.armorClass ?? 10, speed: preview.speed ?? 30 })}</Row>
        <Row k={t('Scores')}>{ABILITIES.map((a) => `${abilityShort(a)} ${preview.abilities![a]}`).join(' · ')}</Row>
        <Row k={t('Skills')}>{preview.skillProficiencies!.map((s) => t(SKILLS[s].name)).join(', ')}</Row>
        {preview.spells!.length > 0 && (
          <Row k={t('Spells')}>
            {preview.spells!.map((s) => {
              const d = s.ref ? content.spell(s.ref) : undefined;
              return <Info key={s.id} entry={d ? spellInfo(d) : null}><span className="chip">{s.name}</span></Info>;
            })}
          </Row>
        )}
        <Row k={t('Items')}>
          {preview.inventory!.map((it) => {
            const d = it.ref ? content.item(it.ref) : undefined;
            return <Info key={it.id} entry={d ? itemInfo(d) : null}><span className="chip">{it.qty > 1 ? `${it.qty}× ` : ''}{it.name}</span></Info>;
          })}
          <span className="chip">{preview.coins!.gp} {t('gp').toUpperCase()}</span>
        </Row>
      </div>
      <p className="muted small hint">{t('Everything can still be changed on the sheet afterwards.')}</p>
    </>
  );
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="review-row">
      <span className="muted small">{k}</span>
      <div className="review-value">{children}</div>
    </div>
  );
}

// ---------- helpers ----------

function featOptions(content: Content, category: string): PickerOption[] {
  return content.feats.filter((f) => f.category === category).map((f) => ({ value: f.id, label: f.name, info: withSource(featInfo(f), content, 'feats', f.id) }));
}

export function spellPickerOptions(spells: SpellDef[]): PickerOption[] {
  return [...spells]
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
    .map((s) => ({
      value: s.id,
      label: s.name,
      hint: [tx(s.school), tx(s.castingTime), s.concentration && t('Concentration'), s.ritual && t('Ritual')].filter(Boolean).join(' · '),
      group: s.level === 0 ? t('Cantrips') : t('Level {n}##spell', { n: s.level }),
      info: spellInfo(s),
    }));
}

/** Marks entries that come from a private pack, so it's clear what isn't SRD. */
function withSource(entry: InfoEntry, content: Content, kind: Parameters<Content['packOf']>[0], id: string): InfoEntry {
  const pack = content.packOf(kind, id);
  return pack && pack.id !== 'srd' ? { ...entry, source: t('From: {pack}', { pack: pack.name }) } : entry;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** crypto.randomUUID only exists on HTTPS/localhost; phones on the LAN dev server use plain http. */
function newId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
