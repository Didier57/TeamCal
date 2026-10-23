import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';

export const newId = () => randomUUID();
export const nowIso = () => new Date().toISOString();
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message);
  }
}

export function asyncHandler<T extends (...args: any[]) => Promise<unknown>>(fn: T) {
  return (req: any, res: any, next: any) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
