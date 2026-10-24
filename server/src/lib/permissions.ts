import type { DB } from '../db';
import type { UserRow } from './auth';

export interface CalendarRow {
  id: string;
  owner_id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface CalendarAccess {
  calendar: CalendarRow;
  isOwner: boolean;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export function getCalendar(db: DB, calendarId: string): CalendarRow | undefined {
  return db.prepare('SELECT * FROM calendars WHERE id = ?').get(calendarId) as CalendarRow | undefined;
}

export function calendarAccess(db: DB, user: UserRow, calendarId: string): CalendarAccess | null {
  const calendar = getCalendar(db, calendarId);
  if (!calendar) return null;
  if (user.is_admin || calendar.owner_id === user.id) {
    return { calendar, isOwner: calendar.owner_id === user.id, canView: true, canCreate: true, canEdit: true, canDelete: true };
  }
  const acl = db
    .prepare('SELECT * FROM calendar_acl WHERE calendar_id = ? AND user_id = ?')
    .get(calendarId, user.id) as
    | { can_view: number; can_create: number; can_edit: number; can_delete: number }
    | undefined;
  if (!acl) {
    return { calendar, isOwner: false, canView: false, canCreate: false, canEdit: false, canDelete: false };
  }
  return {
    calendar,
    isOwner: false,
    canView: Boolean(acl.can_view),
    canCreate: Boolean(acl.can_create),
    canEdit: Boolean(acl.can_edit),
    canDelete: Boolean(acl.can_delete)
  };
}

export interface EventRow {
  id: string;
  uid: string;
  calendar_id: string;
  owner_id: string;
  created_by: string;
  title: string;
  description: string;
  start_at: string;
  end_at: string;
  all_day: number;
  timezone: string;
  location: string | null;
  url: string | null;
  priority: number | null;
  visibility: string;
  category_id: string | null;
  rrule: string | null;
  recurrence_until: string | null;
  rdates?: string | null;
  holiday_source_id?: string | null;
  holiday_key?: string | null;
  sequence: number;
  status: string;
  deleted_at?: string | null;
  deleted_by?: string | null;
  created_at: string;
  updated_at: string;
}

export function isParticipant(db: DB, eventId: string, userId: string): boolean {
  return Boolean(
    db.prepare('SELECT 1 FROM event_participants WHERE event_id = ? AND user_id = ?').get(eventId, userId)
  );
}

export function canViewEvent(db: DB, user: UserRow, event: EventRow): boolean {
  const access = calendarAccess(db, user, event.calendar_id);
  if (access?.canView) return true;
  return isParticipant(db, event.id, user.id);
}

export function canEditEvent(db: DB, user: UserRow, event: EventRow): boolean {
  if (user.is_admin) return true;
  if (event.owner_id === user.id || event.created_by === user.id) return true;
  const access = calendarAccess(db, user, event.calendar_id);
  return Boolean(access?.canEdit);
}

export function canDeleteEvent(db: DB, user: UserRow, event: EventRow): boolean {
  if (user.is_admin) return true;
  if (event.owner_id === user.id || event.created_by === user.id) return true;
  const access = calendarAccess(db, user, event.calendar_id);
  return Boolean(access?.canDelete);
}
