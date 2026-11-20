import { formatDuration, type SessionSummary } from '@dnd/shared';
import { useClosing } from '../fx/hooks.ts';

/**
 * The end of a session, on every phone that was in it: the evening in numbers,
 * from the session log. It covers the home screen until it is closed.
 * `mine`: the names of this player's own characters, whose rows are marked.
 */
export function SessionSummaryScreen({ summary, mine, onClose }: { summary: SessionSummary; mine: string[]; onClose: () => void }) {
  const { closing, close } = useClosing(onClose, 200);
  const rests = [
    summary.rests.short > 0 ? `${summary.rests.short} short` : '',
    summary.rests.long > 0 ? `${summary.rests.long} long` : '',
  ].filter(Boolean);
  const quiet = (c: SessionSummary['characters'][number]) => !c.damage && !c.healed && !c.downs && !c.used;
  return (
    <div className={`summary-screen ${closing ? 'closing' : ''}`} role="dialog" aria-modal aria-label="Session summary">
      <div className="summary-scroll">
        <p className="summary-kicker">Session {summary.session} · the end</p>
        <h2 className="summary-title">{summary.campaign}</h2>
        <span className="summary-rule" aria-hidden><i /></span>
        <dl className="summary-stats">
          <div><dt>Hours played</dt><dd>{formatDuration(summary.minutes)}</dd></div>
          <div><dt>{summary.fights === 1 ? 'Fight' : 'Fights'}</dt><dd>{summary.fights}</dd></div>
          <div><dt>{summary.rounds === 1 ? 'Round' : 'Rounds'}</dt><dd>{summary.rounds}</dd></div>
          <div><dt>Defeated</dt><dd>{summary.defeated}</dd></div>
        </dl>
        {rests.length > 0 && <p className="muted small center summary-rests">Rests of the party: {rests.join(', ')}</p>}
        {summary.characters.length > 0 && <h3 className="section-label">The party</h3>}
        <ul className="summary-party">
          {summary.characters.map((c, i) => (
            <li key={`${c.who}-${i}`} className={mine.includes(c.who) ? 'me' : ''}>
              <p className="summary-who">
                <strong className="grow">{c.who}</strong>
                {c.level !== null && <span className="action-chip">Reached level {c.level}</span>}
              </p>
              {quiet(c) ? (
                <p className="muted small">A quiet evening.</p>
              ) : (
                <dl className="summary-nums">
                  <div><dd>{c.damage}</dd><dt>damage taken</dt></div>
                  <div><dd>{c.healed}</dd><dt>HP regained</dt></div>
                  <div><dd>{c.used}</dd><dt>spells and abilities</dt></div>
                  <div className={c.downs > 0 ? 'bad' : ''}><dd>{c.downs}</dd><dt>{c.downs === 1 ? 'time at 0 HP' : 'times at 0 HP'}</dt></div>
                </dl>
              )}
              {c.favourite && <p className="muted small">Most used: {c.favourite}</p>}
              {c.loot.length > 0 && <p className="muted small">Got: {c.loot.join(', ')}</p>}
            </li>
          ))}
        </ul>
        <p className="muted small center">The session is over. All characters are saved.</p>
      </div>
      <button type="button" className="primary handout-close" onClick={close}>Done</button>
    </div>
  );
}
