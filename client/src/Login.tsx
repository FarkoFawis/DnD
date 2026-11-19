import { useState, type FormEvent } from 'react';
import { PASSWORD_MIN_LENGTH, type LoginResult } from '@dnd/shared';
import { accountStatus, login } from './api.ts';

/**
 * Accounts are pre-made by the admin. Step 1: username. Step 2: the password,
 * or on first login, choosing one.
 */
export function Login({ onLoggedIn }: { onLoggedIn: (r: LoginResult) => void }) {
  const [step, setStep] = useState<'username' | 'password' | 'choose'>('username');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (step === 'username') {
        const status = await accountStatus(username);
        if (!status.exists) setError('There is no account with that name. Ask the DM to add you.');
        else setStep(status.hasPassword ? 'password' : 'choose');
      } else {
        if (step === 'choose' && password !== confirm) {
          setError('The two passwords are different.');
          return;
        }
        onLoggedIn(await login(username, password));
      }
    } catch (err) {
      setError((err as Error).message === 'Failed to fetch' ? 'Cannot reach the server.' : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2 className="card-title">
        {step === 'username' ? 'Log in' : step === 'choose' ? `Welcome, ${username}!` : `Hi ${username}`}
      </h2>
      {step === 'choose' && <p className="muted mb">First time here. Choose a password for your account.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <form onSubmit={submit}>
        {step === 'username' ? (
          <label>
            Username
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              autoFocus
              required
            />
          </label>
        ) : (
          <>
            <input type="hidden" autoComplete="username" value={username} readOnly />
            <label>
              {step === 'choose' ? 'New password' : 'Password'}
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={step === 'choose' ? 'new-password' : 'current-password'}
                minLength={step === 'choose' ? PASSWORD_MIN_LENGTH : undefined}
                autoFocus
                required
              />
            </label>
            {step === 'choose' && (
              <label>
                Repeat password
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </label>
            )}
          </>
        )}
        <button className="primary" type="submit" disabled={busy}>
          {step === 'username' ? 'Continue' : step === 'choose' ? 'Save password and log in' : 'Log in'}
        </button>
        {step !== 'username' && (
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setStep('username');
              setPassword('');
              setConfirm('');
              setError(null);
            }}
          >
            Not {username}?
          </button>
        )}
      </form>
    </section>
  );
}
