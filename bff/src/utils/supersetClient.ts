import http from 'http';
import https from 'https';
import {
  SupersetHealthResponse,
  SupersetLoginResponse,
  SupersetDashboard,
  UserInfo,
} from '../types';

interface CachedToken {
  token: string;
  expiresAt: number;
}

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface SupersetClientOptions {
  rejectUnauthorized?: boolean;
}

export class SupersetClient {
  private readonly baseUrl: string;
  private readonly rejectUnauthorized: boolean;
  private cachedAccessToken: CachedToken | null = null;

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

    const response = await this.request<SupersetLoginResponse>(
      'POST',
      '/api/v1/security/login',
      {
        username: this.adminUsername,
        password: this.adminPassword,
        provider: 'db',
      },
    );

    this.cachedAccessToken = {
      token: response.access_token,
      expiresAt: Date.now() + TOKEN_TTL_MS,
    };

    return response.access_token;
  }

  async generateGuestToken(
    dashboardId: string,
    user: UserInfo,
  ): Promise<string> {
    const accessToken = await this.getAccessToken();

    const response = await this.request<{ token: string }>(
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
      accessToken,
    );

    return response.token;
  }

  async listDashboards(): Promise<SupersetDashboard[]> {
    const accessToken = await this.getAccessToken();

    const response = await this.request<{
      result: Array<{
        id: number;
        dashboard_title: string;
        url: string;
        status: string;
        embedded?: Array<{ uuid: string }>;
        thumbnail_url?: string;
      }>;
    }>(
      'GET',
      '/api/v1/dashboard/?q=(page:0,page_size:100)',
      undefined,
      accessToken,
    );

    return response.result.map((d) => ({
      id: d.id,
      title: d.dashboard_title,
      url: d.url,
      status: d.status,
      embeddedId: d.embedded?.[0]?.uuid,
      thumbnailUrl: d.thumbnail_url,
    }));
  }

  async getSupersetHealth(): Promise<SupersetHealthResponse> {
    try {
      const response = await this.request<string>('GET', '/health');
      const healthy = response === 'OK' || (typeof response === 'object');
      return { healthy, version: '4.1.1' };
    } catch {
      return { healthy: false };
    }
  }

  private request<T>(
    method: string,
    path: string,
    body?: unknown,
    bearerToken?: string,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
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

      const options: http.RequestOptions = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers,
      };

      if (isHttps) {
        (options as https.RequestOptions).rejectUnauthorized = this.rejectUnauthorized;
      }

      const transport = isHttps ? https : http;
      const req = transport.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            if (!data) {
              resolve(undefined as T);
              return;
            }
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve(data as T);
            }
          } else {
            reject(
              new Error(
                `Superset API returned ${res.statusCode} on ${method} ${path}`,
              ),
            );
          }
        });
      });

      req.on('error', reject);

      if (body !== undefined) {
        req.write(JSON.stringify(body));
      }

      req.end();
    });
  }
}
