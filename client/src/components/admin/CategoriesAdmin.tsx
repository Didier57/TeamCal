import { useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from '../../api';
import { useI18n } from '../../i18n';
import type { Category } from '../../types';

interface Row {
  id: string | null;
  name: string;
  color: string;
  isHoliday: boolean;
}

const blank: Row = { id: null, name: '', color: '#2f6feb', isHoliday: false };

export function CategoriesAdmin() {
  const { t, errorMessage } = useI18n();
  const [rows, setRows] = useState<Row[]>([]);
  const [newRow, setNewRow] = useState<Row>(blank);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const list = await apiGet<Category[]>('/categories');
    setRows(
      list.map((item) => ({
        id: item.id,
        name: item.name,
        color: item.color,
        isHoliday: item.isHoliday
      }))
    );
  }

  useEffect(() => {
    void load().catch(() => setError(t('common.error')));
  }, [t]);

  function setHoliday(index: number, checked: boolean) {
    setRows((current) =>
      current.map((row, rowIndex) => ({
        ...row,
        isHoliday: rowIndex === index ? checked : checked ? false : row.isHoliday
      }))
    );
  }

  async function add() {
    if (!newRow.name.trim()) return;
    setBusy(true);
    try {
      await apiPost('/categories', {
        name: newRow.name.trim(),
        color: newRow.color,
        isHoliday: newRow.isHoliday
      });
      setNewRow(blank);
      await load();
      setFlash(t('common.saved'));
    } catch (err) {
      setError(err instanceof ApiError ? errorMessage(err.code) : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  async function save(row: Row) {
    if (!row.id || !row.name.trim()) return;
    setBusy(true);
    try {
      await apiPatch(`/categories/${row.id}`, {
        name: row.name.trim(),
        color: row.color,
        isHoliday: row.isHoliday
      });
      await load();
      setFlash(t('common.saved'));
    } catch (err) {
      setError(err instanceof ApiError ? errorMessage(err.code) : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: Row) {
    if (!row.id) return;
    if (!window.confirm(t('admin.deleteCategoryConfirm'))) return;
    setBusy(true);
    try {
      await apiDelete(`/categories/${row.id}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? errorMessage(err.code) : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-section">
      <div className="section-header">
        <h2>{t('admin.categoriesTitle')}</h2>
      </div>
      {flash && <div className="alert info">{flash}</div>}
      {error && <div className="alert error">{error}</div>}
      <div className="panel">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('admin.categoryName')}</th>
                <th>{t('admin.categoryColor')}</th>
                <th title={t('admin.categoryHolidayHint')}>{t('admin.categoryHoliday')}</th>
                <th>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.id ?? index}>
                  <td>
                    <input
                      value={row.name}
                      onChange={(event) => {
                        const next = [...rows];
                        next[index] = { ...row, name: event.target.value };
                        setRows(next);
                      }}
                    />
                  </td>
                  <td>
                    <input
                      type="color"
                      value={row.color}
                      onChange={(event) => {
                        const next = [...rows];
                        next[index] = { ...row, color: event.target.value };
                        setRows(next);
                      }}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={row.isHoliday}
                      aria-label={t('admin.categoryHoliday')}
                      onChange={(event) => setHoliday(index, event.target.checked)}
                    />
                  </td>
                  <td className="row-actions">
                    <button type="button" className="button small" disabled={busy} onClick={() => void save(row)}>
                      {t('common.save')}
                    </button>
                    <button type="button" className="button small danger" disabled={busy} onClick={() => void remove(row)}>
                      {t('common.delete')}
                    </button>
                  </td>
                </tr>
              ))}
              <tr>
                <td>
                  <input
                    value={newRow.name}
                    placeholder={t('admin.addCategory')}
                    onChange={(event) => setNewRow({ ...newRow, name: event.target.value })}
                  />
                </td>
                <td>
                  <input
                    type="color"
                    value={newRow.color}
                    onChange={(event) => setNewRow({ ...newRow, color: event.target.value })}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={newRow.isHoliday}
                    aria-label={t('admin.categoryHoliday')}
                    onChange={(event) => setNewRow({ ...newRow, isHoliday: event.target.checked })}
                  />
                </td>
                <td>
                  <button type="button" className="button primary small" disabled={busy} onClick={() => void add()}>
                    + {t('common.add')}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
