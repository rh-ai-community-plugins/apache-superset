import { Request, Response } from 'express';

/**
 * Returns the authenticated token from the request, or sends a 401 response and returns null.
 *
 * Use this at the top of every route handler that requires authentication. Without this guard,
 * TypeScript's non-null assertion (`req.token!`) would mask wiring bugs if a route were
 * accidentally mounted without `authMiddleware`.
 *
 * @example
 * ```ts
 * const token = requireToken(req, res);
 * if (token === null) return;
 * // token is now guaranteed to be a string
 * ```
 */
export function requireToken(req: Request, res: Response): string | null {
  const token = req.token;
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }
  return token;
}

/**
 * Clamps an upstream HTTP status code to the 400–599 range.
 *
 * If `code` is already a valid client or server error status it is returned
 * unchanged. Any value outside that range (e.g. a 200 that slipped through,
 * or an out-of-range number) is replaced with 502 Bad Gateway, which signals
 * that the problem lies with the upstream service rather than the caller.
 *
 * @example
 * ```ts
 * res.status(safeHttpStatus(err.statusCode)).json({ error: '...' });
 * ```
 */
export function safeHttpStatus(code: number): number {
  return code >= 400 && code < 600 ? code : 502;
}
