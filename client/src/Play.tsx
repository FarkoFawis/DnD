import { useRef, useState, type FormEvent } from 'react';
import { ROOM_CODE_LENGTH } from '@dnd/shared';
import type { CampaignSummary, CharacterSummary, ImportSummary } from '@dnd/shared';
import { uploadBackup } from './api.ts';
import { CampaignConfig } from './prep/CampaignConfig.tsx';
import { CharacterLine } from './Characters.tsx';
import { CrownIcon, GearIcon, KeyIcon } from './icons.tsx';
import type { Game } from './useGame.ts';
import { getLanguage, plural, t, tj } from './i18n.tsx';

export type PlayPage = 'join' | 'host';

/**
 * Play: two big buttons, Join and Host. Tapping one sends both off to their
 * sides while the picture behind glides on, then that page rises from the
 * bottom. Back is always bottom left. App.tsx owns which page is open (`page`)
 * and when this one is leaving (`leaving`, `to`), because the picture behind
 * belongs to the home screen too.
 */
export function Play({
  game,
  onBack,
  onCharacters,
  page,
  onPage,
  from,
  to,
}: {
  game: Game;
  onBack: () => void;
  onCharacters: () => void;
  /** null: the two buttons. */
  page: PlayPage | null;
  onPage: (page: PlayPage | null) => void;
  /** The screen before this one and, while this one is leaving, the next: they decide which way things move. */
  from: string | null;
  to: string | null;
}) {
  // People who run campaigns usually want to host; everyone else joins.
  const [mode, setMode] = useState<'join' | 'host'>(game.campaigns?.length ? 'host' : 'join');
  /** The campaign the DM is planning ("Configure"). */
  const [configuring, setConfiguring] = useState<CampaignSummary | null>(null);
  if (configuring) {
    return <CampaignConfig game={game} campaign={configuring} onBack={() => setConfiguring(null)} />;
  }
  const scene = { 'data-from': from ?? undefined, 'data-to': to ?? undefined };
  if (page === null) {
    return (
      <section className={`play-screen ${to ? 'leaving' : ''}`} aria-label={t('Play')} {...scene}>
        <h2 className="scene-title"><span>{t('Play')}</span></h2>
        <div className="play-choices">
          {/* `mode` is the likelier of the two (see above), and after that the one picked last: it gets the gold edge. */}
          <button
            type="button"
            className={`play-choice join ${mode === 'join' ? 'likely' : ''}`}
            onClick={() => {
              setMode('join');
              onPage('join');
            }}
          >
            <span className="home-icon" aria-hidden><KeyIcon /></span>
            <strong>{t('Join')}</strong>
            <span className="play-choice-sub hint">{t('With the code from your DM')}</span>
          </button>
          <button
            type="button"
            className={`play-choice host ${mode === 'host' ? 'likely' : ''}`}
            onClick={() => {
              setMode('host');
              onPage('host');
            }}
          >
            <span className="home-icon" aria-hidden><CrownIcon /></span>
            <strong>{t('Host')}</strong>
            <span className="play-choice-sub hint">{t('Open a lobby as the DM')}</span>
          </button>
        </div>
        <div className="scene-bar">
          <BackButton onClick={onBack} />
        </div>
      </section>
    );
  }
  return (
    <section key={page} className={`play-screen play-page ${to ? 'leaving' : ''}`} aria-label={page === 'join' ? t('Join') : t('Host')} {...scene}>
      <h2 className="scene-title"><span>{page === 'join' ? t('Join') : t('Host')}</span></h2>
      <div className="play-frame">
        {page === 'join' ? <Join game={game} onCharacters={onCharacters} /> : <Host game={game} onConfigure={setConfiguring} />}
      </div>
      <div className="scene-bar">
        <BackButton onClick={() => onPage(null)} />
      </div>
    </section>
  );
}

/** The way back, always in the same place: bottom left, big enough for a thumb. */
function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="back-button" onClick={onClick}>
      <span aria-hidden>‹</span> {t('Back')}
    </button>
  );
}

function Join({ game, onCharacters }: { game: Game; onCharacters: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  /** After a valid code: pick which character joins. */
  const [choice, setChoice] = useState<{ code: string; campaign: string; characters: CharacterSummary[] } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await game.peek(code);
    if (!res.ok) game.setError(res.error);
    else if (res.rejoin) await game.join(code);
    else setChoice({ code, campaign: res.campaign.name, characters: res.characters });
    setBusy(false);
  };

  if (choice) {
    return (
      <>
        <h3 className="panel-heading">{t('Who are you playing tonight?')}</h3>
        <p className="muted small">{tj('Joining {campaign}.', { campaign: <strong>{choice.campaign}</strong> })}</p>
        {choice.characters.length === 0 ? (
          <p className="notice">
            {t("You have no free characters. Create one first (characters already in another session can't join).")}
          </p>
        ) : (
          <ul className="rows">
            {choice.characters.map((c) => (
              <li key={c.id}>
                <button className="row-button" disabled={busy} onClick={async () => {
                  setBusy(true);
                  await game.join(choice.code, c.id);
                  setBusy(false);
                }}>
                  <CharacterLine character={c} />
                  <span className="chev">›</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="row-gap">
          <button className="ghost" onClick={() => setChoice(null)}>{t('Other code')}</button>
          <button className="ghost" onClick={onCharacters}>{t('Characters')}</button>
        </div>
      </>
    );
  }

  return (
    <form onSubmit={submit}>
      <h3 className="panel-heading">{t('Join a session')}</h3>
      <label>
        {t("Code from the DM's phone")}
        <input
          className="code-input"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={ROOM_CODE_LENGTH + 2}
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          placeholder="ABCDE"
          required
        />
      </label>
      <button className="primary" type="submit" disabled={busy || game.status !== 'online'}>
        {t('Next')}
      </button>
    </form>
  );
}

function Host({ game, onConfigure }: { game: Game; onConfigure: (c: CampaignSummary) => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    if (await game.createCampaign(name)) setName('');
    setBusy(false);
  };
  return (
    <>
      <h3 className="panel-heading">{t('Host as the DM')}</h3>
      <p className="muted small hint">{t('Tap a campaign to open its lobby. The gear is for preparing it: handouts, NPCs, log and backup.')}</p>
      {game.campaigns === null ? (
        <p className="muted">{t('Loading campaigns…')}</p>
      ) : game.campaigns.length === 0 ? (
        <p className="muted">{t('No campaigns yet. Create your first one below.')}</p>
      ) : (
        <ul className="rows">
          {game.campaigns.map((c) => (
            <li key={c.id} className="campaign-row">
              <button className="row-button" onClick={() => void game.host(c.id)} disabled={game.status !== 'online'}>
                <span className="grow">
                  <strong>{c.name}</strong>
                  <span className="muted small block">
                    {c.lastPlayedAt ? t('Last played {date}', { date: formatDate(c.lastPlayedAt) }) : t('Not played yet')}
                  </span>
                  {c.liveCode && <span className="badge">{t('Live · {code}', { code: c.liveCode })}</span>}
                </span>
              </button>
              <button className="round-button" aria-label={t('Configure {name}', { name: c.name })} title={t('Configure')} onClick={() => onConfigure(c)} disabled={game.status !== 'online'}>
                <GearIcon />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={create} className="new-campaign">
        <label>
          {t('New campaign')}
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('e.g. Lost Mine')} required />
        </label>
        <button className="secondary" type="submit" disabled={busy || game.status !== 'online'}>
          {t('Create')}
        </button>
      </form>
      <LoadBackup game={game} />
    </>
  );
}

/** Brings a campaign back from a backup file (made in Configure → Backup). */
function LoadBackup({ game }: { game: Game }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<ImportSummary | null>(null);

  const load = async (file: File) => {
    setBusy(true);
    setDone(null);
    let res = await uploadBackup(file);
    if (!res.ok && res.missingPlayers?.length) {
      const names = res.missingPlayers.join(', ');
      if (window.confirm(t('These players have no account here: {names}.\n\nLoad the backup without their characters? To keep them, cancel, add the accounts first (npm run users -- add {list}) and load the file again.', { names, list: res.missingPlayers.join(' ') }))) {
        res = await uploadBackup(file, true);
      } else {
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    if (!res.ok) return game.setError(res.error);
    setDone(res.summary);
    void game.refreshCampaigns();
    void game.refreshCharacters();
  };

  return (
    <div className="load-backup">
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void load(file);
        }}
      />
      <button className="ghost" disabled={busy || game.status !== 'online'} onClick={() => input.current?.click()}>
        {busy ? t('Loading the backup…') : t('Load a backup file')}
      </button>
      {done && (
        <div className="notice good" role="status">
          {tj('{campaign} is back: {handouts}, {npcs}, the log of {sessions} and {characters}.', {
            campaign: <strong>{done.campaign.name}</strong>,
            handouts: plural(done.handouts, '{n} handout', '{n} handouts'),
            npcs: plural(done.npcs, '{n} NPC', '{n} NPCs'),
            sessions: plural(done.sessions, '{n} session', '{n} sessions'),
            characters: `${plural(done.characters.length, '{n} character', '{n} characters')}${done.characters.length > 0 ? ` (${done.characters.join(', ')})` : ''}`,
          })}
          {done.existing.length > 0 && <span className="block">{t('Still here and left as they are: {names}.', { names: done.existing.join(', ') })}</span>}
          {done.withoutAccount.length > 0 && <span className="block">{t('Left out, no account: {names}.', { names: done.withoutAccount.join(', ') })}</span>}
          {done.skipped > 0 && <span className="block">{plural(done.skipped, '{n} entry could not be read and was left out.', '{n} entries could not be read and were left out.')}</span>}
        </div>
      )}
    </div>
  );
}

function formatDate(sqliteUtc: string): string {
  const d = new Date(sqliteUtc.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString(getLanguage(), { day: 'numeric', month: 'short', year: 'numeric' });
}
