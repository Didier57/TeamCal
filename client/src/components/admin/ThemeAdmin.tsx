import { useEffect, useState } from 'react';
import { apiGet, apiPut, ApiError } from '../../api';
import { useI18n } from '../../i18n';
import type { AdminSettings, ThemeColors, ThemeKind } from '../../types';

const fields: { key: keyof ThemeColors; label: string }[] = [
  { key: 'primary', label: 'admin.colorPrimary' },
  { key: 'accent', label: 'admin.colorAccent' },
  { key: 'background', label: 'admin.colorBackground' },
  { key: 'surface', label: 'admin.colorSurface' },
  { key: 'text', label: 'admin.colorText' },
  { key: 'muted', label: 'admin.colorMuted' },
  { key: 'border', label: 'admin.colorBorder' }
];

export function ThemeAdmin() {
  const { t, errorMessage } = useI18n();
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [theme, setTheme] = useState<AdminSettings['theme'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiGet<AdminSettings>('/settings')
      .then((data) => {
        setSettings(data);
        setTheme(data.theme);
      })
      .catch(() => setError(t('common.error')));
  }, [t]);

  if (!settings || !theme) return <p className="muted">{t('common.loading')}</p>;

  function update(kind: ThemeKind, key: keyof ThemeColors, value: string) {
    setTheme((current) => (current ? { ...current, [kind]: { ...current[kind], [key]: value } } : current));
  }

  async function save() {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const updated = await apiPut<AdminSettings>('/settings', { theme });
      setSettings(updated);
      setTheme(updated.theme);
      setFlash(t('admin.settingsSaved'));
    } catch (err) {
      setError(err instanceof ApiError ? errorMessage(err.code) : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  function preview(kind: ThemeKind) {
    const colors = theme![kind];
    return (
      <div
        className="theme-preview"
        style={{
          background: colors.background,
          color: colors.text,
          borderColor: colors.border
        }}
      >
        <div className="theme-preview-surface" style={{ background: colors.surface, borderColor: colors.border }}>
          <strong style={{ color: colors.text }}>{settings!.appName}</strong>
          <p style={{ color: colors.muted }}>{t('admin.preview')}</p>
          <div className="theme-preview-actions">
            <span className="theme-preview-button" style={{ background: colors.primary, color: '#fff' }}>
              {t('common.save')}
            </span>
            <span
              className="theme-preview-button"
              style={{ background: colors.accent, color: '#fff' }}
            >
              {t('common.add')}
            </span>
          </div>
        </div>
      </div>
    );
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
      {(['light', 'dark'] as ThemeKind[]).map((kind) => (
        <div className="panel" key={kind}>
          <div className="theme-panel">
            <div>
              <h3>{kind === 'light' ? t('admin.themeLight') : t('admin.themeDark')}</h3>
              <div className="form-grid">
                {fields.map((field) => (
                  <label key={field.key}>
                    <span>{t(field.label)}</span>
                    <div className="color-input">
                      <input
                        type="color"
                        value={theme[kind][field.key]}
                        onChange={(event) => update(kind, field.key, event.target.value)}
                      />
                      <input
                        value={theme[kind][field.key]}
                        onChange={(event) => update(kind, field.key, event.target.value)}
                      />
                    </div>
                  </label>
                ))}
              </div>
            </div>
            {preview(kind)}
          </div>
        </div>
      ))}
    </div>
  );
}
