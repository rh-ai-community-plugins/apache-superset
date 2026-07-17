import http from 'http';
import { EventEmitter } from 'events';
import { SupersetClient, SupersetApiError } from '../src/utils/supersetClient';

jest.mock('http');
jest.mock('https');

const mockedHttp = jest.mocked(http);

function createMockResponse(statusCode: number, body: string) {
  const res = new EventEmitter() as any;
  res.statusCode = statusCode;
  process.nextTick(() => {
    res.emit('data', body);
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
    it('generates a guest token for a dashboard', async () => {
      const mockReq = new EventEmitter() as any;
      mockReq.end = jest.fn();
      mockReq.write = jest.fn();

      let callCount = 0;
      mockedHttp.request.mockImplementation((_opts: any, callback: any) => {
        callCount++;
        if (callCount === 1) {
          callback(createMockResponse(200, JSON.stringify({ access_token: 'admin-token' })));
        } else {
          callback(createMockResponse(200, JSON.stringify({ token: 'guest-token-xyz' })));
        }
        return mockReq;
      });

      const token = await client.generateGuestToken('dashboard-uuid', {
        userName: 'testuser',
        firstName: 'Test',
        lastName: 'User',
      });

      expect(token).toBe('guest-token-xyz');

      const guestCallArgs = mockedHttp.request.mock.calls[1][0] as any;
      expect(guestCallArgs.method).toBe('POST');
      expect(guestCallArgs.path).toBe('/api/v1/security/guest_token/');
      expect(guestCallArgs.headers.Authorization).toBe('Bearer admin-token');
    });

    it('retries with a fresh token when the authenticated request returns 401', async () => {
      const mockReq = new EventEmitter() as any;
      mockReq.end = jest.fn();
      mockReq.write = jest.fn();

      // Call sequence:
      //   1. Login → 200 with stale-token (initial login)
      //   2. guest_token/ → 401 (token expired server-side)
      //   3. Login → 200 with fresh-token (re-login after cache invalidation)
      //   4. guest_token/ → 200 with guest-token-new (retry succeeds)
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
            callback(createMockResponse(200, JSON.stringify({ token: 'guest-token-new' })));
            break;
          default:
            callback(createMockResponse(500, '{"message":"unexpected call"}'));
        }
        return mockReq;
      });

      const token = await client.generateGuestToken('dashboard-uuid', {
        userName: 'testuser',
        firstName: 'Test',
        lastName: 'User',
      });

      expect(token).toBe('guest-token-new');
      // 4 HTTP calls: initial login, failed attempt, re-login, successful retry
      expect(mockedHttp.request).toHaveBeenCalledTimes(4);
      // The retry must use the fresh token
      const retryCallArgs = mockedHttp.request.mock.calls[3][0] as any;
      expect(retryCallArgs.headers.Authorization).toBe('Bearer fresh-token');
    });

    it('does not retry on non-401 errors (e.g. 500)', async () => {
      const mockReq = new EventEmitter() as any;
      mockReq.end = jest.fn();
      mockReq.write = jest.fn();

      // Call sequence:
      //   1. Login → 200
      //   2. guest_token/ → 500 (server error, must not trigger retry)
      let callCount = 0;
      mockedHttp.request.mockImplementation((_opts: any, callback: any) => {
        callCount++;
        switch (callCount) {
          case 1:
            callback(createMockResponse(200, JSON.stringify({ access_token: 'admin-token' })));
            break;
          case 2:
            callback(createMockResponse(500, '{"message":"Internal Server Error"}'));
            break;
          default:
            callback(createMockResponse(500, '{"message":"unexpected call"}'));
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

      // Only 2 calls: login + the failed attempt — no retry for non-401 errors
      expect(mockedHttp.request).toHaveBeenCalledTimes(2);
    });

    it('propagates the error when the retry also returns 401', async () => {
      const mockReq = new EventEmitter() as any;
      mockReq.end = jest.fn();
      mockReq.write = jest.fn();

      // Call sequence:
      //   1. Login → 200 with stale-token
      //   2. guest_token/ → 401
      //   3. Login → 200 with fresh-token (re-login)
      //   4. guest_token/ → 401 (retry also fails)
      let callCount = 0;
      mockedHttp.request.mockImplementation((_opts: any, callback: any) => {
        callCount++;
        switch (callCount) {
          case 1:
            callback(createMockResponse(200, JSON.stringify({ access_token: 'stale-token' })));
            break;
          case 2:
          case 4:
            callback(createMockResponse(401, '{"message":"Token has expired"}'));
            break;
          case 3:
            callback(createMockResponse(200, JSON.stringify({ access_token: 'fresh-token' })));
            break;
          default:
            callback(createMockResponse(500, '{"message":"unexpected call"}'));
        }
        return mockReq;
      });

      await expect(
        client.generateGuestToken('dashboard-uuid', {
          userName: 'testuser',
          firstName: 'Test',
          lastName: 'User',
        }),
      ).rejects.toThrow('Superset API returned 401 on POST /api/v1/security/guest_token/');

      // Exactly 4 calls: initial login + first attempt + re-login + retry
      expect(mockedHttp.request).toHaveBeenCalledTimes(4);
    });

    it('throws when the guest token endpoint returns an empty body', async () => {
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
      mockedHttp.request.mockImplementation((_opts: any, callback: any) => {
        callCount++;
        if (callCount === 1) {
          callback(createMockResponse(200, JSON.stringify({ access_token: 'admin-token' })));
        } else {
          callback(createMockResponse(200, JSON.stringify({
            count: 2,
            result: [
              {
                id: 1,
                dashboard_title: 'Sales Dashboard',
                url: '/dashboard/1/',
                status: 'published',
                embedded: [{ uuid: 'embed-uuid-1' }],
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
