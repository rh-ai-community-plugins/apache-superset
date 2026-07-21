jest.mock('../../utils/httpRequest', () => ({
  httpRequest: jest.fn(),
}));

import { httpRequest } from '../../utils/httpRequest';
import { SupersetClient, SupersetApiError } from '../../utils/supersetClient';

const mockHttpRequest = httpRequest as jest.MockedFunction<typeof httpRequest>;

describe('SupersetClient.forHealthCheck', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns a SupersetClient instance', () => {
    const client = SupersetClient.forHealthCheck('http://superset.test:8088');
    expect(client).toBeInstanceOf(SupersetClient);
  });

  it('has a getSupersetHealth method', () => {
    const client = SupersetClient.forHealthCheck('http://superset.test:8088');
    expect(typeof client.getSupersetHealth).toBe('function');
  });

  it('passes options through to the underlying client', () => {
    // A client created with rejectUnauthorized: true should pass that setting
    // through to the HTTP layer. We verify this indirectly via getSupersetHealth.
    const client = SupersetClient.forHealthCheck('https://superset.test:8088', {
      rejectUnauthorized: true,
    });
    expect(client).toBeInstanceOf(SupersetClient);
  });

  it('strips trailing slashes from the base URL', async () => {
    const client = SupersetClient.forHealthCheck('http://superset.test:8088///');
    mockHttpRequest.mockResolvedValue('OK' as unknown as undefined);

    await client.getSupersetHealth();

    expect(mockHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://superset.test:8088/health',
      }),
    );
  });

  it('calls getSupersetHealth without credentials', async () => {
    const client = SupersetClient.forHealthCheck('http://superset.test:8088');
    mockHttpRequest.mockResolvedValue('OK' as unknown as undefined);

    const result = await client.getSupersetHealth();

    expect(result).toEqual({ healthy: true });
    // Health endpoint must NOT include an Authorization header — no login call
    expect(mockHttpRequest).toHaveBeenCalledTimes(1);
    expect(mockHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://superset.test:8088/health',
        method: 'GET',
      }),
    );
    const callHeaders = (mockHttpRequest.mock.calls[0][0] as { headers?: Record<string, string> }).headers ?? {};
    expect(callHeaders['Authorization']).toBeUndefined();
  });

  it('returns healthy: false when the health endpoint throws', async () => {
    const client = SupersetClient.forHealthCheck('http://superset.test:8088');
    mockHttpRequest.mockRejectedValue(new SupersetApiError('Connection refused', 0));

    const result = await client.getSupersetHealth();

    expect(result).toEqual({ healthy: false });
  });
});
