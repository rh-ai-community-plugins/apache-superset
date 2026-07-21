import WebSocket from 'ws';
import fs from 'fs';
import { getK8sBaseUrl } from './k8sClient';

const CA_PATH = '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt';
let cachedCa: Buffer | undefined;
try {
  cachedCa = fs.readFileSync(CA_PATH);
} catch {
  // Not running in-cluster or CA file not available
}

const DEFAULT_TIMEOUT_MS = 600_000;

export interface K8sExecOptions {
  token: string;
  namespace: string;
  podName: string;
  containerName: string;
  command: string[];
  onData: (stream: 'stdout' | 'stderr', data: string) => void;
  onClose: (exitCode: number | null, errorMessage?: string) => void;
  timeoutMs?: number;
}

export interface K8sExecHandle {
  close: () => void;
}

function buildExecUrl(
  baseUrl: string,
  namespace: string,
  podName: string,
  containerName: string,
  command: string[],
): string {
  const wsBase = baseUrl
    .replace(/^https:\/\//, 'wss://')
    .replace(/^http:\/\//, 'ws://');

  const params = new URLSearchParams();
  params.set('container', containerName);
  for (const arg of command) {
    params.append('command', arg);
  }
  params.set('stdout', 'true');
  params.set('stderr', 'true');

  return `${wsBase}/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(podName)}/exec?${params.toString()}`;
}

function parseExitCode(statusJson: string): { exitCode: number | null; message?: string } {
  try {
    const status = JSON.parse(statusJson);
    if (status.status === 'Success') {
      return { exitCode: 0 };
    }
    const causes: Array<{ reason?: string; message?: string }> = status.details?.causes ?? [];
    const exitCause = causes.find((c) => c.reason === 'ExitCode');
    const exitCode = exitCause?.message ? parseInt(exitCause.message, 10) : null;
    return {
      exitCode: Number.isNaN(exitCode) ? null : exitCode,
      message: status.message,
    };
  } catch {
    return { exitCode: null, message: statusJson };
  }
}

export function k8sExec(options: K8sExecOptions): K8sExecHandle {
  const {
    token,
    namespace,
    podName,
    containerName,
    command,
    onData,
    onClose,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  const baseUrl = getK8sBaseUrl();
  const url = buildExecUrl(baseUrl, namespace, podName, containerName, command);

  const wsOptions: WebSocket.ClientOptions = {
    headers: { Authorization: `Bearer ${token}` },
  };

  const isHttps = baseUrl.startsWith('https://');
  if (isHttps) {
    if (process.env.K8S_TLS_INSECURE === 'true') {
      wsOptions.rejectUnauthorized = false;
    } else if (cachedCa) {
      wsOptions.ca = cachedCa;
    }
  }

  const ws = new WebSocket(url, ['v4.channel.k8s.io'], wsOptions);

  let closed = false;
  let statusReceived = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const finish = (exitCode: number | null, errorMessage?: string) => {
    if (closed) return;
    closed = true;
    if (timer) clearTimeout(timer);
    onClose(exitCode, errorMessage);
  };

  timer = setTimeout(() => {
    if (!closed) {
      finish(null, `Command timed out after ${timeoutMs}ms`);
      ws.close();
    }
  }, timeoutMs);

  ws.on('message', (raw: Buffer) => {
    if (closed || raw.length < 1) return;

    const channel = raw[0];
    const payload = raw.subarray(1).toString('utf-8');

    if (channel === 1) {
      onData('stdout', payload);
    } else if (channel === 2) {
      onData('stderr', payload);
    } else if (channel === 3) {
      statusReceived = true;
      const { exitCode, message } = parseExitCode(payload);
      finish(exitCode, exitCode !== 0 ? message : undefined);
    }
  });

  ws.on('error', (err: Error) => {
    finish(null, err.message);
  });

  ws.on('close', () => {
    if (!statusReceived) {
      finish(null, 'WebSocket closed unexpectedly');
    }
  });

  return {
    close: () => {
      if (!closed) {
        finish(null, 'Exec cancelled');
        ws.close();
      }
    },
  };
}
