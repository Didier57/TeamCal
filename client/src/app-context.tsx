import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';
import { apiGet, apiPost, setCsrfToken } from './api';
import { useI18n } from './i18n';
import type { PublicSettings, ThemeColors, ThemeKind, User } from './types';

interface MeResponse {
  user: User | null;
  csrfToken: string | null;
  settings: PublicSettings;
  needsSetup: boolean;
}

interface AuthContextValue {
  user: User | null;
  settings: PublicSettings | null;
  loading: boolean;
  needsSetup: boolean;
  theme: ThemeKind;
  setTheme: (theme: ThemeKind) => void;
  login: (username: string, password: string, remember: boolean) => Promise<void>;
  setup: (payload: unknown) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  setUser: (user: User) => void;
  setSettings: (settings: PublicSettings) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const defaultThemeColors: { light: ThemeColors; dark: ThemeColors } = {
  light: {
    primary: '#2f6feb',
    accent: '#1f9d55',
    background: '#f5f7fb',
    surface: '#ffffff',
    text: '#1c2434',
    muted: '#64748b',
    border: '#dbe2ee',
    documentTitle: '#1c2434',
    eventText: '#ffffff',
    headerBackground: '#eef2f8',
    headerText: '#1c2434',
    cellBackground: '#ffffff',
    todayBackground: '#e8f0ff',
    eventDayBackground: '#fef9db',
    weekendBackground: '#f3f4f6',
    otherMonthBackground: '#f8fafc',
    weekNumberColor: '#e8590c',
    eventDetailsBackground: '#ffffff',
    eventDetailsText: '#1c2434'
  },
  dark: {
    primary: '#6ea8ff',
    accent: '#4ade80',
    background: '#0f1622',
    surface: '#182132',
    text: '#e6edf7',
    muted: '#93a3b8',
    border: '#2a3648',
    documentTitle: '#e6edf7',
    eventText: '#ffffff',
    headerBackground: '#1f2a3d',
    headerText: '#e6edf7',
    cellBackground: '#182132',
    todayBackground: '#20304a',
    eventDayBackground: '#23351f',
    weekendBackground: '#141c29',
    otherMonthBackground: '#121a26',
    weekNumberColor: '#f97316',
    eventDetailsBackground: '#1f2a3d',
    eventDetailsText: '#e6edf7'
  }
};

function applyThemeColors(theme: ThemeKind, colors: ThemeColors) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.setProperty('--color-primary', colors.primary);
  root.style.setProperty('--color-accent', colors.accent);
  root.style.setProperty('--color-bg', colors.background);
  root.style.setProperty('--color-surface', colors.surface);
  root.style.setProperty('--color-text', colors.text);
  root.style.setProperty('--color-muted', colors.muted);
  root.style.setProperty('--color-border', colors.border);
  root.style.setProperty('--color-title', colors.documentTitle);
  root.style.setProperty('--color-event-text', colors.eventText);
  root.style.setProperty('--color-header-bg', colors.headerBackground);
  root.style.setProperty('--color-header-text', colors.headerText);
  root.style.setProperty('--color-cell-bg', colors.cellBackground);
  root.style.setProperty('--color-today-bg', colors.todayBackground);
  root.style.setProperty('--color-event-day-bg', colors.eventDayBackground);
  root.style.setProperty('--color-weekend-bg', colors.weekendBackground);
  root.style.setProperty('--color-other-month-bg', colors.otherMonthBackground);
  root.style.setProperty('--color-week-number', colors.weekNumberColor);
  root.style.setProperty('--color-event-details-bg', colors.eventDetailsBackground);
  root.style.setProperty('--color-event-details-text', colors.eventDetailsText);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { setLanguage } = useI18n();
  const [user, setUserState] = useState<User | null>(null);
  const [settings, setSettingsState] = useState<PublicSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [theme, setThemeState] = useState<ThemeKind>(
    (localStorage.getItem('teamcal_theme') as ThemeKind) === 'dark' ? 'dark' : 'light'
  );

  const apply = useCallback(
    (response: MeResponse) => {
      setCsrfToken(response.csrfToken);
      setUserState(response.user);
      setSettingsState(response.settings);
      setNeedsSetup(response.needsSetup);
      if (response.user) {
        setLanguage(response.user.language);
      } else {
        setLanguage(response.settings.defaultLanguage);
      }
    },
    [setLanguage]
  );

  const refresh = useCallback(async () => {
    const response = await apiGet<MeResponse>('/auth/me');
    apply(response);
  }, [apply]);

  useEffect(() => {
    refresh()
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    if (!settings) return;
    const globalColors = settings.theme?.[theme] ?? {};
    const userColors =
      settings.allowUserColors && user?.themeColors?.[theme] ? user.themeColors[theme] : undefined;
    applyThemeColors(theme, {
      ...defaultThemeColors[theme],
      ...globalColors,
      ...(userColors ?? {})
    });
    document.title = settings.appName || 'TeamCal';
  }, [settings, theme, user?.themeColors]);

  const login = useCallback(
    async (username: string, password: string, remember: boolean) => {
      const response = await apiPost<MeResponse>('/auth/login', { username, password, remember });
      apply(response);
      setLoading(false);
    },
    [apply]
  );

  const setup = useCallback(
    async (payload: unknown) => {
      const response = await apiPost<MeResponse>('/setup', payload);
      apply(response);
      setLoading(false);
    },
    [apply]
  );

  const logout = useCallback(async () => {
    try {
      await apiPost('/auth/logout');
    } finally {
      setCsrfToken(null);
      setUserState(null);
      await refresh().catch(() => undefined);
    }
  }, [refresh]);

  const setTheme = useCallback((value: ThemeKind) => {
    localStorage.setItem('teamcal_theme', value);
    setThemeState(value);
  }, []);

  const setUser = useCallback((value: User) => setUserState(value), []);
  const setSettings = useCallback((value: PublicSettings) => setSettingsState(value), []);

  const value = useMemo(
    () => ({
      user,
      settings,
      loading,
      needsSetup,
      theme,
      setTheme,
      login,
      setup,
      logout,
      refresh,
      setUser,
      setSettings
    }),
    [user, settings, loading, needsSetup, theme, setTheme, login, setup, logout, refresh, setUser, setSettings]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}

export function useEffectiveTimeZone(): string {
  const { user, settings } = useAuth();
  return user?.timezone || settings?.defaultTimezone || 'UTC';
}
