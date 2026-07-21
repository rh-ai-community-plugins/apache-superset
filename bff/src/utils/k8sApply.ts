import { K8sResource, K8sList } from '../types';
import { k8sRequest, K8sApiError } from './k8sClient';

function apiPath(
  apiVersion: string,
  kind: string,
  namespace?: string,
  name?: string,
): string {
  const isCore = !apiVersion.includes('/');
  const base = isCore ? '/api' : '/apis';
  const parts = [base, apiVersion];

  if (namespace) {
    parts.push('namespaces', namespace);
  }

  parts.push(kindToResource(kind));

  if (name) {
    parts.push(name);
  }

  return parts.join('/');
}

const KIND_RESOURCE_MAP: Record<string, string> = {
  Deployment: 'deployments',
  Service: 'services',
  ConfigMap: 'configmaps',
  Secret: 'secrets',
  PersistentVolumeClaim: 'persistentvolumeclaims',
  ServiceAccount: 'serviceaccounts',
  Job: 'jobs',
  Route: 'routes',
  Pod: 'pods',
  Namespace: 'namespaces',
};

function kindToResource(kind: string): string {
  const mapped = KIND_RESOURCE_MAP[kind];
  if (mapped) {
    return mapped;
  }
  throw new Error(
    `Unknown K8s kind "${kind}" — add it to KIND_RESOURCE_MAP in k8sApply.ts`,
  );
}

const TERMINATING_POLL_INTERVAL_MS = 1000;
const TERMINATING_POLL_TIMEOUT_MS = 30000;

async function waitForDeletion(
  token: string,
  resourcePath: string,
  timeoutMs: number = TERMINATING_POLL_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await k8sRequest<K8sResource>(token, resourcePath);
    } catch (err) {
      if (err instanceof K8sApiError && err.statusCode === 404) {
        return;
      }
      throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, TERMINATING_POLL_INTERVAL_MS));
  }
  throw new Error(
    `Timed out waiting for ${resourcePath} to be deleted (${timeoutMs}ms)`,
  );
}

export async function applyResource(
  token: string,
  resource: K8sResource,
): Promise<K8sResource> {
  const { apiVersion, kind, metadata } = resource;
  const createPath = apiPath(apiVersion, kind, metadata.namespace);

  try {
    const created = await k8sRequest<K8sResource>(token, createPath, {
      method: 'POST',
      body: resource,
    });
    if (created === undefined) {
      throw new Error(`Unexpected empty response from K8s API: POST ${createPath}`);
    }
    return created;
  } catch (err) {
    if (err instanceof K8sApiError && err.statusCode === 409) {
      const resourcePath = apiPath(apiVersion, kind, metadata.namespace, metadata.name);
      const existing = await k8sRequest<K8sResource>(token, resourcePath);
      if (existing === undefined) {
        throw new Error(`Unexpected empty response from K8s API: GET ${resourcePath}`);
      }

      if (existing.metadata.deletionTimestamp) {
        await waitForDeletion(token, resourcePath);
        const created = await k8sRequest<K8sResource>(token, createPath, {
          method: 'POST',
          body: resource,
        });
        if (created === undefined) {
          throw new Error(`Unexpected empty response from K8s API: POST ${createPath} (after deletion)`);
        }
        return created;
      }

      const updated = {
        ...resource,
        metadata: {
          ...resource.metadata,
          resourceVersion: existing.metadata.resourceVersion,
        },
      };
      const patched = await k8sRequest<K8sResource>(token, resourcePath, {
        method: 'PUT',
        body: updated,
      });
      if (patched === undefined) {
        throw new Error(`Unexpected empty response from K8s API: PUT ${resourcePath}`);
      }
      return patched;
    }
    throw err;
  }
}

export function deleteResource(
  token: string,
  apiVersion: string,
  kind: string,
  namespace: string,
  name: string,
): Promise<unknown> {
  const path = apiPath(apiVersion, kind, namespace, name);
  return k8sRequest(token, path, { method: 'DELETE' });
}

export async function getResource<T = K8sResource>(
  token: string,
  apiVersion: string,
  kind: string,
  namespace: string,
  name: string,
): Promise<T> {
  const path = apiPath(apiVersion, kind, namespace, name);
  const result = await k8sRequest<T>(token, path);
  if (result === undefined) {
    throw new Error(`Unexpected empty response from K8s API: GET ${path}`);
  }
  return result;
}

export async function listResources<T = K8sResource>(
  token: string,
  apiVersion: string,
  kind: string,
  namespace: string,
  labelSelector?: string,
): Promise<K8sList<T>> {
  let path = apiPath(apiVersion, kind, namespace);
  if (labelSelector) {
    path += `?labelSelector=${encodeURIComponent(labelSelector)}`;
  }
  const result = await k8sRequest<K8sList<T>>(token, path);
  if (result === undefined) {
    throw new Error(`Unexpected empty response from K8s API: GET ${path}`);
  }
  return result;
}
