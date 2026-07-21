import { K8sResource } from '../types';
import { getResource } from './k8sApply';
import { K8sApiError } from './k8sClient';
import { getSecretName, getSupersetServiceUrl } from './resourceNames';

export interface AdminCredentials {
  username: string;
  password: string;
  supersetUrl: string;
}

export async function getAdminCredentials(
  token: string,
  namespace: string,
): Promise<AdminCredentials> {
  const secret = await getResource<K8sResource>(
    token,
    'v1',
    'Secret',
    namespace,
    getSecretName(),
  );

  const data = secret.data ?? {};

  const username = decodeBase64(data['SUPERSET_ADMIN_USERNAME']) || 'admin';
  const password = decodeBase64(data['SUPERSET_ADMIN_PASSWORD']);

  if (!password) {
    throw new Error('Superset admin password not found in Secret');
  }

  const supersetUrl = await getSupersetUrl(namespace);

  return { username, password, supersetUrl };
}

async function getSupersetUrl(namespace: string): Promise<string> {
  if (process.env.SUPERSET_URL) return process.env.SUPERSET_URL;
  return getSupersetServiceUrl(namespace);
}

function decodeBase64(value: string | undefined): string {
  if (!value) return '';
  return Buffer.from(value, 'base64').toString('utf-8');
}

export function isSecretNotFound(err: unknown): boolean {
  return err instanceof K8sApiError && err.statusCode === 404;
}
