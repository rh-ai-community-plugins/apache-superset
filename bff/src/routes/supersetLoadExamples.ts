import { Router, Request, Response } from 'express';
import { requireToken, safeHttpStatus } from '../utils/routeHelpers';
import { validateNamespace } from '../utils/resourceNames';
import { findSupersetPod } from '../utils/podFinder';
import { k8sExec } from '../utils/k8sExec';
import { K8sApiError } from '../utils/k8sClient';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  const token = requireToken(req, res);
  if (token === null) return;

  const nsError = validateNamespace(req.body?.namespace);
  if (nsError) {
    res.status(400).json({ error: nsError });
    return;
  }

  const namespace = (req.body.namespace as string).trim();

  let podName: string;
  try {
    podName = await findSupersetPod(token, namespace);
  } catch (err) {
    if (err instanceof K8sApiError) {
      res.status(safeHttpStatus(err.statusCode)).json({ error: err.message });
    } else {
      res.status(404).json({
        error: err instanceof Error ? err.message : 'No running Superset pod found',
      });
    }
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let clientDisconnected = false;

  req.on('close', () => {
    clientDisconnected = true;
  });

  const writeSse = (data: object) => {
    if (clientDisconnected) return;
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  k8sExec({
    token,
    namespace,
    podName,
    containerName: 'superset',
    command: ['superset', 'load-examples'],
    onData: (stream, text) => {
      writeSse({ stream, text });
    },
    onClose: (exitCode, errorMessage) => {
      if (exitCode === 0 || (exitCode === null && !errorMessage)) {
        writeSse({ type: 'done', exitCode: exitCode ?? 0 });
      } else {
        writeSse({ type: 'error', exitCode, message: errorMessage });
      }
      if (!clientDisconnected) {
        res.end();
      }
    },
  });
});

export default router;
