import { useCallback, useEffect, useState } from 'react';
import { buildRecap, describeLogEntry, recapLines, type LogEntry } from '@dnd/shared';
import type { Game } from '../useGame.ts';

/** `active`: false while the log is on a page that is not open; it loads again when the page opens. */
function useLog(game: Game, campaignId: string, active = true) {
  const { call, status } = game;
  const [log, setLog] = useState<{ current: LogEntry[]; previous: LogEntry[] } | null>(null);
  const reload = useCallback(async () => {
    const res = await call<{ current: LogEntry[]; previous: LogEntry[] }>((s, done) => s.emit('log:get', { campaignId }, done));
    if (res.ok) setLog({ current: res.current, previous: res.previous });
  }, [call, campaignId]);
  useEffect(() => {
    if (status === 'online' && active) void reload();
  }, [status, reload, active]);
  return { log, reload };
}

const toDate = (sqliteUtc: string) => new Date(sqliteUtc.replace(' ', 'T') + 'Z');
const time = (at: string) => toDate(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const day = (at: string) => toDate(at).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

/** "Last time on ...": what happened in the previous session, ready to read out. Renders nothing if there is none. */
export function Recap({ game, campaign }: { game: Game; campaign: { id: string; name: string } }) {
  const { log } = useLog(game, campaign.id);
  const recap = log && buildRecap(log.previous);
  if (!log || !recap) return null;
  return (
    <section className="card recap">
      <p className="muted small">Session {recap.session} · {day(recap.at)}</p>
      <h2 className="card-title">Last time on {campaign.name}…</h2>
      <RecapBody entries={log.previous} />
    </section>
  );
}

function RecapBody({ entries }: { entries: LogEntry[] }) {
  const recap = buildRecap(entries);
  const lines = recap ? recapLines(recap) : [];
  return (
    <>
      {lines.length === 0 ? (
        <p className="muted">Nothing was recorded.</p>
      ) : (
        <ul className="recap-lines">{lines.map((l) => <li key={l}>{l}</li>)}</ul>
      )}
      <details className="log-details">
        <summary>Everything that happened ({entries.length})</summary>
        <LogList entries={entries} />
      </details>
    </>
  );
}

function LogList({ entries }: { entries: LogEntry[] }) {
  return (
    <ol className="log-list">
      {entries.map((e) => (
        <li key={e.id} className={`log-${e.kind}`}>
          <span className="log-time">{time(e.at)}</span>
          <span>{describeLogEntry(e)}</span>
        </li>
      ))}
    </ol>
  );
}

/** The Log tab: tonight's session so far, and the recap of the one before. */
export function SessionLog({ game, campaign, active }: { game: Game; campaign: { id: string; name: string }; active?: boolean }) {
  const { log, reload } = useLog(game, campaign.id, active);
  if (!log) return <p className="muted">Loading…</p>;
  const previous = buildRecap(log.previous);
  return (
    <>
      <p className="muted small">
        Damage, healing, loot, fights and handouts are written down automatically while a session runs.
      </p>
      {log.current.length > 0 && (
        <>
          <h3>This session <button className="link" onClick={() => void reload()}>Refresh</button></h3>
          <LogList entries={[...log.current].reverse()} />
        </>
      )}
      {previous ? (
        <>
          <h3>Last time · session {previous.session}, {day(previous.at)}</h3>
          <RecapBody entries={log.previous} />
        </>
      ) : (
        log.current.length === 0 && <p className="muted mt">Nothing yet. The log starts with your first session.</p>
      )}
    </>
  );
}
