import type { NextFunction, Request, Response } from 'express';
import { HttpError } from './util';
import { logger } from './logger';

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: 'not_found' });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({
      error: err.message,
      code: err.code,
      ...(err.details ? { details: err.details } : {})
    });
  }
  if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'invalid_json' });
  }
  logger.error('unhandled_error', {
    path: req.path,
    method: req.method,
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined
  });
  res.status(500).json({ error: 'internal_error' });
}
