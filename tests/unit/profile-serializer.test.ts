/**
 * ProfileSerializer tests (v2.20)
 */

import { describe, it, expect } from 'vitest';
import {
  ProfileSerializer,
  REDACTED,
  redactConfig,
  validateProfileExport,
  toYAML,
  parseYAML,
  toJSON,
  parseJSON,
  type ProfileExport,
} from '../../src/core/profile-serializer.js';
import type { Profile } from '../../src/core/profile-manager.js';

const baseProfile: Profile = {
  id: 'p1',
  name: 'prod-mysql',
  description: 'Production MySQL',
  type: 'mysql',
  config: { type: 'mysql', host: 'db.prod', port: 3306, user: 'app', password: 'hunter2' } as any,
  role: 'primary',
  tags: ['prod', 'critical'],
  enabled: true,
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-02T00:00:00Z',
  created_by: 'mcp',
  use_count: 5,
};

describe('profile redaction', () => {
  it('replaces top-level password fields', () => {
    const r = redactConfig(baseProfile.config as unknown as Record<string, unknown>);
    expect((r as any).password).toBe(REDACTED);
    expect((r as any).host).toBe('db.prod');
  });

  it('replaces nested keys (case insensitive)', () => {
    const r = redactConfig({ a: { Token: 'abc', Keep: 'ok' }, password: 'x' });
    expect((r.a as any).Token).toBe(REDACTED);
    expect((r.a as any).Keep).toBe('ok');
    expect((r as any).password).toBe(REDACTED);
  });

  it('preserves non-sensitive fields exactly', () => {
    const r = redactConfig({ host: 'h', database: 'd', pool: { max: 10 } });
    expect(r.host).toBe('h');
    expect((r.pool as any).max).toBe(10);
  });

  it('REDACTED constant equals "REDACTED"', () => {
    expect(REDACTED).toBe('REDACTED');
  });
});

describe('ProfileExport shape', () => {
  it('toYAML redacts password by default', () => {
    const yaml = ProfileSerializer.toYAML([baseProfile]);
    expect(yaml).toContain('name: prod-mysql');
    expect(yaml).toContain('password: REDACTED');
    expect(yaml).not.toContain('hunter2');
  });

  it('toYAML with includeSecrets: true keeps plaintext password', () => {
    const yaml = ProfileSerializer.toYAML([baseProfile], { includeSecrets: true });
    expect(yaml).toContain('password: hunter2');
  });

  it('toJSON round-trip yields identical profile', () => {
    const json = ProfileSerializer.toJSON([baseProfile]);
    const parsed = ProfileSerializer.parse(json, 'json');
    expect(parsed.version).toBe(1);
    expect(parsed.profiles[0].name).toBe('prod-mysql');
    expect((parsed.profiles[0].config as any).password).toBe(REDACTED);
  });
});

describe('YAML round-trip', () => {
  it('parses back to identical ProfileExport (sans REDACTED config)', () => {
    const out = toYAML({ version: 1, profiles: [exported(baseProfile)] });
    const parsed = parseYAML(out);
    expect(parsed.version).toBe(1);
    expect(parsed.profiles).toHaveLength(1);
    expect(parsed.profiles[0].name).toBe('prod-mysql');
    expect(parsed.profiles[0].role).toBe('primary');
    expect(parsed.profiles[0].enabled).toBe(true);
    expect(parsed.profiles[0].tags).toEqual(['prod', 'critical']);
    expect((parsed.profiles[0].config as any).password).toBe(REDACTED);
  });

  it('handles multi-profile export', () => {
    const out = toYAML({ version: 1, profiles: [exported(baseProfile), exported({ ...baseProfile, name: 'staging', role: 'replica' })] });
    const parsed = parseYAML(out);
    expect(parsed.profiles).toHaveLength(2);
    expect(parsed.profiles.map(p => p.name)).toEqual(['prod-mysql', 'staging']);
    expect(parsed.profiles[1].role).toBe('replica');
  });

  it('rejects bad version', () => {
    expect(() => parseYAML('version: 99\nprofiles:\n')).toThrow(/version/);
  });

  it('rejects malformed root', () => {
    expect(() => parseYAML('something: else\n')).toThrow();
  });
});

describe('validateProfileExport', () => {
  const valid: ProfileExport = { ...exported(baseProfile) };
  it('accepts well-formed profile', () => {
    const errs = validateProfileExport(valid);
    expect(errs).toEqual([]);
  });

  it('rejects unknown type', () => {
    const errs = validateProfileExport({ ...valid, type: 'mongo-the-unknown' });
    expect(errs.length).toBeGreaterThan(0);
    expect(errs.some(e => e.includes('unknown profile type'))).toBe(true);
  });

  it('rejects bad role', () => {
    const errs = validateProfileExport({ ...valid, role: 'super' as any });
    expect(errs.some(e => e.includes('role'))).toBe(true);
  });

  it('rejects non-object config', () => {
    const errs = validateProfileExport({ ...valid, config: ['arr'] as any });
    expect(errs.some(e => e.includes('config'))).toBe(true);
  });
});

// Helper: produce a default-redacted export.
function exported(p: Profile): ProfileExport {
  return {
    name: p.name, description: p.description, type: p.type,
    config: redactConfig(p.config as unknown as Record<string, unknown>),
    role: p.role, tags: p.tags, enabled: p.enabled,
    created_by: p.created_by, created_at: p.created_at,
    updated_at: p.updated_at, use_count: p.use_count,
  };
}
