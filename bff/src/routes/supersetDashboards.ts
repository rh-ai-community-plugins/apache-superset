import { Router, Request, Response } from 'express';
import { SupersetClient, SupersetApiError } from '../utils/supersetClient';
import { getAdminCredentials, isSecretNotFound } from '../utils/secretReader';
import { validateNamespace } from '../utils/resourceNames';
import { requireToken } from '../utils/routeHelpers';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  const token = requireToken(req, res);
  if (token === null) return;

  const nsError = validateNamespace(req.query.namespace);
  if (nsError) {
    res.status(400).json({ error: nsError });
    return;
  }

  const namespace = (req.query.namespace as string).trim();

  const page = parseInt(req.query.page as string, 10) || 0;
  const pageSize = Math.min(parseInt(req.query.pageSize as string, 10) || 100, 250);

  try {
    const creds = await getAdminCredentials(token, namespace);

    const client = new SupersetClient(
      creds.supersetUrl,
      creds.username,
      creds.password,
    );

    const result = await client.listDashboards(page, pageSize);
    res.json(result);
  } catch (err) {
    if (isSecretNotFound(err)) {
      res.status(404).json({ error: 'Superset instance not found in this namespace' });
      return;
    }
    if (err instanceof SupersetApiError) {
      const status = err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 502;
      res.status(status).json({ error: `Superset API error: ${err.message}` });
      return;
    }

    const message = err instanceof Error ? err.message : String(err);
    console.error(`Dashboard list error in namespace ${namespace}:`, message);
    res.status(500).json({ error: 'Internal server error listing dashboards' });
  }
});

export default router;
