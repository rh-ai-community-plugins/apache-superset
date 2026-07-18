import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { SupersetDeployRequest, K8sResource } from '../types';
import { renderHelmTemplates } from '../utils/helmRenderer';
import { applyResource, listResources, deleteResource } from '../utils/k8sApply';
import { k8sRequest, K8sApiError } from '../utils/k8sClient';

const router = Router();

const RELEASE_NAME = 'superset';
const MANAGED_BY_LABEL = 'app.kubernetes.io/part-of=superset';

function generateSecret(length: number): string {
  return crypto.randomBytes(length).toString('base64url').slice(0, length);
}

interface SelfSubjectAccessReview {
  status?: {
    allowed: boolean;
    reason?: string;
  };
}

async function checkRbac(token: string, namespace: string): Promise<boolean> {
  const review: Record<string, unknown> = {
    apiVersion: 'authorization.k8s.io/v1',
    kind: 'SelfSubjectAccessReview',
    spec: {
      resourceAttributes: {
        namespace,
        verb: 'create',
        group: 'apps',
        resource: 'deployments',
      },
    },
  };

  try {
    const result = await k8sRequest<SelfSubjectAccessReview>(
      token,
      '/apis/authorization.k8s.io/v1/selfsubjectaccessreviews',
      { method: 'POST', body: review },
    );
    return result?.status?.allowed === true;
  } catch {
    return false;
  }
}

function validateDeployRequest(body: unknown): { valid: true; data: SupersetDeployRequest } | { valid: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body is required' };
  }

  const { namespace, dashboardOrigin } = body as Record<string, unknown>;

  if (typeof namespace !== 'string' || !namespace.trim()) {
    return { valid: false, error: 'namespace is required' };
  }

  if (typeof dashboardOrigin !== 'string' || !dashboardOrigin.trim()) {
    return { valid: false, error: 'dashboardOrigin is required' };
  }

  return {
    valid: true,
    data: {
      namespace: namespace.trim(),
      dashboardOrigin: dashboardOrigin.trim(),
      adminPassword: typeof (body as Record<string, unknown>).adminPassword === 'string'
        ? ((body as Record<string, unknown>).adminPassword as string)
        : undefined,
      secretKey: typeof (body as Record<string, unknown>).secretKey === 'string'
        ? ((body as Record<string, unknown>).secretKey as string)
        : undefined,
      postgresPassword: typeof (body as Record<string, unknown>).postgresPassword === 'string'
        ? ((body as Record<string, unknown>).postgresPassword as string)
        : undefined,
    },
  };
}

router.post('/', async (req: Request, res: Response) => {
  const token = req.token!;

  const validation = validateDeployRequest(req.body);
  if (!validation.valid) {
    res.status(400).json({ error: validation.error });
    return;
  }

  const { namespace, dashboardOrigin, adminPassword, secretKey, postgresPassword } = validation.data;

  try {
    const allowed = await checkRbac(token, namespace);
    if (!allowed) {
      res.status(403).json({ error: 'Insufficient permissions to deploy in this namespace' });
      return;
    }

    const resolvedAdminPassword = adminPassword || generateSecret(24);
    const resolvedSecretKey = secretKey || generateSecret(32);
    const resolvedPostgresPassword = postgresPassword || generateAlphanumericPassword(24);

    const { resources, warnings } = renderHelmTemplates({
      releaseName: RELEASE_NAME,
      namespace,
      values: {
        admin: {
          password: resolvedAdminPassword,
        },
        secretKey: resolvedSecretKey,
        postgres: {
          password: resolvedPostgresPassword,
        },
        embedding: {
          allowedOrigins: dashboardOrigin,
        },
      },
    });

    const applied: Array<{ kind: string; name: string }> = [];
    const errors: string[] = [];

    for (const resource of resources) {
      try {
        await applyResource(token, resource);
        applied.push({ kind: resource.kind, name: resource.metadata.name });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`Failed to apply ${resource.kind}/${resource.metadata.name}: ${message}`);
      }
    }

    if (errors.length > 0 && applied.length === 0) {
      res.status(500).json({
        error: 'Failed to deploy Superset',
        details: errors,
        warnings,
      });
      return;
    }

    res.status(errors.length > 0 ? 207 : 201).json({
      message: errors.length > 0 ? 'Partially deployed' : 'Deployment initiated',
      namespace,
      applied,
      errors: errors.length > 0 ? errors : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Deploy error in namespace ${namespace}:`, message);
    res.status(500).json({ error: 'Internal server error during deployment' });
  }
});

router.delete('/', async (req: Request, res: Response) => {
  const token = req.token!;
  const namespace = req.query.namespace;

  if (typeof namespace !== 'string' || !namespace.trim()) {
    res.status(400).json({ error: 'namespace query parameter is required' });
    return;
  }

  try {
    const kindsToDelete: Array<{ apiVersion: string; kind: string }> = [
      { apiVersion: 'apps/v1', kind: 'Deployment' },
      { apiVersion: 'v1', kind: 'Service' },
      { apiVersion: 'v1', kind: 'ConfigMap' },
      { apiVersion: 'v1', kind: 'Secret' },
      { apiVersion: 'v1', kind: 'PersistentVolumeClaim' },
      { apiVersion: 'v1', kind: 'ServiceAccount' },
      { apiVersion: 'route.openshift.io/v1', kind: 'Route' },
    ];

    const deleted: Array<{ kind: string; name: string }> = [];
    const errors: string[] = [];

    for (const { apiVersion, kind } of kindsToDelete) {
      try {
        const list = await listResources<K8sResource>(
          token,
          apiVersion,
          kind,
          namespace,
          MANAGED_BY_LABEL,
        );

        for (const resource of list.items) {
          try {
            await deleteResource(token, apiVersion, kind, namespace, resource.metadata.name);
            deleted.push({ kind, name: resource.metadata.name });
          } catch (err) {
            if (err instanceof K8sApiError && err.statusCode === 404) {
              continue;
            }
            const message = err instanceof Error ? err.message : String(err);
            errors.push(`Failed to delete ${kind}/${resource.metadata.name}: ${message}`);
          }
        }
      } catch (err) {
        if (err instanceof K8sApiError && err.statusCode === 404) {
          continue;
        }
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`Failed to list ${kind} resources: ${message}`);
      }
    }

    res.json({
      message: deleted.length > 0 ? 'Teardown initiated' : 'No resources found',
      namespace,
      deleted,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Teardown error in namespace ${namespace}:`, message);
    res.status(500).json({ error: 'Internal server error during teardown' });
  }
});

function generateAlphanumericPassword(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

export default router;
