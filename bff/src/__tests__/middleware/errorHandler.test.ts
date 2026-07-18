import { Request, Response, NextFunction } from 'express';
import { errorHandler } from '../../middleware/errorHandler';
import { K8sApiError } from '../../utils/k8sClient';

function createMockRes(): Response & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: unknown) {
      res.body = data;
      return res;
    },
  } as unknown as Response & { statusCode: number; body: unknown };
  return res;
}

const noop: NextFunction = jest.fn();

describe('errorHandler middleware', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('K8sApiError handling', () => {
    it('returns the K8s status code without forwarding the body', () => {
      const sensitiveBody = JSON.stringify({
        kind: 'Status',
        message: 'deployments.apps "superset" is forbidden: service account default/superset ...',
        reason: 'Forbidden',
        code: 403,
      });
      const err = new K8sApiError('K8s API returned 403', 403, sensitiveBody);

      const res = createMockRes();
      errorHandler(err, {} as Request, res, noop);

      expect(res.statusCode).toBe(403);
      expect(res.body).toEqual({ error: 'Kubernetes API request failed' });
    });

    it('does not include the raw K8s body in the response', () => {
      const sensitiveBody = '{"reason":"AlreadyExists","details":{"name":"superset-superset","namespace":"my-ns"}}';
      const err = new K8sApiError('K8s API returned 409', 409, sensitiveBody);

      const res = createMockRes();
      errorHandler(err, {} as Request, res, noop);

      const responseJson = JSON.stringify(res.body);
      expect(responseJson).not.toContain('AlreadyExists');
      expect(responseJson).not.toContain('my-ns');
      expect(responseJson).not.toContain(sensitiveBody);
    });

    it('passes through 404 status code from K8s', () => {
      const err = new K8sApiError('K8s API returned 404', 404, '{"reason":"NotFound"}');

      const res = createMockRes();
      errorHandler(err, {} as Request, res, noop);

      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ error: 'Kubernetes API request failed' });
    });

    it('logs the error server-side without including the body in the log line', () => {
      const sensitiveBody = '{"serviceAccountName":"superset-sa","namespace":"prod"}';
      const err = new K8sApiError('K8s API returned 500', 500, sensitiveBody);

      const res = createMockRes();
      errorHandler(err, {} as Request, res, noop);

      // The log should reference the status and message but NOT the raw body
      expect(consoleSpy).toHaveBeenCalledWith('K8s API error [500]: K8s API returned 500');
      const loggedArgs = consoleSpy.mock.calls[0].join(' ');
      expect(loggedArgs).not.toContain(sensitiveBody);
    });
  });

  describe('generic Error handling', () => {
    it('returns 500 for a plain Error', () => {
      const err = new Error('something went wrong');

      const res = createMockRes();
      errorHandler(err, {} as Request, res, noop);

      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({ error: 'Internal server error' });
    });

    it('returns 500 for a non-Error thrown value', () => {
      const err = 'string error';

      const res = createMockRes();
      errorHandler(err, {} as Request, res, noop);

      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({ error: 'Internal server error' });
    });
  });
});
