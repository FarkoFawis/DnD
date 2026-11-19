import { useCallback, useEffect, useState } from 'react';
import type { PublicUser } from '@dnd/shared';
import { logout, me, saveCode, savedToken, saveToken } from './api.ts';
import { Characters } from './Characters.tsx';
import { Play } from './Play.tsx';
import { Login } from './Login.tsx';
import { SessionView } from './SessionView.tsx';
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

type Screen = 'home' | 'play' | 'characters' | 'settings';

function LoggedIn({ auth, onSignOut }: { auth: Auth; onSignOut: () => void }) {
  const game = useGame(auth.token, onSignOut);
  const [screen, setScreen] = useState<Screen>('home');
  // Once the session starts, the screen is only the game (party for the DM, sheet for players); the rest moves into a sidebar.
  const dmInSession = !!game.session?.started;
  return (
    <Shell status={game.status} user={auth.user.username} onSignOut={game.session ? undefined : onSignOut} hideHeader={dmInSession}>
      {game.error && (
        <p className="error" role="alert" onClick={() => game.setError(null)}>
          {game.error}
        </p>
      )}
      {game.session ? (
        <SessionView game={game} session={game.session} myId={auth.user.id} />
      ) : game.rejoining ? (
        <p className="muted">Getting you back into your session…</p>
      ) : screen === 'play' ? (
        <Play game={game} onBack={() => setScreen('home')} onCharacters={() => setScreen('characters')} />
      ) : screen === 'characters' ? (
        <Characters game={game} onBack={() => setScreen('home')} />
      ) : screen === 'settings' ? (
        <>
          <button className="back" onClick={() => setScreen('home')}>‹ Home</button>
          <section className="card">
            <h2 className="card-title">Settings</h2>
            <p className="muted">Nothing here yet.</p>
          </section>
        </>
      ) : (
        <HomeMenu username={auth.user.username} onPick={setScreen} />
      )}
    </Shell>
  );
}

function HomeMenu({ username, onPick }: { username: string; onPick: (s: Screen) => void }) {
  return (
    <section className="home-menu">
      {username && <p className="muted center">Welcome back, {username}.</p>}
      <button className="menu-button primary" onClick={() => onPick('play')}>
        Play
        <span className="small">Join or host a session</span>
      </button>
      <button className="menu-button" onClick={() => onPick('characters')}>
        Characters
        <span className="small">Create and edit your characters</span>
      </button>
      <button className="menu-button" onClick={() => onPick('settings')}>
        Settings
      </button>
    </section>
  );
}

function Shell(props: {
  children: React.ReactNode;
  status?: Status;
  user?: string;
  onSignOut?: () => void;
  hideHeader?: boolean;
}) {
  return (
    <main className="app">
      {!props.hideHeader && <header className="top">
        <h1>DnD Table</h1>
        <div className="top-right">
          {props.status && <StatusPill status={props.status} />}
          {props.onSignOut && (
            <button className="link" onClick={props.onSignOut}>
              Log out{props.user ? ` ${props.user}` : ''}
            </button>
          )}
        </div>
      </header>}
      {props.children}
    </main>
  );
}
