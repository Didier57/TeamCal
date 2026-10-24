import { describe, expect, it, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { openDatabase, type DB } from './db';
import { createApp } from './app';
import { SettingsStore } from './settings';

async function setupAdmin(app: any) {
  const agent = request.agent(app);
  const response = await agent.post('/api/setup').send({
    appName: 'TeamCal Test',
    baseUrl: 'http://localhost',
    language: 'fr',
    timezone: 'Europe/Paris',
    admin: {
      username: 'admin',
      email: 'admin@example.com',
      firstName: 'Ada',
      lastName: 'Admin',
      password: 'Password123!'
    }
  });
  return { agent, csrf: response.body.csrfToken as string, userId: response.body.user.id as string };
}

describe('TeamCal API', () => {
  let db: DB;
  let app: any;

  beforeEach(() => {
    db = openDatabase(':memory:');
    app = createApp(db, { serveClient: false });
  });

  it('requires setup on first run and creates the administrator', async () => {
    const status = await request(app).get('/api/setup/status');
    expect(status.body.needsSetup).toBe(true);

    const { agent, csrf } = await setupAdmin(app);
    expect(csrf).toBeTruthy();

    const me = await agent.get('/api/auth/me');
    expect(me.body.user.username).toBe('admin');
    expect(me.body.user.isAdmin).toBe(true);
    expect(me.body.needsSetup).toBe(false);

    const again = await request(app).post('/api/setup').send({
      appName: 'x',
      language: 'fr',
      timezone: 'UTC',
      admin: { username: 'other', email: 'o@example.com', password: 'Password123!' }
    });
    expect(again.status).toBe(409);
  });

  it('rejects invalid credentials and accepts valid ones', async () => {
    const { agent } = await setupAdmin(app);
    await agent.post('/api/auth/logout');

    const bad = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'wrong' });
    expect(bad.status).toBe(401);

    const good = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'Password123!' });
    expect(good.status).toBe(200);
    expect(good.body.user.username).toBe('admin');
  });

  it('enforces CSRF tokens on mutations', async () => {
    const { agent } = await setupAdmin(app);
    const missing = await agent.post('/api/categories').send({ name: 'X', color: '#112233' });
    expect(missing.status).toBe(403);
  });

  it('applies calendar ACL and event permissions', async () => {
    const { agent: admin, csrf, userId: adminId } = await setupAdmin(app);
    const created = await admin
      .post('/api/users')
      .set('X-CSRF-Token', csrf)
      .send({
        username: 'bob',
        email: 'bob@example.com',
        firstName: 'Bob',
        lastName: 'User',
        password: 'Password123!'
      });
    expect(created.status).toBe(201);
    const bobId = created.body.id as string;

    const adminCalendars = await admin.get('/api/calendars');
    const adminCalendar = adminCalendars.body.find((c: any) => c.ownerId === adminId);
    expect(adminCalendar).toBeTruthy();

    const bobAgent = request.agent(app);
    const bobLogin = await bobAgent
      .post('/api/auth/login')
      .send({ username: 'bob', password: 'Password123!' });
    const bobCsrf = bobLogin.body.csrfToken as string;
    expect(bobLogin.status).toBe(200);

    const beforeAcl = await bobAgent.get(
      `/api/events?start=2026-01-01T00:00:00.000Z&end=2026-02-01T00:00:00.000Z&calendarIds=${adminCalendar.id}`
    );
    expect(beforeAcl.body).toHaveLength(0);

    const acl = await admin
      .put(`/api/calendars/${adminCalendar.id}/acl`)
      .set('X-CSRF-Token', csrf)
      .send({
        entries: [{ userId: bobId, canView: true, canCreate: true, canEdit: false, canDelete: false }]
      });
    expect(acl.status).toBe(200);

    const event = await bobAgent
      .post('/api/events')
      .set('X-CSRF-Token', bobCsrf)
      .send({
        calendarId: adminCalendar.id,
        title: 'Shared meeting',
        start: '2026-01-12T09:00:00.000Z',
        end: '2026-01-12T10:00:00.000Z',
        allDay: false,
        timezone: 'Europe/Paris'
      });
    expect(event.status).toBe(201);

    const afterAcl = await bobAgent.get(
      `/api/events?start=2026-01-01T00:00:00.000Z&end=2026-02-01T00:00:00.000Z&calendarIds=${adminCalendar.id}`
    );
    expect(afterAcl.body).toHaveLength(1);
    expect(afterAcl.body[0].title).toBe('Shared meeting');

    const adminEvent = await admin
      .post('/api/events')
      .set('X-CSRF-Token', csrf)
      .send({
        calendarId: adminCalendar.id,
        title: 'Admin only meeting',
        start: '2026-01-13T09:00:00.000Z',
        end: '2026-01-13T10:00:00.000Z',
        allDay: false,
        timezone: 'Europe/Paris'
      });
    expect(adminEvent.status).toBe(201);

    const deleteAttempt = await bobAgent
      .delete(`/api/events/${adminEvent.body.eventId}`)
      .set('X-CSRF-Token', bobCsrf);
    expect(deleteAttempt.status).toBe(403);

    const third = await admin
      .post('/api/users')
      .set('X-CSRF-Token', csrf)
      .send({
        username: 'carol',
        email: 'carol@example.com',
        password: 'Password123!'
      });
    const carolAgent = request.agent(app);
    await carolAgent.post('/api/auth/login').send({ username: 'carol', password: 'Password123!' });
    const carolRead = await carolAgent.get(`/api/events/${event.body.eventId}`);
    expect(carolRead.status).toBe(403);
    expect(third.status).toBe(201);
  });

  it('validates event dates and expands recurrences', async () => {
    const { agent, csrf, userId } = await setupAdmin(app);
    const calendars = await agent.get('/api/calendars');
    const calendarId = calendars.body[0].id as string;
    expect(calendars.body[0].ownerId).toBe(userId);

    const invalid = await agent
      .post('/api/events')
      .set('X-CSRF-Token', csrf)
      .send({
        calendarId,
        title: 'Bad',
        start: '2026-03-10T10:00:00.000Z',
        end: '2026-03-10T09:00:00.000Z',
        allDay: false
      });
    expect(invalid.status).toBe(400);

    const recurring = await agent
      .post('/api/events')
      .set('X-CSRF-Token', csrf)
      .send({
        calendarId,
        title: 'Weekly sync',
        start: '2026-03-02T09:00:00.000Z',
        end: '2026-03-02T09:30:00.000Z',
        allDay: false,
        timezone: 'Europe/Paris',
        recurrence: { frequency: 'weekly', interval: 1, count: 4 }
      });
    expect(recurring.status).toBe(201);

    const list = await agent.get(
      `/api/events?start=2026-03-01T00:00:00.000Z&end=2026-04-01T00:00:00.000Z&calendarIds=${calendarId}`
    );
    expect(list.body).toHaveLength(4);
    expect(list.body[0].recurring).toBe(true);

    const occurrenceStart = list.body[1].occurrenceStart as string;
    const moved = await agent
      .patch(`/api/events/${recurring.body.eventId}`)
      .set('X-CSRF-Token', csrf)
      .send({
        scope: 'occurrence',
        occurrenceStart,
        start: '2026-03-11T09:00:00.000Z',
        end: '2026-03-11T09:30:00.000Z'
      });
    expect(moved.status).toBe(200);

    const afterMove = await agent.get(
      `/api/events?start=2026-03-01T00:00:00.000Z&end=2026-04-01T00:00:00.000Z&calendarIds=${calendarId}`
    );
    expect(afterMove.body).toHaveLength(4);
    expect(afterMove.body.some((item: any) => item.isException)).toBe(true);

    const cancelOccurrence = await agent
      .delete(
        `/api/events/${recurring.body.eventId}?scope=occurrence&occurrenceStart=${encodeURIComponent(
          occurrenceStart
        )}`
      )
      .set('X-CSRF-Token', csrf);
    expect(cancelOccurrence.status).toBe(200);

    const afterCancel = await agent.get(
      `/api/events?start=2026-03-01T00:00:00.000Z&end=2026-04-01T00:00:00.000Z&calendarIds=${calendarId}`
    );
    expect(afterCancel.body).toHaveLength(3);
  });

  it('detects event conflicts and allows an explicit override', async () => {
    const { agent, csrf } = await setupAdmin(app);
    const calendars = await agent.get('/api/calendars');
    const calendarId = calendars.body[0].id as string;

    const first = await agent
      .post('/api/events')
      .set('X-CSRF-Token', csrf)
      .send({
        calendarId,
        title: 'Existing meeting',
        start: '2026-06-01T10:00:00.000Z',
        end: '2026-06-01T11:00:00.000Z',
        allDay: false,
        timezone: 'Europe/Paris'
      });
    expect(first.status).toBe(201);

    const conflict = await agent
      .post('/api/events')
      .set('X-CSRF-Token', csrf)
      .send({
        calendarId,
        title: 'Overlapping meeting',
        start: '2026-06-01T10:30:00.000Z',
        end: '2026-06-01T11:30:00.000Z',
        allDay: false,
        timezone: 'Europe/Paris'
      });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toBe('event_conflict');
    expect(conflict.body.details.total).toBe(1);
    expect(conflict.body.details.conflicts[0].title).toBe('Existing meeting');

    const forced = await agent
      .post('/api/events')
      .set('X-CSRF-Token', csrf)
      .send({
        calendarId,
        title: 'Overlapping meeting',
        start: '2026-06-01T10:30:00.000Z',
        end: '2026-06-01T11:30:00.000Z',
        allDay: false,
        timezone: 'Europe/Paris',
        force: true
      });
    expect(forced.status).toBe(201);

    const renamed = await agent
      .patch(`/api/events/${forced.body.eventId}`)
      .set('X-CSRF-Token', csrf)
      .send({
        scope: 'series',
        title: 'Renamed meeting',
        start: '2026-06-01T10:30:00.000Z',
        end: '2026-06-01T11:30:00.000Z',
        allDay: false,
        timezone: 'Europe/Paris'
      });
    expect(renamed.status).toBe(200);

    const moved = await agent
      .patch(`/api/events/${forced.body.eventId}`)
      .set('X-CSRF-Token', csrf)
      .send({
        scope: 'series',
        start: '2026-06-01T10:15:00.000Z',
        end: '2026-06-01T11:15:00.000Z'
      });
    expect(moved.status).toBe(409);
    expect(moved.body.details.total).toBe(1);

    const movedAnyway = await agent
      .patch(`/api/events/${forced.body.eventId}`)
      .set('X-CSRF-Token', csrf)
      .send({
        scope: 'series',
        start: '2026-06-01T10:15:00.000Z',
        end: '2026-06-01T11:15:00.000Z',
        force: true
      });
    expect(movedAnyway.status).toBe(200);
  });

  it('expands recurrences in their timezone and detects conflicts when changing owner', async () => {
    const { agent, csrf } = await setupAdmin(app);
    const created = await agent
      .post('/api/users')
      .set('X-CSRF-Token', csrf)
      .send({
        username: 'bob',
        email: 'bob@example.com',
        firstName: 'Bob',
        lastName: 'User',
        password: 'Password123!'
      });
    expect(created.status).toBe(201);

    const calendars = await agent.get('/api/calendars');
    const adminCalendar = calendars.body.find((c: any) => c.ownerName === 'Ada Admin');
    const bobCalendar = calendars.body.find((c: any) => c.ownerId === created.body.id);
    expect(adminCalendar).toBeTruthy();
    expect(bobCalendar).toBeTruthy();

    const recurring = await agent
      .post('/api/events')
      .set('X-CSRF-Token', csrf)
      .send({
        calendarId: adminCalendar.id,
        title: 'Recurring sync',
        start: '2026-07-01T09:00:00.000Z',
        end: '2026-07-01T10:00:00.000Z',
        allDay: false,
        timezone: 'Europe/Paris',
        recurrence: { frequency: 'daily', interval: 1, count: 3 }
      });
    expect(recurring.status).toBe(201);

    const occurrences = await agent.get(
      `/api/events?start=2026-07-01T00:00:00.000Z&end=2026-07-05T00:00:00.000Z&calendarIds=${adminCalendar.id}`
    );
    expect(occurrences.body).toHaveLength(3);
    expect(occurrences.body[0].start).toBe('2026-07-01T09:00:00.000Z');
    expect(occurrences.body[1].start).toBe('2026-07-02T09:00:00.000Z');

    const single = await agent
      .post('/api/events')
      .set('X-CSRF-Token', csrf)
      .send({
        calendarId: bobCalendar.id,
        title: 'Bob meeting',
        start: '2026-07-02T09:30:00.000Z',
        end: '2026-07-02T10:30:00.000Z',
        allDay: false,
        timezone: 'Europe/Paris'
      });
    expect(single.status).toBe(201);

    const moved = await agent
      .patch(`/api/events/${recurring.body.eventId}`)
      .set('X-CSRF-Token', csrf)
      .send({ calendarId: bobCalendar.id, scope: 'series' });
    expect(moved.status).toBe(409);
    expect(moved.body.error).toBe('event_conflict');
    expect(moved.body.details.total).toBe(1);
    expect(moved.body.details.conflicts[0].title).toBe('Bob meeting');
  });

  it('searches events by title and description with permissions', async () => {
    const { agent, csrf } = await setupAdmin(app);
    const category = await agent
      .post('/api/categories')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Restauration', color: '#e8590c' });
    expect(category.status).toBe(201);

    const created = await agent
      .post('/api/users')
      .set('X-CSRF-Token', csrf)
      .send({
        username: 'bob',
        email: 'bob@example.com',
        firstName: 'Bob',
        lastName: 'Import',
        password: 'Password123!'
      });
    expect(created.status).toBe(201);
    const bobId = created.body.id as string;

    const calendars = await agent.get('/api/calendars');
    const adminCalendar = calendars.body.find((calendar: any) => calendar.ownerName === 'Ada Admin');
    const bobCalendar = calendars.body.find((calendar: any) => calendar.ownerId === bobId);
    expect(adminCalendar).toBeTruthy();
    expect(bobCalendar).toBeTruthy();

    const lunch = await agent
      .post('/api/events')
      .set('X-CSRF-Token', csrf)
      .send({
        calendarId: adminCalendar.id,
        title: 'Déjeuner équipe',
        description: '<p>Réservation au restaurant</p>',
        start: '2026-01-10T12:00:00.000Z',
        end: '2026-01-10T13:00:00.000Z',
        allDay: false,
        timezone: 'Europe/Paris',
        categoryId: category.body.id,
        participantIds: [bobId]
      });
    expect(lunch.status).toBe(201);

    const older = await agent
      .post('/api/events')
      .set('X-CSRF-Token', csrf)
      .send({
        calendarId: adminCalendar.id,
        title: 'Budget 2027',
        description: 'Préparation',
        start: '2026-01-20T09:00:00.000Z',
        end: '2026-01-20T10:00:00.000Z',
        allDay: false,
        timezone: 'Europe/Paris'
      });
    expect(older.status).toBe(201);

    const newer = await agent
      .post('/api/events')
      .set('X-CSRF-Token', csrf)
      .send({
        calendarId: adminCalendar.id,
        title: 'Point projet',
        description: 'budget prévisionnel',
        start: '2026-01-30T09:00:00.000Z',
        end: '2026-01-30T10:00:00.000Z',
        allDay: false,
        timezone: 'Europe/Paris'
      });
    expect(newer.status).toBe(201);

    const privateEvent = await agent
      .post('/api/events')
      .set('X-CSRF-Token', csrf)
      .send({
        calendarId: bobCalendar.id,
        title: 'Budget privé',
        start: '2026-02-01T09:00:00.000Z',
        end: '2026-02-01T10:00:00.000Z',
        allDay: false,
        timezone: 'Europe/Paris'
      });
    expect(privateEvent.status).toBe(201);

    const adminSearch = await agent.get('/api/events/search?q=budget');
    expect(adminSearch.status).toBe(200);
    expect(adminSearch.body.total).toBe(3);
    expect(adminSearch.body.results.map((item: any) => item.title)).toEqual([
      'Budget privé',
      'Point projet',
      'Budget 2027'
    ]);

    const lunchSearch = await agent.get('/api/events/search?q=D%C3%89JEUNER');
    expect(lunchSearch.status).toBe(200);
    expect(lunchSearch.body.results).toHaveLength(1);
    expect(lunchSearch.body.results[0].description).toBe('Réservation au restaurant');
    expect(lunchSearch.body.results[0].categoryName).toBe('Restauration');
    expect(lunchSearch.body.results[0].participants).toEqual(['Bob Import']);

    const bobAgent = request.agent(app);
    const bobLogin = await bobAgent
      .post('/api/auth/login')
      .send({ username: 'bob', password: 'Password123!' });
    expect(bobLogin.status).toBe(200);
    const bobSearch = await bobAgent.get('/api/events/search?q=budget');
    expect(bobSearch.status).toBe(200);
    expect(bobSearch.body.total).toBe(1);
    expect(bobSearch.body.results[0].title).toBe('Budget privé');
  });

  it('manages manual holidays and keeps adjustments across syncs', async () => {
    const { agent, csrf } = await setupAdmin(app);
    const pref = await agent
      .put('/api/auth/me/preferences')
      .set('X-CSRF-Token', csrf)
      .send({ country: 'FR' });
    expect(pref.status).toBe(200);

    const created = await agent
      .post('/api/holidays/admin')
      .set('X-CSRF-Token', csrf)
      .send({ country: 'FR', date: '2026-08-15', title: 'Fête locale' });
    expect(created.status).toBe(201);
    expect(created.body.users).toBe(1);
    const key = created.body.key as string;

    const list = await agent.get('/api/holidays/admin');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].title).toBe('Fête locale');
    expect(list.body[0].manual).toBe(true);

    const patched = await agent
      .patch(`/api/holidays/admin/${encodeURIComponent(key)}`)
      .set('X-CSRF-Token', csrf)
      .send({ title: 'Fête nationale' });
    expect(patched.status).toBe(200);

    const events = await agent.get('/api/events?start=2026-08-01T00:00:00.000Z&end=2026-09-01T00:00:00.000Z');
    expect(events.body).toHaveLength(1);
    expect(events.body[0].title).toBe('Fête nationale');

    const synced = await agent.post('/api/holidays/sync').set('X-CSRF-Token', csrf).send({});
    expect(synced.status).toBe(200);
    const afterSync = await agent.get('/api/holidays/admin');
    expect(afterSync.body).toHaveLength(1);
    expect(afterSync.body[0].title).toBe('Fête nationale');

    const deleted = await agent
      .delete(`/api/holidays/admin/${encodeURIComponent(key)}`)
      .set('X-CSRF-Token', csrf);
    expect(deleted.status).toBe(200);
    const afterDelete = await agent.get('/api/holidays/admin');
    expect(afterDelete.body).toHaveLength(0);

    await agent.post('/api/holidays/sync').set('X-CSRF-Token', csrf).send({});
    const afterDeleteSync = await agent.get('/api/holidays/admin');
    expect(afterDeleteSync.body).toHaveLength(0);
  });

  it('imports ICS events into a user calendar with category matching and no duplicates', async () => {
    const { agent, csrf } = await setupAdmin(app);
    const category = await agent
      .post('/api/categories')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Travail', color: '#2f6feb' });
    expect(category.status).toBe(201);
    const created = await agent
      .post('/api/users')
      .set('X-CSRF-Token', csrf)
      .send({
        username: 'bob',
        email: 'bob@example.com',
        firstName: 'Bob',
        lastName: 'Import',
        password: 'Password123!'
      });
    const bobId = created.body.id as string;
    const calendars = await agent.get('/api/calendars');
    const bobCalendar = calendars.body.find((calendar: any) => calendar.ownerId === bobId);
    expect(bobCalendar).toBeTruthy();

    const content = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//TeamCal test//EN',
      'BEGIN:VEVENT',
      'UID:source-1',
      'DTSTAMP:20260101T000000Z',
      'DTSTART;TZID=Europe/Paris:20270115T100000',
      'DTEND;TZID=Europe/Paris:20270115T110000',
      'SUMMARY:Réunion importée',
      'CATEGORIES:Travail,Autre',
      'DESCRIPTION:Ligne 1\\nLigne 2',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:source-2',
      'DTSTART;VALUE=DATE:20270201',
      'DTEND;VALUE=DATE:20270203',
      'SUMMARY:Deux jours',
      'CATEGORIES:Inconnue',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');

    const emailCount = () =>
      (db.prepare('SELECT COUNT(*) AS count FROM email_log').get() as { count: number }).count;
    const emailsBefore = emailCount();

    const imported = await agent
      .post('/api/import/ics')
      .set('X-CSRF-Token', csrf)
      .send({ userId: bobId, defaultCategoryId: null, content });
    expect(imported.status).toBe(201);
    expect(imported.body.imported).toBe(2);
    expect(imported.body.updated).toBe(0);
    expect(imported.body.categoriesMatched).toBe(1);
    expect(imported.body.unmatchedCategories).toEqual(['Inconnue']);

    const events = await agent.get(
      `/api/events?start=2027-01-01T00:00:00.000Z&end=2027-03-01T00:00:00.000Z&calendarIds=${bobCalendar.id}`
    );
    expect(events.body).toHaveLength(2);
    const meeting = events.body.find((event: any) => event.title === 'Réunion importée');
    expect(meeting).toBeTruthy();
    expect(meeting.start).toBe('2027-01-15T09:00:00.000Z');
    expect(meeting.categoryId).toBe(category.body.id);
    expect(meeting.participantIds).toEqual([bobId]);
    const allDay = events.body.find((event: any) => event.title === 'Deux jours');
    expect(allDay.allDay).toBe(true);
    expect(allDay.start).toBe('2027-02-01');
    expect(allDay.end).toBe('2027-02-02');
    expect(allDay.participantIds).toEqual([bobId]);
    expect(emailCount()).toBe(emailsBefore);

    const repeated = await agent
      .post('/api/import/ics')
      .set('X-CSRF-Token', csrf)
      .send({ userId: bobId, content });
    expect(repeated.status).toBe(201);
    expect(repeated.body.imported).toBe(0);
    expect(repeated.body.updated).toBe(2);
    const afterRepeat = await agent.get(
      `/api/events?start=2027-01-01T00:00:00.000Z&end=2027-03-01T00:00:00.000Z&calendarIds=${bobCalendar.id}`
    );
    expect(afterRepeat.body).toHaveLength(2);
    const repeatedMeeting = afterRepeat.body.find((event: any) => event.title === 'Réunion importée');
    expect(repeatedMeeting.participantIds).toEqual([bobId]);
    const participantCount = db
      .prepare('SELECT COUNT(*) AS count FROM event_participants WHERE event_id = ?')
      .get(repeatedMeeting.eventId) as { count: number };
    expect(participantCount.count).toBe(1);
  });

  it('lets users import and export only their own calendar', async () => {
    const { agent: admin, csrf, userId: adminId } = await setupAdmin(app);
    const created = await admin
      .post('/api/users')
      .set('X-CSRF-Token', csrf)
      .send({
        username: 'bob',
        email: 'bob@example.com',
        firstName: 'Bob',
        lastName: 'Export',
        password: 'Password123!'
      });
    expect(created.status).toBe(201);
    const bobId = created.body.id as string;

    const calendars = await admin.get('/api/calendars');
    const bobCalendar = calendars.body.find((calendar: any) => calendar.ownerId === bobId);
    const adminCalendar = calendars.body.find((calendar: any) => calendar.ownerId === adminId);
    expect(bobCalendar).toBeTruthy();
    expect(adminCalendar).toBeTruthy();

    const category = await admin
      .post('/api/categories')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Export category', color: '#336699' });
    expect(category.status).toBe(201);

    await admin
      .post('/api/events')
      .set('X-CSRF-Token', csrf)
      .send({
        calendarId: adminCalendar.id,
        title: 'Admin private export',
        start: '2028-02-09T09:00:00.000Z',
        end: '2028-02-09T10:00:00.000Z',
        allDay: false,
        timezone: 'Europe/Paris'
      });

    const bob = request.agent(app);
    const login = await bob
      .post('/api/auth/login')
      .send({ username: 'bob', password: 'Password123!' });
    const bobCsrf = login.body.csrfToken as string;

    const content = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//TeamCal test//EN',
      'BEGIN:VEVENT',
      'UID:self-import-1',
      'DTSTAMP:20260101T000000Z',
      'DTSTART;TZID=Europe/Paris:20280210T100000',
      'DTEND;TZID=Europe/Paris:20280210T110000',
      'SUMMARY:Bob imported event',
      'CATEGORIES:Export category',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');

    const imported = await bob
      .post('/api/import/ics')
      .set('X-CSRF-Token', bobCsrf)
      .send({ content });
    expect(imported.status).toBe(201);
    expect(imported.body.imported).toBe(1);

    const forbiddenImport = await bob
      .post('/api/import/ics')
      .set('X-CSRF-Token', bobCsrf)
      .send({ userId: adminId, content });
    expect(forbiddenImport.status).toBe(403);

    const bobExport = await bob.get('/api/export/ics');
    expect(bobExport.status).toBe(200);
    expect(bobExport.headers['content-type']).toContain('text/calendar');
    expect(bobExport.headers['content-disposition']).toContain('teamcal_bob.ics');
    expect(bobExport.text).toContain('SUMMARY:Bob imported event');
    expect(bobExport.text).toContain('CATEGORIES:Export category');
    expect(bobExport.text).not.toContain('Admin private export');

    const adminExport = await admin.get(`/api/export/ics?userId=${bobId}`);
    expect(adminExport.status).toBe(200);
    expect(adminExport.text).toContain('SUMMARY:Bob imported event');
    expect(adminExport.text).toContain('CATEGORIES:Export category');
    expect(adminExport.text).not.toContain('Admin private export');

    const adminOwn = await admin.get('/api/export/ics');
    expect(adminOwn.status).toBe(200);
    expect(adminOwn.text).toContain('SUMMARY:Admin private export');
    expect(adminOwn.text).not.toContain('Bob imported event');

    const forbiddenExport = await bob.get(`/api/export/ics?userId=${adminId}`);
    expect(forbiddenExport.status).toBe(403);
  });

  it('keeps deleted events for the audit log', async () => {
    const { agent, csrf } = await setupAdmin(app);
    const calendars = await agent.get('/api/calendars');
    const calendarId = calendars.body[0].id as string;

    const created = await agent
      .post('/api/events')
      .set('X-CSRF-Token', csrf)
      .send({
        calendarId,
        title: 'Audit event',
        start: '2027-08-10T09:00:00.000Z',
        end: '2027-08-10T10:00:00.000Z',
        allDay: false
      });
    expect(created.status).toBe(201);
    const eventId = created.body.eventId as string;

    const updated = await agent
      .patch(`/api/events/${eventId}`)
      .set('X-CSRF-Token', csrf)
      .send({ title: 'Renamed audit event', scope: 'series' });
    expect(updated.status).toBe(200);

    const deleted = await agent
      .delete(`/api/events/${eventId}`)
      .set('X-CSRF-Token', csrf);
    expect(deleted.status).toBe(200);

    const list = await agent.get(
      '/api/events?start=2027-08-01T00:00:00.000Z&end=2027-08-31T23:59:59.000Z'
    );
    expect(list.body.some((event: any) => event.eventId === eventId)).toBe(false);

    const read = await agent.get(`/api/events/${eventId}`);
    expect(read.status).toBe(200);
    expect(read.body.event.title).toBe('Renamed audit event');
    expect(read.body.event.status).toBe('cancelled');
    expect(read.body.event.deletedAt).toBeTruthy();
    expect(read.body.editable).toBe(false);
    expect(read.body.deletable).toBe(false);

    const deleteAgain = await agent
      .delete(`/api/events/${eventId}`)
      .set('X-CSRF-Token', csrf);
    expect(deleteAgain.status).toBe(409);
    expect(deleteAgain.body.error).toBe('event_deleted');

    const report = await agent.get('/api/reports/audit');
    expect(report.status).toBe(200);
    const rows = report.body.entries.filter((entry: any) => entry.event.id === eventId);
    expect(rows.map((entry: any) => entry.action)).toEqual(['deleted', 'updated', 'created']);
    expect(rows[0].event.available).toBe(true);
    expect(rows[0].event.deleted).toBe(true);
    expect(rows[0].event.title).toBe('Renamed audit event');
    expect(rows[0].actor.name).toBe('Ada Admin');
    expect(rows[0].agenda.name).toBeTruthy();
    expect(rows[0].agenda.username).toBe('admin');

    await agent
      .post('/api/users')
      .set('X-CSRF-Token', csrf)
      .send({ username: 'dave', email: 'dave@example.com', password: 'Password123!' });
    const dave = request.agent(app);
    await dave.post('/api/auth/login').send({ username: 'dave', password: 'Password123!' });
    const forbidden = await dave.get('/api/reports/audit');
    expect(forbidden.status).toBe(403);
  });

  it('lists system and account activity for administrators', async () => {
    const { agent, csrf } = await setupAdmin(app);
    const created = await agent
      .post('/api/users')
      .set('X-CSRF-Token', csrf)
      .send({
        username: 'loguser',
        email: 'loguser@example.com',
        firstName: 'Log',
        lastName: 'User',
        password: 'Password123!'
      });
    expect(created.status).toBe(201);
    const userId = created.body.id as string;

    const updated = await agent
      .patch(`/api/users/${userId}`)
      .set('X-CSRF-Token', csrf)
      .send({ firstName: 'Logged' });
    expect(updated.status).toBe(200);

    const reset = await agent
      .post(`/api/users/${userId}/password`)
      .set('X-CSRF-Token', csrf)
      .send({ newPassword: 'NewPassword123!' });
    expect(reset.status).toBe(200);

    const settings = await agent
      .put('/api/settings')
      .set('X-CSRF-Token', csrf)
      .send({ appName: 'TeamCal System Test' });
    expect(settings.status).toBe(200);

    const failed = await request(app)
      .post('/api/auth/login')
      .send({ username: 'loguser', password: 'wrong' });
    expect(failed.status).toBe(401);

    const report = await agent.get('/api/reports/system');
    expect(report.status).toBe(200);
    const actions = report.body.entries.map((entry: any) => entry.action);
    expect(actions).toContain('user.created');
    expect(actions).toContain('user.updated');
    expect(actions).toContain('user.password_reset');
    expect(actions).toContain('settings.updated');
    expect(actions).toContain('auth.login_failed');
    expect(actions).not.toContain('event.created');

    const settingsRow = report.body.entries.find(
      (entry: any) =>
        entry.action === 'settings.updated' &&
        Array.isArray(entry.details.changes) &&
        entry.details.changes.some((change: any) => change.path === 'appName')
    );
    expect(settingsRow).toBeTruthy();
    expect(settingsRow.details.changes).toEqual(
      expect.arrayContaining([
        {
          path: 'appName',
          before: 'TeamCal Test',
          after: 'TeamCal System Test'
        }
      ])
    );

    const createdRow = report.body.entries.find(
      (entry: any) => entry.action === 'user.created' && entry.target?.username === 'loguser'
    );
    expect(createdRow).toBeTruthy();
    expect(createdRow.actor.username).toBe('admin');
    expect(createdRow.target.label).toContain('User');

    const failedRow = report.body.entries.find(
      (entry: any) => entry.action === 'auth.login_failed'
    );
    expect(failedRow).toBeTruthy();
    expect(failedRow.actor.id).toBeNull();
    expect(failedRow.target.username).toBe('loguser');
    expect(failedRow.ip).toBeTruthy();
    expect(failedRow.details.username).toBe('loguser');

    const userAgent = request.agent(app);
    const login = await userAgent
      .post('/api/auth/login')
      .send({ username: 'loguser', password: 'NewPassword123!' });
    expect(login.status).toBe(200);
    const forbidden = await userAgent.get('/api/reports/system');
    expect(forbidden.status).toBe(403);
  });

  it('exports and restores the database while keeping the backup password', async () => {
    const { agent: admin, csrf } = await setupAdmin(app);
    const calendars = await admin.get('/api/calendars');
    const calendarId = calendars.body[0].id as string;

    const saved = await admin
      .put('/api/settings')
      .set('X-CSRF-Token', csrf)
      .send({
        backup: {
          enabled: false,
          host: '10.0.0.5',
          share: 'BACKUPS',
          username: 'backup',
          password: 'Secret123!',
          folder: 'TeamCal',
          day: 'all',
          time: '04:00',
          keep: 10
        }
      });
    expect(saved.status).toBe(200);
    expect(saved.body.backup.password).toBe('');
    expect(saved.body.backup.hasPassword).toBe(true);

    const kept = await admin
      .put('/api/settings')
      .set('X-CSRF-Token', csrf)
      .send({ backup: { host: '10.0.0.6' } });
    expect(kept.status).toBe(200);
    expect(new SettingsStore(db).get().backup.password).toBe('Secret123!');

    await admin
      .post('/api/events')
      .set('X-CSRF-Token', csrf)
      .send({
        calendarId,
        title: 'Backup before',
        start: '2027-11-01T09:00:00.000Z',
        end: '2027-11-01T10:00:00.000Z',
        allDay: false,
        timezone: 'Europe/Paris'
      });

    const binaryParser = (res: any, callback: any) => {
      let data = '';
      res.setEncoding('binary');
      res.on('data', (chunk: string) => {
        data += chunk;
      });
      res.on('end', () => callback(null, Buffer.from(data, 'binary')));
    };
    const exported = await admin.get('/api/backups/export').buffer(true).parse(binaryParser);
    expect(exported.status).toBe(200);
    expect(String(exported.headers['content-disposition'])).toContain('teamcal_');
    const snapshot = exported.body as Buffer;
    expect(snapshot.subarray(0, 15).toString('utf8')).toBe('SQLite format 3');

    await admin
      .post('/api/events')
      .set('X-CSRF-Token', csrf)
      .send({
        calendarId,
        title: 'Backup after',
        start: '2027-11-02T09:00:00.000Z',
        end: '2027-11-02T10:00:00.000Z',
        allDay: false,
        timezone: 'Europe/Paris'
      });

    const file = path.join(os.tmpdir(), `teamcal-test-${Date.now()}.sqlite`);
    fs.writeFileSync(file, snapshot);
    try {
      const restored = await admin
        .post('/api/backups/import')
        .set('Content-Type', 'application/octet-stream')
        .set('X-CSRF-Token', csrf)
        .send(fs.readFileSync(file));
      expect(restored.status).toBe(200);
      expect(restored.body.ok).toBe(true);
    } finally {
      fs.rmSync(file, { force: true });
    }

    const titles = (
      db.prepare("SELECT title FROM events WHERE title LIKE 'Backup %' ORDER BY title").all() as {
        title: string;
      }[]
    ).map((row) => row.title);
    expect(titles).toEqual(['Backup before']);
    expect(new SettingsStore(db).get().backup.password).toBe('Secret123!');
    const me = await admin.get('/api/auth/me');
    expect(me.status).toBe(200);

    const cleared = await admin
      .delete('/api/backups/smb/password')
      .set('X-CSRF-Token', csrf);
    expect(cleared.status).toBe(200);
    expect(new SettingsStore(db).get().backup.password).toBe('');
    const masked = await admin.get('/api/settings');
    expect(masked.body.backup.hasPassword).toBe(false);
  });

  it('prevents non-admins from reading administration settings', async () => {
    const { agent, csrf } = await setupAdmin(app);
    await agent
      .post('/api/users')
      .set('X-CSRF-Token', csrf)
      .send({ username: 'dave', email: 'dave@example.com', password: 'Password123!' });

    const dave = request.agent(app);
    await dave.post('/api/auth/login').send({ username: 'dave', password: 'Password123!' });
    const settings = await dave.get('/api/settings');
    expect(settings.status).toBe(403);
    const users = await dave.get('/api/users');
    expect(users.status).toBe(200);
    expect(users.body[0].email).toBeUndefined();
  });
});
