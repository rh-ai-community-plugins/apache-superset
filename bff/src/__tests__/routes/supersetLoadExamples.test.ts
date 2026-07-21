jest.mock('../../utils/podFinder', () => ({
  findSupersetPod: jest.fn(),
}));

jest.mock('../../utils/k8sExec', () => ({
  k8sExec: jest.fn(),
}));

import supersetLoadExamplesRouter from '../../routes/supersetLoadExamples';
import { findSupersetPod } from '../../utils/podFinder';
import { k8sExec } from '../../utils/k8sExec';
import { createTestApp, createTestAppNoToken, testRequest } from '../helpers/testServer';

const mockFindSupersetPod = findSupersetPod as jest.MockedFunction<typeof findSupersetPod>;
const mockK8sExec = k8sExec as jest.MockedFunction<typeof k8sExec>;

const MOUNT_PATH = '/api/superset/load-examples';

beforeEach(() => {
  jest.resetAllMocks();
});

describe('POST /api/superset/load-examples', () => {
  it('returns 401 when token is missing', async () => {
    const app = createTestAppNoToken(supersetLoadExamplesRouter, MOUNT_PATH);
    const res = await testRequest(app, MOUNT_PATH, {
      method: 'POST',
      body: { namespace: 'test-ns' },
    });
    expect(res.status).toBe(401);
    expect((res.body as Record<string, unknown>).error).toBe('Authentication required');
  });

  it('returns 400 when namespace is missing', async () => {
    const app = createTestApp(supersetLoadExamplesRouter, MOUNT_PATH);
    const res = await testRequest(app, MOUNT_PATH, {
      method: 'POST',
      body: {},
    });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toMatch(/namespace/i);
  });

  it('returns 400 when namespace is invalid', async () => {
    const app = createTestApp(supersetLoadExamplesRouter, MOUNT_PATH);
    const res = await testRequest(app, MOUNT_PATH, {
      method: 'POST',
      body: { namespace: 'INVALID' },
    });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toMatch(/valid Kubernetes namespace/);
  });

  it('returns 404 when no running Superset pod is found', async () => {
    mockFindSupersetPod.mockRejectedValue(new Error('No running Superset pod found in this namespace'));

    const app = createTestApp(supersetLoadExamplesRouter, MOUNT_PATH);
    const res = await testRequest(app, MOUNT_PATH, {
      method: 'POST',
      body: { namespace: 'test-ns' },
    });
    expect(res.status).toBe(404);
    expect((res.body as Record<string, unknown>).error).toMatch(/No running Superset pod/);
  });

  it('starts SSE stream and calls k8sExec with correct arguments', async () => {
    mockFindSupersetPod.mockResolvedValue('superset-pod-xyz');
    mockK8sExec.mockImplementation((opts) => {
      process.nextTick(() => {
        opts.onData('stdout', 'Loading...\n');
        opts.onClose(0);
      });
      return { close: jest.fn() };
    });

    const app = createTestApp(supersetLoadExamplesRouter, MOUNT_PATH);

    const { status, body, headers } = await rawRequest(app, MOUNT_PATH, {
      method: 'POST',
      body: { namespace: 'test-ns' },
    });

    expect(status).toBe(200);
    expect(headers['content-type']).toBe('text/event-stream');
    expect(headers['cache-control']).toBe('no-cache');

    expect(mockK8sExec).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'test-token',
        namespace: 'test-ns',
        podName: 'superset-pod-xyz',
        containerName: 'superset',
        command: ['superset', 'load-examples'],
      }),
    );

    const events = parseSseEvents(body);
    expect(events).toContainEqual(
      expect.objectContaining({ stream: 'stdout', text: 'Loading...\n' }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'done', exitCode: 0 }),
    );
  });

  it('sends error event when command fails', async () => {
    mockFindSupersetPod.mockResolvedValue('superset-pod-xyz');
    mockK8sExec.mockImplementation((opts) => {
      process.nextTick(() => {
        opts.onData('stderr', 'Error: failed\n');
        opts.onClose(1, 'command failed');
      });
      return { close: jest.fn() };
    });

    const app = createTestApp(supersetLoadExamplesRouter, MOUNT_PATH);
    const { body } = await rawRequest(app, MOUNT_PATH, {
      method: 'POST',
      body: { namespace: 'test-ns' },
    });

    const events = parseSseEvents(body);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'error', exitCode: 1, message: 'command failed' }),
    );
  });
});

function parseSseEvents(raw: string): unknown[] {
  return raw
    .split('\n\n')
    .filter((chunk) => chunk.trim())
    .map((chunk) => {
      const dataLine = chunk.split('\n').find((l) => l.startsWith('data: '));
      if (!dataLine) return null;
      try {
        return JSON.parse(dataLine.slice(6));
      } catch {
        return dataLine.slice(6);
      }
    })
    .filter(Boolean);
}

import http from 'http';
import express from 'express';

function rawRequest(
  app: express.Express,
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  const { method = 'GET', body } = options;
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        reject(new Error('Failed to get server address'));
        return;
      }
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: addr.port,
          path,
          method: method.toUpperCase(),
          headers: body ? { 'Content-Type': 'application/json' } : {},
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            server.close();
            const headers: Record<string, string> = {};
            for (const [key, val] of Object.entries(res.headers)) {
              if (typeof val === 'string') headers[key] = val;
            }
            resolve({ status: res.statusCode!, body: data, headers });
          });
        },
      );
      req.on('error', (err) => {
        server.close();
        reject(err);
      });
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  });
}
