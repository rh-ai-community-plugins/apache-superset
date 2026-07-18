import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { SupersetDeployRequest, K8sResource } from '../types';
import { renderHelmTemplates } from '../utils/helmRenderer';
import { applyResource, listResources, deleteResource } from '../utils/k8sApply';
import { k8sRequest, K8sApiError } from '../utils/k8sClient';
import { RELEASE_NAME, TEARDOWN_LABEL_SELECTOR, validateNamespace } from '../utils/resourceNames';

const router = Router();

const ORIGIN_REGEX = /^https?:\/\/[a-zA-Z0-9][a-zA-Z0-9._-]*(?::(\d{1,5}))?$/;

function generateSecret(length: number): string {
  return crypto.randomBytes(length).toString('base64url').slice(0, length);
}

function generateAlphanumericPassword(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const maxValid = Math.floor(256 / chars.length) * chars.length;
  let result = '';
  while (result.length < length) {
    const bytes = crypto.randomBytes(length - result.length);
    for (let i = 0; i < bytes.length && result.length < length; i++) {
      if (bytes[i] < maxValid) {
        result += chars[bytes[i] % chars.length];
      }
    }
  }
  return result;
}

interface SelfSubjectAccessReview {
  status?: {
    allowed: boolean;
    reason?: string;
  };
}

async function checkRbac(token: string, namespace: string, verb: string): Promise<boolean> {
  const review: Record<string, unknown> = {
    apiVersion: 'authorization.k8s.io/v1',
    kind: 'SelfSubjectAccessReview',
    spec: {
      resourceAttributes: {
        namespace,
        verb,
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

  const nsError = validateNamespace(namespace);
  if (nsError) {
    return { valid: false, error: nsError };
  }

  if (typeof dashboardOrigin !== 'string' || !dashboardOrigin.trim()) {
    return { valid: false, error: 'dashboardOrigin is required' };
  }

  const originMatch = ORIGIN_REGEX.exec(dashboardOrigin.trim());
  if (!originMatch) {
    return { valid: false, error: 'dashboardOrigin must be a valid HTTP(S) origin (e.g., https://dashboard.example.com)' };
  }

  const portStr = originMatch[1];
  if (portStr !== undefined) {
    const port = parseInt(portStr, 10);
    if (port === 0 || port > 65535) {
      return { valid: false, error: 'dashboardOrigin contains an invalid port number (must be 1–65535)' };
    }
  }

  return {
    valid: true,
    data: {
      namespace: (namespace as string).trim(),
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
    const allowed = await checkRbac(token, namespace, 'create');
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

  const nsError = validateNamespace(namespace);
  if (nsError) {
    res.status(400).json({ error: nsError });
    return;
  }

  const ns = (namespace as string).trim();

  try {
    const allowed = await checkRbac(token, ns, 'delete');
    if (!allowed) {
      res.status(403).json({ error: 'Insufficient permissions to tear down resources in this namespace' });
      return;
    }

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

    // List all resource kinds in parallel (read-only, safe to fan out).
    // Within each kind, delete all matching resources in parallel (independent operations).
    const kindResults = await Promise.allSettled(
      kindsToDelete.map(async ({ apiVersion, kind }) => {
        const kindDeleted: Array<{ kind: string; name: string }> = [];
        const kindErrors: string[] = [];

        let list;
        try {
          // List resources by combined label selector that matches what the Helm renderer sets:
          //   app.kubernetes.io/part-of=superset  — all plugin-managed resources
          //   app.kubernetes.io/instance=<release> — scoped to this Superset release
          list = await listResources<K8sResource>(
            token,
            apiVersion,
            kind,
            ns,
            TEARDOWN_LABEL_SELECTOR,
          );
        } catch (err) {
          if (err instanceof K8sApiError && err.statusCode === 404) {
            return { kindDeleted, kindErrors };
          }
          const message = err instanceof Error ? err.message : String(err);
          kindErrors.push(`Failed to list ${kind} resources: ${message}`);
          return { kindDeleted, kindErrors };
        }

        const deleteResults = await Promise.allSettled(
          list.items.map((resource) =>
            deleteResource(token, apiVersion, kind, ns, resource.metadata.name)
              .then(() => ({ kind, name: resource.metadata.name })),
          ),
        );

        for (let i = 0; i < deleteResults.length; i++) {
          const result = deleteResults[i];
          if (result.status === 'fulfilled') {
            kindDeleted.push(result.value);
          } else {
            const err = result.reason as unknown;
            if (err instanceof K8sApiError && err.statusCode === 404) {
              continue;
            }
            const message = err instanceof Error ? err.message : String(err);
            kindErrors.push(`Failed to delete ${kind}/${list.items[i].metadata.name}: ${message}`);
          }
        }

        return { kindDeleted, kindErrors };
      }),
    );

    for (const result of kindResults) {
      if (result.status === 'fulfilled') {
        deleted.push(...result.value.kindDeleted);
        errors.push(...result.value.kindErrors);
      } else {
        const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
        errors.push(`Unexpected teardown error: ${message}`);
      }
    }

    res.json({
      message: deleted.length > 0 ? 'Teardown initiated' : 'No resources found',
      namespace: ns,
      deleted,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Teardown error in namespace ${ns}:`, message);
    res.status(500).json({ error: 'Internal server error during teardown' });
  }
});

export default router;
