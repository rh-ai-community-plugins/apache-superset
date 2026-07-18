import { Request, Response, NextFunction } from 'express';
import { K8sApiError } from '../utils/k8sClient';

// Express 4 requires all four parameters to identify this as an error-handling middleware.
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  if (err instanceof K8sApiError) {
    console.error(`K8s API error [${err.statusCode}]: ${err.message}`, err.body);
    res.status(err.statusCode).json({ error: 'Kubernetes API request failed' });
    return;
  }

  const message = err instanceof Error ? err.message : String(err);
  console.error('Unexpected server error:', message);
  res.status(500).json({ error: 'Internal server error' });
}
