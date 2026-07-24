/**
 * Error mapping tests
 * Verifies error → { status, code } mapping for HTTP responses.
 */

import { describe, it, expect } from 'vitest';
import { mapErrorToStatus } from '../../src/http/middleware/error-mapping.js';

describe('mapErrorToStatus', () => {
  it('returns 504 for timeout', () => {
    const r = mapErrorToStatus(new Error('executeQuery timed out after 5000ms'));
    expect(r.status).toBe(504);
    expect(r.code).toBe('TIMEOUT');
  });

  it('returns 401 for auth errors', () => {
    const r = mapErrorToStatus(new Error('Invalid API key'));
    expect(r.status).toBe(401);
    expect(r.code).toBe('UNAUTHORIZED');
  });

  it('returns 403 for permission errors', () => {
    const r = mapErrorToStatus(new Error('execute_script 需要 script 权限'));
    expect(r.status).toBe(403);
    expect(r.code).toBe('FORBIDDEN');
  });

  it('returns 404 for not found', () => {
    const r = mapErrorToStatus(new Error('Table "users" not found'));
    expect(r.status).toBe(404);
    expect(r.code).toBe('NOT_FOUND');
  });

  it('returns 404 for allowlist rejection', () => {
    const r = mapErrorToStatus(new Error('Path not in allowlist: /etc/passwd'));
    expect(r.status).toBe(404);
    expect(r.code).toBe('NOT_FOUND');
  });

  it('returns 500 for unknown errors', () => {
    const r = mapErrorToStatus(new Error('Something went wrong'));
    expect(r.status).toBe(500);
    expect(r.code).toBe('INTERNAL_ERROR');
  });

  it('returns 500 for non-Error throws', () => {
    const r = mapErrorToStatus('plain string' as any);
    expect(r.status).toBe(500);
  });
});