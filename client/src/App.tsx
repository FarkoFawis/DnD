import { useCallback, useEffect, useState } from 'react';
import type { PublicUser } from '@dnd/shared';
import { logout, me, saveCode, savedToken, saveToken } from './api.ts';
import { Characters } from './Characters.tsx';
import { useScene } from './fx/hooks.ts';
import { HeroBackdrop, Home, type HomeTarget } from './Home.tsx';
import { Play, type PlayPage } from './Play.tsx';
import { Login } from './Login.tsx';
import { SessionView } from './SessionView.tsx';
import { SettingsScreen } from './SettingsScreen.tsx';
import { StatusPill } from './StatusPill.tsx';
import { useGame, type Status } from './useGame.ts';

type Auth = { token: string; user: PublicUser };

export function App() {
  const [auth, setAuth] = useState<Auth | null>(null);
  const [checking, setChecking] = useState(() => savedToken() !== null);

  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    const token = savedToken();
    if (!token) return;
    let timer: ReturnType<typeof setTimeout>;
    const check = () =>
      me(token)
        .then((user) => {
          if (user) setAuth({ token, user });
          else saveToken(null);
          setChecking(false);
        })
        // Server unreachable (e.g. phone just woke up): keep the login and retry.
        .catch(() => {
          setUnreachable(true);
          timer = setTimeout(check, 3000);
        });
    void check();
    return () => clearTimeout(timer);
  }, []);

  const signOut = useCallback(() => {
    if (auth) void logout(auth.token);
    saveToken(null);
    saveCode(null);
    setAuth(null);
  }, [auth]);

  if (checking) {
    return (
      <Shell>
        <p className="muted">{unreachable ? 'Cannot reach the server. Retrying…' : 'Loading…'}</p>
      </Shell>
    );
  }
  if (!auth) {
    return (
      <Shell>
        <Login
          onLoggedIn={(result) => {
            saveToken(result.token);
            setAuth(result);
          }}
        />
      </Shell>
    );
  }
  return <LoggedIn auth={auth} onSignOut={signOut} />;
}

/** `join` and `host` are the two pages behind the buttons of Play. */
type Screen = 'home' | HomeTarget | PlayPage;
/** Home and Play share the picture behind them: it stays while they change in front of it. */
const ON_STAGE: readonly Screen[] = ['home', 'play', 'join', 'host'];

function LoggedIn({ auth, onSignOut }: { auth: Auth; onSignOut: () => void }) {
  const game = useGame(auth.token, onSignOut);
  // `to`: the screen that is about to open, while the current one is still sliding away.
  const { scene: screen, from, to, go, jump } = useScene<Screen>('home');
  const home = () => go('home');
  /** From a panel, which has already faded away by itself. */
  const homeNow = () => go('home', true);
  // Whoever leaves a session, or whose session ends, lands on the home screen again.
  const inSession = !!game.session;
  useEffect(() => {
    if (inSession) jump('home');
  }, [inSession, jump]);
  // The bar at the top is only there in the lobby. The home screen keeps what was in it in its sidebar,
  // and once the session starts the screen is only the game (the rest is in that sidebar too).
  const inLobby = !!game.session && !game.session.started;
  return (
    <Shell status={game.status} hideHeader={!inLobby} full={!game.session}>
      {game.error && (
        <p className="error" role="alert" onClick={() => game.setError(null)}>
          {game.error}
        </p>
      )}
      {!game.session && screen !== 'home' && game.status !== 'online' && (
        <p className="offline-note"><StatusPill status={game.status} /></p>
      )}
      {game.session ? (
        <SessionView game={game} session={game.session} myId={auth.user.id} />
      ) : game.rejoining ? (
        <p className="muted">Getting you back into your session…</p>
      ) : screen === 'characters' ? (
        <Characters game={game} onBack={homeNow} />
      ) : screen === 'settings' ? (
        <SettingsScreen onBack={homeNow} />
      ) : (
        // `data-scene` is where the picture behind should be: it glides there (motion.css).
        <div className="stage" data-scene={to && ON_STAGE.includes(to) ? to : to ? 'away' : screen}>
          <HeroBackdrop game={game} />
          {screen === 'home' ? (
            <Home game={game} username={auth.user.username} onPick={go} onSignOut={onSignOut} leaving={to !== null} />
          ) : (
            <Play
              game={game}
              page={screen === 'play' ? null : (screen as PlayPage)}
              onPage={(page) => go(page ?? 'play')}
              onBack={home}
              onCharacters={() => go('characters')}
              from={from}
              to={to}
            />
          )}
        </div>
      )}
    </Shell>
  );
}

function Shell(props: {
  children: React.ReactNode;
  status?: Status;
  hideHeader?: boolean;
  /** The screen fills the phone from top to bottom (home screen, panels). */
  full?: boolean;
}) {
  return (
    <main className={`app ${props.full ? 'app-full' : ''}`}>
      {!props.hideHeader && <header className="top">
        <h1>DnD Table</h1>
        <div className="top-right">{props.status && <StatusPill status={props.status} />}</div>
      </header>}
      {props.children}
    </main>
  );
}
