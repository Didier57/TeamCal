import { useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPost, apiPut, apiUpload, ApiError } from '../../api';
import { useI18n } from '../../i18n';
import type { AdminSettings, BackupFile, BackupResult, BackupSettings } from '../../types';

const MAX_DATABASE_SIZE = 500 * 1024 * 1024;

function formatSize(size: number, locale: string): string {
  const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  if (size >= 1024 * 1024) return `${formatter.format(size / (1024 * 1024))} MB`;
  if (size >= 1024) return `${formatter.format(size / 1024)} KB`;
  return `${formatter.format(size)} B`;
}

function formatDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'short',
    timeStyle: 'medium'
  }).format(new Date(value));
}

export function BackupAdmin() {
  const { t, locale, errorMessage } = useI18n();
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [files, setFiles] = useState<BackupFile[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);

  useEffect(() => {
    apiGet<AdminSettings>('/settings')
      .then((loaded) => {
        setSettings(loaded);
        if (loaded.backup.host && loaded.backup.share) {
          return apiGet<{ files: BackupFile[] }>('/backups/smb')
            .then((result) => setFiles(result.files))
            .catch(() => undefined);
        }
        return undefined;
      })
      .catch(() => setError(t('common.error')));
  }, [t]);

  if (!settings) return <p className="muted">{t('common.loading')}</p>;

  function showError(err: unknown) {
    if (err instanceof ApiError) {
      const detail =
        err.details && typeof err.details === 'object'
          ? String((err.details as { message?: unknown }).message ?? '')
          : '';
      setError(detail ? `${errorMessage(err.code)} (${detail})` : errorMessage(err.code));
      return;
    }
    setError(t('common.error'));
  }

  function updateBackup(patch: Partial<BackupSettings>) {
    setSettings((current) =>
      current ? { ...current, backup: { ...current.backup, ...patch } } : current
    );
  }

  async function reloadFiles() {
    if (!settings?.backup.host || !settings.backup.share) {
      setFiles([]);
      return;
    }
    setLoadingFiles(true);
    try {
      const result = await apiGet<{ files: BackupFile[] }>('/backups/smb');
      setFiles(result.files);
    } catch (err) {
      showError(err);
    } finally {
      setLoadingFiles(false);
    }
  }

  async function persistBackup(showSaved = true): Promise<AdminSettings | null> {
    if (!settings) return null;
    const updated = await apiPut<AdminSettings>('/settings', { backup: settings.backup });
    setSettings(updated);
    if (showSaved) setFlash(t('admin.settingsSaved'));
    return updated;
  }

  async function save() {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      await persistBackup();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setError(null);
    setFlash(null);
    try {
      await persistBackup(false);
      const result = await apiPost<{ ok: boolean; folderExists: boolean }>('/backups/smb/test');
      setFlash(
        result.folderExists
          ? t('admin.backupTestSuccess')
          : t('admin.backupTestFolderMissing')
      );
    } catch (err) {
      showError(err);
    } finally {
      setTesting(false);
    }
  }

  async function backupNow() {
    setBackingUp(true);
    setError(null);
    setFlash(null);
    try {
      await persistBackup(false);
      const result = await apiPost<BackupResult>('/backups/smb/run');
      setFlash(`${t('admin.backupCreated')} ${result.file}`);
      const listing = await apiGet<{ files: BackupFile[] }>('/backups/smb');
      setFiles(listing.files);
    } catch (err) {
      showError(err);
    } finally {
      setBackingUp(false);
    }
  }

  async function uploadDatabase() {
    if (!file) return;
    if (file.size > MAX_DATABASE_SIZE) {
      setError(t('admin.backupTooLarge'));
      return;
    }
    if (!window.confirm(t('admin.backupRestoreConfirm'))) return;
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      await apiUpload('/backups/import', file);
      setFlash(t('admin.backupRestoredReload'));
      window.setTimeout(() => window.location.reload(), 900);
    } catch (err) {
      showError(err);
      setBusy(false);
    }
  }

  async function restoreFile(name: string) {
    if (!window.confirm(t('admin.backupRestoreConfirm'))) return;
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      await apiPost(`/backups/smb/${encodeURIComponent(name)}/restore`);
      setFlash(t('admin.backupRestoredReload'));
      window.setTimeout(() => window.location.reload(), 900);
    } catch (err) {
      showError(err);
      setBusy(false);
    }
  }

  async function deleteFile(name: string) {
    if (!window.confirm(t('admin.backupDeleteConfirm'))) return;
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      await apiDelete(`/backups/smb/${encodeURIComponent(name)}`);
      setFiles((current) => current.filter((entry) => entry.name !== name));
      setFlash(t('admin.backupDeleted'));
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  const weekdays = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
    value: day,
    label: new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(
      new Date(Date.UTC(2024, 0, 7 + day, 12))
    )
  }));

  return (
    <div className="admin-section backup-admin">
      <div className="section-header">
        <h2>{t('admin.backupTitle')}</h2>
      </div>
      {flash && <div className="alert info">{flash}</div>}
      {error && <div className="alert error">{error}</div>}

      <div className="panel">
        <h3>{t('admin.backupDatabase')}</h3>
        <p className="hint">{t('admin.backupDatabaseHelp')}</p>
        <div className="backup-db-actions">
          <a className="button" href="/api/backups/export">
            {t('admin.backupDownload')}
          </a>
          <input
            key={fileInputKey}
            type="file"
            accept=".sqlite,.db,application/octet-stream,application/x-sqlite3"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            className="button danger"
            disabled={busy || !file}
            onClick={() => void uploadDatabase()}
          >
            {t('admin.backupRestoreUpload')}
          </button>
        </div>
      </div>

      <div className="panel">
        <h3>{t('admin.backupSmbTitle')}</h3>
        <p className="hint">{t('admin.backupSmbHelp')}</p>
        <div className="form-grid">
          <label>
            <span>{t('admin.backupHost')}</span>
            <input
              value={settings.backup.host}
              onChange={(event) => updateBackup({ host: event.target.value })}
            />
          </label>
          <label>
            <span>{t('admin.backupShare')}</span>
            <input
              value={settings.backup.share}
              onChange={(event) => updateBackup({ share: event.target.value })}
            />
          </label>
          <label>
            <span>{t('admin.backupUsername')}</span>
            <input
              value={settings.backup.username}
              onChange={(event) => updateBackup({ username: event.target.value })}
            />
          </label>
          <label>
            <span>{t('admin.backupPassword')}</span>
            <input
              type="password"
              value={settings.backup.password}
              placeholder={settings.backup.hasPassword ? '********' : ''}
              onChange={(event) => updateBackup({ password: event.target.value })}
            />
            <small>{t('admin.backupPasswordKeep')}</small>
          </label>
          <label>
            <span>{t('admin.backupDomain')}</span>
            <input
              value={settings.backup.domain}
              onChange={(event) => updateBackup({ domain: event.target.value })}
            />
          </label>
          <label>
            <span>{t('admin.backupFolder')}</span>
            <input
              value={settings.backup.folder}
              onChange={(event) => updateBackup({ folder: event.target.value })}
            />
          </label>
        </div>

        <label className="checkbox backup-enabled">
          <input
            type="checkbox"
            checked={settings.backup.enabled}
            onChange={(event) => updateBackup({ enabled: event.target.checked })}
          />
          <span>{t('admin.backupEnabled')}</span>
        </label>

        <div className="form-grid">
          <label>
            <span>{t('admin.backupDay')}</span>
            <select
              value={String(settings.backup.day)}
              onChange={(event) =>
                updateBackup({
                  day: event.target.value === 'all' ? 'all' : Number(event.target.value)
                })
              }
            >
              <option value="all">{t('admin.backupEveryDay')}</option>
              {weekdays.map((day) => (
                <option key={day.value} value={day.value}>
                  {day.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t('admin.backupTime')}</span>
            <input
              type="time"
              value={settings.backup.time}
              onChange={(event) => updateBackup({ time: event.target.value })}
            />
          </label>
          <label>
            <span>{t('admin.backupKeep')}</span>
            <input
              type="number"
              min={1}
              max={100}
              value={settings.backup.keep}
              onChange={(event) => updateBackup({ keep: Number(event.target.value) })}
            />
          </label>
        </div>

        <div className="backup-actions">
          <button
            type="button"
            className="button"
            disabled={testing || busy}
            onClick={() => void testConnection()}
          >
            {testing ? t('admin.backupTesting') : t('admin.backupTest')}
          </button>
          <button type="button" className="button" disabled={busy} onClick={() => void save()}>
            {t('common.save')}
          </button>
          <button
            type="button"
            className="button primary"
            disabled={backingUp || busy}
            onClick={() => void backupNow()}
          >
            {backingUp ? t('admin.backupRunning') : t('admin.backupNow')}
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="section-header">
          <h3>{t('admin.backupFiles')}</h3>
          <button
            type="button"
            className="button small"
            disabled={loadingFiles}
            onClick={() => void reloadFiles()}
          >
            {t('admin.backupRefresh')}
          </button>
        </div>
        {files.length === 0 ? (
          <p className="muted">{t('admin.backupNoFiles')}</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table backup-table">
              <thead>
                <tr>
                  <th>{t('admin.backupFile')}</th>
                  <th>{t('admin.backupModified')}</th>
                  <th>{t('admin.backupSize')}</th>
                  <th>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {files.map((entry) => (
                  <tr key={entry.name}>
                    <td className="backup-file-name">{entry.name}</td>
                    <td>{formatDate(entry.modifiedAt, locale)}</td>
                    <td>{formatSize(entry.size, locale)}</td>
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="button small"
                          disabled={busy}
                          onClick={() => void restoreFile(entry.name)}
                        >
                          {t('admin.backupRestore')}
                        </button>
                        <button
                          type="button"
                          className="button small danger"
                          disabled={busy}
                          onClick={() => void deleteFile(entry.name)}
                        >
                          {t('common.delete')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
