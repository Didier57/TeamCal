import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../app-context';
import { languageLabel, useI18n } from '../i18n';
import type { Language } from '../types';

export function AppLayout() {
  const { user, settings, logout, theme, setTheme } = useAuth();
  const { t, language, setLanguage } = useI18n();
  if (!user || !settings) return null;

  const displayName = `${user.firstName} ${user.lastName}`.trim() || user.username;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">TC</span>
          <div>
            <strong>{settings.appName}</strong>
            <small>{t('app.tagline')}</small>
          </div>
        </div>
        <nav className="main-nav">
          <NavLink to="/" end>
            {t('nav.calendar')}
          </NavLink>
          {user.isAdmin && <NavLink to="/admin">{t('nav.admin')}</NavLink>}
          <NavLink to="/preferences">{t('nav.preferences')}</NavLink>
        </nav>
        <div className="header-tools">
          <select
            aria-label={t('common.language')}
            value={language}
            onChange={(event) => setLanguage(event.target.value as Language)}
          >
            <option value="fr">{languageLabel('fr')}</option>
            <option value="en">{languageLabel('en')}</option>
            <option value="de">{languageLabel('de')}</option>
          </select>
          <button
            type="button"
            className="icon-button"
            title={t('common.theme')}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          <div className="user-chip" title={displayName}>
            <span className="avatar">{displayName.slice(0, 1).toUpperCase()}</span>
            <span className="user-name">{displayName}</span>
          </div>
          <button type="button" className="button ghost" onClick={() => void logout()}>
            {t('nav.logout')}
          </button>
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
