import { Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../../middleware/auth';

function createMockReq(headers: Record<string, string | undefined> = {}): Request {
  return { headers } as unknown as Request;
}

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

describe('authMiddleware', () => {
  let next: jest.Mock<NextFunction>;

  beforeEach(() => {
    next = jest.fn();
  });

  it('extracts Bearer token from Authorization header', () => {
    const req = createMockReq({ authorization: 'Bearer my-token-123' });
    const res = createMockRes();

    authMiddleware(req, res, next);

    expect(req.token).toBe('my-token-123');
    expect(next).toHaveBeenCalled();
  });

  it('extracts token from x-forwarded-access-token header', () => {
    const req = createMockReq({ 'x-forwarded-access-token': 'forwarded-token' });
    const res = createMockRes();

    authMiddleware(req, res, next);

    expect(req.token).toBe('forwarded-token');
    expect(next).toHaveBeenCalled();
  });

  it('prefers Authorization header over x-forwarded-access-token', () => {
    const req = createMockReq({
      authorization: 'Bearer auth-token',
      'x-forwarded-access-token': 'forwarded-token',
    });
    const res = createMockRes();

    authMiddleware(req, res, next);

    expect(req.token).toBe('auth-token');
    expect(next).toHaveBeenCalled();
  });

  it('returns 401 when no token is provided', () => {
    const req = createMockReq();
    const res = createMockRes();

    authMiddleware(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Authentication required' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for non-Bearer Authorization header', () => {
    const req = createMockReq({ authorization: 'Basic dXNlcjpwYXNz' });
    const res = createMockRes();

    authMiddleware(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for empty x-forwarded-access-token', () => {
    const req = createMockReq({ 'x-forwarded-access-token': '' });
    const res = createMockRes();

    authMiddleware(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});
