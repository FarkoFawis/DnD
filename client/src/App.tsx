import { useCallback, useEffect, useState } from 'react';
import type { PublicUser } from '@dnd/shared';
import { logout, me, saveCode, savedToken, saveToken } from './api.ts';
import { Home } from './Home.tsx';
import { Login } from './Login.tsx';
import { SessionView } from './SessionView.tsx';
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

function LoggedIn({ auth, onSignOut }: { auth: Auth; onSignOut: () => void }) {
  const game = useGame(auth.token, onSignOut);
  return (
    <Shell status={game.status} user={auth.user.username} onSignOut={game.session ? undefined : onSignOut}>
      {game.error && (
        <p className="error" role="alert" onClick={() => game.setError(null)}>
          {game.error}
        </p>
      )}
      {game.session ? (
        <SessionView game={game} session={game.session} myId={auth.user.id} />
      ) : game.rejoining ? (
        <p className="muted">Getting you back into your session…</p>
      ) : (
        <Home game={game} />
      )}
    </Shell>
  );
}

function Shell(props: {
  children: React.ReactNode;
  status?: Status;
  user?: string;
  onSignOut?: () => void;
}) {
  return (
    <main className="app">
      <header className="top">
        <h1>DnD Table</h1>
        <div className="top-right">
          {props.status && <StatusPill status={props.status} />}
          {props.onSignOut && (
            <button className="link" onClick={props.onSignOut}>
              Log out{props.user ? ` ${props.user}` : ''}
            </button>
          )}
        </div>
      </header>
      {props.children}
    </main>
  );
}

function StatusPill({ status }: { status: Status }) {
  const label = { connecting: 'Connecting', online: 'Online', offline: 'Offline' }[status];
  return (
    <span className={`status status-${status}`} aria-live="polite">
      {label}
    </span>
  );
}
