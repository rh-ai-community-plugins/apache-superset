import http from 'http';
import https from 'https';
import { EventEmitter } from 'events';
import { httpRequest } from '../src/utils/httpRequest';

jest.mock('http');
jest.mock('https');

const mockedHttp = jest.mocked(http);
const mockedHttps = jest.mocked(https);

function createMockResponse(statusCode: number, body: string) {
  const res = new EventEmitter() as any;
  res.statusCode = statusCode;
  process.nextTick(() => {
    res.emit('data', body);
    res.emit('end');
  });
  return res;
}

function createEmptyResponse(statusCode: number) {
  const res = new EventEmitter() as any;
  res.statusCode = statusCode;
  process.nextTick(() => {
    res.emit('end');
  });
  return res;
}

function makeMockReq() {
  const mockReq = new EventEmitter() as any;
  mockReq.end = jest.fn();
  mockReq.write = jest.fn();
  mockReq.destroy = jest.fn();
  return mockReq;
}

const defaultMakeError = (statusCode: number, body: string, method: string, path: string) =>
  new Error(`HTTP ${statusCode} on ${method} ${path}: ${body}`);

describe('httpRequest', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('transport selection', () => {
    it('uses https transport for https:// URLs', async () => {
      const mockReq = makeMockReq();
      mockedHttps.request.mockImplementation((_opts: any, callback: any) => {
        callback(createMockResponse(200, '{"ok":true}'));
        return mockReq;
      });

      await httpRequest({
        url: 'https://example.com/api',
        makeError: defaultMakeError,
      });

      expect(mockedHttps.request).toHaveBeenCalled();
      expect(mockedHttp.request).not.toHaveBeenCalled();
    });

    it('uses http transport for http:// URLs', async () => {
      const mockReq = makeMockReq();
      mockedHttp.request.mockImplementation((_opts: any, callback: any) => {
        callback(createMockResponse(200, '{"ok":true}'));
        return mockReq;
      });

      await httpRequest({
        url: 'http://example.com/api',
        makeError: defaultMakeError,
      });

      expect(mockedHttp.request).toHaveBeenCalled();
      expect(mockedHttps.request).not.toHaveBeenCalled();
    });
  });

  describe('request construction', () => {
    it('builds correct hostname, port, and path from the URL', async () => {
      const mockReq = makeMockReq();
      mockedHttps.request.mockImplementation((_opts: any, callback: any) => {
        callback(createMockResponse(200, '{}'));
        return mockReq;
      });

      await httpRequest({
        url: 'https://my-cluster:6443/api/v1/pods',
        makeError: defaultMakeError,
      });

      const callArgs = mockedHttps.request.mock.calls[0][0] as any;
      expect(callArgs.hostname).toBe('my-cluster');
      expect(callArgs.port).toBe('6443');
      expect(callArgs.path).toBe('/api/v1/pods');
    });

    it('includes query string in path', async () => {
      const mockReq = makeMockReq();
      mockedHttps.request.mockImplementation((_opts: any, callback: any) => {
        callback(createMockResponse(200, '{}'));
        return mockReq;
      });

      await httpRequest({
        url: 'https://host/search?q=test&page=1',
        makeError: defaultMakeError,
      });

      const callArgs = mockedHttps.request.mock.calls[0][0] as any;
      expect(callArgs.path).toBe('/search?q=test&page=1');
    });

    it('defaults to GET method', async () => {
      const mockReq = makeMockReq();
      mockedHttp.request.mockImplementation((_opts: any, callback: any) => {
        callback(createMockResponse(200, '{}'));
        return mockReq;
      });

      await httpRequest({ url: 'http://host/', makeError: defaultMakeError });

      const callArgs = mockedHttp.request.mock.calls[0][0] as any;
      expect(callArgs.method).toBe('GET');
    });

    it('passes specified HTTP method', async () => {
      const mockReq = makeMockReq();
      mockedHttp.request.mockImplementation((_opts: any, callback: any) => {
        callback(createMockResponse(201, '{}'));
        return mockReq;
      });

      await httpRequest({
        url: 'http://host/resource',
        method: 'POST',
        body: { name: 'test' },
        makeError: defaultMakeError,
      });

      const callArgs = mockedHttp.request.mock.calls[0][0] as any;
      expect(callArgs.method).toBe('POST');
    });

    it('forwards custom headers to the request', async () => {
      const mockReq = makeMockReq();
      mockedHttps.request.mockImplementation((_opts: any, callback: any) => {
        callback(createMockResponse(200, '{}'));
        return mockReq;
      });

      await httpRequest({
        url: 'https://host/api',
        headers: {
          Authorization: 'Bearer my-token',
          Accept: 'application/json',
        },
        makeError: defaultMakeError,
      });

      const callArgs = mockedHttps.request.mock.calls[0][0] as any;
      expect(callArgs.headers.Authorization).toBe('Bearer my-token');
      expect(callArgs.headers.Accept).toBe('application/json');
    });

    it('sets timeout on the request options', async () => {
      const mockReq = makeMockReq();
      mockedHttp.request.mockImplementation((_opts: any, callback: any) => {
        callback(createMockResponse(200, '{}'));
        return mockReq;
      });

      await httpRequest({
        url: 'http://host/',
        timeoutMs: 5000,
        makeError: defaultMakeError,
      });

      const callArgs = mockedHttp.request.mock.calls[0][0] as any;
      expect(callArgs.timeout).toBe(5000);
    });
  });

  describe('TLS options', () => {
    it('sets rejectUnauthorized on HTTPS requests', async () => {
      const mockReq = makeMockReq();
      mockedHttps.request.mockImplementation((_opts: any, callback: any) => {
        callback(createMockResponse(200, '{}'));
        return mockReq;
      });

      await httpRequest({
        url: 'https://host/api',
        rejectUnauthorized: false,
        makeError: defaultMakeError,
      });

      const callArgs = mockedHttps.request.mock.calls[0][0] as any;
      expect(callArgs.rejectUnauthorized).toBe(false);
    });

    it('sets ca certificate on HTTPS requests', async () => {
      const mockReq = makeMockReq();
      mockedHttps.request.mockImplementation((_opts: any, callback: any) => {
        callback(createMockResponse(200, '{}'));
        return mockReq;
      });

      const caCert = Buffer.from('fake-ca-cert');

      await httpRequest({
        url: 'https://host/api',
        ca: caCert,
        makeError: defaultMakeError,
      });

      const callArgs = mockedHttps.request.mock.calls[0][0] as any;
      expect(callArgs.ca).toBe(caCert);
    });

    it('does not set rejectUnauthorized on HTTP requests', async () => {
      const mockReq = makeMockReq();
      mockedHttp.request.mockImplementation((_opts: any, callback: any) => {
        callback(createMockResponse(200, '{}'));
        return mockReq;
      });

      await httpRequest({
        url: 'http://host/api',
        rejectUnauthorized: false,
        makeError: defaultMakeError,
      });

      const callArgs = mockedHttp.request.mock.calls[0][0] as any;
      expect(callArgs.rejectUnauthorized).toBeUndefined();
    });
  });

  describe('body serialisation', () => {
    it('writes JSON-serialised body when body is provided', async () => {
      const mockReq = makeMockReq();
      mockedHttp.request.mockImplementation((_opts: any, callback: any) => {
        callback(createMockResponse(200, '{"id":1}'));
        return mockReq;
      });

      const body = { key: 'value', num: 42 };
      await httpRequest({
        url: 'http://host/resource',
        method: 'POST',
        body,
        makeError: defaultMakeError,
      });

      expect(mockReq.write).toHaveBeenCalledWith(JSON.stringify(body));
    });

    it('does not call write when body is absent', async () => {
      const mockReq = makeMockReq();
      mockedHttp.request.mockImplementation((_opts: any, callback: any) => {
        callback(createMockResponse(200, '{}'));
        return mockReq;
      });

      await httpRequest({ url: 'http://host/', makeError: defaultMakeError });

      expect(mockReq.write).not.toHaveBeenCalled();
    });
  });

  describe('response handling', () => {
    it('resolves with parsed JSON on 2xx response', async () => {
      const mockReq = makeMockReq();
      mockedHttp.request.mockImplementation((_opts: any, callback: any) => {
        callback(createMockResponse(200, '{"name":"superset"}'));
        return mockReq;
      });

      const result = await httpRequest<{ name: string }>({
        url: 'http://host/',
        makeError: defaultMakeError,
      });

      expect(result).toEqual({ name: 'superset' });
    });

    it('resolves undefined for an empty response body', async () => {
      const mockReq = makeMockReq();
      mockedHttp.request.mockImplementation((_opts: any, callback: any) => {
        callback(createEmptyResponse(204));
        return mockReq;
      });

      const result = await httpRequest({ url: 'http://host/', makeError: defaultMakeError });

      expect(result).toBeUndefined();
    });

    it('rejects with a descriptive error on non-2xx status by default', async () => {
      const mockReq = makeMockReq();
      mockedHttp.request.mockImplementation((_opts: any, callback: any) => {
        callback(createMockResponse(403, '{"message":"forbidden"}'));
        return mockReq;
      });

      const err = (await httpRequest({
        url: 'http://host/resource',
        method: 'GET',
        makeError: defaultMakeError,
      }).catch((e: unknown) => e)) as Error;

      expect(err).toBeInstanceOf(Error);
      expect(err.message).toContain('403');
      expect(err.message).toContain('forbidden');
    });

    it('calls makeError with statusCode, body, method, and path', async () => {
      const mockReq = makeMockReq();
      mockedHttp.request.mockImplementation((_opts: any, callback: any) => {
        callback(createMockResponse(404, 'not found'));
        return mockReq;
      });

      const makeError = jest.fn(
        (code: number, body: string, method: string, path: string) =>
          new Error(`custom:${code}:${method}:${path}:${body}`),
      );

      const err = (await httpRequest({
        url: 'http://host/missing',
        method: 'DELETE',
        makeError,
      }).catch((e: unknown) => e)) as Error;

      expect(makeError).toHaveBeenCalledWith(404, 'not found', 'DELETE', '/missing');
      expect(err.message).toBe('custom:404:DELETE:/missing:not found');
    });
  });

  describe('JSON parse failure', () => {
    it('rejects when JSON parsing fails (strict mode, default)', async () => {
      const mockReq = makeMockReq();
      mockedHttp.request.mockImplementation((_opts: any, callback: any) => {
        callback(createMockResponse(200, 'plain text, not json'));
        return mockReq;
      });

      await expect(
        httpRequest({ url: 'http://host/', makeError: defaultMakeError }),
      ).rejects.toThrow('Failed to parse response JSON');
    });

    it('resolves with the raw string when lenientJson is true', async () => {
      const mockReq = makeMockReq();
      mockedHttp.request.mockImplementation((_opts: any, callback: any) => {
        callback(createMockResponse(200, 'OK'));
        return mockReq;
      });

      const result = await httpRequest<string>({
        url: 'http://host/health',
        makeError: defaultMakeError,
        lenientJson: true,
      });

      expect(result).toBe('OK');
    });
  });

  describe('timeout and error handling', () => {
    it('destroys the request and rejects on timeout', async () => {
      const mockReq = makeMockReq();
      mockedHttp.request.mockImplementation(() => {
        process.nextTick(() => mockReq.emit('timeout'));
        return mockReq;
      });

      await expect(
        httpRequest({ url: 'http://host/', timeoutMs: 100, makeError: defaultMakeError }),
      ).rejects.toThrow('HTTP request timed out after 100ms');

      expect(mockReq.destroy).toHaveBeenCalled();
    });

    it('rejects when the request emits an error event', async () => {
      const mockReq = makeMockReq();
      mockedHttp.request.mockImplementation(() => {
        process.nextTick(() => mockReq.emit('error', new Error('ECONNREFUSED')));
        return mockReq;
      });

      await expect(
        httpRequest({ url: 'http://host/', makeError: defaultMakeError }),
      ).rejects.toThrow('ECONNREFUSED');
    });
  });
});
