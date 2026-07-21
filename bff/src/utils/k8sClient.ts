import fs from 'fs';
import { httpRequest } from './httpRequest';

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
  lenientJson?: boolean;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export function k8sRequest<T = unknown>(
  token: string,
  path: string,
  options: K8sRequestOptions = {},
): Promise<T | undefined> {
  const { method = 'GET', body, contentType = 'application/json', timeoutMs = DEFAULT_TIMEOUT_MS, lenientJson = false } = options;

  const baseUrl = getK8sBaseUrl();
  const url = new URL(path, baseUrl);
  const isHttps = url.protocol === 'https:';

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };

  if (body !== undefined) {
    headers['Content-Type'] = contentType;
  }

  let rejectUnauthorized: boolean | undefined;
  let ca: Buffer | undefined;

  if (isHttps) {
    if (process.env.K8S_TLS_INSECURE === 'true') {
      rejectUnauthorized = false;
    } else if (cachedCa) {
      ca = cachedCa;
    }
  }

  return httpRequest<T>({
    url: url.toString(),
    method,
    headers,
    body,
    timeoutMs,
    rejectUnauthorized,
    ca,
    lenientJson,
    makeError: (statusCode, responseBody) =>
      new K8sApiError(
        `K8s API returned ${statusCode}`,
        statusCode,
        responseBody,
      ),
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
