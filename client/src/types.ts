export type Language = 'fr' | 'en' | 'de';
export type ViewKind = 'day' | 'week' | 'month';
export type ThemeKind = 'light' | 'dark';

export interface User {
  id: string;
  username: string;
  email?: string;
  firstName: string;
  lastName: string;
  isAdmin: boolean;
  isActive: boolean;
  language: Language;
  timezone: string | null;
  dateFormat?: string | null;
  timeFormat?: '12' | '24' | null;
  defaultView?: ViewKind | `view:${string}`;
  theme?: ThemeKind | null;
  themeColors?: { light: ThemeColors; dark: ThemeColors } | null;
  feedToken?: string | null;
  country?: string | null;
  lastLoginAt?: string | null;
  createdAt?: string;
}

export interface ThemeColors {
  primary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  documentTitle: string;
  eventText: string;
  headerBackground: string;
  headerText: string;
  cellBackground: string;
  todayBackground: string;
  eventDayBackground: string;
  weekendBackground: string;
  otherMonthBackground: string;
  weekNumberColor: string;
  eventDetailsBackground: string;
  eventDetailsText: string;
}

export interface PublicSettings {
  appName: string;
  baseUrl: string;
  defaultLanguage: Language;
  defaultTimezone: string;
  dateFormat: string;
  timeFormat: '12' | '24';
  firstDay: number;
  weekendDays: number[];
  workHours: { start: string; end: string };
  defaultView: ViewKind;
  fields: {
    location: boolean;
    url: boolean;
    priority: boolean;
    visibility: boolean;
    participants: boolean;
    recurrence: boolean;
  };
  allowHtmlDescription: boolean;
  allowUserColors: boolean;
  priorities: string[];
  visibilityOptions: string[];
  theme: { light: ThemeColors; dark: ThemeColors };
  setupCompleted: boolean;
}

export interface HolidaySource {
  id: string;
  country: string;
  url: string;
  name: string;
}

export interface HolidaySyncResult {
  sources: number;
  users: number;
  created: number;
  updated: number;
  deleted: number;
  errors: string[];
}

export interface BackupSettings {
  enabled: boolean;
  host: string;
  share: string;
  username: string;
  password: string;
  domain: string;
  folder: string;
  day: 'all' | number;
  time: string;
  keep: number;
  hasPassword?: boolean;
}

export interface BackupFile {
  name: string;
  size: number;
  modifiedAt: string;
}

export interface BackupResult {
  file: string;
  size: number;
  deleted: string[];
}

export interface AdminHoliday {
  key: string;
  country: string;
  date: string;
  title: string;
  users: number;
  manual: boolean;
}

export interface ImportIcsResult {
  imported: number;
  updated: number;
  skipped: number;
  exceptions: number;
  categoriesMatched: number;
  unmatchedCategories: string[];
  warnings: string[];
}

export interface AdminSettings extends PublicSettings {
  holidaySources: HolidaySource[];
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    password: string;
    fromName: string;
    fromEmail: string;
    hasPassword?: boolean;
  };
  backup: BackupSettings;
  sessionDurationDays: number;
}

export interface Calendar {
  id: string;
  ownerId: string;
  ownerUsername: string;
  ownerName: string;
  ownerActive: boolean;
  name: string;
  color: string;
  isOwner: boolean;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export interface CalendarAclEntry {
  userId: string;
  username: string;
  name: string;
  isActive: boolean;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export interface Category {
  id: string;
  name: string;
  color: string;
}

export interface Occurrence {
  id: string;
  eventId: string;
  uid: string;
  title: string;
  description: string;
  start: string;
  end: string;
  allDay: boolean;
  timezone: string;
  location: string | null;
  url: string | null;
  priority: number | null;
  visibility: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  calendarId: string;
  calendarColor: string;
  ownerId: string;
  participantIds: string[];
  rrule: string | null;
  recurring: boolean;
  occurrenceStart: string;
  isException: boolean;
  sequence: number;
  status: string;
  deletedAt?: string | null;
  deletedBy?: string | null;
  editable: boolean;
  deletable: boolean;
}

export interface EventSearchResult {
  id: string;
  title: string;
  description: string;
  start: string;
  end: string;
  allDay: boolean;
  timezone: string;
  calendarName?: string | null;
  calendarColor?: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  participants: string[];
}

export interface EventSearchResponse {
  total: number;
  results: EventSearchResult[];
}

export interface EventConflict {
  eventId: string;
  occurrenceStart: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
}

export interface EventConflictDetails {
  conflicts: EventConflict[];
  total: number;
}

export interface AuditReportEntry {
  id: string;
  action: 'created' | 'updated' | 'deleted';
  createdAt: string;
  actor: {
    id: string | null;
    username: string | null;
    name: string;
  };
  agenda: {
    id: string;
    name: string | null;
    username: string | null;
    ownerName: string;
  } | null;
  event: {
    id: string;
    title: string;
    start: string | null;
    end: string | null;
    allDay: boolean;
    status: string | null;
    deleted: boolean;
    deletedAt: string | null;
    available: boolean;
  };
}

export interface AuditReportResponse {
  entries: AuditReportEntry[];
}

export interface SystemReportEntry {
  id: string;
  action: string;
  createdAt: string;
  ip: string | null;
  actor: {
    id: string | null;
    username: string | null;
    name: string;
  };
  target: {
    id: string | null;
    label: string;
    username: string;
    kind: string;
  } | null;
  details: Record<string, unknown>;
}

export interface SettingChange {
  path: string;
  before: string;
  after: string;
  secret?: boolean;
}

export interface SystemReportResponse {
  entries: SystemReportEntry[];
}

export interface EventHistoryEntry {
  id: string;
  action: 'created' | 'updated' | 'deleted';
  createdAt: string;
  actorName: string;
  fields: string[];
  scope: string | null;
}

export interface EventDetail {
  event: Occurrence & {
    recurrenceUntil?: string | null;
    createdAt?: string;
    updatedAt?: string;
    createdByName?: string;
    updatedByName?: string;
  };
  exceptions: {
    id: string;
    occurrence_start: string;
    action: string;
    override_json: string | null;
  }[];
  history?: EventHistoryEntry[];
  editable: boolean;
  deletable: boolean;
}

export interface CustomView {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  isShared: boolean;
  userIds: string[];
  createdAt: string;
}

export interface Recurrence {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  byWeekday?: number[];
  until?: string | null;
  count?: number | null;
}

export interface EventPayload {
  calendarId: string;
  title: string;
  description?: string;
  start: string;
  end: string;
  allDay: boolean;
  timezone?: string;
  location?: string | null;
  url?: string | null;
  priority?: number | null;
  visibility?: string;
  categoryId?: string | null;
  participantIds?: string[];
  recurrence?: Recurrence | null;
  force?: boolean;
}
