import http from 'http';
import { EventEmitter } from 'events';
import { SupersetClient, SupersetApiError } from '../src/utils/supersetClient';

jest.mock('http');
jest.mock('https');

const mockedHttp = jest.mocked(http);

function createMockResponse(statusCode: number, body: string, headers?: Record<string, string | string[]>) {
  const res = new EventEmitter() as any;
  res.statusCode = statusCode;
  res.headers = headers ?? {};
  process.nextTick(() => {
    if (body) res.emit('data', body);
    res.emit('end');
  });
  return res;
}

function setupMockRequest(statusCode: number, body: string) {
  const mockReq = new EventEmitter() as any;
  mockReq.end = jest.fn();
  mockReq.write = jest.fn();

  mockedHttp.request.mockImplementation((_opts: any, callback: any) => {
    callback(createMockResponse(statusCode, body));
    return mockReq;
  });

  return mockReq;
}

describe('SupersetClient', () => {
  let client: SupersetClient;

  beforeEach(() => {
    jest.resetAllMocks();
    client = new SupersetClient('http://superset:8088', 'admin', 'password123');
  });

  describe('getAccessToken', () => {
    it('fetches a new access token via login', async () => {
      setupMockRequest(200, JSON.stringify({ access_token: 'jwt-token-123' }));

      const token = await client.getAccessToken();

      expect(token).toBe('jwt-token-123');

      const callArgs = mockedHttp.request.mock.calls[0][0] as any;
      expect(callArgs.method).toBe('POST');
      expect(callArgs.path).toBe('/api/v1/security/login');
    });

    it('caches the token on subsequent calls', async () => {
      setupMockRequest(200, JSON.stringify({ access_token: 'jwt-token-123' }));

      await client.getAccessToken();
      await client.getAccessToken();

      expect(mockedHttp.request).toHaveBeenCalledTimes(1);
    });

    it('rejects on login failure', async () => {
      setupMockRequest(401, '{"message":"Invalid credentials"}');

      await expect(client.getAccessToken()).rejects.toThrow(
        'Superset API returned 401 on POST /api/v1/security/login',
      );
    });

    it('throws when the login endpoint returns an empty body', async () => {
      const mockReq = new EventEmitter() as any;
      mockReq.end = jest.fn();
      mockReq.write = jest.fn();

      const res = new EventEmitter() as any;
      res.statusCode = 204;
      process.nextTick(() => res.emit('end'));
      mockedHttp.request.mockImplementation((_opts: any, callback: any) => {
        callback(res);
        return mockReq;
      });

      await expect(client.getAccessToken()).rejects.toThrow(
        'Empty response from Superset login endpoint',
      );
    });

    it('concurrent calls share a single in-flight login request', async () => {
      setupMockRequest(200, JSON.stringify({ access_token: 'jwt-token-concurrent' }));

      const [token1, token2, token3] = await Promise.all([
        client.getAccessToken(),
        client.getAccessToken(),
        client.getAccessToken(),
      ]);

      expect(token1).toBe('jwt-token-concurrent');
      expect(token2).toBe('jwt-token-concurrent');
      expect(token3).toBe('jwt-token-concurrent');
      // Only one login request should have been made despite three concurrent calls
      expect(mockedHttp.request).toHaveBeenCalledTimes(1);
    });
  });

  describe('generateGuestToken', () => {
    const csrfResponse = JSON.stringify({ result: 'csrf-token-abc' });
    const csrfHeaders = { 'set-cookie': ['session=abc123; Path=/; HttpOnly'] };

    it('generates a guest token for a dashboard', async () => {
      const mockReq = new EventEmitter() as any;
      mockReq.end = jest.fn();
      mockReq.write = jest.fn();

      // Call sequence: 1) login, 2) CSRF token, 3) guest token POST
      mockedHttp.request.mockImplementation((opts: any, callback: any) => {
        if (opts.path === '/api/v1/security/login') {
          callback(createMockResponse(200, JSON.stringify({ access_token: 'admin-token' })));
        } else if (opts.path === '/api/v1/security/csrf_token/') {
          callback(createMockResponse(200, csrfResponse, csrfHeaders));
        } else if (opts.path === '/api/v1/security/guest_token/') {
          callback(createMockResponse(200, JSON.stringify({ token: 'guest-token-xyz' })));
        } else {
          callback(createMockResponse(500, '{}'));
        }
        return mockReq;
      });

      const token = await client.generateGuestToken('dashboard-uuid', {
        userName: 'testuser',
        firstName: 'Test',
        lastName: 'User',
      });

      expect(token).toBe('guest-token-xyz');

      const guestCall = mockedHttp.request.mock.calls.find(
        (c: any) => c[0].path === '/api/v1/security/guest_token/',
      )!;
      const guestOpts = guestCall[0] as any;
      expect(guestOpts.method).toBe('POST');
      expect(guestOpts.headers.Authorization).toBe('Bearer admin-token');
      expect(guestOpts.headers['X-CSRFToken']).toBe('csrf-token-abc');
      expect(guestOpts.headers['Cookie']).toBe('session=abc123');
    });

    it('throws on CSRF token fetch failure', async () => {
      const mockReq = new EventEmitter() as any;
      mockReq.end = jest.fn();
      mockReq.write = jest.fn();

      mockedHttp.request.mockImplementation((opts: any, callback: any) => {
        if (opts.path === '/api/v1/security/login') {
          callback(createMockResponse(200, JSON.stringify({ access_token: 'admin-token' })));
        } else if (opts.path === '/api/v1/security/csrf_token/') {
          callback(createMockResponse(401, '{"message":"Token has expired"}'));
        } else {
          callback(createMockResponse(500, '{}'));
        }
        return mockReq;
      });

      await expect(
        client.generateGuestToken('dashboard-uuid', {
          userName: 'testuser',
          firstName: 'Test',
          lastName: 'User',
        }),
      ).rejects.toThrow('Superset API returned 401 on GET /api/v1/security/csrf_token/');
    });

    it('throws when the guest token POST fails with 500', async () => {
      const mockReq = new EventEmitter() as any;
      mockReq.end = jest.fn();
      mockReq.write = jest.fn();

      mockedHttp.request.mockImplementation((opts: any, callback: any) => {
        if (opts.path === '/api/v1/security/login') {
          callback(createMockResponse(200, JSON.stringify({ access_token: 'admin-token' })));
        } else if (opts.path === '/api/v1/security/csrf_token/') {
          callback(createMockResponse(200, csrfResponse, csrfHeaders));
        } else if (opts.path === '/api/v1/security/guest_token/') {
          callback(createMockResponse(500, '{"message":"Internal Server Error"}'));
        } else {
          callback(createMockResponse(500, '{}'));
        }
        return mockReq;
      });

      await expect(
        client.generateGuestToken('dashboard-uuid', {
          userName: 'testuser',
          firstName: 'Test',
          lastName: 'User',
        }),
      ).rejects.toThrow('Superset API returned 500 on POST /api/v1/security/guest_token/');
    });

    it('throws when the guest token endpoint returns an empty body', async () => {
      const mockReq = new EventEmitter() as any;
      mockReq.end = jest.fn();
      mockReq.write = jest.fn();

      mockedHttp.request.mockImplementation((opts: any, callback: any) => {
        if (opts.path === '/api/v1/security/login') {
          callback(createMockResponse(200, JSON.stringify({ access_token: 'admin-token' })));
        } else if (opts.path === '/api/v1/security/csrf_token/') {
          callback(createMockResponse(200, csrfResponse, csrfHeaders));
        } else if (opts.path === '/api/v1/security/guest_token/') {
          const res = new EventEmitter() as any;
          res.statusCode = 204;
          res.headers = {};
          process.nextTick(() => res.emit('end'));
          callback(res);
        } else {
          callback(createMockResponse(500, '{}'));
        }
        return mockReq;
      });

      await expect(
        client.generateGuestToken('dashboard-uuid', {
          userName: 'testuser',
          firstName: 'Test',
          lastName: 'User',
        }),
      ).rejects.toThrow('Empty response from Superset guest token endpoint');
    });
  });

  describe('listDashboards', () => {
    it('returns transformed dashboard list with pagination metadata', async () => {
      const mockReq = new EventEmitter() as any;
      mockReq.end = jest.fn();
      mockReq.write = jest.fn();

      let callCount = 0;
      mockedHttp.request.mockImplementation((opts: any, callback: any) => {
        callCount++;
        if (callCount === 1) {
          callback(createMockResponse(200, JSON.stringify({ access_token: 'admin-token' })));
        } else if (opts.path?.includes('/api/v1/dashboard/?q=')) {
          callback(createMockResponse(200, JSON.stringify({
            count: 2,
            result: [
              {
                id: 1,
                dashboard_title: 'Sales Dashboard',
                url: '/dashboard/1/',
                status: 'published',
                thumbnail_url: '/thumb/1.png',
              },
              {
                id: 2,
                dashboard_title: 'Marketing',
                url: '/dashboard/2/',
                status: 'draft',
              },
            ],
          })));
        } else if (opts.path === '/api/v1/dashboard/1/embedded') {
          callback(createMockResponse(200, JSON.stringify({ result: { uuid: 'embed-uuid-1' } })));
        } else if (opts.path === '/api/v1/dashboard/2/embedded') {
          callback(createMockResponse(404, '{"message":"Not found"}'));
        } else {
          callback(createMockResponse(500, '{}'));
        }
        return mockReq;
      });

      const result = await client.listDashboards();

      expect(result.dashboards).toEqual([
        {
          id: 1,
          title: 'Sales Dashboard',
          url: '/dashboard/1/',
          status: 'published',
          embeddedId: 'embed-uuid-1',
          thumbnailUrl: '/thumb/1.png',
        },
        {
          id: 2,
          title: 'Marketing',
          url: '/dashboard/2/',
          status: 'draft',
          embeddedId: undefined,
          thumbnailUrl: undefined,
        },
      ]);
      expect(result.totalCount).toBe(2);
      expect(result.page).toBe(0);
      expect(result.pageSize).toBe(100);
    });

    it('uses default page=0 and pageSize=100 in the query URL', async () => {
      const mockReq = new EventEmitter() as any;
      mockReq.end = jest.fn();
      mockReq.write = jest.fn();

      let callCount = 0;
      mockedHttp.request.mockImplementation((_opts: any, callback: any) => {
        callCount++;
        if (callCount === 1) {
          callback(createMockResponse(200, JSON.stringify({ access_token: 'admin-token' })));
        } else {
          callback(createMockResponse(200, JSON.stringify({ count: 0, result: [] })));
        }
        return mockReq;
      });

      await client.listDashboards();

      const listCallArgs = mockedHttp.request.mock.calls[1][0] as any;
      expect(listCallArgs.path).toContain('page:0');
      expect(listCallArgs.path).toContain('page_size:100');
    });

    it('accepts explicit page and pageSize parameters', async () => {
      const mockReq = new EventEmitter() as any;
      mockReq.end = jest.fn();
      mockReq.write = jest.fn();

      let callCount = 0;
      mockedHttp.request.mockImplementation((_opts: any, callback: any) => {
        callCount++;
        if (callCount === 1) {
          callback(createMockResponse(200, JSON.stringify({ access_token: 'admin-token' })));
        } else {
          callback(createMockResponse(200, JSON.stringify({ count: 250, result: [] })));
        }
        return mockReq;
      });

      const result = await client.listDashboards(2, 50);

      const listCallArgs = mockedHttp.request.mock.calls[1][0] as any;
      expect(listCallArgs.path).toContain('page:2');
      expect(listCallArgs.path).toContain('page_size:50');
      expect(result.page).toBe(2);
      expect(result.pageSize).toBe(50);
      expect(result.totalCount).toBe(250);
    });

    it('retries listDashboards with a fresh token on 401', async () => {
      const mockReq = new EventEmitter() as any;
      mockReq.end = jest.fn();
      mockReq.write = jest.fn();

      // Call sequence:
      //   1. Login → 200 with stale-token
      //   2. dashboard list → 401
      //   3. Login → 200 with fresh-token
      //   4. dashboard list → 200
      let callCount = 0;
      mockedHttp.request.mockImplementation((_opts: any, callback: any) => {
        callCount++;
        switch (callCount) {
          case 1:
            callback(createMockResponse(200, JSON.stringify({ access_token: 'stale-token' })));
            break;
          case 2:
            callback(createMockResponse(401, '{"message":"Token has expired"}'));
            break;
          case 3:
            callback(createMockResponse(200, JSON.stringify({ access_token: 'fresh-token' })));
            break;
          case 4:
            callback(createMockResponse(200, JSON.stringify({ count: 0, result: [] })));
            break;
          default:
            callback(createMockResponse(500, '{"message":"unexpected call"}'));
        }
        return mockReq;
      });

      const result = await client.listDashboards();

      expect(result.dashboards).toEqual([]);
      expect(result.totalCount).toBe(0);
      expect(mockedHttp.request).toHaveBeenCalledTimes(4);
      const retryCallArgs = mockedHttp.request.mock.calls[3][0] as any;
      expect(retryCallArgs.headers.Authorization).toBe('Bearer fresh-token');
    });

    it('throws when the dashboard list endpoint returns an empty body', async () => {
      const mockReq = new EventEmitter() as any;
      mockReq.end = jest.fn();
      mockReq.write = jest.fn();

      let callCount = 0;
      mockedHttp.request.mockImplementation((_opts: any, callback: any) => {
        callCount++;
        if (callCount === 1) {
          callback(createMockResponse(200, JSON.stringify({ access_token: 'admin-token' })));
        } else {
          const res = new EventEmitter() as any;
          res.statusCode = 204;
          process.nextTick(() => res.emit('end'));
          callback(res);
        }
        return mockReq;
      });

      await expect(client.listDashboards()).rejects.toThrow(
        'Empty response from Superset dashboard list endpoint',
      );
    });
  });

  describe('getSupersetHealth', () => {
    it('returns healthy when /health responds OK', async () => {
      setupMockRequest(200, '"OK"');

      const health = await client.getSupersetHealth();

      expect(health.healthy).toBe(true);
      expect(health.version).toBeUndefined();
    });

    it('returns unhealthy on error', async () => {
      const mockReq = new EventEmitter() as any;
      mockReq.end = jest.fn();
      mockReq.write = jest.fn();

      mockedHttp.request.mockImplementation(() => {
        process.nextTick(() => mockReq.emit('error', new Error('ECONNREFUSED')));
        return mockReq;
      });

      const health = await client.getSupersetHealth();

      expect(health.healthy).toBe(false);
    });

    it('returns unhealthy when the health endpoint returns an empty body', async () => {
      const mockReq = new EventEmitter() as any;
      mockReq.end = jest.fn();
      mockReq.write = jest.fn();

      const res = new EventEmitter() as any;
      res.statusCode = 204;
      process.nextTick(() => res.emit('end'));
      mockedHttp.request.mockImplementation((_opts: any, callback: any) => {
        callback(res);
        return mockReq;
      });

      const health = await client.getSupersetHealth();

      expect(health.healthy).toBe(false);
    });
  });

  describe('SupersetApiError', () => {
    it('is exported and carries statusCode', () => {
      const err = new SupersetApiError('test error', 401);
      expect(err.statusCode).toBe(401);
      expect(err.name).toBe('SupersetApiError');
      expect(err.message).toBe('test error');
      expect(err instanceof Error).toBe(true);
    });
  });
});
