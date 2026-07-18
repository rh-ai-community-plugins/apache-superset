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
    const response = await this.authenticatedRequest<{ token: string }>(
      'POST',
      '/api/v1/security/guest_token/',
      {
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
      },
    );

    if (response === undefined) {
      throw new SupersetApiError(
        'Empty response from Superset guest token endpoint',
        0,
      );
    }

    return response.token;
  }

  async listDashboards(page = 0, pageSize = 100): Promise<DashboardListResult> {
    const path = `/api/v1/dashboard/?q=(page:${page},page_size:${pageSize})`;
    const response = await this.authenticatedRequest<{
      result: Array<{
        id: number;
        dashboard_title: string;
        url: string;
        status: string;
        embedded?: Array<{ uuid: string }>;
        thumbnail_url?: string;
      }>;
      count: number;
    }>(
      'GET',
      path,
    );

    if (response === undefined) {
      throw new SupersetApiError(
        `Empty response from Superset dashboard list endpoint: GET ${path}`,
        0,
      );
    }

    return {
      dashboards: response.result.map((d) => ({
        id: d.id,
        title: d.dashboard_title,
        url: d.url,
        status: d.status,
        embeddedId: d.embedded?.[0]?.uuid,
        thumbnailUrl: d.thumbnail_url,
      })),
      totalCount: response.count,
      page,
      pageSize,
    };
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
      makeError: (statusCode) =>
        new SupersetApiError(
          `Superset API returned ${statusCode} on ${method} ${path}`,
          statusCode,
        ),
      lenientJson: true,
    });
  }
}
