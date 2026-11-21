/**
 * Conditions, concentration and death saves on the sheet. The rules are in
 * shared/src/status.ts; dice are rolled at the table and only recorded here.
 */
import {
  ABILITY_NAMES,
  CONDITIONS,
  conditionInfo,
  conditionName,
  deriveStats,
  formatModifier,
  isDead,
  isStable,
  type CharacterData,
  type Content,
  type DeathSaveResult,
  type InfoEntry,
  ruleText,
} from '@dnd/shared';
import { useFresh } from './fx/hooks.ts';
import { Info } from './Info.tsx';
import { t, tj, tx } from './i18n.tsx';

function exhaustionEntry(content: Content | null, level: number): InfoEntry {
  const def = content?.condition('exhaustion');
  return {
    title: t('Exhaustion {n}', { n: level }),
    subtitle: t('Condition'),
    body: `**${t('Right now.')}** ${t('−{penalty} on every d20 Test, Speed −{feet} ft.', { penalty: 2 * level, feet: 5 * level })}${def ? `\n${ruleText(`condition:${def.id}`, def.description)}` : ''}`,
  };
}

/** The conditions a character has, as badges. Tap one to read its rules. */
export function ConditionBadges({ character: c, content }: { character: CharacterData; content: Content | null }) {
  /** A condition the DM just set pops in; the ones already there don't. */
  const fresh = useFresh(c.conditions);
  if (c.conditions.length === 0 && c.exhaustion === 0) return null;
  return (
    <div className="conditions" aria-label={t('Conditions')}>
      {c.conditions.map((id) => {
        const def = content?.condition(id);
        return (
          <Info key={id} entry={def ? conditionInfo(def) : null} tapToOpen>
            <span className={`condition-badge ${fresh.has(id) ? 'fresh' : ''}`}>{tx(def?.name ?? conditionName(id))}</span>
          </Info>
        );
      })}
      {c.exhaustion > 0 && (
        <Info entry={exhaustionEntry(content, c.exhaustion)} tapToOpen>
          <span className="condition-badge">{t('Exhaustion {n}', { n: c.exhaustion })}{' '}<span className="small">(−{2 * c.exhaustion} d20)</span></span>
        </Info>
      )}
    </div>
  );
}

/** DM: switch conditions on and off and set the Exhaustion level. Hold a name to read it. */
export function ConditionEditor({
  character: c,
  content,
  onConditions,
  onExhaustion,
}: {
  character: CharacterData;
  content: Content | null;
  onConditions: (next: string[]) => void;
  onExhaustion: (level: number) => void;
}) {
  return (
    <div className="condition-editor">
      <div className="chips">
        {CONDITIONS.map(([id, name]) => {
          const on = c.conditions.includes(id);
          const def = content?.condition(id);
          return (
            <Info key={id} entry={def ? conditionInfo(def) : null}>
              <button
                type="button"
                className={`chip condition-toggle ${on ? 'on' : ''}`}
                aria-pressed={on}
                onClick={() => onConditions(on ? c.conditions.filter((x) => x !== id) : [...c.conditions, id])}
              >
                {tx(name)}
              </button>
            </Info>
          );
        })}
      </div>
      <div className="exhaustion-row">
        <Info entry={exhaustionEntry(content, Math.max(1, c.exhaustion))}>
          <span>{t('Exhaustion')}</span>
        </Info>
        <span className="grow" />
        <button type="button" aria-label={t('Less exhaustion')} disabled={c.exhaustion === 0} onClick={() => onExhaustion(c.exhaustion - 1)}>−</button>
        <strong className="exhaustion-level">{c.exhaustion}</strong>
        <button type="button" aria-label={t('More exhaustion')} disabled={c.exhaustion >= 6} onClick={() => onExhaustion(c.exhaustion + 1)}>+</button>
      </div>
      <p className="muted small hint">{t('Hold a condition to read it. The player sees a badge with the rules.')}</p>
    </div>
  );
}

/** "Concentrating on X", with the save reminder after damage. */
export function ConcentrationBanner({
  character: c,
  content,
  onAction,
}: {
  character: CharacterData;
  content: Content | null;
  onAction?: (action: 'end' | 'kept') => void;
}) {
  const conc = c.concentration;
  if (!conc) return null;
  const def = conc.ref ? content?.spell(conc.ref) : undefined;
  const save = deriveStats(c).saves.con;
  const entry: InfoEntry | null = def ? { title: def.name, subtitle: t('Concentration'), facts: [[t('Duration'), tx(def.duration)]], body: def.description } : null;
  return (
    <div className={`concentration ${conc.saveDc !== null ? 'alert' : ''}`} role={conc.saveDc !== null ? 'alert' : 'status'}>
      <div className="concentration-line">
        <span className="grow">
          <span className="muted small block">{t('Concentrating on')}</span>
          <Info entry={entry} tapToOpen><strong>{conc.name}</strong></Info>
        </span>
        {onAction && conc.saveDc === null && (
          <button type="button" className="use-button" onClick={() => onAction('end')}>{t('End')}</button>
        )}
      </div>
      {conc.saveDc !== null && (
        <>
          <p className="concentration-save">
            {tj('Took damage: roll a {save}, {dc} (d20 {bonus}).', { save: t('{name} save', { name: t(ABILITY_NAMES.con) }), dc: <strong>{t('DC {n}', { n: conc.saveDc })}</strong>, bonus: formatModifier(save) })}
          </p>
          {onAction && (
            <div className="rest-buttons">
              <button type="button" className="secondary" onClick={() => onAction('kept')}>{t('Made it')}</button>
              <button type="button" className="secondary" onClick={() => onAction('end')}>{t('Failed: spell ends')}</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SavePips({ n, kind }: { n: number; kind: 'success' | 'failure' }) {
  return (
    <span className="pips" role="img" aria-label={kind === 'success' ? t('{n} of 3 successes', { n }) : t('{n} of 3 failures', { n })}>
      {[0, 1, 2].map((i) => <span key={i} className={`pip ${kind} ${i < n ? 'on' : ''}`} />)}
    </span>
  );
}

/** Death saving throws, shown while at 0 HP. */
export function DeathSaves({ character: c, onRoll }: { character: CharacterData; onRoll?: (r: DeathSaveResult) => void }) {
  if (c.hpCurrent > 0 && !isDead(c)) return null;
  const dead = isDead(c);
  const stable = isStable(c);
  return (
    <div className={`death-saves ${dead ? 'dead' : stable ? '' : 'dying'}`} role="status">
      <strong className="death-title">{dead ? t('Dead') : stable ? t('Stable at 0 HP') : t('0 HP: Unconscious and dying')}</strong>
      {!dead && (
        <div className="death-rows">
          <span>{t('Successes')}{' '}<SavePips n={c.deathSaves.successes} kind="success" /></span>
          <span>{t('Failures')}{' '}<SavePips n={c.deathSaves.failures} kind="failure" /></span>
        </div>
      )}
      {!dead && !stable && (
        <>
          <p className="muted small">{t('At the start of your turn roll a d20, no modifiers. What did you roll?')}</p>
          {onRoll && (
            <div className="death-buttons">
              <button type="button" className="secondary" onClick={() => onRoll('nat1')}>1</button>
              <button type="button" className="secondary" onClick={() => onRoll('fail')}>{t('2 to 9')}</button>
              <button type="button" className="secondary" onClick={() => onRoll('success')}>{t('10 to 19')}</button>
              <button type="button" className="secondary" onClick={() => onRoll('nat20')}>20</button>
            </div>
          )}
        </>
      )}
      {stable && <p className="muted small">{t('No more death saves. You wake up with 1 HP after 1d4 hours, or when healed.')}</p>}
    </div>
  );
}

/** Compact status for the party list: conditions, concentration, death saves. */
export function StatusChips({ character: c }: { character: CharacterData }) {
  const dead = isDead(c);
  const down = c.hpCurrent === 0 && !dead;
  if (!dead && !down && !c.concentration && c.conditions.length === 0 && c.exhaustion === 0) return null;
  return (
    <span className="status-chips">
      {dead && <span className="status-chip bad">{t('Dead')}</span>}
      {down && (
        <span className="status-chip bad">
          {isStable(c) ? t('Stable') : t('Dying')} <SavePips n={c.deathSaves.successes} kind="success" /> <SavePips n={c.deathSaves.failures} kind="failure" />
        </span>
      )}
      {c.concentration && (
        <span className={`status-chip ${c.concentration.saveDc !== null ? 'warn' : 'conc'}`}>
          ◎ {c.concentration.name}
          {c.concentration.saveDc !== null && ` · ${t('CON save DC {n}', { n: c.concentration.saveDc })}`}
        </span>
      )}
      {c.conditions.map((id) => <span key={id} className="status-chip cond">{conditionName(id)}</span>)}
      {c.exhaustion > 0 && <span className="status-chip cond">{t('Exhaustion {n}', { n: c.exhaustion })}</span>}
    </span>
  );
}
