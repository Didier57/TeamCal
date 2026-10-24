import { useEffect, useState } from 'react';
import { apiGet, apiPut, ApiError } from '../../api';
import { useAuth } from '../../app-context';
import { useI18n } from '../../i18n';
import type { AdminSettings } from '../../types';
import { ThemeColorEditor } from '../ThemeColorEditor';

export function ThemeAdmin() {
  const { t, errorMessage } = useI18n();
  const { refresh } = useAuth();
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [theme, setTheme] = useState<AdminSettings['theme'] | null>(null);
  const [allowUserColors, setAllowUserColors] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiGet<AdminSettings>('/settings')
      .then((data) => {
        setSettings(data);
        setTheme(data.theme);
        setAllowUserColors(data.allowUserColors);
      })
      .catch(() => setError(t('common.error')));
  }, [t]);

  if (!settings || !theme) return <p className="muted">{t('common.loading')}</p>;

  async function save() {
    if (!theme) return;
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const updated = await apiPut<AdminSettings>('/settings', { theme, allowUserColors });
      setSettings(updated);
      setTheme(updated.theme);
      setFlash(t('admin.settingsSaved'));
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? errorMessage(err.code) : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-section">
      <div className="section-header">
        <h2>{t('admin.themeTitle')}</h2>
        <button type="button" className="button primary" disabled={busy} onClick={() => void save()}>
          {t('common.save')}
        </button>
      </div>
      {flash && <div className="alert info">{flash}</div>}
      {error && <div className="alert error">{error}</div>}

      <div className="panel theme-options">
        <div className="theme-option-line">
          <span>{t('theme.allowUserColors')}</span>
          <label className="checkbox">
            <input
              type="radio"
              name="allowUserColors"
              checked={allowUserColors}
              onChange={() => setAllowUserColors(true)}
            />
            <span>{t('common.yes')}</span>
          </label>
          <label className="checkbox">
            <input
              type="radio"
              name="allowUserColors"
              checked={!allowUserColors}
              onChange={() => setAllowUserColors(false)}
            />
            <span>{t('common.no')}</span>
          </label>
        </div>
      </div>

      <div className="panel">
        <ThemeColorEditor value={theme} onChange={setTheme} showPreview />
      </div>
    </div>
  );
}
