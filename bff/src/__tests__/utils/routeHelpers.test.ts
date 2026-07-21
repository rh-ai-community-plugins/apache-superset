import { safeHttpStatus } from '../../utils/routeHelpers';

describe('safeHttpStatus', () => {
  it('passes through 400 (lower boundary of client errors)', () => {
    expect(safeHttpStatus(400)).toBe(400);
  });

  it('passes through 404', () => {
    expect(safeHttpStatus(404)).toBe(404);
  });

  it('passes through 422', () => {
    expect(safeHttpStatus(422)).toBe(422);
  });

  it('passes through 500 (lower boundary of server errors)', () => {
    expect(safeHttpStatus(500)).toBe(500);
  });

  it('passes through 503', () => {
    expect(safeHttpStatus(503)).toBe(503);
  });

  it('passes through 599 (upper boundary)', () => {
    expect(safeHttpStatus(599)).toBe(599);
  });

  it('clamps 200 to 502', () => {
    expect(safeHttpStatus(200)).toBe(502);
  });

  it('clamps 301 to 502', () => {
    expect(safeHttpStatus(301)).toBe(502);
  });

  it('clamps 600 to 502', () => {
    expect(safeHttpStatus(600)).toBe(502);
  });

  it('clamps 0 to 502', () => {
    expect(safeHttpStatus(0)).toBe(502);
  });

  it('clamps negative values to 502', () => {
    expect(safeHttpStatus(-1)).toBe(502);
  });
});
