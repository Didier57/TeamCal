import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiGet, apiPost, ApiError } from '../api';
import { useAuth } from '../app-context';
import { useI18n } from '../i18n';

interface ResetInfo {
  valid: boolean;
  username?: string;
  firstName?: string;
  email?: string;
}

export function ResetPasswordPage() {
  const { settings } = useAuth();
  const { t, errorMessage } = useI18n();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [info, setInfo] = useState<ResetInfo | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setInfo({ valid: false });
      return;
    }
    apiGet<ResetInfo>(`/auth/reset/${encodeURIComponent(token)}`)
      .then(setInfo)
      .catch(() => setInfo({ valid: false }));
  }, [token]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError(t('reset.mismatch'));
      return;
    }
    setSubmitting(true);
    try {
      await apiPost('/auth/reset-password', { token, password });
      setDone(true);
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
          <p>{t('reset.subtitle')}</p>
        </div>
        {info === null ? (
          <div className="splash">
            <div className="spinner" />
          </div>
        ) : done ? (
          <div className="form">
            <div className="alert success">{t('reset.success')}</div>
            <a className="button primary wide" href="/">
              {t('login.backToLogin')}
            </a>
          </div>
        ) : !info.valid ? (
          <div className="form">
            <div className="alert error">{t('reset.invalid')}</div>
            <a className="button ghost wide" href="/">
              {t('login.backToLogin')}
            </a>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="form">
            {info.firstName || info.username ? (
              <p className="muted">
                {info.firstName ? `${info.firstName} (${info.username})` : info.username}
              </p>
            ) : null}
            <label>
              <span>{t('reset.newPassword')}</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                autoFocus
                minLength={8}
                required
              />
            </label>
            <label>
              <span>{t('reset.confirm')}</span>
              <input
                type="password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </label>
            <p className="muted">{t('reset.passwordHint')}</p>
            {error && <div className="alert error">{error}</div>}
            <button
              type="submit"
              className="button primary wide"
              disabled={submitting || password.length < 8 || confirm.length < 8}
            >
              {submitting ? t('common.loading') : t('reset.submit')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
