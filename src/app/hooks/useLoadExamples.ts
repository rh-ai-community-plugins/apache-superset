import { useState, useCallback, useRef } from 'react';

interface UseLoadExamplesReturn {
  startLoadExamples: (namespace: string) => void;
  logs: string;
  isRunning: boolean;
  isDone: boolean;
  error: string | null;
  exitCode: number | null;
  reset: () => void;
}

export function useLoadExamples(): UseLoadExamplesReturn {
  const [logs, setLogs] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const abortRef = useRef<AbortController>();

  const appendLog = useCallback((text: string) => {
    setLogs((prev) => prev + text);
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setLogs('');
    setIsRunning(false);
    setIsDone(false);
    setError(null);
    setExitCode(null);
  }, []);

  const startLoadExamples = useCallback(
    (namespace: string) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setIsRunning(true);
      setIsDone(false);
      setError(null);
      setExitCode(null);
      setLogs('');

      (async () => {
        try {
          const response = await fetch('/apache-superset/api/superset/load-examples', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ namespace }),
            signal: controller.signal,
          });

          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            setError((data as Record<string, string>).error || `Request failed: ${response.status}`);
            setIsRunning(false);
            return;
          }

          const reader = response.body?.getReader();
          if (!reader) {
            setError('Streaming not supported');
            setIsRunning(false);
            return;
          }

          const decoder = new TextDecoder();
          let buffer = '';

          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split('\n\n');
            buffer = parts.pop() || '';

            for (const part of parts) {
              const dataLine = part.split('\n').find((l) => l.startsWith('data: '));
              if (!dataLine) continue;
              try {
                const event = JSON.parse(dataLine.slice(6));
                if (event.type === 'done') {
                  setExitCode(event.exitCode ?? 0);
                  setIsDone(true);
                  setIsRunning(false);
                } else if (event.type === 'error') {
                  setExitCode(event.exitCode);
                  setError(event.message || 'Command failed');
                  setIsRunning(false);
                } else if (event.stream) {
                  appendLog(event.text);
                }
              } catch {
                // ignore malformed SSE
              }
            }
          }
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') return;
          setError(e instanceof Error ? e.message : 'Load examples failed');
          setIsRunning(false);
        }
      })();
    },
    [appendLog],
  );

  return { startLoadExamples, logs, isRunning, isDone, error, exitCode, reset };
}
