import { EventEmitter } from 'events';

const mockWsInstances: any[] = [];

jest.mock('ws', () => {
  return jest.fn().mockImplementation(function (this: any, url: string, protocols: string[], options: any) {
    const emitter = new EventEmitter();
    Object.assign(emitter, {
      url,
      protocols,
      options,
      close: jest.fn(() => emitter.emit('close')),
      readyState: 1,
    });
    mockWsInstances.push(emitter);
    return emitter;
  });
});

jest.mock('../../utils/k8sClient', () => ({
  getK8sBaseUrl: () => 'https://k8s.test:6443',
}));

import { k8sExec } from '../../utils/k8sExec';

function lastWs() {
  return mockWsInstances[mockWsInstances.length - 1];
}

function makeMessage(channel: number, text: string): Buffer {
  const payload = Buffer.from(text, 'utf-8');
  const buf = Buffer.alloc(1 + payload.length);
  buf[0] = channel;
  payload.copy(buf, 1);
  return buf;
}

beforeEach(() => {
  jest.useFakeTimers();
  mockWsInstances.length = 0;
});

afterEach(() => {
  jest.useRealTimers();
});

describe('k8sExec', () => {
  const baseOptions = {
    token: 'test-token',
    namespace: 'test-ns',
    podName: 'superset-pod-abc',
    containerName: 'superset',
    command: ['superset', 'load-examples'],
  };

  it('connects to the correct WebSocket URL', () => {
    const onData = jest.fn();
    const onClose = jest.fn();
    k8sExec({ ...baseOptions, onData, onClose });

    const ws = lastWs();
    expect(ws.url).toContain('wss://k8s.test:6443/api/v1/namespaces/test-ns/pods/superset-pod-abc/exec');
    expect(ws.url).toContain('container=superset');
    expect(ws.url).toContain('command=superset');
    expect(ws.url).toContain('command=load-examples');
    expect(ws.url).toContain('stdout=true');
    expect(ws.url).toContain('stderr=true');
  });

  it('uses v4.channel.k8s.io subprotocol', () => {
    const onData = jest.fn();
    const onClose = jest.fn();
    k8sExec({ ...baseOptions, onData, onClose });

    expect(lastWs().protocols).toEqual(['v4.channel.k8s.io']);
  });

  it('sends Bearer token in headers', () => {
    const onData = jest.fn();
    const onClose = jest.fn();
    k8sExec({ ...baseOptions, onData, onClose });

    expect(lastWs().options.headers.Authorization).toBe('Bearer test-token');
  });

  it('delivers stdout messages via onData', () => {
    const onData = jest.fn();
    const onClose = jest.fn();
    k8sExec({ ...baseOptions, onData, onClose });

    lastWs().emit('message', makeMessage(1, 'Loading examples...\n'));

    expect(onData).toHaveBeenCalledWith('stdout', 'Loading examples...\n');
  });

  it('delivers stderr messages via onData', () => {
    const onData = jest.fn();
    const onClose = jest.fn();
    k8sExec({ ...baseOptions, onData, onClose });

    lastWs().emit('message', makeMessage(2, 'WARNING: something\n'));

    expect(onData).toHaveBeenCalledWith('stderr', 'WARNING: something\n');
  });

  it('parses successful exit from channel 3 status', () => {
    const onData = jest.fn();
    const onClose = jest.fn();
    k8sExec({ ...baseOptions, onData, onClose });

    lastWs().emit('message', makeMessage(3, JSON.stringify({ status: 'Success' })));

    expect(onClose).toHaveBeenCalledWith(0, undefined);
  });

  it('parses non-zero exit code from channel 3 status', () => {
    const onData = jest.fn();
    const onClose = jest.fn();
    k8sExec({ ...baseOptions, onData, onClose });

    const status = {
      status: 'Failure',
      message: 'command terminated with exit code 1',
      details: { causes: [{ reason: 'ExitCode', message: '1' }] },
    };
    lastWs().emit('message', makeMessage(3, JSON.stringify(status)));

    expect(onClose).toHaveBeenCalledWith(1, 'command terminated with exit code 1');
  });

  it('calls onClose on WebSocket error', () => {
    const onData = jest.fn();
    const onClose = jest.fn();
    k8sExec({ ...baseOptions, onData, onClose });

    lastWs().emit('error', new Error('connection refused'));

    expect(onClose).toHaveBeenCalledWith(null, 'connection refused');
  });

  it('calls onClose when WebSocket closes without status', () => {
    const onData = jest.fn();
    const onClose = jest.fn();
    k8sExec({ ...baseOptions, onData, onClose });

    lastWs().emit('close');

    expect(onClose).toHaveBeenCalledWith(null, 'WebSocket closed unexpectedly');
  });

  it('does not call onClose twice when status is received before close', () => {
    const onData = jest.fn();
    const onClose = jest.fn();
    k8sExec({ ...baseOptions, onData, onClose });

    lastWs().emit('message', makeMessage(3, JSON.stringify({ status: 'Success' })));
    lastWs().emit('close');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('times out and closes the WebSocket', () => {
    const onData = jest.fn();
    const onClose = jest.fn();
    k8sExec({ ...baseOptions, onData, onClose, timeoutMs: 5000 });

    jest.advanceTimersByTime(5000);

    expect(lastWs().close).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledWith(null, 'Command timed out after 5000ms');
  });

  it('close() handle cancels the exec', () => {
    const onData = jest.fn();
    const onClose = jest.fn();
    const handle = k8sExec({ ...baseOptions, onData, onClose });

    handle.close();

    expect(lastWs().close).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledWith(null, 'Exec cancelled');
  });
});
