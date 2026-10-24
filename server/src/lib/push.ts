import webpush from 'web-push';
import type { DB } from '../db';
import type { AppSettings } from '../settings';
import type { EventRow } from './permissions';
import { logger } from './logger';
import { nowIso } from './util';

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

interface PushRecipientRow {
  id: string;
  language: string | null;
  timezone: string | null;
}

function readSecret(db: DB, key: string): string | null {
  const row = db.prepare('SELECT value FROM app_secrets WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

function writeSecret(db: DB, key: string, value: string) {
  db.prepare(
    'INSERT INTO app_secrets (key, value, created_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING'
  ).run(key, value, nowIso());
}

export function ensureVapidKeys(db: DB): VapidKeys {
  const existingPublic = readSecret(db, 'vapid_public_key');
  const existingPrivate = readSecret(db, 'vapid_private_key');
  if (existingPublic && existingPrivate) {
    return { publicKey: existingPublic, privateKey: existingPrivate };
  }
  const generated = webpush.generateVAPIDKeys();
  writeSecret(db, 'vapid_public_key', generated.publicKey);
  writeSecret(db, 'vapid_private_key', generated.privateKey);
  const publicKey = readSecret(db, 'vapid_public_key');
  const privateKey = readSecret(db, 'vapid_private_key');
  if (!publicKey || !privateKey) {
    throw new Error('vapid_key_generation_failed');
  }
  return { publicKey, privateKey };
}

export function getVapidPublicKey(db: DB): string {
  return ensureVapidKeys(db).publicKey;
}

function localeOf(language: string | null): string {
  return language === 'de' ? 'de-DE' : language === 'en' ? 'en-GB' : 'fr-FR';
}

function formatWhen(event: EventRow, timezone: string, language: string | null): string {
  try {
    return new Intl.DateTimeFormat(localeOf(language), {
      timeZone: timezone,
      dateStyle: 'full',
      ...(event.all_day ? {} : { timeStyle: 'short' })
    }).format(new Date(event.start_at));
  } catch {
    return event.start_at;
  }
}

function recipientsFor(db: DB, event: EventRow, actorId: string): PushRecipientRow[] {
  const participantIds = (
    db.prepare('SELECT user_id FROM event_participants WHERE event_id = ?').all(event.id) as {
      user_id: string;
    }[]
  ).map((row) => row.user_id);
  const ids = Array.from(new Set([event.owner_id, ...participantIds])).filter((id) => id !== actorId);
  if (ids.length === 0) return [];
  return db
    .prepare(
      `SELECT id, language, timezone FROM users
       WHERE id IN (${ids.map(() => '?').join(',')})
         AND is_active = 1 AND notify_new_events = 1`
    )
    .all(...ids) as PushRecipientRow[];
}

function subscriptionsFor(db: DB, userId: string): PushSubscriptionRow[] {
  return db
    .prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?')
    .all(userId) as PushSubscriptionRow[];
}

export async function sendPushEvent(
  db: DB,
  settings: AppSettings,
  event: EventRow,
  actorId: string
): Promise<void> {
  const recipients = recipientsFor(db, event, actorId);
  if (recipients.length === 0) return;
  const keys = ensureVapidKeys(db);
  const subject = settings.smtp.fromEmail ? `mailto:${settings.smtp.fromEmail}` : 'mailto:admin@localhost';
  webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);
  const base = (settings.baseUrl || '').replace(/\/+$/, '');
  const dateKey = event.start_at.slice(0, 10);
  const url = `${base}/?date=${dateKey}`;
  for (const recipient of recipients) {
    const subscriptions = subscriptionsFor(db, recipient.id);
    if (subscriptions.length === 0) continue;
    const payload = JSON.stringify({
      title: event.title,
      body: formatWhen(event, recipient.timezone || event.timezone || 'UTC', recipient.language),
      url,
      icon: '/icon-192.png',
      badge: '/icon-192.png'
    });
    for (const subscription of subscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth }
          },
          payload,
          { TTL: 3600, urgency: 'normal' }
        );
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(subscription.id);
          continue;
        }
        logger.error('push_send_failed', {
          userId: recipient.id,
          statusCode: statusCode ?? null,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }
}
