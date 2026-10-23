type Level = 'debug' | 'info' | 'warn' | 'error';

const secretKeys = /password|secret|token|cookie|authorization|smtp/i;

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || value === undefined) return value;
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = secretKeys.test(key) ? '[redacted]' : sanitize(val, depth + 1);
  }
  return out;
}

function emit(level: Level, message: string, meta?: unknown) {
  const line = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(meta !== undefined ? { meta: sanitize(meta) } : {})
  };
  const text = JSON.stringify(line);
  if (level === 'error') console.error(text);
  else if (level === 'warn') console.warn(text);
  else console.log(text);
}

export const logger = {
  debug: (message: string, meta?: unknown) => emit('debug', message, meta),
  info: (message: string, meta?: unknown) => emit('info', message, meta),
  warn: (message: string, meta?: unknown) => emit('warn', message, meta),
  error: (message: string, meta?: unknown) => emit('error', message, meta)
};
