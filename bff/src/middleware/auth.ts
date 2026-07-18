import { Request, Response, NextFunction } from 'express';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      token?: string;
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  const forwardedToken = req.headers['x-forwarded-access-token'];

  let token: string | undefined;

  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (typeof forwardedToken === 'string' && forwardedToken.length > 0) {
    token = forwardedToken;
  }

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  req.token = token;
  next();
}
