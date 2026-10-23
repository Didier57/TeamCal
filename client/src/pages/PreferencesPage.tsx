import { useState, type FormEvent } from 'react';
import { apiPost, apiPut, ApiError } from '../api';
import { useAuth } from '../app-context';
import { languageLabel, useI18n } from '../i18n';
import type { Language, ThemeKind, User, ViewKind } from '../types';

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

export function PreferencesPage() {
  const { user, settings, setUser, setTheme } = useAuth();
  const { t, errorMessage, setLanguage } = useI18n();
  const [firstName, setFirstName] = useState(user?.firstName ?? '');
  const [lastName, setLastName] = useState(user?.lastName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [language, setLanguageValue] = useState<Language>(user?.language ?? 'fr');
  const [timezone, setTimezone] = useState(user?.timezone ?? '');
  const [dateFormat, setDateFormat] = useState(user?.dateFormat ?? '');
  const [timeFormat, setTimeFormat] = useState(user?.timeFormat ?? '');
  const [defaultView, setDefaultView] = useState<ViewKind>(user?.defaultView ?? 'week');
  const [theme, setThemeValue] = useState<ThemeKind | ''>(user?.theme ?? '');
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileFlash, setProfileFlash] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordFlash, setPasswordFlash] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);

  if (!user || !settings) return null;

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProfileError(null);
    setProfileFlash(null);
    try {
      const response = await apiPut<{ user: User }>('/auth/me/preferences', {
        firstName,
        lastName,
        email,
        language,
        timezone: timezone || null,
        dateFormat: dateFormat || null,
        timeFormat: timeFormat || null,
        defaultView,
        theme: theme || null
      });
      setUser(response.user);
      setLanguage(language);
      if (theme) setTheme(theme);
      setProfileFlash(t('prefs.profileSaved'));
    } catch (err) {
      setProfileError(err instanceof ApiError ? errorMessage(err.code) : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  async function savePassword(event: FormEvent) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setPasswordError(t('prefs.mismatch'));
      return;
    }
    setBusy(true);
    setPasswordError(null);
    setPasswordFlash(null);
    try {
      await apiPost('/auth/me/password', { currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordFlash(t('prefs.passwordChanged'));
    } catch (err) {
      setPasswordError(err instanceof ApiError ? errorMessage(err.code) : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="preferences-page">
      <div className="page-heading">
        <h1>{t('prefs.title')}</h1>
      </div>
      <form className="panel" onSubmit={saveProfile}>
        <h2>{t('prefs.profile')}</h2>
        {profileFlash && <div className="alert info">{profileFlash}</div>}
        {profileError && <div className="alert error">{profileError}</div>}
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
            <input value={user.username} disabled />
          </label>
          <label>
            <span>{t('common.email')}</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label>
            <span>{t('common.language')}</span>
            <select value={language} onChange={(event) => setLanguageValue(event.target.value as Language)}>
              <option value="fr">{languageLabel('fr')}</option>
              <option value="en">{languageLabel('en')}</option>
              <option value="de">{languageLabel('de')}</option>
            </select>
          </label>
          <label>
            <span>{t('common.timezone')}</span>
            <select value={timezone} onChange={(event) => setTimezone(event.target.value)}>
              <option value="">{settings.defaultTimezone}</option>
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t('prefs.dateFormat')}</span>
            <select value={dateFormat} onChange={(event) => setDateFormat(event.target.value)}>
              <option value="">{settings.dateFormat}</option>
              <option value="dd/MM/yyyy">dd/MM/yyyy</option>
              <option value="MM/dd/yyyy">MM/dd/yyyy</option>
              <option value="dd/MM">dd/MM</option>
              <option value="MM/yyyy">MM/yyyy</option>
            </select>
          </label>
          <label>
            <span>{t('prefs.timeFormat')}</span>
            <select
              value={timeFormat}
              onChange={(event) => setTimeFormat(event.target.value as '' | '12' | '24')}
            >
              <option value="">{settings.timeFormat === '12' ? '12 h' : '24 h'}</option>
              <option value="24">24 h</option>
              <option value="12">12 h</option>
            </select>
          </label>
          <label>
            <span>{t('admin.defaultView')}</span>
            <select value={defaultView} onChange={(event) => setDefaultView(event.target.value as ViewKind)}>
              <option value="day">{t('common.day')}</option>
              <option value="week">{t('common.week')}</option>
              <option value="month">{t('common.month')}</option>
            </select>
          </label>
          <label>
            <span>{t('prefs.theme')}</span>
            <select
              value={theme}
              onChange={(event) => setThemeValue(event.target.value as ThemeKind | '')}
            >
              <option value="">{t('prefs.useGlobal')}</option>
              <option value="light">{t('common.light')}</option>
              <option value="dark">{t('common.dark')}</option>
            </select>
          </label>
        </div>
        <div className="row-actions">
          <button type="submit" className="button primary" disabled={busy}>
            {t('common.save')}
          </button>
        </div>
      </form>

      <form className="panel" onSubmit={savePassword}>
        <h2>{t('prefs.security')}</h2>
        {passwordFlash && <div className="alert info">{passwordFlash}</div>}
        {passwordError && <div className="alert error">{passwordError}</div>}
        <div className="form-grid">
          <label>
            <span>{t('prefs.currentPassword')}</span>
            <input
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <label>
            <span>{t('prefs.newPassword')}</span>
            <input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              minLength={8}
              autoComplete="new-password"
              required
            />
          </label>
          <label>
            <span>{t('prefs.confirmPassword')}</span>
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              minLength={8}
              autoComplete="new-password"
              required
            />
          </label>
        </div>
        <div className="row-actions">
          <button type="submit" className="button primary" disabled={busy}>
            {t('common.save')}
          </button>
        </div>
      </form>
    </div>
  );
}
