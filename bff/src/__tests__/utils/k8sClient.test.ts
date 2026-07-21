const mockReadFileSync = jest.fn();

jest.mock('fs', () => ({
  readFileSync: mockReadFileSync,
}));

jest.mock('../../utils/httpRequest', () => ({
  httpRequest: jest.fn().mockResolvedValue({}),
}));

const CA_BUFFER = Buffer.from('mock-ca-cert');

function loadK8sClient() {
  jest.resetModules();
  jest.mock('../../utils/httpRequest', () => ({
    httpRequest: jest.fn().mockResolvedValue({}),
  }));
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../../utils/k8sClient') as typeof import('../../utils/k8sClient');
}

function getHttpRequestMock() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../../utils/httpRequest').httpRequest as jest.Mock;
}

describe('k8sClient TLS handling', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...savedEnv };
    delete process.env.K8S_TLS_INSECURE;
    delete process.env.K8S_API_BASE;
    process.env.KUBERNETES_SERVICE_HOST = 'k8s.cluster.local';
    process.env.KUBERNETES_SERVICE_PORT = '443';
  });

  afterAll(() => {
    process.env = savedEnv;
  });

  it('uses in-cluster CA cert when available', async () => {
    mockReadFileSync.mockReturnValue(CA_BUFFER);
    const { k8sRequest } = loadK8sClient();

    await k8sRequest('token', '/api/v1/namespaces');

    const mock = getHttpRequestMock();
    const opts = mock.mock.calls[0][0];
    expect(opts.ca).toBe(CA_BUFFER);
    expect(opts.rejectUnauthorized).toBeUndefined();
  });

  it('does not set CA when in-cluster CA file is missing', async () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const { k8sRequest } = loadK8sClient();

    await k8sRequest('token', '/api/v1/namespaces');

    const mock = getHttpRequestMock();
    const opts = mock.mock.calls[0][0];
    expect(opts.ca).toBeUndefined();
    expect(opts.rejectUnauthorized).toBeUndefined();
  });

  it('uses insecure mode when K8S_TLS_INSECURE is set', async () => {
    process.env.K8S_TLS_INSECURE = 'true';
    mockReadFileSync.mockReturnValue(CA_BUFFER);
    const { k8sRequest } = loadK8sClient();

    await k8sRequest('token', '/api/v1/namespaces');

    const mock = getHttpRequestMock();
    const opts = mock.mock.calls[0][0];
    expect(opts.rejectUnauthorized).toBe(false);
    expect(opts.ca).toBeUndefined();
  });

  it('uses CA cert with K8S_API_BASE when K8S_TLS_INSECURE is not set', async () => {
    process.env.K8S_API_BASE = 'https://external-api.example.com';
    mockReadFileSync.mockReturnValue(CA_BUFFER);
    const { k8sRequest } = loadK8sClient();

    await k8sRequest('token', '/api/v1/namespaces');

    const mock = getHttpRequestMock();
    const opts = mock.mock.calls[0][0];
    expect(opts.ca).toBe(CA_BUFFER);
    expect(opts.rejectUnauthorized).toBeUndefined();
  });
});
