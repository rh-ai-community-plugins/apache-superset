import { Router, Request, Response } from 'express';
import { SupersetConfig, K8sResource } from '../types';
import { getResource } from '../utils/k8sApply';
import { K8sApiError } from '../utils/k8sClient';

const router = Router();

const RELEASE_NAME = 'superset';
const APP_VERSION = '4.1.1';

function getSecretName(): string {
  return `${RELEASE_NAME}-superset-secret`;
}

router.get('/', async (req: Request, res: Response) => {
  const token = req.token!;
  const namespace = req.query.namespace;

  if (typeof namespace !== 'string' || !namespace.trim()) {
    res.status(400).json({ error: 'namespace query parameter is required' });
    return;
  }

  try {
    let url: string | undefined;

    try {
      const routeName = `${RELEASE_NAME}-superset`;
      const route = await getResource<K8sResource>(
        token,
        'route.openshift.io/v1',
        'Route',
        namespace,
        routeName,
      );
      const spec = route.spec as Record<string, unknown> | undefined;
      const host = spec?.host as string | undefined;
      if (host) {
        const tls = spec?.tls as Record<string, unknown> | undefined;
        url = tls ? `https://${host}` : `http://${host}`;
      }
    } catch (err) {
      if (!(err instanceof K8sApiError && err.statusCode === 404)) {
        throw err;
      }
    }

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
