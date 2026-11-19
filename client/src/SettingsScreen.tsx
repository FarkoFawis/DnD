import { useState } from 'react';
import { changeSettings, useSettings, type Theme } from './settings.ts';

const THEME_OPTIONS: Array<{ id: Theme; name: string; about: string }> = [
  { id: 'default', name: 'Default', about: 'Warm dark with gold.' },
  { id: 'light', name: 'Light', about: 'Bright, for daylight.' },
  { id: 'black', name: 'Black', about: 'Pure black and white.' },
];

/** Home → Settings. Everything here is remembered on this phone. */
export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const settings = useSettings();
  const [tab, setTab] = useState<'general' | 'theme'>('general');
  return (
    <>
      <button className="back" onClick={onBack}>‹ Home</button>
      <section className="card">
        <h2 className="card-title">Settings</h2>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'general'} onClick={() => setTab('general')}>General</button>
          <button role="tab" aria-selected={tab === 'theme'} onClick={() => setTab('theme')}>Theme</button>
        </div>
        {tab === 'general' ? (
          <label className="setting-row">
            <span className="grow">
              Show helper texts
              <span className="muted small block">
                The small grey explanations under buttons and lists, like “Tap a player to open their sheet”. Switch them off once you know your way around.
              </span>
            </span>
            <input
              type="checkbox"
              role="switch"
              className="switch"
              checked={settings.hints}
              onChange={(e) => changeSettings({ hints: e.target.checked })}
            />
          </label>
        ) : (
          <div className="theme-options" role="radiogroup" aria-label="Theme">
            {THEME_OPTIONS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={settings.theme === t.id}
                className={`theme-option ${settings.theme === t.id ? 'on' : ''}`}
                onClick={() => changeSettings({ theme: t.id })}
              >
                {/* A tiny picture of the app in that theme: its own colours, whatever theme is active. */}
                <span className="theme-preview" data-theme={t.id} aria-hidden>
                  <span className="theme-preview-title" />
                  <span className="theme-preview-line" />
                  <span className="theme-preview-line short" />
                  <span className="theme-preview-button" />
                </span>
                <strong>{t.name}</strong>
                <span className="muted small">{t.about}</span>
              </button>
            ))}
          </div>
        )}
        <p className="muted small mt">Settings are saved on this phone.</p>
      </section>
    </>
  );
}
