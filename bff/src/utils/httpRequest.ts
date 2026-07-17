import http from 'http';
import https from 'https';

export interface HttpRequestOptions {
  /** Full URL including scheme, host, port, path, and query string. */
  url: string;
  method?: string;
  /** Additional request headers to merge into the outgoing request. */
  headers?: Record<string, string>;
  /** Request body; serialised to JSON when present. */
  body?: unknown;
  timeoutMs?: number;
  /** Passed as `rejectUnauthorized` on HTTPS requests only. */
  rejectUnauthorized?: boolean;
  /** CA certificate; passed as `ca` on HTTPS requests only. */
  ca?: Buffer;
  /**
   * Factory that builds the Error used to reject the promise on non-2xx
   * responses.  Receives the status code, raw response body, HTTP method, and
   * URL path so that callers can produce domain-specific error types.
   */
  makeError: (statusCode: number, responseBody: string, method: string, path: string) => Error;
  /**
   * When `true`, resolve with the raw response body string (typed as `T`)
   * instead of rejecting when JSON parsing fails.  Useful for endpoints that
   * may return non-JSON responses (e.g. plain-text health checks).
   * Default: `false`.
   */
  lenientJson?: boolean;
}

/**
 * Shared low-level HTTP/HTTPS request helper used by both k8sClient and
 * supersetClient.  Handles transport selection, body serialisation, chunk
 * accumulation, JSON parsing, empty-body detection, timeout, and errors.
 */
export function httpRequest<T = unknown>(options: HttpRequestOptions): Promise<T | undefined> {
  const {
    url: urlString,
    method = 'GET',
    headers = {},
    body,
    timeoutMs = 30_000,
    rejectUnauthorized,
    ca,
    makeError,
    lenientJson = false,
  } = options;

  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const isHttps = url.protocol === 'https:';

    const requestOptions: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers,
      timeout: timeoutMs,
    };

    if (isHttps) {
      const httpsOptions = requestOptions as https.RequestOptions;
      if (rejectUnauthorized !== undefined) {
        httpsOptions.rejectUnauthorized = rejectUnauthorized;
      }
      if (ca !== undefined) {
        httpsOptions.ca = ca;
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
            resolve(JSON.parse(data) as T);
          } catch {
            if (lenientJson) {
              resolve(data as unknown as T);
            } else {
              reject(new Error('Failed to parse response JSON'));
            }
          }
        } else {
          const statusCode = res.statusCode ?? 0;
          reject(makeError(statusCode, data, method, url.pathname + url.search));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`HTTP request timed out after ${timeoutMs}ms: ${method} ${urlString}`));
    });

    req.on('error', reject);

    if (body !== undefined) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}
