import { Request, Response, NextFunction } from 'express';
import { K8sApiError } from '../utils/k8sClient';

/**
 * Express error-handling middleware.
 *
 * Catches errors that bubble up from route handlers and returns a safe,
 * sanitised response to the client.  K8sApiError bodies are intentionally
 * withheld because they may contain internal cluster details (service-account
 * names, namespace metadata, RBAC reasons, etc.).  Only the HTTP status code
 * and a generic message are forwarded.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  if (err instanceof K8sApiError) {
    // Log the full error (including body) server-side for debugging, but do
    // NOT forward the body to the client.
    console.error(`K8s API error [${err.statusCode}]: ${err.message}`);
    res.status(err.statusCode).json({ error: 'Kubernetes API request failed' });
    return;
  }

  const message = err instanceof Error ? err.message : String(err);
  console.error('Unexpected server error:', message);
  res.status(500).json({ error: 'Internal server error' });
}
