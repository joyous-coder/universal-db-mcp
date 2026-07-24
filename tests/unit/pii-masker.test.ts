/**
 * PiiMasker unit tests (v3.x)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync, writeFileSync } from 'node:fs';
import { PiiMasker, type MaskStrategy } from '../../src/core/pii-masker.js';

describe('PiiMasker.applyStrategy (v3.x)', () => {
  it('mask replaces with ***', () => {
    expect(PiiMasker.applyStrategy('john@example.com', 'mask')).toBe('***');
  });

  it('mask_last4 keeps last 4 chars', () => {
    expect(PiiMasker.applyStrategy('5551234567', 'mask_last4')).toBe('******4567');
    expect(PiiMasker.applyStrategy('abc', 'mask_last4')).toBe('****');  // short → all masked
  });

  it('hash is deterministic 16-char hex', () => {
    const h = PiiMasker.applyStrategy('john@example.com', 'hash');
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(PiiMasker.applyStrategy('john@example.com', 'hash')).toBe(h);
  });

  it('redact replaces with REDACTED', () => {
    expect(PiiMasker.applyStrategy('secret', 'redact')).toBe('REDACTED');
  });

  it('passthrough returns input unchanged', () => {
    expect(PiiMasker.applyStrategy('hello', 'passthrough')).toBe('hello');
  });

  it('preserves null and undefined', () => {
    expect(PiiMasker.applyStrategy(null, 'mask')).toBeNull();
    expect(PiiMasker.applyStrategy(undefined, 'mask')).toBeUndefined();
  });

  it('all 5 strategies enumerated', () => {
    const strategies: MaskStrategy[] = ['mask', 'mask_last4', 'hash', 'redact', 'passthrough'];
    strategies.forEach(s => {
      const r = PiiMasker.applyStrategy('x', s);
      expect(r).toBeDefined();
    });
  });
});

describe('PiiMasker.mask (rows-level)', () => {
  beforeEach(() => {
    // Reset config between tests
    (PiiMasker as any).cfg = { profiles: {} };
  });
  afterEach(() => {
    (PiiMasker as any).cfg = { profiles: {} };
  });

  it('masks configured columns', () => {
    PiiMasker.setProfileConfig('prod-mysql', [
      { table: 'users', column: 'email', strategy: 'hash' },
      { table: 'users', column: 'phone', strategy: 'mask_last4' },
    ], true);
    const rows = PiiMasker.mask('prod-mysql', 'users', [
      { id: 1, email: 'john@example.com', phone: '5551234567' },
    ]);
    expect((rows[0] as any).email).toMatch(/^[0-9a-f]{16}$/);
    expect((rows[0] as any).phone).toBe('******4567');
    expect((rows[0] as any).id).toBe(1);  // untouched
  });

  it('does not mask columns absent from config', () => {
    PiiMasker.setProfileConfig('prod-mysql', [
      { table: 'users', column: 'email', strategy: 'hash' },
    ], true);
    const rows = PiiMasker.mask('prod-mysql', 'users', [
      { id: 1, email: 'john@example.com', phone: '5551234567' },
    ]);
    expect((rows[0] as any).phone).toBe('5551234567');  // untouched
  });

  it('profile without rules → no masking', () => {
    const rows = PiiMasker.mask('unknown-profile', 'users', [
      { email: 'plain@example.com' },
    ]);
    expect((rows[0] as any).email).toBe('plain@example.com');
  });

  it('table name match is case-insensitive', () => {
    PiiMasker.setProfileConfig('prod', [
      { table: 'Users', column: 'email', strategy: 'redact' },
    ], true);
    const rows = PiiMasker.mask('prod', 'USERS', [
      { email: 'a@b' },
    ]);
    expect((rows[0] as any).email).toBe('REDACTED');
  });

  it('non-matching table → no mask', () => {
    PiiMasker.setProfileConfig('prod', [
      { table: 'users', column: 'email', strategy: 'redact' },
    ], true);
    const rows = PiiMasker.mask('prod', 'orders', [
      { email: 'a@b' },
    ]);
    expect((rows[0] as any).email).toBe('a@b');
  });

  it('setProfileConfig appends by default, replaces when replace=true', () => {
    PiiMasker.setProfileConfig('p1', [{ table: 't1', column: 'a', strategy: 'mask' }], true);
    PiiMasker.setProfileConfig('p1', [{ table: 't2', column: 'b', strategy: 'redact' }], false);
    const cfg = PiiMasker.getConfig();
    expect(cfg.profiles.p1.length).toBe(2);
    PiiMasker.setProfileConfig('p1', [{ table: 't3', column: 'c', strategy: 'passthrough' }], true);
    expect(PiiMasker.getConfig().profiles.p1.length).toBe(1);
  });

  it('handles empty rows gracefully', () => {
    PiiMasker.setProfileConfig('p1', [{ table: 't', column: 'a', strategy: 'mask' }], true);
    expect(PiiMasker.mask('p1', 't', [])).toEqual([]);
  });

  it('preserves null in column even if rule applied', () => {
    PiiMasker.setProfileConfig('p1', [{ table: 'users', column: 'email', strategy: 'mask' }], true);
    const rows = PiiMasker.mask('p1', 'users', [
      { email: null, name: 'x' },
    ]);
    expect((rows[0] as any).email).toBeNull();
    expect((rows[0] as any).name).toBe('x');
  });
});

describe('PiiMasker.loadFromFile + validate', () => {
  const cfgPath = `.tmp-pii-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
  afterEach(() => {
    try { unlinkSync(cfgPath); } catch { /* ignore */ }
  });

  it('loads valid config file', () => {
    writeFileSync(cfgPath, JSON.stringify({
      profiles: { prod: [{ table: 'users', column: 'email', strategy: 'hash' }] },
    }));
    const cfg = PiiMasker.loadFromFile(cfgPath);
    expect(cfg.profiles.prod[0].strategy).toBe('hash');
  });

  it('returns empty config when file does not exist', () => {
    const cfg = PiiMasker.loadFromFile(`/nonexistent-${Math.random()}.json`);
    expect(cfg.profiles).toEqual({});
  });

  it('throws on invalid strategy', () => {
    writeFileSync(cfgPath, JSON.stringify({
      profiles: { prod: [{ table: 't', column: 'c', strategy: 'BAD' }] },
    }));
    expect(() => PiiMasker.loadFromFile(cfgPath)).toThrow(/strategy/);
  });

  it('throws on missing table/column', () => {
    writeFileSync(cfgPath, JSON.stringify({
      profiles: { prod: [{ table: 't' }] },
    }));
    expect(() => PiiMasker.loadFromFile(cfgPath)).toThrow(/column/);
  });
});
