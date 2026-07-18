import { K8sResource } from '../types';
import { getResource } from './k8sApply';
import { K8sApiError } from './k8sClient';
import { getRouteName } from './resourceNames';

export async function getRouteUrl(token: string, namespace: string): Promise<string | undefined> {
  try {
    const route = await getResource<K8sResource>(
      token,
      'route.openshift.io/v1',
      'Route',
      namespace,
      getRouteName(),
    );

    const spec = route.spec as Record<string, unknown> | undefined;
    const host = spec?.host as string | undefined;
    if (host) {
      const tls = spec?.tls as Record<string, unknown> | undefined;
      const scheme = tls ? 'https' : 'http';
      return `${scheme}://${host}`;
    }
  } catch (err) {
    if (err instanceof K8sApiError && err.statusCode === 404) {
      return undefined;
    }
    throw err;
  }
  return undefined;
}
