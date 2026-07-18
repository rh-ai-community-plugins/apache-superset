import { Router, Request, Response } from 'express';
import { SupersetConfig, K8sResource } from '../types';
import { getResource } from '../utils/k8sApply';
import { K8sApiError } from '../utils/k8sClient';
import { getSecretName, validateNamespace } from '../utils/resourceNames';
import { getRouteUrl } from '../utils/routeUrl';

const router = Router();

const APP_VERSION = '4.1.1';

router.get('/', async (req: Request, res: Response) => {
  const token = req.token!;

  const nsError = validateNamespace(req.query.namespace);
  if (nsError) {
    res.status(400).json({ error: nsError });
    return;
  }

  const namespace = (req.query.namespace as string).trim();

  try {
    const url = await getRouteUrl(token, namespace);

    let embeddingEnabled = true;

    try {
      const secret = await getResource<K8sResource>(
        token,
        'v1',
        'Secret',
        namespace,
        getSecretName(),
      );
      const data = secret.data ?? {};
      embeddingEnabled = data['SUPERSET_GUEST_TOKEN_JWT_SECRET'] !== undefined;
    } catch (err) {
      if (err instanceof K8sApiError && err.statusCode === 404) {
        res.status(404).json({ error: 'Superset instance not found in this namespace' });
        return;
      }
      throw err;
    }

    const config: SupersetConfig = {
      namespace,
      url,
      mode: 'lightweight',
      version: APP_VERSION,
      embeddingEnabled,
    };

    res.json(config);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Config check error in namespace ${namespace}:`, message);
    res.status(500).json({ error: 'Internal server error during config check' });
  }
});

export default router;
