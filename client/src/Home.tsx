import { useState } from 'react';
import type { CharacterSummary } from '@dnd/shared';
import { GearIcon, PersonIcon } from './icons.tsx';
import { Portrait } from './Portrait.tsx';
import { Drawer } from './session/SessionDrawer.tsx';
import type { Game } from './useGame.ts';

export type HomeTarget = 'play' | 'characters' | 'settings';

/** The hero of the home screen: the newest character with a picture of its own, else the newest one. */
function heroOf(characters: CharacterSummary[]): CharacterSummary | undefined {
  return [...characters].reverse().find((c) => c.data.portrait) ?? characters.at(-1);
}

/**
 * The picture behind the home screen. It lives outside `Home` (App.tsx puts it
 * behind both the home screen and Play) so it can stay and glide sideways,
 * like a camera moving along a scene, while the screens in front change.
 */
export function HeroBackdrop({ game }: { game: Game }) {
  const hero = heroOf(game.characters ?? []);
  return (
    <div className="home-hero" aria-hidden>
      {hero ? <Portrait characterId={hero.id} character={hero.data} className="home-hero-art" /> : <HeroDie />}
    </div>
  );
}

/**
 * The screen after logging in. Top left: who you are (tap for the sidebar
 * with the connection status and Log out). Down the left: Characters and
 * Settings as round buttons. On the right, behind them: one of your
 * characters as the picture of the screen. Bottom right: Play.
 */
export function Home({
  game,
  username,
  onPick,
  onSignOut,
  leaving,
}: {
  game: Game;
  username: string;
  onPick: (t: HomeTarget) => void;
  onSignOut: () => void;
  /** Another screen is about to open: everything slides off to its side first. */
  leaving?: boolean;
}) {
  const [menu, setMenu] = useState(false);
  const characters = game.characters ?? [];
  const hero = heroOf(characters);
  const count = characters.length;

  return (
    <section className={`home ${leaving ? 'leaving' : ''}`}>
      <Drawer game={game} open={menu} onClose={() => setMenu(false)}>
        <p className="muted small drawer-label">Logged in as</p>
        <p className="drawer-campaign">{username}</p>
        <p className="muted small drawer-label">Characters</p>
        <p className="drawer-campaign">{game.characters === null ? '…' : count}</p>
        <div className="drawer-spacer" />
        <button
          className="ghost"
          onClick={() => {
            if (window.confirm(`Log out ${username}?`)) onSignOut();
          }}
        >
          Log out
        </button>
      </Drawer>

      <button type="button" className="home-user" aria-label={`${username}: open the menu`} aria-expanded={menu} onClick={() => setMenu(true)}>
        <span className="home-avatar">
          {(username.trim()[0] ?? '?').toUpperCase()}
          <i className={`home-status status-${game.status}`} aria-label={game.status} />
        </span>
        <span className="home-username">{username}</span>
      </button>

      <nav className="home-nav" aria-label="Menu">
        <button type="button" className="home-item" onClick={() => onPick('characters')}>
          <span className="home-icon" aria-hidden>
            <PersonIcon />
          </span>
          <span className="home-label">
            Characters
            <span className="home-sub">{game.characters === null ? ' ' : count === 0 ? 'Create your first one' : `${count} ${count === 1 ? 'character' : 'characters'}`}</span>
          </span>
        </button>
        <button type="button" className="home-item" onClick={() => onPick('settings')}>
          <span className="home-icon" aria-hidden>
            <GearIcon />
          </span>
          <span className="home-label">
            Settings
            <span className="home-sub hint">Themes, helper texts, dice roller</span>
          </span>
        </button>
      </nav>

      <div className="home-bottom">
        {hero ? (
          <button type="button" className="home-hero-tag" onClick={() => onPick('characters')}>
            <strong>{hero.data.name || 'Unnamed'}</strong>
            <span className="muted small">{[hero.data.species, hero.data.className].filter(Boolean).join(' ') || 'Adventurer'} · Level {hero.data.level}</span>
          </button>
        ) : (
          <span />
        )}
        <button type="button" className="home-play" onClick={() => onPick('play')}>
          Play
          <span className="home-play-sub hint">Join or host</span>
        </button>
      </div>
    </section>
  );
}

/** Shown while there is no character yet: a twenty-sided die, drawn in lines. */
function HeroDie() {
  return (
    <svg className="home-hero-die" viewBox="0 0 200 220">
      <path d="M100 10 182 58v104l-82 48-82-48V58z" />
      <path d="M100 10 60 82h80zM60 82 18 58M140 82l42-24M60 82l40 76 40-76M100 158v52M60 82 18 162M140 82l42 80M100 158l-82 4M100 158l82 4" />
      <text x="100" y="118" textAnchor="middle">20</text>
    </svg>
  );
}
