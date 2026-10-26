import { useI18n } from '../i18n';

export function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function monthRange(month: string, day: string | null): { from: string; to: string } {
  if (day) {
    const [year, monthIndex, dayNumber] = day.split('-').map(Number);
    return {
      from: new Date(year, monthIndex - 1, dayNumber).toISOString(),
      to: new Date(year, monthIndex - 1, dayNumber + 1).toISOString()
    };
  }
  const [year, monthIndex] = month.split('-').map(Number);
  return {
    from: new Date(year, monthIndex - 1, 1).toISOString(),
    to: new Date(year, monthIndex, 1).toISOString()
  };
}

interface Props {
  month: string;
  day: string | null;
  onChange: (month: string, day: string | null) => void;
}

export function MonthNavigator({ month, day, onChange }: Props) {
  const { t, locale } = useI18n();
  const [year, monthIndex] = month.split('-').map(Number);
  const label = new Date(year, monthIndex - 1, 1).toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric'
  });

  function shift(delta: number) {
    const date = new Date(year, monthIndex - 1 + delta, 1);
    onChange(
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
      null
    );
  }

  function pick(value: string) {
    if (!value) {
      onChange(month, null);
      return;
    }
    const [pickedYear, pickedMonth] = value.split('-');
    onChange(`${pickedYear}-${pickedMonth}`, value);
  }

  return (
    <div className="range-nav">
      <button
        type="button"
        className="icon-button"
        onClick={() => shift(-1)}
        title={t('reports.previousMonth')}
        aria-label={t('reports.previousMonth')}
      >
        ‹
      </button>
      <span className="range-label">{label}</span>
      <button
        type="button"
        className="icon-button"
        onClick={() => shift(1)}
        title={t('reports.nextMonth')}
        aria-label={t('reports.nextMonth')}
      >
        ›
      </button>
      <input
        type="date"
        value={day ?? ''}
        onChange={(event) => pick(event.target.value)}
        aria-label={t('reports.pickDate')}
        title={t('reports.pickDate')}
      />
      {day && (
        <button type="button" className="button ghost" onClick={() => onChange(month, null)}>
          {t('reports.wholeMonth')}
        </button>
      )}
    </div>
  );
}
