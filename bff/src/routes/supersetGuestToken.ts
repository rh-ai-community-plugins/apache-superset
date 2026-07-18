import { Router, Request, Response } from 'express';
import { GuestTokenResponse } from '../types';
import { SupersetClient, SupersetApiError } from '../utils/supersetClient';
import { getAdminCredentials, isSecretNotFound } from '../utils/secretReader';
import { getUserInfo } from '../utils/userIdentity';
import { K8sApiError } from '../utils/k8sClient';
import { validateNamespace } from '../utils/resourceNames';
import { requireToken } from '../utils/routeHelpers';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  const token = requireToken(req, res);
  if (token === null) return;

  const nsError = validateNamespace(req.query.namespace);
  if (nsError) {
    res.status(400).json({ error: nsError });
    return;
  }

  const dashboard = req.query.dashboard as string | undefined;
  if (!dashboard || !UUID_REGEX.test(dashboard)) {
    res.status(400).json({ error: 'dashboard query parameter must be a valid UUID' });
    return;
  }

  const namespace = (req.query.namespace as string).trim();

  let creds;
  try {
    creds = await getAdminCredentials(token, namespace);
  } catch (err) {
    if (isSecretNotFound(err)) {
      res.status(404).json({ error: 'Superset instance not found in this namespace' });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Credential read error in namespace ${namespace}:`, message);
    res.status(500).json({ error: 'Internal server error generating guest token' });
    return;
  }

  try {
    const userInfo = await getUserInfo(token);

    const client = new SupersetClient(
      creds.supersetUrl,
      creds.username,
      creds.password,
    );

    const guestToken = await client.generateGuestToken(dashboard, userInfo);

    const response: GuestTokenResponse = { guestToken };
    res.json(response);
  } catch (err) {
    if (err instanceof K8sApiError) {
      const status = err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 502;
      console.error(`User identity resolution error in namespace ${namespace}:`, err.message);
      res.status(status).json({ error: 'Unable to resolve user identity' });
      return;
    }

    if (err instanceof SupersetApiError) {
      const status = err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 502;
      console.error(`Guest token Superset error in namespace ${namespace}:`, err.message);
      res.status(status).json({ error: 'Superset API request failed' });
      return;
    }

    const message = err instanceof Error ? err.message : String(err);
    console.error(`Guest token error in namespace ${namespace}:`, message);
    res.status(500).json({ error: 'Internal server error generating guest token' });
  }
});

export default router;
