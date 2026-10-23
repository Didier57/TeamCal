import { useState } from 'react';
import { apiDelete, apiPatch, apiPost, ApiError } from '../api';
import { useAuth } from '../app-context';
import { useI18n } from '../i18n';
import type { Calendar, CustomView, User } from '../types';

interface Props {
  views: CustomView[];
  calendars: Calendar[];
  users: User[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}

interface FormState {
  id: string | null;
  name: string;
  userIds: string[];
  isShared: boolean;
}

const emptyForm: FormState = { id: null, name: '', userIds: [], isShared: false };

export function ViewsDialog({ views, calendars, users, onClose, onChanged }: Props) {
  const { user } = useAuth();
  const { t, errorMessage } = useI18n();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const resourceOwners = Array.from(
    new Map(calendars.map((calendar) => [calendar.ownerId, calendar.ownerName])).entries()
  );

  function startEdit(view: CustomView) {
    setForm({ id: view.id, name: view.name, userIds: view.userIds, isShared: view.isShared });
    setError(null);
  }

  async function save() {
    if (!form.name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      if (form.id) {
        await apiPatch(`/views/${form.id}`, {
          name: form.name.trim(),
          userIds: form.userIds,
          isShared: form.isShared
        });
      } else {
        await apiPost('/views', {
          name: form.name.trim(),
          userIds: form.userIds,
          isShared: form.isShared
        });
      }
      setForm(emptyForm);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? errorMessage(err.code) : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(view: CustomView) {
    if (!window.confirm(t('views.deleteConfirm'))) return;
    setBusy(true);
    try {
      await apiDelete(`/views/${view.id}`);
      if (form.id === view.id) setForm(emptyForm);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? errorMessage(err.code) : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal wide"
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h2>{t('views.title')}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t('common.close')}>
            ×
          </button>
        </div>
        <div className="modal-body two-columns">
          <div>
            <div className="list">
              {views.length === 0 && <p className="muted">{t('views.empty')}</p>}
              {views.map((view) => (
                <div key={view.id} className="list-row">
                  <div>
                    <strong>{view.name}</strong>
                    <small>
                      {view.isShared ? t('views.global') : t('views.personal')} · {view.userIds.length}{' '}
                      {t('calendar.resources').toLowerCase()}
                    </small>
                  </div>
                  <div className="row-actions">
                    <button type="button" className="button small" onClick={() => startEdit(view)}>
                      {t('common.edit')}
                    </button>
                    <button type="button" className="button small danger" onClick={() => void remove(view)}>
                      {t('common.delete')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3>{form.id ? t('views.edit') : t('views.createTitle')}</h3>
            <div className="form">
              <label>
                <span>{t('views.name')}</span>
                <input
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  maxLength={80}
                />
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={form.isShared}
                  onChange={(event) => setForm({ ...form, isShared: event.target.checked })}
                />
                <span>{t('views.shared')}</span>
              </label>
              <p className="hint">{t('views.sharedHint')}</p>
              <div className="field-label">{t('views.users')}</div>
              <div className="checkbox-list">
                {resourceOwners.map(([ownerId, ownerName]) => (
                  <label key={ownerId} className="checkbox">
                    <input
                      type="checkbox"
                      checked={form.userIds.includes(ownerId)}
                      onChange={(event) => {
                        const ids = new Set(form.userIds);
                        if (event.target.checked) ids.add(ownerId);
                        else ids.delete(ownerId);
                        setForm({ ...form, userIds: Array.from(ids) });
                      }}
                    />
                    <span>{ownerName}</span>
                  </label>
                ))}
              </div>
              {error && <div className="alert error">{error}</div>}
              <div className="row-actions">
                <button type="button" className="button primary" disabled={busy} onClick={() => void save()}>
                  {t('common.save')}
                </button>
                {form.id && (
                  <button type="button" className="button ghost" onClick={() => setForm(emptyForm)}>
                    {t('common.cancel')}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
