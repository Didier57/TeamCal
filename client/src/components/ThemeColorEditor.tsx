import { useI18n } from '../i18n';
import type { ThemeColors } from '../types';

const fields: { key: keyof ThemeColors; label: string }[] = [
  { key: 'background', label: 'theme.background' },
  { key: 'documentTitle', label: 'theme.documentTitle' },
  { key: 'text', label: 'theme.documentText' },
  { key: 'eventText', label: 'theme.eventText' },
  { key: 'border', label: 'theme.gridColor' },
  { key: 'headerBackground', label: 'theme.headerBackground' },
  { key: 'headerText', label: 'theme.headerText' },
  { key: 'cellBackground', label: 'theme.cellBackground' },
  { key: 'todayBackground', label: 'theme.todayBackground' },
  { key: 'eventDayBackground', label: 'theme.eventDayBackground' },
  { key: 'weekendBackground', label: 'theme.weekendBackground' },
  { key: 'otherMonthBackground', label: 'theme.otherMonthBackground' },
  { key: 'weekNumberColor', label: 'theme.weekNumberColor' },
  { key: 'eventDetailsBackground', label: 'theme.eventDetailsBackground' },
  { key: 'eventDetailsText', label: 'theme.eventDetailsText' }
];

interface Props {
  value: { light: ThemeColors; dark: ThemeColors };
  onChange: (value: { light: ThemeColors; dark: ThemeColors }) => void;
  showPreview?: boolean;
}

function ThemePreview({ theme }: { theme: { light: ThemeColors; dark: ThemeColors } }) {
  const { t, locale } = useI18n();
  const monthLabel = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(
    new Date(2026, 9, 1)
  );
  const weekdays = Array.from({ length: 7 }, (_, index) =>
    new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(2026, 9, 5 + index))
  );
  const days = [28, 29, 30, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 1];
  const weeks = [days.slice(0, 7), days.slice(7, 14), days.slice(14, 21), days.slice(21, 28), days.slice(28, 35)];

  function calendar(colors: ThemeColors, label: string) {
    return (
      <div className="theme-mini" style={{ background: colors.background, borderColor: colors.border }}>
        <div className="theme-mini-title" style={{ color: colors.documentTitle }}>
          {monthLabel} <span>{label}</span>
        </div>
        <div
          className="theme-mini-grid"
          style={{ gridTemplateColumns: '30px repeat(7, minmax(30px, 1fr))' }}
        >
          <div
            className="theme-mini-week"
            style={{ background: colors.weekNumberColor, color: colors.eventText, borderColor: colors.border }}
          >
            {t('theme.weekShort')}
          </div>
          {weekdays.map((day) => (
            <div
              key={day}
              className="theme-mini-head"
              style={{
                background: colors.headerBackground,
                color: colors.headerText,
                borderColor: colors.border
              }}
            >
              {day}
            </div>
          ))}
          {weeks.map((week, weekIndex) => (
            <div className="theme-mini-week-row" key={weekIndex} style={{ display: 'contents' }}>
              <div
                className="theme-mini-week"
                style={{
                  background: colors.weekNumberColor,
                  color: colors.eventText,
                  borderColor: colors.border
                }}
              >
                {43 + weekIndex}
              </div>
              {week.map((day, dayIndex) => {
                const isWeekend = dayIndex >= 5;
                const isToday = weekIndex === 3 && dayIndex === 3;
                const hasEvent = (weekIndex === 1 && dayIndex === 2) || (weekIndex === 3 && dayIndex === 3);
                return (
                  <div
                    key={`${weekIndex}-${dayIndex}`}
                    className="theme-mini-day"
                    style={{
                      background: isToday
                        ? colors.todayBackground
                        : hasEvent
                          ? colors.eventDayBackground
                          : isWeekend
                            ? colors.weekendBackground
                            : colors.cellBackground,
                      color: colors.text,
                      borderColor: colors.border
                    }}
                  >
                    {day}
                    {hasEvent && (
                      <span className="theme-mini-event" style={{ color: colors.eventText }}>
                        {t('theme.sampleEvent')}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="theme-preview-wrap">
      {calendar(theme.light, t('common.light'))}
      {calendar(theme.dark, t('common.dark'))}
      <div
        className="theme-details-preview"
        style={{
          background: theme.light.eventDetailsBackground,
          color: theme.light.eventDetailsText,
          borderColor: theme.light.border
        }}
      >
        {t('theme.eventDetails')}
      </div>
    </div>
  );
}

export function ThemeColorEditor({ value, onChange, showPreview = true }: Props) {
  const { t } = useI18n();

  function update(kind: 'light' | 'dark', key: keyof ThemeColors, color: string) {
    onChange({ ...value, [kind]: { ...value[kind], [key]: color } });
  }

  return (
    <div className="theme-editor">
      <div className="theme-color-rows">
        {fields.map((field) => (
          <div className="theme-color-row" key={field.key}>
            <span className="theme-color-label">{t(field.label)}</span>
            {(['light', 'dark'] as const).map((kind) => (
              <label className="theme-color-control" key={kind}>
                <span>{kind === 'light' ? t('common.light') : t('common.dark')}</span>
                <input
                  type="color"
                  value={value[kind][field.key]}
                  onChange={(event) => update(kind, field.key, event.target.value)}
                />
                <input
                  className="theme-hex"
                  value={value[kind][field.key]}
                  onChange={(event) => {
                    const next = event.target.value;
                    update(kind, field.key, next);
                  }}
                  maxLength={7}
                />
              </label>
            ))}
          </div>
        ))}
      </div>
      {showPreview && <ThemePreview theme={value} />}
    </div>
  );
}
