import type { DB } from './db';

export type Language = 'fr' | 'en' | 'de';

export interface ThemeColors {
  primary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
}

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  fromName: string;
  fromEmail: string;
}

export interface AppSettings {
  appName: string;
  baseUrl: string;
  defaultLanguage: Language;
  defaultTimezone: string;
  dateFormat: string;
  timeFormat: '12' | '24';
  firstDay: number;
  weekendDays: number[];
  workHours: { start: string; end: string };
  defaultView: 'day' | 'week' | 'month';
  fields: {
    location: boolean;
    url: boolean;
    priority: boolean;
    visibility: boolean;
    participants: boolean;
    recurrence: boolean;
  };
  allowHtmlDescription: boolean;
  priorities: string[];
  visibilityOptions: string[];
  theme: { light: ThemeColors; dark: ThemeColors };
  smtp: SmtpSettings;
  sessionDurationDays: number;
  setupCompleted: boolean;
}

export const defaultSettings: AppSettings = {
  appName: 'TeamCal',
  baseUrl: '',
  defaultLanguage: 'fr',
  defaultTimezone: 'Europe/Paris',
  dateFormat: 'dd/MM/yyyy',
  timeFormat: '24',
  firstDay: 1,
  weekendDays: [0, 6],
  workHours: { start: '08:00', end: '18:00' },
  defaultView: 'week',
  fields: {
    location: true,
    url: true,
    priority: true,
    visibility: true,
    participants: true,
    recurrence: true
  },
  allowHtmlDescription: false,
  priorities: ['low', 'normal', 'high'],
  visibilityOptions: ['default', 'private', 'public'],
  theme: {
    light: {
      primary: '#2f6feb',
      accent: '#1f9d55',
      background: '#f5f7fb',
      surface: '#ffffff',
      text: '#1c2434',
      muted: '#64748b',
      border: '#dbe2ee'
    },
    dark: {
      primary: '#6ea8ff',
      accent: '#4ade80',
      background: '#0f1622',
      surface: '#182132',
      text: '#e6edf7',
      muted: '#93a3b8',
      border: '#2a3648'
    }
  },
  smtp: {
    host: '',
    port: 587,
    secure: false,
    user: '',
    password: '',
    fromName: 'TeamCal',
    fromEmail: ''
  },
  sessionDurationDays: 14,
  setupCompleted: false
};

export class SettingsStore {
  constructor(private db: DB) {}

  get(): AppSettings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as {
      key: string;
      value: string;
    }[];
    const stored: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        stored[row.key] = JSON.parse(row.value);
      } catch {
        stored[row.key] = row.value;
      }
    }
    return mergeSettings(defaultSettings, stored);
  }

  set(patch: Record<string, unknown>): AppSettings {
    const current = this.get() as unknown as Record<string, unknown>;
    const merged = mergeSettings(current as unknown as AppSettings, patch);
    const upsert = this.db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    );
    this.db.transaction(() => {
      for (const [key, value] of Object.entries(patch)) {
        const next = (merged as unknown as Record<string, unknown>)[key];
        upsert.run(key, JSON.stringify(next));
      }
    })();
    return merged;
  }

  publicView(): Record<string, unknown> {
    const s = this.get();
    return {
      appName: s.appName,
      baseUrl: s.baseUrl,
      defaultLanguage: s.defaultLanguage,
      defaultTimezone: s.defaultTimezone,
      dateFormat: s.dateFormat,
      timeFormat: s.timeFormat,
      firstDay: s.firstDay,
      weekendDays: s.weekendDays,
      workHours: s.workHours,
      defaultView: s.defaultView,
      fields: s.fields,
      allowHtmlDescription: s.allowHtmlDescription,
      priorities: s.priorities,
      visibilityOptions: s.visibilityOptions,
      theme: s.theme,
      setupCompleted: s.setupCompleted
    };
  }
}

function mergeSettings(base: AppSettings, patch: Record<string, unknown>): AppSettings {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in base)) continue;
    const currentValue = (base as unknown as Record<string, unknown>)[key];
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      currentValue &&
      typeof currentValue === 'object' &&
      !Array.isArray(currentValue)
    ) {
      result[key] = { ...(currentValue as object), ...(value as object) };
    } else if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as unknown as AppSettings;
}
