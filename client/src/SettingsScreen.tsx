import { useState } from 'react';
import { LANGUAGES, LANGUAGE_NAMES } from '@dnd/shared';
import { Panel } from './Panel.tsx';
import { changeSettings, useSettings, type Theme } from './settings.ts';
import { msg, t } from './i18n.tsx';

const THEME_OPTIONS: Array<{ id: Theme; name: string; about: string }> = [
  { id: 'default', name: msg('Default##theme'), about: msg('Warm dark with gold.') },
  { id: 'light', name: msg('Light##theme'), about: msg('Bright, for daylight.') },
  { id: 'black', name: msg('Black##theme'), about: msg('Pure black and white.') },
];

const TABS = [
  { id: 'general', label: msg('General') },
  { id: 'theme', label: msg('Theme') },
  { id: 'language', label: msg('Language') },
] as const;

/** Home → Settings. Everything here is remembered on this phone. */
export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const settings = useSettings();
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('general');
  return (
    <Panel title={t('Settings')} tabs={TABS} tab={tab} onTab={setTab} onClose={onBack}>
        {tab === 'general' ? (
          <div className="setting-list">
            <label className="setting-row">
              <span className="setting-name">{t('Show helper texts')}</span>
              <span className="setting-about muted small">
                {t('The small grey explanations under buttons and lists, like “Tap a player to open their sheet”. Switch them off once you know your way around.')}
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
              <span className="setting-name">{t('Dice roller')}</span>
              <span className="setting-about muted small">
                {t('Tap an ability, save, skill or attack on your sheet to roll it with the right bonus. Your DM sees the result. Leave it off if you roll real dice.')}
              </span>
              <input
                type="checkbox"
                role="switch"
                className="switch"
                checked={settings.dice}
                onChange={(e) => changeSettings({ dice: e.target.checked })}
              />
            </label>
            <label className="setting-row">
              <span className="setting-name">{t('Animations and effects')}</span>
              <span className="setting-about muted small">
                {t('Pages that slide, numbers that count, the flash when you are hit or cast a spell. Switch them off if your phone stutters or you want it calm.')}
              </span>
              <input
                type="checkbox"
                role="switch"
                className="switch"
                checked={settings.effects}
                onChange={(e) => changeSettings({ effects: e.target.checked })}
              />
            </label>
          </div>
        ) : tab === 'language' ? (
          <div className="theme-options" role="radiogroup" aria-label={t('Language')}>
            {LANGUAGES.map((id) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={settings.language === id}
                className={`theme-option ${settings.language === id ? 'on' : ''}`}
                onClick={() => changeSettings({ language: id })}
              >
                {/* Each language in its own words, so it can be found from the other one. */}
                <span className="grow" lang={id}>
                  <strong>{LANGUAGE_NAMES[id]}</strong>
                </span>
                <span className="theme-check" aria-hidden />
              </button>
            ))}
            <p className="muted small">
              {t('Everything the app says is translated. The rulebook texts of spells, items and features are still in English.')}
            </p>
          </div>
        ) : (
          <div className="theme-options" role="radiogroup" aria-label={t('Theme')}>
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={settings.theme === option.id}
                className={`theme-option ${settings.theme === option.id ? 'on' : ''}`}
                onClick={() => changeSettings({ theme: option.id })}
              >
                {/* A tiny picture of the app in that theme: its own colours, whatever theme is active. */}
                <span className="theme-preview" data-theme={option.id} aria-hidden>
                  <span className="theme-preview-title" />
                  <span className="theme-preview-line" />
                  <span className="theme-preview-line short" />
                  <span className="theme-preview-button" />
                </span>
                <span className="grow">
                  <strong>{t(option.name)}</strong>
                  <span className="muted small block">{t(option.about)}</span>
                </span>
                <span className="theme-check" aria-hidden />
              </button>
            ))}
          </div>
        )}
        <p className="muted small mt hint">{t('Settings are saved on this phone.')}</p>
    </Panel>
  );
}
