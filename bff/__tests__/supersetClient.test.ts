import http from 'http';
import { EventEmitter } from 'events';
import { SupersetClient } from '../src/utils/supersetClient';

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
        'Superset API returned 401',
      );
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
  });

  describe('listDashboards', () => {
    it('returns transformed dashboard list', async () => {
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

      const dashboards = await client.listDashboards();

      expect(dashboards).toEqual([
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
    });
  });

  describe('getSupersetHealth', () => {
    it('returns healthy when /health responds OK', async () => {
      setupMockRequest(200, '"OK"');

      const health = await client.getSupersetHealth();

      expect(health.healthy).toBe(true);
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
  });
});
