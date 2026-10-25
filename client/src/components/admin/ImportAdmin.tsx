import { useEffect, useState } from 'react';
import { apiGet, apiPost, ApiError } from '../../api';
import { useAuth } from '../../app-context';
import { useI18n } from '../../i18n';
import type { Category, ImportIcsResult, User } from '../../types';

const MAX_FILE_SIZE = 10_000_000;

export function ImportAdmin({ selfOnly = false }: { selfOnly?: boolean }) {
  const { user } = useAuth();
  const { t, errorMessage } = useI18n();
  const [users, setUsers] = useState<User[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [userId, setUserId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [result, setResult] = useState<ImportIcsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const usersRequest = selfOnly ? Promise.resolve<User[]>([]) : apiGet<User[]>('/users/all');
    Promise.all([usersRequest, apiGet<Category[]>('/categories')])
      .then(([loadedUsers, loadedCategories]) => {
        setUsers(loadedUsers);
        setCategories(loadedCategories);
        if (selfOnly) {
          setUserId(user?.id ?? '');
        } else {
          setUserId((current) => current || loadedUsers.find((entry) => entry.isActive)?.id || '');
        }
      })
      .catch(() => setError(t('common.error')));
  }, [t, selfOnly, user?.id]);

  async function runImport() {
    if (!userId || !file) {
      setError(t('admin.importRequired'));
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError(t('admin.importTooLarge'));
      return;
    }
    setBusy(true);
    setError(null);
    setFlash(null);
    setResult(null);
    try {
      const content = await file.text();
      const imported = await apiPost<ImportIcsResult>('/import/ics', {
        userId,
        defaultCategoryId: categoryId || null,
        content
      });
      setResult(imported);
      setFlash(t('admin.importDone'));
      setFile(null);
      setFileInputKey((value) => value + 1);
    } catch (err) {
      setError(err instanceof ApiError ? errorMessage(err.code) : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={selfOnly ? 'admin-section events-page' : 'admin-section'}>
      <div className="section-header">
        <h2>{selfOnly ? t('events.importTitle') : t('admin.importTitle')}</h2>
      </div>
      <div className="panel">
        <p className="hint">{selfOnly ? t('events.importHelp') : t('admin.importHelp')}</p>
        <div className="form-grid">
          <label className="field">
            <span>{t('admin.importUser')}</span>
            {selfOnly ? (
              <input
                readOnly
                value={`${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim() || user?.username || ''}
              />
            ) : (
              <select value={userId} onChange={(event) => setUserId(event.target.value)}>
                {users.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {`${entry.firstName} ${entry.lastName}`.trim() || entry.username} (
                    {entry.username}){entry.isActive ? '' : ` - ${t('common.inactive')}`}
                  </option>
                ))}
              </select>
            )}
          </label>
          <label className="field">
            <span>{t('admin.importCategory')}</span>
            <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              <option value="">{t('admin.importCategoryNone')}</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field span-2">
            <span>{t('admin.importFile')}</span>
            <input
              key={fileInputKey}
              type="file"
              accept=".ics,text/calendar,application/ics"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <span className="hint">{t('admin.importCategoryHint')}</span>
          </label>
        </div>
        <div className="import-actions">
          <button
            type="button"
            className="button primary"
            disabled={busy || !userId || !file}
            onClick={() => void runImport()}
          >
            {busy ? t('admin.importing') : t('admin.importButton')}
          </button>
        </div>
      </div>
      {flash && <div className="alert info">{flash}</div>}
      {error && <div className="alert error">{error}</div>}
      {result && (
        <div className="panel import-result">
          <h3>{t('admin.importResult')}</h3>
          <div className="import-stats">
            <span>
              <strong>{result.imported}</strong> {t('admin.importImported')}
            </span>
            <span>
              <strong>{result.updated}</strong> {t('admin.importUpdated')}
            </span>
            <span>
              <strong>{result.skipped}</strong> {t('admin.importSkipped')}
            </span>
            <span>
              <strong>{result.exceptions}</strong> {t('admin.importExceptions')}
            </span>
            <span>
              <strong>{result.categoriesMatched}</strong> {t('admin.importCategoriesMatched')}
            </span>
          </div>
          {result.unmatchedCategories.length > 0 && (
            <p className="hint">
              {t('admin.importUnmatched')}: {result.unmatchedCategories.join(', ')}
            </p>
          )}
          {result.warnings.length > 0 && (
            <p className="hint">
              {t('admin.importWarnings')}: {result.warnings.join(', ')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
