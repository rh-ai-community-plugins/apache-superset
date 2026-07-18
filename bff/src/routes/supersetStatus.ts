import { Router, Request, Response } from 'express';
import { SupersetStatus, K8sResource } from '../types';
import { getResource } from '../utils/k8sApply';
import { K8sApiError } from '../utils/k8sClient';
import { SupersetClient } from '../utils/supersetClient';

const router = Router();

const RELEASE_NAME = 'superset';
const SUPERSET_PORT = 8088;

interface DeploymentStatus {
  spec?: {
    replicas?: number;
  };
  status?: {
    readyReplicas?: number;
    replicas?: number;
    conditions?: Array<{
      type: string;
      status: string;
      message?: string;
    }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

function getDeploymentName(): string {
  return `${RELEASE_NAME}-superset`;
}

function getPostgresDeploymentName(): string {
  return `${RELEASE_NAME}-superset-postgres`;
}

function getSupersetServiceUrl(namespace: string): string {
  const serviceName = `${RELEASE_NAME}-superset-svc`;
  return `http://${serviceName}.${namespace}.svc.cluster.local:${SUPERSET_PORT}`;
}

async function getDeploymentStatus(
  token: string,
  namespace: string,
  name: string,
): Promise<{ ready: boolean; replicas?: number; readyReplicas?: number; message?: string }> {
  try {
    const deployment = await getResource<DeploymentStatus>(
      token,
      'apps/v1',
      'Deployment',
      namespace,
      name,
    );

    const replicas = deployment.spec?.replicas ?? 0;
    const readyReplicas = deployment.status?.readyReplicas ?? 0;
    const conditions = deployment.status?.conditions ?? [];

    const availableCondition = conditions.find((c) => c.type === 'Available');
    const progressingCondition = conditions.find((c) => c.type === 'Progressing');

    let message: string | undefined;
    if (availableCondition?.status !== 'True') {
      message = progressingCondition?.message ?? 'Deployment is not yet available';
    }

    return {
      ready: readyReplicas >= replicas && replicas > 0,
      replicas,
      readyReplicas,
      message,
    };
  } catch (err) {
    if (err instanceof K8sApiError && err.statusCode === 404) {
      return { ready: false, message: 'Deployment not found' };
    }
    throw err;
  }
}

async function getRouteUrl(token: string, namespace: string): Promise<string | undefined> {
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
      const scheme = tls ? 'https' : 'http';
      return `${scheme}://${host}`;
    }
  } catch {
    // Route not found or not available (non-OpenShift cluster)
  }
  return undefined;
}

router.get('/', async (req: Request, res: Response) => {
  const token = req.token!;
  const namespace = req.query.namespace;

  if (typeof namespace !== 'string' || !namespace.trim()) {
    res.status(400).json({ error: 'namespace query parameter is required' });
    return;
  }

  try {
    const deploymentName = getDeploymentName();
    const postgresName = getPostgresDeploymentName();

    const [supersetDeployment, postgresDeployment] = await Promise.all([
      getDeploymentStatus(token, namespace, deploymentName),
      getDeploymentStatus(token, namespace, postgresName),
    ]);

    if (
      supersetDeployment.message === 'Deployment not found' &&
      postgresDeployment.message === 'Deployment not found'
    ) {
      const status: SupersetStatus = {
        phase: 'not-deployed',
        healthy: false,
        message: 'No Superset instance found in this namespace',
        resources: {
          superset: { ready: false, message: 'Not deployed' },
          postgres: { ready: false, message: 'Not deployed' },
        },
      };
      res.json(status);
      return;
    }

    let healthy = false;
    let version: string | undefined;

    if (supersetDeployment.ready) {
      try {
        const serviceUrl = getSupersetServiceUrl(namespace);
        const client = new SupersetClient(serviceUrl, '', '');
        const health = await client.getSupersetHealth();
        healthy = health.healthy;
        version = health.version;
      } catch {
        healthy = false;
      }
    }

    const routeUrl = await getRouteUrl(token, namespace);

    const allReady = supersetDeployment.ready && postgresDeployment.ready;

    let phase: SupersetStatus['phase'];
    if (allReady && healthy) {
      phase = 'running';
    } else if (
      supersetDeployment.message === 'Deployment not found' &&
      postgresDeployment.message === 'Deployment not found'
    ) {
      phase = 'not-deployed';
    } else if (allReady && !healthy) {
      phase = 'error';
    } else {
      phase = 'deploying';
    }

    const status: SupersetStatus = {
      phase,
      healthy,
      version,
      url: routeUrl,
      message: !allReady
        ? 'Waiting for pods to be ready'
        : !healthy
          ? 'Superset is not responding to health checks'
          : undefined,
      resources: {
        superset: {
          ready: supersetDeployment.ready,
          replicas: supersetDeployment.replicas,
          readyReplicas: supersetDeployment.readyReplicas,
          message: supersetDeployment.message,
        },
        postgres: {
          ready: postgresDeployment.ready,
          replicas: postgresDeployment.replicas,
          readyReplicas: postgresDeployment.readyReplicas,
          message: postgresDeployment.message,
        },
      },
    };

    res.json(status);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Status check error in namespace ${namespace}:`, message);
    res.status(500).json({ error: 'Internal server error during status check' });
  }
});

export default router;
