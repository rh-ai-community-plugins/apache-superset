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
