/**
 * DM: "Who is best at this?" The party in order of a skill, a saving throw or
 * a passive score, best first, so the DM sees at a glance whom to ask or who
 * notices something.
 */
import { useState } from 'react';
import { ABILITIES, ABILITY_NAMES, PASSIVE_SKILLS, SKILLS, SKILL_KEYS, formatModifier, partyCheckName, rankParty, type PartyCheck, type SessionPlayer } from '@dnd/shared';
import { BottomSheet } from './BottomSheet.tsx';
import { t } from './i18n.tsx';

export function PartyChecks({ players, onClose }: { players: SessionPlayer[]; onClose: () => void }) {
  const [check, setCheck] = useState<PartyCheck>('passive:perception');
  const passive = check.startsWith('passive:');
  const ranked = rankParty(players.map((p) => ({ ...p, sheet: p.character })), check);
  return (
    <BottomSheet label={t('Who is best at this?')} className="party-checks" onClose={onClose}>
      {(close) => (
        <>
          <h2 className="info-title">{t('Who is best at…')}</h2>
          <label className="check-pick">
            <span className="sr-only">{t('Skill, save or passive score')}</span>
            <select value={check} onChange={(e) => setCheck(e.target.value as PartyCheck)}>
              <optgroup label={t('Passive scores')}>
                {PASSIVE_SKILLS.map((s) => <option key={s} value={`passive:${s}`}>{t('Passive {name}', { name: t(SKILLS[s].name) })}</option>)}
              </optgroup>
              <optgroup label={t('Skills')}>
                {SKILL_KEYS.map((s) => <option key={s} value={`skill:${s}`}>{t(SKILLS[s].name)}</option>)}
              </optgroup>
              <optgroup label={t('Saving throws')}>
                {ABILITIES.map((a) => <option key={a} value={`save:${a}`}>{t('{name} save', { name: t(ABILITY_NAMES[a]) })}</option>)}
              </optgroup>
              <optgroup label={t('Other')}>
                <option value="initiative">{t('Initiative')}</option>
              </optgroup>
            </select>
          </label>
          {/* Keyed by the check: the list comes in anew, best first. */}
          <ol key={check} className="rows rank-rows" aria-label={partyCheckName(check)}>
            {ranked.map((r) => {
              const c = r.character;
              // Exhaustion takes 2 per level off every d20 roll; a passive score has no roll.
              const tired = !passive && c.exhaustion > 0;
              return (
                <li key={r.user.id} className={r.best ? 'best' : ''}>
                  <span className="rank-value">{passive ? r.value : formatModifier(r.value)}</span>
                  <span className="grow">
                    <strong>{c.name || r.user.username}</strong>
                    <span className="muted small block">
                      {[r.user.username, r.expert ? t('Expertise') : r.trained ? t('Proficient') : '', tired ? t('Exhaustion −{n}', { n: 2 * c.exhaustion }) : ''].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {r.best && <span className="role-tag best-tag">{t('Best')}</span>}
                </li>
              );
            })}
          </ol>
          <button type="button" className="ghost" onClick={close}>{t('Close')}</button>
        </>
      )}
    </BottomSheet>
  );
}
