import { useState, type FormEvent } from 'react';
import { useAuth } from '../app-context';
import { ApiError } from '../api';
import { languageLabel, useI18n } from '../i18n';
import type { Language } from '../types';

const timezones = [
  'Europe/Paris',
  'Europe/Brussels',
  'Europe/Luxembourg',
  'Europe/Geneva',
  'Europe/Berlin',
  'Europe/London',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'UTC'
];

export function SetupPage() {
  const { setup, settings } = useAuth();
  const { t, language, setLanguage, errorMessage } = useI18n();
  const [appName, setAppName] = useState(settings?.appName ?? 'TeamCal');
  const [baseUrl, setBaseUrl] = useState(window.location.origin);
  const [timezone, setTimezone] = useState(settings?.defaultTimezone ?? 'Europe/Paris');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await setup({
        appName,
        baseUrl,
        language,
        timezone,
        admin: { username, email, firstName, lastName, password }
      });
    } catch (err) {
      setError(err instanceof ApiError ? errorMessage(err.code) : t('common.error'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card wide">
        <div className="auth-brand">
          <span className="brand-mark large">TC</span>
          <h1>{t('setup.title')}</h1>
          <p>{t('setup.subtitle')}</p>
        </div>
        <form onSubmit={onSubmit} className="form">
          <h2>{t('setup.appSection')}</h2>
          <div className="form-grid">
            <label>
              <span>{t('setup.appName')}</span>
              <input value={appName} onChange={(event) => setAppName(event.target.value)} required />
            </label>
            <label>
              <span>{t('setup.baseUrl')}</span>
              <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
            </label>
            <label>
              <span>{t('common.language')}</span>
              <select
                value={language}
                onChange={(event) => setLanguage(event.target.value as Language)}
              >
                <option value="fr">{languageLabel('fr')}</option>
                <option value="en">{languageLabel('en')}</option>
                <option value="de">{languageLabel('de')}</option>
              </select>
            </label>
            <label>
              <span>{t('common.timezone')}</span>
              <select value={timezone} onChange={(event) => setTimezone(event.target.value)}>
                {timezones.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <h2>{t('setup.adminSection')}</h2>
          <div className="form-grid">
            <label>
              <span>{t('setup.firstName')}</span>
              <input value={firstName} onChange={(event) => setFirstName(event.target.value)} />
            </label>
            <label>
              <span>{t('setup.lastName')}</span>
              <input value={lastName} onChange={(event) => setLastName(event.target.value)} />
            </label>
            <label>
              <span>{t('common.username')}</span>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                minLength={3}
                required
                autoComplete="username"
              />
            </label>
            <label>
              <span>{t('common.email')}</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoComplete="email"
              />
            </label>
            <label className="span-2">
              <span>{t('common.password')}</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={8}
                required
                autoComplete="new-password"
              />
              <small>{t('setup.passwordHint')}</small>
            </label>
          </div>
          {error && <div className="alert error">{error}</div>}
          <button type="submit" className="button primary wide" disabled={submitting}>
            {submitting ? t('common.loading') : t('setup.submit')}
          </button>
        </form>
      </div>
    </div>
  );
}
