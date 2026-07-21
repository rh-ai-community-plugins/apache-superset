import { listResources } from './k8sApply';
import { K8sResource } from '../types';
import { RELEASE_NAME } from './resourceNames';

const SUPERSET_POD_SELECTOR =
  `app.kubernetes.io/name=superset,app.kubernetes.io/instance=${RELEASE_NAME},app.kubernetes.io/component=server`;

export async function findSupersetPod(token: string, namespace: string): Promise<string> {
  const list = await listResources<K8sResource>(token, 'v1', 'Pod', namespace, SUPERSET_POD_SELECTOR);

  const running = list.items.filter((pod) => pod.status?.phase === 'Running');

  if (running.length === 0) {
    const phases = list.items.map((p) => `${p.metadata.name}=${p.status?.phase ?? 'Unknown'}`);
    const detail = list.items.length > 0
      ? `Found ${list.items.length} pod(s) but none Running: ${phases.join(', ')}`
      : 'No pods matched the label selector';
    throw new Error(`No running Superset pod found in namespace "${namespace}". ${detail}`);
  }

  return running[0].metadata.name;
}
