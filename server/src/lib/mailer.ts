import nodemailer from 'nodemailer';
import type { DB } from '../db';
import type { AppSettings } from '../settings';
import type { EventRow } from './permissions';
import { emailTexts } from './i18n';
import { buildIcs, googleCalendarUrl } from './ics';
import { logger } from './logger';
import { newId, nowIso } from './util';

export type MailAction = 'created' | 'updated' | 'cancelled';

interface Recipient {
  id: string;
  email: string;
  name: string;
  language: string;
}

function recipientsFor(db: DB, event: EventRow, extraUserIds?: string[]): Recipient[] {
  const ids = Array.from(new Set([event.owner_id, ...(extraUserIds ?? [])]));
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT u.id, u.email, u.language, u.first_name, u.last_name
       FROM users u
       WHERE u.id IN (${placeholders})`
    )
    .all(...ids) as {
    id: string;
    email: string;
    language: string;
    first_name: string;
    last_name: string;
  }[];
  const seen = new Set<string>();
  return rows
    .filter((r) => {
      if (!r.email || seen.has(r.email.toLowerCase())) return false;
      seen.add(r.email.toLowerCase());
      return true;
    })
    .map((r) => ({
      id: r.id,
      email: r.email,
      language: r.language,
      name: `${r.first_name} ${r.last_name}`.trim() || r.email
    }));
}

export function smtpConfigured(settings: AppSettings): boolean {
  return Boolean(settings.smtp.host && settings.smtp.fromEmail);
}

function transport(settings: AppSettings) {
  return nodemailer.createTransport({
    host: settings.smtp.host,
    port: settings.smtp.port,
    secure: settings.smtp.secure,
    auth: settings.smtp.user
      ? { user: settings.smtp.user, pass: settings.smtp.password }
      : undefined,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000
  });
}

export async function sendTestEmail(settings: AppSettings, to: string): Promise<{ ok: boolean; error?: string }> {
  if (!smtpConfigured(settings)) return { ok: false, error: 'smtp_not_configured' };
  try {
    await transport(settings).sendMail({
      from: { name: settings.smtp.fromName || settings.appName, address: settings.smtp.fromEmail },
      to,
      subject: `${settings.appName} - test SMTP`,
      text: 'Ceci est un e-mail de test envoyé par TeamCal.',
      html: '<p>Ceci est un e-mail de test envoyé par <strong>TeamCal</strong>.</p>'
    });
    return { ok: true };
  } catch (error) {
    logger.error('smtp_test_failed', { error: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: error instanceof Error ? error.message : 'smtp_error' };
  }
}

function formatDate(value: string, allDay: boolean, timeZone: string, language: string): string {
  const locale = language === 'de' ? 'de-DE' : language === 'en' ? 'en-GB' : 'fr-FR';
  const date = new Date(value);
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone,
      dateStyle: 'full',
      ...(allDay ? {} : { timeStyle: 'short' })
    }).format(date);
  } catch {
    return value;
  }
}

export async function notifyEvent(
  db: DB,
  settings: AppSettings,
  event: EventRow,
  action: MailAction,
  extraUserIds?: string[]
): Promise<void> {
  const recipients = recipientsFor(db, event, extraUserIds);
  if (recipients.length === 0) return;
  if (!smtpConfigured(settings)) {
    for (const recipient of recipients) {
      db.prepare(
        'INSERT INTO email_log (id, recipient, subject, status, error, event_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(newId(), recipient.email, event.title, 'skipped', 'smtp_not_configured', event.id, nowIso());
    }
    return;
  }
  const organizerRow = db
    .prepare('SELECT email, first_name, last_name FROM users WHERE id = ?')
    .get(event.owner_id) as { email: string; first_name: string; last_name: string } | undefined;
  const organizer = {
    name: organizerRow ? `${organizerRow.first_name} ${organizerRow.last_name}`.trim() : settings.appName,
    email: organizerRow?.email ?? settings.smtp.fromEmail
  };
  const mailer = transport(settings);
  for (const recipient of recipients) {
    const texts = emailTexts(recipient.language);
    const subject =
      action === 'created'
        ? texts.createdSubject(event.title)
        : action === 'updated'
          ? texts.updatedSubject(event.title)
          : texts.cancelledSubject(event.title);
    const when = event.all_day
      ? formatDate(event.start_at, true, event.timezone, recipient.language)
      : `${formatDate(event.start_at, false, event.timezone, recipient.language)} - ${formatDate(event.end_at, false, event.timezone, recipient.language)}`;
    const ics = buildIcs({
      uid: event.uid,
      sequence: event.sequence,
      method: action === 'cancelled' ? 'CANCEL' : 'REQUEST',
      title: event.title,
      description: event.description,
      location: event.location,
      url: event.url,
      start: event.start_at,
      end: event.end_at,
      allDay: Boolean(event.all_day),
      rrule: event.rrule,
      organizer,
      attendees: recipients.map((r) => ({ name: r.name, email: r.email })),
      cancelled: action === 'cancelled'
    });
    const gcal = googleCalendarUrl({
      title: event.title,
      description: event.description,
      location: event.location,
      start: event.start_at,
      end: event.end_at,
      allDay: Boolean(event.all_day)
    });
    const html = `<!doctype html><html><body style="font-family:Segoe UI,Arial,sans-serif;color:#1c2434">
      <h2 style="margin:0 0 8px">${escapeHtml(event.title)}</h2>
      <p>${escapeHtml(texts.intro(action))}</p>
      <p><strong>${escapeHtml(texts.when)} :</strong> ${escapeHtml(when)}</p>
      ${event.location ? `<p><strong>${escapeHtml(texts.where)} :</strong> ${escapeHtml(event.location)}</p>` : ''}
      ${event.description ? `<p><strong>${escapeHtml(texts.details)} :</strong><br>${escapeHtml(event.description).replace(/\n/g, '<br>')}</p>` : ''}
      <p><strong>${escapeHtml(texts.organizer)} :</strong> ${escapeHtml(organizer.name)}</p>
      <p><a href="${gcal}">Google Calendar</a></p>
      <p style="color:#64748b;font-size:12px">${escapeHtml(texts.addToCalendar)}<br>${escapeHtml(texts.footer)}</p>
    </body></html>`;
    try {
      await mailer.sendMail({
        from: { name: settings.smtp.fromName || settings.appName, address: settings.smtp.fromEmail },
        to: { name: recipient.name, address: recipient.email },
        replyTo: organizer.email,
        subject,
        html,
        text: `${event.title}\n${texts.intro(action)}\n${texts.when}: ${when}`,
        icalEvent: {
          filename: 'invitation.ics',
          method: action === 'cancelled' ? 'CANCEL' : 'REQUEST',
          content: ics
        }
      });
      db.prepare(
        'INSERT INTO email_log (id, recipient, subject, status, error, event_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(newId(), recipient.email, subject, 'sent', null, event.id, nowIso());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('email_send_failed', { eventId: event.id, recipient: recipient.email, error: message });
      db.prepare(
        'INSERT INTO email_log (id, recipient, subject, status, error, event_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(newId(), recipient.email, subject, 'failed', message, event.id, nowIso());
    }
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
