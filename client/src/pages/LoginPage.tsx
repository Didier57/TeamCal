import { useState, type FormEvent } from 'react';
import { apiPost, ApiError } from '../api';
import { useAuth } from '../app-context';
import { useI18n } from '../i18n';

export function LoginPage() {
  const { login, settings } = useAuth();
  const { t, errorMessage } = useI18n();
  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(username, password, remember);
    } catch (err) {
      setError(err instanceof ApiError ? errorMessage(err.code) : t('common.error'));
    } finally {
      setSubmitting(false);
    }
  }

  async function onForgot(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setInfo(null);
    setSubmitting(true);
    try {
      await apiPost('/auth/forgot-password', { email });
      setInfo(t('login.resetSent'));
    } catch (err) {
      setError(err instanceof ApiError ? errorMessage(err.code) : t('common.error'));
    } finally {
      setSubmitting(false);
    }
  }

  function switchMode(next: 'login' | 'forgot') {
    setMode(next);
    setError(null);
    setInfo(null);
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark large">TC</span>
          <h1>{settings?.appName ?? 'TeamCal'}</h1>
          <p>{mode === 'login' ? t('login.subtitle') : t('login.forgotHelp')}</p>
        </div>
        {mode === 'login' ? (
          <form onSubmit={onSubmit} className="form">
            <label>
              <span>{t('common.username')}</span>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                autoFocus
                required
              />
            </label>
            <label>
              <span>{t('common.password')}</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
              />
              <span>{t('login.remember')}</span>
            </label>
            {error && <div className="alert error">{error}</div>}
            <button type="submit" className="button primary wide" disabled={submitting}>
              {submitting ? t('common.loading') : t('login.submit')}
            </button>
            <button
              type="button"
              className="link-button"
              onClick={() => switchMode('forgot')}
            >
              {t('login.forgotPassword')}
            </button>
          </form>
        ) : (
          <form onSubmit={onForgot} className="form">
            <label>
              <span>{t('common.email')}</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                autoFocus
                required
              />
            </label>
            {info && <div className="alert info">{info}</div>}
            {error && <div className="alert error">{error}</div>}
            <button type="submit" className="button primary wide" disabled={submitting}>
              {submitting ? t('common.loading') : t('login.sendReset')}
            </button>
            <button type="button" className="link-button" onClick={() => switchMode('login')}>
              {t('login.backToLogin')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
