import https from 'https';
import http from 'http';
import fs from 'fs';

const CA_PATH = '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt';
let cachedCa: Buffer | undefined;
try {
  cachedCa = fs.readFileSync(CA_PATH);
} catch {
  // Not running in-cluster or CA file not available
}

export function getK8sBaseUrl(): string {
  if (process.env.K8S_API_BASE) {
    return process.env.K8S_API_BASE;
  }
  const host = process.env.KUBERNETES_SERVICE_HOST;
  const port = process.env.KUBERNETES_SERVICE_PORT;
  if (host && port) {
    return `https://${host}:${port}`;
  }
  throw new Error(
    'K8s API not configured: set K8S_API_BASE or run in-cluster',
  );
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export interface K8sRequestOptions {
  method?: HttpMethod;
  body?: unknown;
  contentType?: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export function k8sRequest<T = unknown>(
  token: string,
  path: string,
  options: K8sRequestOptions = {},
): Promise<T | undefined> {
  const { method = 'GET', body, contentType = 'application/json', timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  return new Promise((resolve, reject) => {
    const baseUrl = getK8sBaseUrl();
    const url = new URL(path, baseUrl);
    const isHttps = url.protocol === 'https:';

    const requestOptions: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      timeout: timeoutMs,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    };

    if (body !== undefined) {
      requestOptions.headers = {
        ...requestOptions.headers,
        'Content-Type': contentType,
      };
    }

    if (isHttps) {
      if (process.env.K8S_API_BASE) {
        requestOptions.rejectUnauthorized = false;
      } else if (cachedCa) {
        requestOptions.ca = cachedCa;
      }
    }

    const transport = isHttps ? https : http;
    const req = transport.request(requestOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          if (!data) {
            resolve(undefined);
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error('Failed to parse response JSON'));
          }
        } else {
          reject(
            new K8sApiError(
              `K8s API returned ${res.statusCode}: ${data}`,
              res.statusCode ?? 0,
              data,
            ),
          );
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`K8s API request timed out after ${timeoutMs}ms: ${method} ${path}`));
    });

    req.on('error', reject);

    if (body !== undefined) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

export class K8sApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = 'K8sApiError';
  }
}
