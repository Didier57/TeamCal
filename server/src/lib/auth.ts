import type { NextFunction, Request, Response } from 'express';
import type { DB } from '../db';
import { HttpError, newId, nowIso, randomToken } from './util';

export interface UserRow {
  id: string;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  password_hash: string;
  is_admin: number;
  is_active: number;
  language: string;
  timezone: string | null;
  date_format: string | null;
  time_format: string | null;
  default_view: string;
  theme: string | null;
  theme_colors: string | null;
  feed_token: string | null;
  password_token: string | null;
  password_token_expires_at: string | null;
  country: string | null;
  notify_new_events: number;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionRow {
  id: string;
  user_id: string;
  csrf_token: string;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
}

export const SESSION_COOKIE = 'teamcal_session';

declare global {
  namespace Express {
    interface Request {
      user?: UserRow;
      sessionRow?: SessionRow;
      db: DB;
    }
  }
}

export interface SessionContext {
  user: UserRow;
  session: SessionRow;
}

export function publicUser(user: UserRow) {
  let themeColors: unknown = null;
  if (user.theme_colors) {
    try {
      themeColors = JSON.parse(user.theme_colors);
    } catch {
      themeColors = null;
    }
  }
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    firstName: user.first_name,
    lastName: user.last_name,
    isAdmin: Boolean(user.is_admin),
    isActive: Boolean(user.is_active),
    language: user.language,
    timezone: user.timezone,
    dateFormat: user.date_format,
    timeFormat: user.time_format,
    defaultView: user.default_view,
    theme: user.theme,
    themeColors,
    feedToken: user.feed_token,
    country: user.country,
    notifyNewEvents: Boolean(user.notify_new_events),
    lastLoginAt: user.last_login_at,
    createdAt: user.created_at
  };
}

export function ensureFeedToken(db: DB, user: UserRow): string {
  if (user.feed_token) return user.feed_token;
  const token = randomToken(24);
  db.prepare('UPDATE users SET feed_token = ?, updated_at = ? WHERE id = ?').run(
    token,
    new Date().toISOString(),
    user.id
  );
  user.feed_token = token;
  return token;
}

export function isSecureRequest(req: Request): boolean {
  if (req.secure) return true;
  const proto = req.headers['x-forwarded-proto'];
  const value = Array.isArray(proto) ? proto[0] : proto;
  return (value ?? '').split(',')[0].trim() === 'https';
}

export function createSession(
  req: Request,
  res: Response,
  userId: string,
  durationDays: number
): SessionRow {
  const db = req.db;
  const id = randomToken(32);
  const csrf = randomToken(24);
  const now = new Date();
  const expires = new Date(now.getTime() + durationDays * 86400000);
  const session: SessionRow = {
    id,
    user_id: userId,
    csrf_token: csrf,
    ip: req.ip ?? null,
    user_agent: (req.headers['user-agent'] ?? '').slice(0, 400) || null,
    created_at: now.toISOString(),
    last_seen_at: now.toISOString(),
    expires_at: expires.toISOString()
  };
  db.prepare(
    `INSERT INTO sessions (id, user_id, csrf_token, ip, user_agent, created_at, last_seen_at, expires_at)
     VALUES (@id, @user_id, @csrf_token, @ip, @user_agent, @created_at, @last_seen_at, @expires_at)`
  ).run(session);
  res.cookie(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureRequest(req),
    expires,
    path: '/'
  });
  return session;
}

export function destroySession(req: Request, res: Response) {
  if (req.sessionRow) {
    req.db.prepare('DELETE FROM sessions WHERE id = ?').run(req.sessionRow.id);
  }
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function sessionMiddleware(req: Request, _res: Response, next: NextFunction) {
  const raw = req.cookies?.[SESSION_COOKIE];
  if (typeof raw === 'string' && raw.length > 0) {
    const session = req.db.prepare('SELECT * FROM sessions WHERE id = ?').get(raw) as
      | SessionRow
      | undefined;
    if (session && new Date(session.expires_at).getTime() > Date.now()) {
      const user = req.db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id) as
        | UserRow
        | undefined;
      if (user && user.is_active) {
        req.sessionRow = session;
        req.user = user;
        const lastSeen = new Date(session.last_seen_at).getTime();
        if (Date.now() - lastSeen > 300000) {
          const seen = nowIso();
          req.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(seen, session.id);
          session.last_seen_at = seen;
        }
      } else if (session) {
        req.db.prepare('DELETE FROM sessions WHERE id = ?').run(session.id);
      }
    }
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'authentication_required'));
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'authentication_required'));
  if (!req.user.is_admin) return next(new HttpError(403, 'admin_required'));
  next();
}

export function csrfMiddleware(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!req.sessionRow) {
    const origin = req.headers.origin;
    if (origin) {
      try {
        const originHost = new URL(origin).host;
        if (originHost !== req.headers.host) return next(new HttpError(403, 'csrf_origin_mismatch'));
      } catch {
        return next(new HttpError(403, 'csrf_origin_invalid'));
      }
    }
    return next();
  }
  const header = req.headers['x-csrf-token'];
  const token = Array.isArray(header) ? header[0] : header;
  if (!token || token !== req.sessionRow.csrf_token) {
    return next(new HttpError(403, 'csrf_token_invalid'));
  }
  next();
}

const attempts = new Map<string, { count: number; first: number; blockedUntil?: number }>();
const WINDOW_MS = 15 * 60000;
const MAX_ATTEMPTS = 10;

export function checkLoginRate(ip: string): void {
  const entry = attempts.get(ip);
  const now = Date.now();
  if (!entry) return;
  if (entry.blockedUntil && entry.blockedUntil > now) {
    throw new HttpError(429, 'too_many_attempts');
  }
  if (now - entry.first > WINDOW_MS) attempts.delete(ip);
}

export function recordLoginFailure(ip: string): void {
  const now = Date.now();
  const entry = attempts.get(ip) ?? { count: 0, first: now };
  if (now - entry.first > WINDOW_MS) {
    entry.count = 0;
    entry.first = now;
    entry.blockedUntil = undefined;
  }
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) entry.blockedUntil = now + WINDOW_MS;
  attempts.set(ip, entry);
}

export function recordLoginSuccess(ip: string): void {
  attempts.delete(ip);
}

export function cleanupExpiredSessions(db: DB) {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(nowIso());
}
