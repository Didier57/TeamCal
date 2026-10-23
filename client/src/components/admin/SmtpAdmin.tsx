import { useEffect, useState } from 'react';
import { apiGet, apiPost, apiPut, ApiError } from '../../api';
import { useI18n } from '../../i18n';
import type { AdminSettings } from '../../types';

export function SmtpAdmin() {
  const { t, errorMessage } = useI18n();
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [testTo, setTestTo] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiGet<AdminSettings>('/settings')
      .then(setSettings)
      .catch(() => setError(t('common.error')));
  }, [t]);

  if (!settings) return <p className="muted">{t('common.loading')}</p>;

  function update(patch: Partial<AdminSettings['smtp']>) {
    setSettings((current) =>
      current ? { ...current, smtp: { ...current.smtp, ...patch } } : current
    );
  }

  async function save() {
    if (!settings) return;
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const updated = await apiPut<AdminSettings>('/settings', { smtp: settings.smtp });
      setSettings(updated);
      setFlash(t('admin.settingsSaved'));
    } catch (err) {
      setError(err instanceof ApiError ? errorMessage(err.code) : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      await apiPost('/settings/smtp/test', { to: testTo });
      setFlash(t('admin.testSuccess'));
    } catch (err) {
      setError(
        err instanceof ApiError ? `${t('admin.testFailed')} (${errorMessage(err.code)})` : t('admin.testFailed')
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-section">
      <div className="section-header">
        <h2>{t('admin.smtpTitle')}</h2>
        <button type="button" className="button primary" disabled={busy} onClick={() => void save()}>
          {t('common.save')}
        </button>
      </div>
      {flash && <div className="alert info">{flash}</div>}
      {error && <div className="alert error">{error}</div>}
      <div className="panel">
        <div className="form-grid">
          <label>
            <span>{t('admin.smtpHost')}</span>
            <input value={settings.smtp.host} onChange={(event) => update({ host: event.target.value })} />
          </label>
          <label>
            <span>{t('admin.smtpPort')}</span>
            <input
              type="number"
              min={1}
              max={65535}
              value={settings.smtp.port}
              onChange={(event) => update({ port: Number(event.target.value) })}
            />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings.smtp.secure}
              onChange={(event) => update({ secure: event.target.checked })}
            />
            <span>{t('admin.smtpSecure')}</span>
          </label>
          <label>
            <span>{t('admin.smtpUser')}</span>
            <input value={settings.smtp.user} onChange={(event) => update({ user: event.target.value })} />
          </label>
          <label>
            <span>{t('admin.smtpPassword')}</span>
            <input
              type="password"
              value={settings.smtp.password}
              placeholder={settings.smtp.hasPassword ? '••••••••' : ''}
              onChange={(event) => update({ password: event.target.value })}
            />
            <small>{t('admin.smtpPasswordKeep')}</small>
          </label>
          <label>
            <span>{t('admin.smtpFromName')}</span>
            <input
              value={settings.smtp.fromName}
              onChange={(event) => update({ fromName: event.target.value })}
            />
          </label>
          <label>
            <span>{t('admin.smtpFromEmail')}</span>
            <input
              type="email"
              value={settings.smtp.fromEmail}
              onChange={(event) => update({ fromEmail: event.target.value })}
            />
          </label>
        </div>
      </div>
      <div className="panel">
        <h3>{t('admin.testEmail')}</h3>
        <div className="inline-fields">
          <input
            type="email"
            placeholder={t('admin.testRecipient')}
            value={testTo}
            onChange={(event) => setTestTo(event.target.value)}
          />
          <button type="button" className="button" disabled={busy || !testTo} onClick={() => void test()}>
            {t('admin.sendTest')}
          </button>
        </div>
      </div>
    </div>
  );
}
