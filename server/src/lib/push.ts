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

export function regenerateVapidKeys(db: DB): string {
  const removedSubscriptions = db.transaction(() => {
    db.prepare("DELETE FROM app_secrets WHERE key IN ('vapid_public_key', 'vapid_private_key')").run();
    return db.prepare('DELETE FROM push_subscriptions').run().changes;
  })();
  const keys = ensureVapidKeys(db);
  logger.warn('vapid_keys_regenerated', { removedSubscriptions });
  return keys.publicKey;
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

function recipientsFor(db: DB, event: EventRow): PushRecipientRow[] {
  const participantIds = (
    db.prepare('SELECT user_id FROM event_participants WHERE event_id = ?').all(event.id) as {
      user_id: string;
    }[]
  ).map((row) => row.user_id);
  const ids = Array.from(new Set([event.owner_id, ...participantIds]));
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

async function deliver(
  db: DB,
  subscription: PushSubscriptionRow,
  payload: string
): Promise<{ sent: boolean; statusCode: number | null }> {
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth }
      },
      payload,
      { TTL: 3600, urgency: 'normal' }
    );
    return { sent: true, statusCode: null };
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode ?? null;
    if (statusCode === 404 || statusCode === 410) {
      db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(subscription.id);
    } else {
      logger.error('push_send_failed', {
        endpoint: subscription.endpoint.slice(0, 60),
        statusCode,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return { sent: false, statusCode };
  }
}

function configureVapid(db: DB, settings: AppSettings) {
  const keys = ensureVapidKeys(db);
  const subject = settings.smtp.fromEmail
    ? `mailto:${settings.smtp.fromEmail}`
    : 'https://localhost';
  webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);
}

export type PushAction = 'created' | 'updated' | 'cancelled';

const actionLabels: Record<string, Record<PushAction, string>> = {
  fr: { created: 'Nouvel événement', updated: 'Événement modifié', cancelled: 'Événement supprimé' },
  en: { created: 'New event', updated: 'Event updated', cancelled: 'Event cancelled' },
  de: { created: 'Neuer Termin', updated: 'Termin geändert', cancelled: 'Termin abgesagt' }
};

function actionLabel(language: string | null, action: PushAction): string {
  const key = language === 'de' ? 'de' : language === 'en' ? 'en' : 'fr';
  return actionLabels[key][action];
}

export async function sendPushEvent(
  db: DB,
  settings: AppSettings,
  event: EventRow,
  action: PushAction = 'created'
): Promise<void> {
  const recipients = recipientsFor(db, event);
  if (recipients.length === 0) {
    logger.info('push_skipped', { eventId: event.id, reason: 'no_recipients' });
    return;
  }
  configureVapid(db, settings);
  const base = (settings.baseUrl || '').replace(/\/+$/, '');
  const dateKey = event.start_at.slice(0, 10);
  const url = `${base}/?date=${dateKey}&event=${encodeURIComponent(event.id)}`;
  let sent = 0;
  let failed = 0;
  let missingSubscriptions = 0;
  for (const recipient of recipients) {
    const subscriptions = subscriptionsFor(db, recipient.id);
    if (subscriptions.length === 0) {
      missingSubscriptions += 1;
      continue;
    }
    const payload = JSON.stringify({
      title: event.title,
      body: `${actionLabel(recipient.language, action)} · ${formatWhen(
        event,
        recipient.timezone || event.timezone || 'UTC',
        recipient.language
      )}`,
      url,
      icon: '/icon-192.png',
      badge: '/icon-192.png'
    });
    for (const subscription of subscriptions) {
      const result = await deliver(db, subscription, payload);
      if (result.sent) sent += 1;
      else failed += 1;
    }
  }
  logger.info('push_event_sent', {
    eventId: event.id,
    action,
    recipients: recipients.length,
    sent,
    failed,
    missingSubscriptions
  });
}

export async function sendTestPush(
  db: DB,
  settings: AppSettings,
  userId: string
): Promise<{ subscriptions: number; sent: number; failed: number }> {
  const subscriptions = subscriptionsFor(db, userId);
  if (subscriptions.length === 0) return { subscriptions: 0, sent: 0, failed: 0 };
  configureVapid(db, settings);
  const payload = JSON.stringify({
    title: settings.appName,
    body: 'Notification de test',
    url: '/',
    icon: '/icon-192.png',
    badge: '/icon-192.png'
  });
  let sent = 0;
  let failed = 0;
  for (const subscription of subscriptions) {
    const result = await deliver(db, subscription, payload);
    if (result.sent) sent += 1;
    else failed += 1;
  }
  return { subscriptions: subscriptions.length, sent, failed };
}
