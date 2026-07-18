import { Router, Request, Response } from 'express';
import { GuestTokenResponse } from '../types';
import { SupersetClient, SupersetApiError } from '../utils/supersetClient';
import { getAdminCredentials, isSecretNotFound } from '../utils/secretReader';
import { getUserInfo } from '../utils/userIdentity';
import { K8sApiError } from '../utils/k8sClient';
import { validateNamespace, isValidUuid } from '../utils/resourceNames';
import { requireToken, safeHttpStatus } from '../utils/routeHelpers';

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
  if (!dashboard || !isValidUuid(dashboard)) {
    res.status(400).json({ error: 'dashboard query parameter must be a valid UUID' });
    return;
  }

  const namespace = (req.query.namespace as string).trim();

  const [credsResult, userResult] = await Promise.allSettled([
    getAdminCredentials(token, namespace),
    getUserInfo(token),
  ]);

  if (credsResult.status === 'rejected') {
    const err = credsResult.reason as unknown;
    if (isSecretNotFound(err)) {
      res.status(404).json({ error: 'Superset instance not found in this namespace' });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Credential read error in namespace ${namespace}:`, message);
    res.status(500).json({ error: 'Internal server error generating guest token' });
    return;
  }

  if (userResult.status === 'rejected') {
    const err = userResult.reason as unknown;
    if (err instanceof K8sApiError) {
      console.error(`User identity resolution error in namespace ${namespace}:`, err.message);
      res.status(safeHttpStatus(err.statusCode)).json({ error: 'Unable to resolve user identity' });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Guest token error in namespace ${namespace}:`, message);
    res.status(500).json({ error: 'Internal server error generating guest token' });
    return;
  }

  const creds = credsResult.value;
  const userInfo = userResult.value;

  try {
    const client = new SupersetClient(
      creds.supersetUrl,
      creds.username,
      creds.password,
    );

    const guestToken = await client.generateGuestToken(dashboard, userInfo);

    const response: GuestTokenResponse = { guestToken };
    res.json(response);
  } catch (err) {
    if (err instanceof SupersetApiError) {
      console.error(`Guest token Superset error in namespace ${namespace}:`, err.message);
      res.status(safeHttpStatus(err.statusCode)).json({ error: 'Superset API request failed' });
      return;
    }

    const message = err instanceof Error ? err.message : String(err);
    console.error(`Guest token error in namespace ${namespace}:`, message);
    res.status(500).json({ error: 'Internal server error generating guest token' });
  }
});

export default router;
