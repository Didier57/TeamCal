import { describe, expect, it, beforeEach } from 'vitest';
import request from 'supertest';
import { openDatabase, type DB } from './db';
import { createApp } from './app';

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
