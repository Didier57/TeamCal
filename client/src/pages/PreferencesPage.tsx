import { useEffect, useState, type FormEvent } from 'react';
import { apiGet, apiPost, apiPut, ApiError } from '../api';
import { defaultThemeColors, useAuth } from '../app-context';
import { languageLabel, useI18n } from '../i18n';
import { countryLabel, EUROPEAN_COUNTRY_CODES } from '../countries';
import type { CustomView, Language, PublicSettings, ThemeColors, ThemeKind, User } from '../types';
import { ThemeColorEditor } from '../components/ThemeColorEditor';

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

const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const timezoneChoices = timezones.includes(browserTimeZone)
  ? timezones
  : [browserTimeZone, ...timezones];

export function PreferencesPage() {
  const { user, settings, setUser, setTheme, setSettings } = useAuth();
  const { t, errorMessage, setLanguage, locale } = useI18n();
  const [firstName, setFirstName] = useState(user?.firstName ?? '');
  const [lastName, setLastName] = useState(user?.lastName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [language, setLanguageValue] = useState<Language>(user?.language ?? 'fr');
  const [timezone, setTimezone] = useState(user?.timezone ?? '');
  const [country, setCountry] = useState(user?.country ?? '');
  const [dateFormat, setDateFormat] = useState(user?.dateFormat ?? '');
  const [timeFormat, setTimeFormat] = useState(user?.timeFormat ?? '');
  const [defaultView, setDefaultView] = useState<string>(user?.defaultView ?? 'week');
  const [views, setViews] = useState<CustomView[]>([]);
  const [theme, setThemeValue] = useState<ThemeKind | ''>(user?.theme ?? '');
  const [notifyNewEvents, setNotifyNewEvents] = useState(Boolean(user?.notifyNewEvents));
  const [notificationsBlocked, setNotificationsBlocked] = useState(
    typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'denied'
  );
  const [useCustomColors, setUseCustomColors] = useState(Boolean(user?.themeColors));
  const [themeColors, setThemeColors] = useState<{ light: ThemeColors; dark: ThemeColors }>({
    light: {
      ...defaultThemeColors.light,
      ...(settings?.theme?.light ?? {}),
      ...(user?.themeColors?.light ?? {})
    },
    dark: {
      ...defaultThemeColors.dark,
      ...(settings?.theme?.dark ?? {}),
      ...(user?.themeColors?.dark ?? {})
    }
  });
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileFlash, setProfileFlash] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordFlash, setPasswordFlash] = useState<string | null>(null);
  const [feedFlash, setFeedFlash] = useState<string | null>(null);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    apiGet<PublicSettings>('/settings/public')
      .then((value) => {
        if (active) setSettings(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [setSettings]);

  useEffect(() => {
    let active = true;
    apiGet<CustomView[]>('/views')
      .then((list) => {
        if (!active) return;
        setViews(list);
        setDefaultView((current) =>
          current.startsWith('view:') && !list.some((view) => `view:${view.id}` === current)
            ? 'week'
            : current
        );
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (!user || !settings) return null;

  const personalViews = views.filter((customView) => customView.ownerId === user.id);
  const sharedViews = views.filter(
    (customView) => customView.isShared && customView.ownerId !== user.id
  );

  const feedBase = (settings.baseUrl || window.location.origin).replace(/\/+$/, '');
  const feedUrl = user.feedToken ? `${feedBase}/api/feed/${user.feedToken}.ics` : '';
  const googleFeedUrl = feedUrl
    ? `https://calendar.google.com/calendar/r/settings/addbyurl?url=${encodeURIComponent(feedUrl)}`
    : '';

  async function copyFeed() {
    if (!feedUrl) return;
    try {
      await navigator.clipboard.writeText(feedUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setFeedError(t('common.error'));
    }
  }

  async function regenerateFeed() {
    setBusy(true);
    setFeedError(null);
    setFeedFlash(null);
    try {
      const response = await apiPost<{ feedToken: string }>('/auth/me/feed/regenerate');
      setUser({ ...user!, feedToken: response.feedToken });
      setFeedFlash(t('prefs.regenerated'));
    } catch (err) {
      setFeedError(err instanceof ApiError ? errorMessage(err.code) : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  async function toggleNotifications(checked: boolean) {
    if (!checked) {
      setNotifyNewEvents(false);
      return;
    }
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setNotificationsBlocked(true);
      return;
    }
    const permission =
      Notification.permission === 'default'
        ? await Notification.requestPermission()
        : Notification.permission;
    if (permission !== 'granted') {
      setNotificationsBlocked(true);
      setNotifyNewEvents(false);
      return;
    }
    setNotificationsBlocked(false);
    setNotifyNewEvents(true);
  }

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
        country: country || null,
        dateFormat: dateFormat || null,
        timeFormat: timeFormat || null,
        defaultView,
        theme: theme || null,
        notifyNewEvents,
        themeColors: settings?.allowUserColors && useCustomColors ? themeColors : null
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
              {timezoneChoices.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
            <button type="button" className="link" onClick={() => setTimezone(browserTimeZone)}>
              {t('prefs.useBrowserTimeZone')} ({browserTimeZone})
            </button>
          </label>
          <label>
            <span>{t('prefs.country')}</span>
            <select value={country} onChange={(event) => setCountry(event.target.value)}>
              <option value="">{t('common.none')}</option>
              {EUROPEAN_COUNTRY_CODES.map((code) => (
                <option key={code} value={code}>
                  {countryLabel(code, locale)}
                </option>
              ))}
            </select>
            <span className="hint">{t('prefs.countryHint')}</span>
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
            <select value={defaultView} onChange={(event) => setDefaultView(event.target.value)}>
              <option value="day">{t('common.day')}</option>
              <option value="week">{t('common.week')}</option>
              <option value="month">{t('common.month')}</option>
              {personalViews.length > 0 && (
                <optgroup label={t('prefs.personalViews')}>
                  {personalViews.map((customView) => (
                    <option key={customView.id} value={`view:${customView.id}`}>
                      {customView.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {sharedViews.length > 0 && (
                <optgroup label={t('prefs.globalViews')}>
                  {sharedViews.map((customView) => (
                    <option key={customView.id} value={`view:${customView.id}`}>
                      {customView.name}
                    </option>
                  ))}
                </optgroup>
              )}
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
        <div className="notification-settings">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={notifyNewEvents}
              onChange={(event) => void toggleNotifications(event.target.checked)}
            />
            <span>{t('prefs.notifications')}</span>
          </label>
          <p className="hint">
            {notificationsBlocked ? t('prefs.notificationsBlocked') : t('prefs.notificationsHint')}
          </p>
        </div>
        {settings.allowUserColors && (
          <div className="theme-user-block">
            <div className="section-header">
              <h3>{t('prefs.customColors')}</h3>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={useCustomColors}
                  onChange={(event) => setUseCustomColors(event.target.checked)}
                />
                <span>{t('prefs.useCustomColors')}</span>
              </label>
            </div>
            {useCustomColors ? (
              <ThemeColorEditor value={themeColors} onChange={setThemeColors} showPreview />
            ) : (
              <p className="muted">{t('theme.globalColors')}</p>
            )}
          </div>
        )}
        <div className="row-actions">
          <button type="submit" className="button primary" disabled={busy}>
            {t('common.save')}
          </button>
        </div>
      </form>

      <section className="panel">
        <h2>{t('prefs.feedTitle')}</h2>
        {feedFlash && <div className="alert info">{feedFlash}</div>}
        {feedError && <div className="alert error">{feedError}</div>}
        <p className="muted">{t('prefs.feedHelp')}</p>
        <div className="feed-url-row">
          <input
            readOnly
            value={feedUrl}
            onFocus={(event) => event.currentTarget.select()}
            aria-label={t('prefs.feedTitle')}
          />
          <button type="button" className="button" onClick={copyFeed} disabled={!feedUrl}>
            {copied ? t('prefs.copied') : t('prefs.copy')}
          </button>
        </div>
        <div className="row-actions">
          {googleFeedUrl && (
            <a className="button" href={googleFeedUrl} target="_blank" rel="noreferrer">
              {t('prefs.openGoogle')}
            </a>
          )}
          <button
            type="button"
            className="button"
            onClick={regenerateFeed}
            disabled={busy || !feedUrl}
          >
            {t('prefs.regenerate')}
          </button>
        </div>
        <p className="hint">{t('prefs.feedSecret')}</p>
        <p className="hint">{t('prefs.feedDelay')}</p>
      </section>

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
