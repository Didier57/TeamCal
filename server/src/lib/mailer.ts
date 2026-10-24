import nodemailer from 'nodemailer';
import type { DB } from '../db';
import type { AppSettings } from '../settings';
import type { EventRow } from './permissions';
import { emailTexts } from './i18n';
import { buildIcs, googleCalendarUrl } from './ics';
import { logger } from './logger';
import { newId, nowIso, randomToken } from './util';

export type MailAction = 'created' | 'updated' | 'cancelled';

interface Recipient {
  id: string;
  email: string;
  name: string;
  language: string;
  timezone: string | null;
  feedToken: string;
}

function recipientsFor(db: DB, event: EventRow, extraUserIds?: string[]): Recipient[] {
  const participantIds = (
    db.prepare('SELECT user_id FROM event_participants WHERE event_id = ?').all(event.id) as {
      user_id: string;
    }[]
  ).map((row) => row.user_id);
  const ids = Array.from(new Set([event.owner_id, ...participantIds, ...(extraUserIds ?? [])]));
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT u.id, u.email, u.language, u.timezone, u.first_name, u.last_name, u.feed_token
       FROM users u
       WHERE u.id IN (${placeholders})`
    )
    .all(...ids) as {
    id: string;
    email: string;
    language: string;
    timezone: string | null;
    first_name: string;
    last_name: string;
    feed_token: string | null;
  }[];
  const seen = new Set<string>();
  return rows
    .filter((r) => {
      if (!r.email || seen.has(r.email.toLowerCase())) return false;
      seen.add(r.email.toLowerCase());
      return true;
    })
    .map((r) => {
      let feedToken = r.feed_token;
      if (!feedToken) {
        feedToken = randomToken(24);
        db.prepare('UPDATE users SET feed_token = ?, updated_at = ? WHERE id = ?').run(
          feedToken,
          nowIso(),
          r.id
        );
      }
      return {
        id: r.id,
        email: r.email,
        language: r.language,
        timezone: r.timezone,
        name: `${r.first_name} ${r.last_name}`.trim() || r.email,
        feedToken
      };
    });
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
  const icsOrganizer = {
    name: settings.smtp.fromName || settings.appName,
    email: settings.smtp.fromEmail
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
    const displayTimeZone = recipient.timezone || event.timezone;
    const when = event.all_day
      ? formatDate(event.start_at, true, displayTimeZone, recipient.language)
      : `${formatDate(event.start_at, false, displayTimeZone, recipient.language)} - ${formatDate(event.end_at, false, displayTimeZone, recipient.language)}`;
    const attendees = recipients.map((r) => ({
      name: r.name,
      email: r.email,
      role: r.id === event.owner_id ? ('CHAIR' as const) : ('REQ-PARTICIPANT' as const),
      partStat: r.id === event.owner_id ? 'ACCEPTED' : 'NEEDS-ACTION'
    }));
    const method: 'REQUEST' | 'CANCEL' = action === 'cancelled' ? 'CANCEL' : 'REQUEST';
    const ics = buildIcs({
      uid: event.uid,
      sequence: event.sequence,
      method,
      title: event.title,
      description: event.description,
      location: event.location,
      url: event.url,
      start: event.start_at,
      end: event.end_at,
      allDay: Boolean(event.all_day),
      rrule: event.rrule,
      organizer: icsOrganizer,
      attendees,
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
    const prefsUrl = settings.baseUrl
      ? `${settings.baseUrl.replace(/\/+$/, '')}/preferences`
      : '';
    const feedBase = settings.baseUrl ? settings.baseUrl.replace(/\/+$/, '') : '';
    const feedUrl = feedBase ? `${feedBase}/api/feed/${recipient.feedToken}.ics` : '';
    const googleFeedUrl = feedUrl
      ? `https://calendar.google.com/calendar/r/settings/addbyurl?url=${encodeURIComponent(feedUrl)}`
      : '';
    const html = `<!doctype html><html><body style="font-family:Segoe UI,Arial,sans-serif;color:#1c2434">
      <h2 style="margin:0 0 8px">${escapeHtml(event.title)}</h2>
      <p>${escapeHtml(texts.intro(action))}</p>
      <p><strong>${escapeHtml(texts.when)} :</strong> ${escapeHtml(when)}</p>
      ${event.location ? `<p><strong>${escapeHtml(texts.where)} :</strong> ${escapeHtml(event.location)}</p>` : ''}
      ${event.description ? `<p><strong>${escapeHtml(texts.details)} :</strong><br>${escapeHtml(event.description).replace(/\n/g, '<br>')}</p>` : ''}
      <p><strong>${escapeHtml(texts.organizer)} :</strong> ${escapeHtml(organizer.name)}</p>
      <p><a href="${escapeHtml(gcal)}">Google Calendar</a></p>
      ${feedUrl ? `<p><strong>${escapeHtml(texts.subscribe)}</strong><br><a href="${escapeHtml(googleFeedUrl)}">${escapeHtml(texts.autoAddAction)}</a><br><span style="color:#64748b;font-size:12px">${escapeHtml(texts.autoAddHint)}</span></p>` : ''}
      ${prefsUrl ? `<p><a href="${escapeHtml(prefsUrl)}">${escapeHtml(texts.subscribeAction)}</a></p>` : ''}
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
        alternatives: [
          {
            content: ics,
            contentType: `text/calendar; charset=utf-8; method=${method}`
          }
        ]
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

export type AccountMailKind = 'invite' | 'reset';

const accountTexts: Record<string, { subject: string; intro: string; action: string; hint: string; footer: string; app: string }> = {
  fr: {
    subject: 'Invitation à créer votre compte',
    intro: 'Un compte a été créé pour vous. Cliquez sur le bouton ci-dessous pour choisir votre mot de passe.',
    action: 'Créer mon mot de passe',
    hint: 'Ce lien expire dans 3 jours.',
    footer: 'Cet e-mail a été envoyé automatiquement par TeamCal.',
    app: 'Application'
  },
  en: {
    subject: 'Invitation to create your account',
    intro: 'An account has been created for you. Click the button below to choose your password.',
    action: 'Create my password',
    hint: 'This link expires in 3 days.',
    footer: 'This e-mail was sent automatically by TeamCal.',
    app: 'Application'
  },
  de: {
    subject: 'Einladung zur Kontoerstellung',
    intro: 'Für Sie wurde ein Konto erstellt. Klicken Sie auf die Schaltfläche unten, um Ihr Passwort zu wählen.',
    action: 'Passwort erstellen',
    hint: 'Dieser Link läuft in 3 Tagen ab.',
    footer: 'Diese E-Mail wurde automatisch von TeamCal gesendet.',
    app: 'Anwendung'
  }
};

export async function sendAccountEmail(
  settings: AppSettings,
  input: { to: string; name: string; language: string; url: string; kind: AccountMailKind }
): Promise<boolean> {
  if (!smtpConfigured(settings)) return false;
  const t = accountTexts[input.language] ?? accountTexts.fr;
  const subject =
    input.kind === 'invite'
      ? `${settings.appName} - ${t.subject}`
      : `${settings.appName} - ${input.language === 'de' ? 'Passwort zurücksetzen' : input.language === 'en' ? 'Password reset' : 'Réinitialisation du mot de passe'}`;
  const intro =
    input.kind === 'invite'
      ? t.intro
      : input.language === 'de'
        ? 'Eine Zurücksetzung Ihres Passworts wurde angefordert. Klicken Sie auf die Schaltfläche unten, um ein neues Passwort zu wählen.'
        : input.language === 'en'
          ? 'A password reset was requested. Click the button below to choose a new password.'
          : 'Une réinitialisation de votre mot de passe a été demandée. Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe.';
  const action =
    input.kind === 'invite'
      ? t.action
      : input.language === 'de'
        ? 'Neues Passwort wählen'
        : input.language === 'en'
          ? 'Choose a new password'
          : 'Choisir un nouveau mot de passe';
  const html = `<!doctype html><html><body style="font-family:Segoe UI,Arial,sans-serif;color:#1c2434">
    <h2 style="margin:0 0 8px">${escapeHtml(settings.appName)}</h2>
    <p>${escapeHtml(intro)}</p>
    <p><a href="${escapeHtml(input.url)}" style="display:inline-block;padding:10px 16px;border-radius:6px;background:#2f6feb;color:#fff;text-decoration:none">${escapeHtml(action)}</a></p>
    <p style="color:#64748b;font-size:12px">${escapeHtml(t.hint)}</p>
    <p style="color:#64748b;font-size:12px">${escapeHtml(t.footer)}</p>
  </body></html>`;
  try {
    await transport(settings).sendMail({
      from: { name: settings.smtp.fromName || settings.appName, address: settings.smtp.fromEmail },
      to: { name: input.name || input.to, address: input.to },
      subject,
      html,
      text: `${intro}\n${input.url}\n${t.hint}`
    });
    return true;
  } catch (error) {
    logger.error('account_email_failed', {
      kind: input.kind,
      recipient: input.to,
      error: error instanceof Error ? error.message : String(error)
    });
    return false;
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
