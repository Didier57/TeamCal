import { useEffect, useState } from 'react';
import { apiGet, apiPatch, apiPost, ApiError } from '../../api';
import { useAuth } from '../../app-context';
import { languageLabel, useI18n } from '../../i18n';
import { countryLabel, EUROPEAN_COUNTRY_CODES } from '../../countries';
import type { Language, User } from '../../types';

interface FormState {
  id: string | null;
  username: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  language: Language;
  timezone: string;
  country: string;
  isAdmin: boolean;
  isActive: boolean;
}

const empty: FormState = {
  id: null,
  username: '',
  firstName: '',
  lastName: '',
  email: '',
  password: '',
  language: 'fr',
  timezone: '',
  country: '',
  isAdmin: false,
  isActive: true
};

const timezones = [
  '',
  'Europe/Paris',
  'Europe/Brussels',
  'Europe/Luxembourg',
  'Europe/Geneva',
  'Europe/Berlin',
  'Europe/London',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'UTC'
];

export function UsersAdmin() {
  const { t, errorMessage, locale } = useI18n();
  const { refresh } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [resetFor, setResetFor] = useState<User | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const list = await apiGet<User[]>('/users');
    setUsers(list);
  }

  useEffect(() => {
    void load().catch(() => setError(t('common.error')));
  }, [t]);

  function startCreate() {
    setForm({ ...empty });
    setError(null);
  }

  function startEdit(user: User) {
    setForm({
      id: user.id,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email ?? '',
      password: '',
      language: user.language,
      timezone: user.timezone ?? '',
      country: user.country ?? '',
      isAdmin: user.isAdmin,
      isActive: user.isActive
    });
    setError(null);
  }

  async function save() {
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      if (form.id) {
        await apiPatch(`/users/${form.id}`, {
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email,
          language: form.language,
          timezone: form.timezone || null,
          country: form.country || null,
          isAdmin: form.isAdmin,
          isActive: form.isActive
        });
        setFlash(t('admin.userUpdated'));
      } else {
        await apiPost('/users', {
          username: form.username,
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email,
          password: form.password,
          language: form.language,
          timezone: form.timezone || undefined,
          country: form.country || undefined,
          isAdmin: form.isAdmin
        });
        setFlash(t('admin.userCreated'));
      }
      setForm(null);
      await load();
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? errorMessage(err.code) : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(user: User) {
    if (user.isActive && !window.confirm(t('admin.deactivateConfirm'))) return;
    try {
      await apiPatch(`/users/${user.id}`, { isActive: !user.isActive });
      setFlash(user.isActive ? t('admin.userDisabled') : t('admin.userEnabled'));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? errorMessage(err.code) : t('common.error'));
    }
  }

  async function submitReset() {
    if (!resetFor) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/users/${resetFor.id}/password`, { newPassword: resetPassword });
      setFlash(t('admin.passwordReset'));
      setResetFor(null);
      setResetPassword('');
    } catch (err) {
      setError(err instanceof ApiError ? errorMessage(err.code) : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-section">
      <div className="section-header">
        <h2>{t('admin.usersTitle')}</h2>
        <button type="button" className="button primary" onClick={startCreate}>
          + {t('admin.newUser')}
        </button>
      </div>
      {flash && <div className="alert info">{flash}</div>}
      {error && <div className="alert error">{error}</div>}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('common.name')}</th>
              <th>{t('common.username')}</th>
              <th>{t('common.email')}</th>
              <th>{t('common.language')}</th>
              <th>{t('common.country')}</th>
              <th>{t('common.admin')}</th>
              <th>{t('common.active')}</th>
              <th>{t('admin.lastLogin')}</th>
              <th>{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className={user.isActive ? '' : 'row-muted'}>
                <td>
                  {`${user.firstName} ${user.lastName}`.trim() || user.username}
                </td>
                <td>{user.username}</td>
                <td>{user.email ?? '—'}</td>
                <td>{languageLabel(user.language)}</td>
                <td>{user.country ? countryLabel(user.country, locale) : '-'}</td>
                <td>{user.isAdmin ? t('common.yes') : t('common.no')}</td>
                <td>
                  <span className={`pill ${user.isActive ? 'success' : 'muted'}`}>
                    {user.isActive ? t('common.active') : t('common.inactive')}
                  </span>
                </td>
                <td>
                  {user.lastLoginAt
                    ? new Intl.DateTimeFormat(undefined, {
                        dateStyle: 'short',
                        timeStyle: 'short'
                      }).format(new Date(user.lastLoginAt))
                    : '—'}
                </td>
                <td className="row-actions">
                  <button type="button" className="button small" onClick={() => startEdit(user)}>
                    {t('common.edit')}
                  </button>
                  <button
                    type="button"
                    className="button small"
                    onClick={() => {
                      setResetFor(user);
                      setResetPassword('');
                    }}
                  >
                    {t('admin.resetPassword')}
                  </button>
                  <button
                    type="button"
                    className={`button small ${user.isActive ? 'danger' : ''}`}
                    onClick={() => void toggleActive(user)}
                  >
                    {user.isActive ? t('admin.deactivate') : t('admin.activate')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <div className="panel">
          <h3>{form.id ? t('admin.editUser') : t('admin.newUser')}</h3>
          <div className="form-grid">
            <label>
              <span>{t('setup.firstName')}</span>
              <input value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} />
            </label>
            <label>
              <span>{t('setup.lastName')}</span>
              <input value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} />
            </label>
            <label>
              <span>{t('common.username')}</span>
              <input
                value={form.username}
                onChange={(event) => setForm({ ...form, username: event.target.value })}
                disabled={Boolean(form.id)}
                minLength={3}
              />
            </label>
            <label>
              <span>{t('common.email')}</span>
              <input
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
              />
            </label>
            {!form.id && (
              <label>
                <span>{t('common.password')}</span>
                <input
                  type="password"
                  value={form.password}
                  onChange={(event) => setForm({ ...form, password: event.target.value })}
                  minLength={8}
                />
              </label>
            )}
            <label>
              <span>{t('common.language')}</span>
              <select
                value={form.language}
                onChange={(event) => setForm({ ...form, language: event.target.value as Language })}
              >
                <option value="fr">{languageLabel('fr')}</option>
                <option value="en">{languageLabel('en')}</option>
                <option value="de">{languageLabel('de')}</option>
              </select>
            </label>
            <label>
              <span>{t('common.timezone')}</span>
              <select value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })}>
                {timezones.map((tz) => (
                  <option key={tz || 'default'} value={tz}>
                    {tz || t('admin.defaultTimezone')}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{t('common.country')}</span>
              <select value={form.country} onChange={(event) => setForm({ ...form, country: event.target.value })}>
                <option value="">{t('common.none')}</option>
                {EUROPEAN_COUNTRY_CODES.map((code) => (
                  <option key={code} value={code}>
                    {countryLabel(code, locale)}
                  </option>
                ))}
              </select>
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.isAdmin}
                onChange={(event) => setForm({ ...form, isAdmin: event.target.checked })}
              />
              <span>{t('admin.isAdmin')}</span>
            </label>
            {form.id && (
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
                />
                <span>{t('admin.isActive')}</span>
              </label>
            )}
          </div>
          <div className="row-actions">
            <button type="button" className="button primary" disabled={busy} onClick={() => void save()}>
              {t('common.save')}
            </button>
            <button type="button" className="button ghost" onClick={() => setForm(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {resetFor && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setResetFor(null)}>
          <div className="modal small" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2>{t('admin.resetPassword')}</h2>
              <button type="button" className="icon-button" onClick={() => setResetFor(null)}>
                ×
              </button>
            </div>
            <div className="modal-body form">
              <p>
                {resetFor.firstName} {resetFor.lastName} ({resetFor.username})
              </p>
              <label>
                <span>{t('admin.newPassword')}</span>
                <input
                  type="password"
                  value={resetPassword}
                  onChange={(event) => setResetPassword(event.target.value)}
                  minLength={8}
                />
              </label>
              {error && <div className="alert error">{error}</div>}
            </div>
            <div className="modal-footer">
              <button type="button" className="button ghost" onClick={() => setResetFor(null)}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="button primary"
                disabled={busy || resetPassword.length < 8}
                onClick={() => void submitReset()}
              >
                {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
