import { useI18n } from '../i18n';
import type { Recurrence } from '../types';
import { defaultRecurrence } from '../recurrence-utils';

interface Props {
  value: Recurrence | null;
  onChange: (value: Recurrence | null) => void;
}

export function RecurrenceEditor({ value, onChange }: Props) {
  const { t, locale } = useI18n();
  const weekdayLabels = Array.from({ length: 7 }, (_, index) =>
    new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(Date.UTC(2024, 0, 1 + index)))
  );

  const frequency = value?.frequency ?? '';
  const endMode = value?.until ? 'until' : value?.count ? 'count' : 'never';

  function update(patch: Partial<Recurrence>) {
    onChange({ ...(value ?? defaultRecurrence()), ...patch });
  }

  return (
    <div className="recurrence-editor">
      <label>
        <span>{t('event.repeat')}</span>
        <select
          value={frequency}
          onChange={(event) => {
            const next = event.target.value;
            if (!next) {
              onChange(null);
              return;
            }
            onChange({
              ...(value ?? defaultRecurrence()),
              frequency: next as Recurrence['frequency']
            });
          }}
        >
          <option value="">{t('recurrence.none')}</option>
          <option value="daily">{t('recurrence.daily')}</option>
          <option value="weekly">{t('recurrence.weekly')}</option>
          <option value="monthly">{t('recurrence.monthly')}</option>
          <option value="yearly">{t('recurrence.yearly')}</option>
        </select>
      </label>
      {value && (
        <>
          <label className="inline">
            <span>{t('recurrence.every')}</span>
            <input
              type="number"
              min={1}
              max={99}
              value={value.interval}
              onChange={(event) => update({ interval: Math.max(1, Number(event.target.value) || 1) })}
            />
            <span>
              {value.frequency === 'daily'
                ? t('common.day')
                : value.frequency === 'weekly'
                  ? t('common.week')
                  : value.frequency === 'monthly'
                    ? t('common.month')
                    : 'an'}
            </span>
          </label>
          {value.frequency === 'weekly' && (
            <div className="weekday-picker">
              {weekdayLabels.map((label, index) => (
                <label key={index} className="weekday">
                  <input
                    type="checkbox"
                    checked={(value.byWeekday ?? []).includes(index)}
                    onChange={(event) => {
                      const current = new Set(value.byWeekday ?? []);
                      if (event.target.checked) current.add(index);
                      else current.delete(index);
                      update({ byWeekday: Array.from(current).sort() });
                    }}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          )}
          <label>
            <span>{t('common.end')}</span>
            <select
              value={endMode}
              onChange={(event) => {
                if (event.target.value === 'never') update({ until: null, count: null });
                else if (event.target.value === 'until') update({ count: null });
                else update({ until: null });
              }}
            >
              <option value="never">{t('recurrence.endsNever')}</option>
              <option value="until">{t('recurrence.endsOn')}</option>
              <option value="count">{t('recurrence.endsAfter')}</option>
            </select>
          </label>
          {endMode === 'until' && (
            <label>
              <span>{t('recurrence.until')}</span>
              <input
                type="date"
                value={value.until ?? ''}
                onChange={(event) => update({ until: event.target.value || null })}
              />
            </label>
          )}
          {endMode === 'count' && (
            <label>
              <span>{t('recurrence.count')}</span>
              <input
                type="number"
                min={1}
                max={1000}
                value={value.count ?? 10}
                onChange={(event) => update({ count: Math.max(1, Number(event.target.value) || 1) })}
              />
            </label>
          )}
        </>
      )}
    </div>
  );
}
