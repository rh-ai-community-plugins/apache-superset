import { validateNamespace, isValidUuid } from '../../utils/resourceNames';

describe('validateNamespace', () => {
  it('accepts a simple lowercase namespace', () => {
    expect(validateNamespace('my-namespace')).toBeNull();
  });

  it('accepts a single-character namespace', () => {
    expect(validateNamespace('a')).toBeNull();
  });

  it('accepts alphanumeric-only namespace', () => {
    expect(validateNamespace('myproject123')).toBeNull();
  });

  it('rejects undefined', () => {
    expect(validateNamespace(undefined)).toBe('namespace is required');
  });

  it('rejects empty string', () => {
    expect(validateNamespace('')).toBe('namespace is required');
  });

  it('rejects whitespace-only string', () => {
    expect(validateNamespace('   ')).toBe('namespace is required');
  });

  it('rejects uppercase characters', () => {
    expect(validateNamespace('MyNamespace')).toMatch(/valid Kubernetes namespace/);
  });

  it('rejects namespace starting with a hyphen', () => {
    expect(validateNamespace('-bad')).toMatch(/valid Kubernetes namespace/);
  });

  it('rejects namespace ending with a hyphen', () => {
    expect(validateNamespace('bad-')).toMatch(/valid Kubernetes namespace/);
  });
});

describe('isValidUuid', () => {
  it('accepts a valid lowercase UUID v4', () => {
    expect(isValidUuid('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(true);
  });

  it('accepts a valid uppercase UUID', () => {
    expect(isValidUuid('A1B2C3D4-E5F6-7890-ABCD-EF1234567890')).toBe(true);
  });

  it('accepts a mixed-case UUID', () => {
    expect(isValidUuid('a1B2c3D4-e5F6-7890-AbCd-Ef1234567890')).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(isValidUuid('')).toBe(false);
  });

  it('rejects a UUID missing hyphens', () => {
    expect(isValidUuid('a1b2c3d4e5f67890abcdef1234567890')).toBe(false);
  });

  it('rejects a UUID with wrong segment lengths', () => {
    expect(isValidUuid('a1b2c3d4-e5f6-7890-abcd-ef123456789')).toBe(false);
  });

  it('rejects a plain string', () => {
    expect(isValidUuid('not-a-uuid')).toBe(false);
  });

  it('rejects a UUID with non-hex characters', () => {
    expect(isValidUuid('g1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(false);
  });
});
