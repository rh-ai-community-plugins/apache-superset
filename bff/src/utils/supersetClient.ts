import http from 'http';
import https from 'https';
import {
  SupersetHealthResponse,
  SupersetLoginResponse,
  DashboardListResult,
  UserInfo,
} from '../types';
import { httpRequest } from './httpRequest';

interface CachedToken {
  token: string;
  expiresAt: number;
}

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const REQUEST_TIMEOUT_MS = 30_000;

export class SupersetApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'SupersetApiError';
  }
}

export interface SupersetClientOptions {
  rejectUnauthorized?: boolean;
}

export class SupersetClient {
  private readonly baseUrl: string;
  private readonly rejectUnauthorized: boolean;
  private cachedAccessToken: CachedToken | null = null;
  private loginPromise: Promise<string> | null = null;

  /**
   * Creates a SupersetClient configured for unauthenticated health checks only.
   *
   * The Superset `/health` endpoint does not require credentials. Use this
   * factory instead of passing empty-string credentials to make the intent
   * explicit: only `getSupersetHealth()` will be called on the returned client.
   */
  static forHealthCheck(baseUrl: string, options: SupersetClientOptions = {}): SupersetClient {
    return new SupersetClient(baseUrl, '', '', options);
  }

  constructor(
    private readonly supersetUrl: string,
    private readonly adminUsername: string,
    private readonly adminPassword: string,
    options: SupersetClientOptions = {},
  ) {
    this.baseUrl = supersetUrl.replace(/\/+$/, '');
    // In-cluster Superset uses self-signed certs or plain HTTP; default to
    // skipping TLS verification since BFF and Superset are co-located.
    this.rejectUnauthorized = options.rejectUnauthorized ?? false;
  }

  async getAccessToken(): Promise<string> {
    if (
      this.cachedAccessToken &&
      Date.now() < this.cachedAccessToken.expiresAt
    ) {
      return this.cachedAccessToken.token;
    }

    if (!this.loginPromise) {
      this.loginPromise = this.doLogin().finally(() => {
        this.loginPromise = null;
      });
    }

    return this.loginPromise;
  }

  private async doLogin(): Promise<string> {
    const response = await this.request<SupersetLoginResponse>(
      'POST',
      '/api/v1/security/login',
      {
        username: this.adminUsername,
        password: this.adminPassword,
        provider: 'db',
      },
    );

    if (response === undefined) {
      throw new SupersetApiError(
        'Empty response from Superset login endpoint',
        0,
      );
    }

    this.cachedAccessToken = {
      token: response.access_token,
      expiresAt: Date.now() + TOKEN_TTL_MS,
    };

    return response.access_token;
  }

  /**
   * Superset JWTs may be revoked server-side (e.g. server restart, explicit
   * revocation) before the client-side TTL expires, causing stale-cache 401s.
   * This wrapper detects those 401s, discards the stale token, and retries
   * once so callers recover transparently without manual cache management.
   */
  private async authenticatedRequest<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T | undefined> {
    const token = await this.getAccessToken();
    try {
      return await this.request<T>(method, path, body, token);
    } catch (err) {
      if (err instanceof SupersetApiError && err.statusCode === 401) {
        // Invalidate the stale token and any in-flight login so the next call
        // triggers a fresh login instead of reusing the failed credential.
        this.cachedAccessToken = null;
        this.loginPromise = null;
        const freshToken = await this.getAccessToken();
        return this.request<T>(method, path, body, freshToken);
      }
      throw err;
    }
  }

  async generateGuestToken(
    dashboardId: string,
    user: UserInfo,
  ): Promise<string> {
    const accessToken = await this.getAccessToken();
    const csrf = await this.fetchCsrfToken(accessToken);

    const guestTokenBody = {
      user: {
        username: user.userName,
        first_name: user.firstName ?? user.userName,
        last_name: user.lastName ?? '',
      },
      resources: [
        {
          type: 'dashboard',
          id: dashboardId,
        },
      ],
      rls: [],
    };

    const url = new URL('/api/v1/security/guest_token/', this.baseUrl);
    const isHttps = url.protocol === 'https:';

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
      'X-CSRFToken': csrf.csrfToken,
    };
    if (csrf.sessionCookie) {
      headers['Cookie'] = csrf.sessionCookie;
    }

    const response = await httpRequest<{ token: string }>({
      url: url.toString(),
      method: 'POST',
      headers,
      body: guestTokenBody,
      timeoutMs: REQUEST_TIMEOUT_MS,
      rejectUnauthorized: isHttps ? this.rejectUnauthorized : undefined,
      makeError: (statusCode, responseBody) =>
        new SupersetApiError(
          `Superset API returned ${statusCode} on POST /api/v1/security/guest_token/: ${responseBody}`,
          statusCode,
        ),
    });

    if (response === undefined) {
      throw new SupersetApiError(
        'Empty response from Superset guest token endpoint',
        0,
      );
    }

    return response.token;
  }

  private fetchCsrfToken(
    accessToken: string,
  ): Promise<{ csrfToken: string; sessionCookie: string }> {
    const url = new URL('/api/v1/security/csrf_token/', this.baseUrl);
    const isHttps = url.protocol === 'https:';

    const transport = isHttps ? https : http;

    const requestOptions: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      timeout: REQUEST_TIMEOUT_MS,
    };

    if (isHttps) {
      (requestOptions as https.RequestOptions).rejectUnauthorized =
        this.rejectUnauthorized;
    }

    return new Promise((resolve, reject) => {
      const req = transport.request(requestOptions, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            reject(
              new SupersetApiError(
                `Superset API returned ${res.statusCode} on GET /api/v1/security/csrf_token/: ${data}`,
                res.statusCode ?? 0,
              ),
            );
            return;
          }

          let csrfToken: string;
          try {
            const parsed = JSON.parse(data) as { result: string };
            csrfToken = parsed.result;
          } catch {
            reject(new Error('Failed to parse CSRF token response'));
            return;
          }

          const setCookies = res.headers['set-cookie'] ?? [];
          const sessionCookie = setCookies
            .map((c) => c.split(';')[0])
            .join('; ');

          resolve({ csrfToken, sessionCookie });
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('CSRF token request timed out'));
      });
      req.on('error', reject);
      req.end();
    });
  }

  async listDashboards(page = 0, pageSize = 100): Promise<DashboardListResult> {
    const path = `/api/v1/dashboard/?q=(page:${page},page_size:${pageSize})`;
    const response = await this.authenticatedRequest<{
      result: Array<{
        id: number;
        dashboard_title: string;
        url: string;
        status: string;
        thumbnail_url?: string;
      }>;
      count: number;
    }>(
      'GET',
      path,
    );

    // TODO: remove debug logging
    console.log('[DEBUG] Dashboard list response count:', response?.count, 'results:', response?.result?.length);
    console.log('[DEBUG] Dashboard list raw:', JSON.stringify(response));

    if (response === undefined) {
      throw new SupersetApiError(
        `Empty response from Superset dashboard list endpoint: GET ${path}`,
        0,
      );
    }

    const embeddedIds = await Promise.all(
      response.result.map((d) => this.getDashboardEmbeddedId(d.id)),
    );

    return {
      dashboards: response.result.map((d, i) => ({
        id: d.id,
        title: d.dashboard_title,
        url: d.url,
        status: d.status,
        embeddedId: embeddedIds[i],
        thumbnailUrl: d.thumbnail_url,
      })),
      totalCount: response.count,
      page,
      pageSize,
    };
  }

  private async getDashboardEmbeddedId(dashboardId: number): Promise<string | undefined> {
    try {
      const response = await this.authenticatedRequest<{
        result: { uuid: string };
      }>('GET', `/api/v1/dashboard/${dashboardId}/embedded`);
      // TODO: remove debug logging
      console.log(`[DEBUG] Dashboard ${dashboardId} embedded response:`, JSON.stringify(response));
      return response?.result?.uuid;
    } catch (err) {
      // TODO: remove debug logging
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[DEBUG] Dashboard ${dashboardId} embedded error: ${msg}`);
      if (err instanceof SupersetApiError && (err.statusCode === 404 || err.statusCode === 400)) {
        return undefined;
      }
      throw err;
    }
  }

  async getSupersetHealth(): Promise<SupersetHealthResponse> {
    try {
      const response = await this.request<unknown>('GET', '/health');
      const healthy = response === 'OK' || (typeof response === 'object' && response !== null);
      return { healthy };
    } catch {
      return { healthy: false };
    }
  }

  private request<T>(
    method: string,
    path: string,
    body?: unknown,
    bearerToken?: string,
  ): Promise<T | undefined> {
    const url = new URL(path, this.baseUrl);
    const isHttps = url.protocol === 'https:';

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    if (bearerToken) {
      headers['Authorization'] = `Bearer ${bearerToken}`;
    }

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    return httpRequest<T>({
      url: url.toString(),
      method,
      headers,
      body,
      timeoutMs: REQUEST_TIMEOUT_MS,
      rejectUnauthorized: isHttps ? this.rejectUnauthorized : undefined,
      makeError: (statusCode, responseBody) =>
        new SupersetApiError(
          `Superset API returned ${statusCode} on ${method} ${path}: ${responseBody}`,
          statusCode,
        ),
      lenientJson: true,
    });
  }
}
