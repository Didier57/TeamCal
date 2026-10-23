import { useState, type FormEvent } from 'react';
import { useAuth } from '../app-context';
import { ApiError } from '../api';
import { useI18n } from '../i18n';

export function LoginPage() {
  const { login, settings } = useAuth();
  const { t, errorMessage } = useI18n();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
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

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark large">TC</span>
          <h1>{settings?.appName ?? 'TeamCal'}</h1>
          <p>{t('login.subtitle')}</p>
        </div>
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
        </form>
      </div>
    </div>
  );
}
