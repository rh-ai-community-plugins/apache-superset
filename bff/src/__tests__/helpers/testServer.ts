import express from 'express';
import type { Router } from 'express';
import http from 'http';

/**
 * Creates an Express app with JSON body parsing, a token-injection middleware
 * (req.token = 'test-token'), and the given router mounted at `path`.
 */
export function createTestApp(router: Router, path: string): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.token = 'test-token';
    next();
  });
  app.use(path, router);
  return app;
}

/**
 * Same as createTestApp but intentionally omits the auth middleware so that
 * req.token remains undefined — used to test the 401 path.
 */
export function createTestAppNoToken(router: Router, path: string): express.Express {
  const app = express();
  app.use(express.json());
  // Intentionally omit auth middleware — req.token remains undefined
  app.use(path, router);
  return app;
}

export interface TestRequestOptions {
  method?: string;
  body?: unknown;
}

/**
 * Spins up a temporary HTTP server on a random port, sends one request, then
 * tears the server down.  Supports all HTTP methods and an optional JSON body.
 * Defaults to GET when no method is provided.
 */
export function testRequest(
  app: express.Express,
  path: string,
  options: TestRequestOptions = {},
): Promise<{ status: number; body: unknown }> {
  const { method = 'GET', body } = options;
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        reject(new Error('Failed to get server address'));
        return;
      }
      const reqOptions: http.RequestOptions = {
        hostname: '127.0.0.1',
        port: addr.port,
        path,
        method: method.toUpperCase(),
        headers: body ? { 'Content-Type': 'application/json' } : {},
      };
      const req = http.request(reqOptions, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          server.close();
          try {
            resolve({ status: res.statusCode!, body: data ? JSON.parse(data) : null });
          } catch {
            resolve({ status: res.statusCode!, body: data });
          }
        });
      });
      req.on('error', (err) => {
        server.close();
        reject(err);
      });
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  });
}
