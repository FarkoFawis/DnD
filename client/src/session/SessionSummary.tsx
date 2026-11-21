import { formatDuration, type SessionSummary } from '@dnd/shared';
import { useClosing } from '../fx/hooks.ts';
import { t, tx } from '../i18n.tsx';

/**
 * The end of a session, on every phone that was in it: the evening in numbers,
 * from the session log. It covers the home screen until it is closed.
 * `mine`: the names of this player's own characters, whose rows are marked.
 */
export function SessionSummaryScreen({ summary, mine, onClose }: { summary: SessionSummary; mine: string[]; onClose: () => void }) {
  const { closing, close } = useClosing(onClose, 200);
  const rests = [
    summary.rests.short > 0 ? t('{n} short', { n: summary.rests.short }) : '',
    summary.rests.long > 0 ? t('{n} long', { n: summary.rests.long }) : '',
  ].filter(Boolean);
  const quiet = (c: SessionSummary['characters'][number]) => !c.damage && !c.healed && !c.downs && !c.used;
  return (
    <div className={`summary-screen ${closing ? 'closing' : ''}`} role="dialog" aria-modal aria-label={t('Session summary')}>
      <div className="summary-scroll">
        <p className="summary-kicker">{t('Session {n} · the end', { n: summary.session })}</p>
        <h2 className="summary-title">{summary.campaign}</h2>
        <span className="summary-rule" aria-hidden><i /></span>
        <dl className="summary-stats">
          <div><dt>{t('Hours played')}</dt><dd>{formatDuration(summary.minutes)}</dd></div>
          <div><dt>{summary.fights === 1 ? t('Fight') : t('Fights')}</dt><dd>{summary.fights}</dd></div>
          <div><dt>{summary.rounds === 1 ? t('Round') : t('Rounds')}</dt><dd>{summary.rounds}</dd></div>
          <div><dt>{t('Defeated')}</dt><dd>{summary.defeated}</dd></div>
        </dl>
        {rests.length > 0 && <p className="muted small center summary-rests">{t('Rests of the party: {rests}', { rests: rests.join(', ') })}</p>}
        {summary.characters.length > 0 && <h3 className="section-label">{t('The party')}</h3>}
        <ul className="summary-party">
          {summary.characters.map((c, i) => (
            <li key={`${c.who}-${i}`} className={mine.includes(c.who) ? 'me' : ''}>
              <p className="summary-who">
                <strong className="grow">{c.who}</strong>
                {c.level !== null && <span className="action-chip">{t('Reached level {n}', { n: c.level })}</span>}
              </p>
              {quiet(c) ? (
                <p className="muted small">{t('A quiet evening.')}</p>
              ) : (
                <dl className="summary-nums">
                  <div><dd>{c.damage}</dd><dt>{t('damage taken')}</dt></div>
                  <div><dd>{c.healed}</dd><dt>{t('HP regained')}</dt></div>
                  <div><dd>{c.used}</dd><dt>{t('spells and abilities')}</dt></div>
                  <div className={c.downs > 0 ? 'bad' : ''}><dd>{c.downs}</dd><dt>{c.downs === 1 ? t('time at 0 HP') : t('times at 0 HP')}</dt></div>
                </dl>
              )}
              {c.favourite && <p className="muted small">{t('Most used: {name}', { name: c.favourite })}</p>}
              {c.loot.length > 0 && <p className="muted small">{t('Got: {items}', { items: c.loot.map((l) => tx(l)).join(', ') })}</p>}
            </li>
          ))}
        </ul>
        <p className="muted small center">{t('The session is over. All characters are saved.')}</p>
      </div>
      <button type="button" className="primary handout-close" onClick={close}>{t('Done')}</button>
    </div>
  );
}
