import { useState } from 'react';
import { Panel } from './Panel.tsx';
import { changeSettings, useSettings, type Theme } from './settings.ts';

const THEME_OPTIONS: Array<{ id: Theme; name: string; about: string }> = [
  { id: 'default', name: 'Default', about: 'Warm dark with gold.' },
  { id: 'light', name: 'Light', about: 'Bright, for daylight.' },
  { id: 'black', name: 'Black', about: 'Pure black and white.' },
];

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'theme', label: 'Theme' },
] as const;

/** Home → Settings. Everything here is remembered on this phone. */
export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const settings = useSettings();
  const [tab, setTab] = useState<'general' | 'theme'>('general');
  return (
    <Panel title="Settings" tabs={TABS} tab={tab} onTab={setTab} onClose={onBack}>
        {tab === 'general' ? (
          <div className="setting-list">
            <label className="setting-row">
              <span className="setting-name">Show helper texts</span>
              <span className="setting-about muted small">
                The small grey explanations under buttons and lists, like “Tap a player to open their sheet”. Switch them off once you know your way around.
              </span>
              <input
                type="checkbox"
                role="switch"
                className="switch"
                checked={settings.hints}
                onChange={(e) => changeSettings({ hints: e.target.checked })}
              />
            </label>
            <label className="setting-row">
              <span className="setting-name">Dice roller</span>
              <span className="setting-about muted small">
                Tap an ability, save, skill or attack on your sheet to roll it with the right bonus. Your DM sees the result. Leave it off if you roll real dice.
              </span>
              <input
                type="checkbox"
                role="switch"
                className="switch"
                checked={settings.dice}
                onChange={(e) => changeSettings({ dice: e.target.checked })}
              />
            </label>
          </div>
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
                <span className="grow">
                  <strong>{t.name}</strong>
                  <span className="muted small block">{t.about}</span>
                </span>
                <span className="theme-check" aria-hidden />
              </button>
            ))}
          </div>
        )}
        <p className="muted small mt hint">Settings are saved on this phone.</p>
    </Panel>
  );
}
