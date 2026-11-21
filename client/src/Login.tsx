import { useState, type FormEvent } from 'react';
import { PASSWORD_MIN_LENGTH, type LoginResult } from '@dnd/shared';
import { accountStatus, login } from './api.ts';
import { t, tx } from './i18n.tsx';

/**
 * Accounts are pre-made by the admin. Step 1: username. Step 2: the password,
 * or on first login, choosing one.
 */
export function Login({ onLoggedIn }: { onLoggedIn: (r: LoginResult) => void }) {
  const [step, setStep] = useState<'username' | 'password' | 'choose'>('username');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  /** Online servers ask for an invite code when a password is chosen for the first time. */
  const [needsInvite, setNeedsInvite] = useState(false);
  const [invite, setInvite] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (step === 'username') {
        const status = await accountStatus(username);
        if (!status.exists) setError(t('There is no account with that name. Ask the DM to add you.'));
        else {
          setNeedsInvite(!!status.needsInvite);
          setStep(status.hasPassword ? 'password' : 'choose');
        }
      } else {
        if (step === 'choose' && password !== confirm) {
          setError(t('The two passwords are different.'));
          return;
        }
        onLoggedIn(await login(username, password, step === 'choose' && needsInvite ? invite : undefined));
      }
    } catch (err) {
      setError((err as Error).message === 'Failed to fetch' ? t('Cannot reach the server.') : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2 className="card-title">
        {step === 'username' ? t('Log in') : step === 'choose' ? t('Welcome, {username}!', { username }) : t('Hi {username}', { username })}
      </h2>
      {step === 'choose' && <p className="muted mb">{t('First time here. Choose a password for your account.')}</p>}
      {error && <p className="error" role="alert">{tx(error)}</p>}
      <form onSubmit={submit}>
        {step === 'username' ? (
          <label>
            {t('Username')}
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
              {step === 'choose' ? t('New password') : t('Password')}
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
            {step === 'choose' && needsInvite && (
              <label>
                Invite code
                <input value={invite} onChange={(e) => setInvite(e.target.value)} autoComplete="off" autoCapitalize="none" autoCorrect="off" required />
                <span className="small hint">Your DM gave it to you together with the link. You only need it this once.</span>
              </label>
            )}
            {step === 'choose' && (
              <label>
                {t('Repeat password')}
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
          {step === 'username' ? t('Continue') : step === 'choose' ? t('Save password and log in') : t('Log in')}
        </button>
        {step !== 'username' && (
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setStep('username');
              setPassword('');
              setConfirm('');
              setInvite('');
              setError(null);
            }}
          >
            {t('Not {username}?', { username })}
          </button>
        )}
      </form>
    </section>
  );
}
