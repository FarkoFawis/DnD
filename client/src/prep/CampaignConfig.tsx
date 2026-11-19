import { useRef, useState, type FormEvent } from 'react';
import {
  ABILITIES,
  DEFAULT_NPC,
  PREP_LIMITS,
  abilityModifier,
  formatModifier,
  npcInitiative,
  type Handout,
  type Npc,
  type SessionState,
} from '@dnd/shared';
import type { Game } from '../useGame.ts';
import { uploadImage } from './image.ts';
import { NumberField } from './NumberField.tsx';
import { SessionLog } from './SessionLog.tsx';
import { usePrep, type Prep } from './usePrep.ts';

export type ConfigTab = 'handouts' | 'npcs' | 'log';

/**
 * "Configure": the DM plans a campaign ahead. Handouts (pictures and text to
 * put on the players' phones), NPCs and opponents, and the session log.
 */
export function CampaignConfig(props: {
  game: Game;
  campaign: { id: string; name: string };
  onBack: () => void;
  backLabel?: string;
}) {
  const { game, campaign } = props;
  const prep = usePrep(game, campaign.id);
  return (
    <>
      <button className="back" onClick={props.onBack}>‹ {props.backLabel ?? 'Back'}</button>
      <section className="card">
        <p className="muted small">Configure</p>
        <h2 className="card-title">{campaign.name}</h2>
        <ConfigTabs game={game} campaign={campaign} prep={prep} />
      </section>
    </>
  );
}

/**
 * The three tabs of the campaign prep. Also sits on the DM's Tools page
 * during a session, where handouts get a "Show" button.
 */
export function ConfigTabs(props: {
  game: Game;
  campaign: { id: string; name: string };
  prep: Prep;
  /** The running session, when used inside it. */
  session?: SessionState;
  /** False while the page holding the tabs is not open. */
  active?: boolean;
}) {
  const { game, campaign, prep, session } = props;
  const [tab, setTab] = useState<ConfigTab>('handouts');
  return (
    <>
      <div className="tabs tabs3" role="tablist">
        <button role="tab" aria-selected={tab === 'handouts'} onClick={() => setTab('handouts')}>Handouts</button>
        <button role="tab" aria-selected={tab === 'npcs'} onClick={() => setTab('npcs')}>NPCs</button>
        <button role="tab" aria-selected={tab === 'log'} onClick={() => setTab('log')}>Log</button>
      </div>
      {prep.error && (
        <p className="error" role="alert" onClick={() => prep.setError(null)}>{prep.error}</p>
      )}
      {tab === 'log' ? (
        <SessionLog game={game} campaign={campaign} active={props.active} />
      ) : prep.prep === null ? (
        <p className="muted">Loading…</p>
      ) : tab === 'handouts' ? (
        <Handouts game={game} campaignId={campaign.id} prep={prep} handouts={prep.prep.handouts} session={session} />
      ) : (
        <Npcs prep={prep} npcs={prep.prep.npcs} />
      )}
    </>
  );
}

// ---------- handouts ----------

function Handouts(props: {
  game: Game;
  campaignId: string;
  prep: Prep;
  handouts: Handout[];
  session?: SessionState;
}) {
  const { game, prep, handouts, session } = props;
  /** 'new' or the id of the handout being edited. */
  const [editing, setEditing] = useState<string | null>(null);
  const live = session?.started ? session : undefined;

  const show = async (handoutId: string | null) => {
    const res = await game.call<object>((s, done) => s.emit('handout:show', { handoutId }, done));
    prep.setError(res.ok ? null : res.error);
  };

  if (editing) {
    const current = handouts.find((h) => h.id === editing);
    return (
      <HandoutEditor
        key={editing}
        game={game}
        campaignId={props.campaignId}
        prep={prep}
        handout={current}
        onDone={() => setEditing(null)}
      />
    );
  }
  return (
    <>
      <p className="muted small hint">
        {live
          ? 'Show a picture or a text on every player’s phone.'
          : 'Pictures and texts you can put on every player’s phone during the session: maps, letters, portraits, riddles.'}
      </p>
      {handouts.length === 0 && <p className="muted mt">No handouts yet.</p>}
      <ul className="list">
        {handouts.map((h) => {
          const showing = live?.handout?.id === h.id;
          return (
            <li key={h.id} className={`prep-row ${showing ? 'showing' : ''}`}>
              <button className="prep-main" onClick={() => setEditing(h.id)} aria-label={`Edit ${h.title}`}>
                {h.imageUrl ? <img className="thumb" src={h.imageUrl} alt="" loading="lazy" /> : <span className="thumb text-thumb" aria-hidden>Aa</span>}
                <span className="grow">
                  <strong>{h.title}</strong>
                  <span className="muted small block clamp1">{h.text || 'Picture'}</span>
                </span>
              </button>
              {live && (
                <button className={showing ? 'secondary' : 'primary'} onClick={() => void show(showing ? null : h.id)}>
                  {showing ? 'Hide' : 'Show'}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <button className="secondary wide" onClick={() => setEditing('new')}>+ New handout</button>
    </>
  );
}

function HandoutEditor(props: { game: Game; campaignId: string; prep: Prep; handout?: Handout; onDone: () => void }) {
  const { game, prep, handout } = props;
  const [title, setTitle] = useState(handout?.title ?? '');
  const [text, setText] = useState(handout?.text ?? '');
  const [imageUrl, setImageUrl] = useState<string | null>(handout?.imageUrl ?? null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      setImageUrl(await uploadImage(props.campaignId, game.token, file));
      prep.setError(null);
      if (!title.trim()) setTitle(file.name.replace(/\.[^.]+$/, '').slice(0, PREP_LIMITS.titleMaxLength));
    } catch (e) {
      prep.setError((e as Error).message);
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await prep.saveHandout({ id: handout?.id, title, text, imageUrl });
    setBusy(false);
    if (ok) props.onDone();
  };

  return (
    <form onSubmit={save}>
      <label>
        Title (players see it)
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={PREP_LIMITS.titleMaxLength} placeholder="e.g. The mayor's letter" required />
      </label>
      <div>
        <span className="field-label">Picture</span>
        {imageUrl && <img className="handout-preview" src={imageUrl} alt="" />}
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void pick(e.target.files?.[0])} />
        <div className="row-gap">
          <button type="button" className="secondary grow" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? 'Working…' : imageUrl ? 'Change picture' : 'Choose a picture'}
          </button>
          {imageUrl && <button type="button" className="secondary" onClick={() => setImageUrl(null)}>Remove</button>}
        </div>
      </div>
      <label>
        Text
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} maxLength={PREP_LIMITS.handoutTextMaxLength} placeholder="What the players read. Leave empty for a picture only." />
      </label>
      <button className="primary" type="submit" disabled={busy}>Save handout</button>
      <div className="row-gap">
        <button type="button" className="ghost" onClick={props.onDone}>Cancel</button>
        {handout && (
          <button
            type="button"
            className="ghost danger"
            onClick={async () => {
              if (window.confirm(`Delete "${handout.title}"?`) && (await prep.deleteHandout(handout.id))) props.onDone();
            }}
          >
            Delete
          </button>
        )}
      </div>
    </form>
  );
}

// ---------- NPCs & opponents ----------

export function npcSummary(n: Npc): string {
  return `AC ${n.armorClass} · HP ${n.hpMax} · Initiative ${formatModifier(npcInitiative(n))}`;
}

function Npcs({ prep, npcs }: { prep: Prep; npcs: Npc[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  if (editing) {
    return <NpcEditor key={editing} prep={prep} npc={npcs.find((n) => n.id === editing)} onDone={() => setEditing(null)} />;
  }
  return (
    <>
      <p className="muted small hint">
        The people and monsters of your adventure, with their stats and personality. Opponents are ready to pick when you start a fight.
      </p>
      {npcs.length === 0 && <p className="muted mt">Nobody here yet.</p>}
      <ul className="list">
        {npcs.map((n) => (
          <li key={n.id} className="prep-row">
            <button className="prep-main" onClick={() => setEditing(n.id)} aria-label={`Edit ${n.name}`}>
              <span className="grow">
                <strong>{n.name}</strong> <span className={`role-tag ${n.role}`}>{n.role === 'npc' ? 'NPC' : 'Opponent'}</span>
                <span className="muted small block">{npcSummary(n)}</span>
                {n.personality && <span className="muted small block clamp1">{n.personality}</span>}
              </span>
              <span className="chev">›</span>
            </button>
          </li>
        ))}
      </ul>
      <button className="secondary wide" onClick={() => setEditing('new')}>+ New NPC or opponent</button>
    </>
  );
}

function NpcEditor({ prep, npc, onDone }: { prep: Prep; npc?: Npc; onDone: () => void }) {
  const [draft, setDraft] = useState<Omit<Npc, 'id'>>(() => (npc ? { ...npc } : structuredClone(DEFAULT_NPC)));
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Npc>(key: K, value: Npc[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const max = PREP_LIMITS.npcTextMaxLength;

  const save = async (e: FormEvent, asCopy = false) => {
    e.preventDefault();
    setBusy(true);
    const ok = await prep.saveNpc(asCopy ? { ...draft, name: `${draft.name} (copy)`.slice(0, PREP_LIMITS.titleMaxLength) } : { ...draft, id: npc?.id });
    setBusy(false);
    if (ok) onDone();
  };

  return (
    <form onSubmit={save}>
      <label>
        Name
        <input value={draft.name} onChange={(e) => set('name', e.target.value)} maxLength={PREP_LIMITS.titleMaxLength} placeholder="e.g. Goblin, Mayor Aldric" required />
      </label>
      <label>
        Role
        <select value={draft.role} onChange={(e) => set('role', e.target.value === 'npc' ? 'npc' : 'opponent')}>
          <option value="opponent">Opponent (fights the party)</option>
          <option value="npc">NPC (someone to talk to)</option>
        </select>
      </label>
      <div className="grid3">
        <label>Armor Class<NumberField value={draft.armorClass} min={0} max={40} onChange={(v) => set('armorClass', v)} /></label>
        <label>Hit points<NumberField value={draft.hpMax} min={1} max={9999} onChange={(v) => set('hpMax', v)} /></label>
        <label>Speed (ft)<NumberField value={draft.speed} min={0} max={500} onChange={(v) => set('speed', v)} /></label>
      </div>
      <div>
        <span className="field-label">Ability scores</span>
        <div className="abilities">
          {ABILITIES.map((a) => (
            <label key={a} className="ability">
              <span className="ability-name">{a.toUpperCase()}</span>
              <span className="ability-mod">{formatModifier(abilityModifier(draft.abilities[a]))}</span>
              <NumberField aria-label={`${a} score`} value={draft.abilities[a]} min={1} max={30} onChange={(v) => set('abilities', { ...draft.abilities, [a]: v })} />
            </label>
          ))}
        </div>
      </div>
      <label>
        Extra initiative bonus (on top of DEX)
        <NumberField value={draft.initiativeBonus} min={-20} max={20} onChange={(v) => set('initiativeBonus', v)} />
        <span className="small">Rolls initiative with {formatModifier(npcInitiative(draft))}.</span>
      </label>
      <label>
        Personality
        <textarea value={draft.personality} onChange={(e) => set('personality', e.target.value)} rows={3} maxLength={max} placeholder="How they talk and act, what they want, what they fear." />
      </label>
      <label>
        Attacks and abilities
        <textarea value={draft.actions} onChange={(e) => set('actions', e.target.value)} rows={3} maxLength={max} placeholder="e.g. Scimitar +4, 1d6+2 slashing. Nimble Escape." />
      </label>
      <label>
        Notes
        <textarea value={draft.notes} onChange={(e) => set('notes', e.target.value)} rows={2} maxLength={max} placeholder="Loot, secrets, where the party meets them." />
      </label>
      <button className="primary" type="submit" disabled={busy}>Save</button>
      <div className="row-gap">
        <button type="button" className="ghost" onClick={onDone}>Cancel</button>
        {npc && <button type="button" className="ghost" disabled={busy} onClick={(e) => void save(e, true)}>Duplicate</button>}
        {npc && (
          <button
            type="button"
            className="ghost danger"
            onClick={async () => {
              if (window.confirm(`Delete ${npc.name}?`) && (await prep.deleteNpc(npc.id))) onDone();
            }}
          >
            Delete
          </button>
        )}
      </div>
    </form>
  );
}
