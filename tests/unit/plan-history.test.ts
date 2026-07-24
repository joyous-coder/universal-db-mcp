/**
 * PlanHistory + sql-normalizer unit tests (v3.1)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { PlanHistory } from '../../src/core/plan-history.js';
import { SqlNormalizer } from '../../src/utils/sql-normalizer.js';

const ts = Date.now();
const dbPath = `.tmp-planhist-${ts}-${Math.random().toString(36).slice(2)}.db`;
function cleanup(p: string) {
  for (const s of ['', '-wal', '-shm']) {
    if (existsSync(p + s)) { try { unlinkSync(p + s); } catch { /* ignore */ } }
  }
}

describe('SqlNormalizer (v3.1)', () => {
  it('replaces numeric literals with placeholders', () => {
    const r = SqlNormalizer.normalize('SELECT * FROM users WHERE id = 5');
    expect(r.template).toContain('?');
    expect(r.template).not.toContain('5');
  });

  it('replaces string literals', () => {
    const r = SqlNormalizer.normalize(`SELECT * FROM users WHERE name = 'alice'`);
    expect(r.template).toContain('?');
    expect(r.template).not.toContain('alice');
  });

  it('replaces IN-list values positionally (each `?` separated by comma)', () => {
    const r = SqlNormalizer.normalize('SELECT * FROM t WHERE a IN (1, 2, 3)');
    expect(r.template).toContain('?, ?, ?');
  });

  it('collapses whitespace', () => {
    const r = SqlNormalizer.normalize('SELECT   *   FROM    users');
    expect(r.template).toBe('SELECT * FROM users');
  });

  it('same query with different values hashes the same', () => {
    const a = SqlNormalizer.normalize('SELECT * FROM users WHERE id = 1');
    const b = SqlNormalizer.normalize('SELECT * FROM users WHERE id = 999');
    expect(a.hash).toBe(b.hash);
    expect(a.template).toBe(b.template);
  });

  it('different structure hashes differently', () => {
    const a = SqlNormalizer.normalize('SELECT * FROM users WHERE id = 1');
    const b = SqlNormalizer.normalize('SELECT * FROM orders WHERE id = 1');
    expect(a.hash).not.toBe(b.hash);
  });

  it('preserves boolean / null → ?', () => {
    const r = SqlNormalizer.normalize('SELECT * FROM t WHERE active = TRUE');
    expect(r.template).toContain('?');
  });
});

describe('PlanHistory (v3.1)', () => {
  let history: PlanHistory;
  beforeEach(() => {
    cleanup(dbPath);
    history = new PlanHistory({ dbPath });
  });
  afterEach(async () => {
    try { await history.close(); } catch { /* ignore */ }
    cleanup(dbPath);
  });

  it('captures and retrieves by hash', async () => {
    const sql1 = 'SELECT * FROM users WHERE id = 1';
    const norm1 = SqlNormalizer.normalize(sql1);
    await history.capture({
      queryHash: norm1.hash,
      sqlTemplate: norm1.template,
      sqlOriginal: sql1,
      planJson: '{"op":"SCAN","table":"users"}',
      dbType: 'sqlite',
      profileName: 'prod',
      capturedAt: new Date().toISOString(),
      durationMs: 5,
    });
    const all = await history.getByHash(norm1.hash);
    expect(all.length).toBe(1);
    expect(all[0].sqlOriginal).toBe(sql1);
    expect(all[0].profileName).toBe('prod');
  });

  it('groups multiple snapshots by hash (different times)', async () => {
    const hash = 'abc123';
    await history.capture({
      queryHash: hash, sqlTemplate: 'SELECT * FROM t', sqlOriginal: 'SELECT * FROM t',
      planJson: '{}', dbType: 'sqlite', profileName: null,
      capturedAt: '2026-07-01T00:00:00Z', durationMs: 1,
    });
    await history.capture({
      queryHash: hash, sqlTemplate: 'SELECT * FROM t', sqlOriginal: 'SELECT * FROM t',
      planJson: '{"rows":100}', dbType: 'sqlite', profileName: null,
      capturedAt: '2026-07-02T00:00:00Z', durationMs: 5,
    });
    const all = await history.getByHash(hash);
    expect(all.length).toBe(2);
  });

  it('list returns most recent first', async () => {
    const hash = 'list-test';
    await history.capture({
      queryHash: hash, sqlTemplate: '', sqlOriginal: '',
      planJson: '{}', dbType: 'sqlite', profileName: null,
      capturedAt: '2026-07-01T00:00:00Z', durationMs: 1,
    });
    await history.capture({
      queryHash: hash, sqlTemplate: '', sqlOriginal: '',
      planJson: '{}', dbType: 'sqlite', profileName: null,
      capturedAt: '2026-07-02T00:00:00Z', durationMs: 1,
    });
    const list = await history.list(10);
    expect(list[0].capturedAt).toBe('2026-07-02T00:00:00Z');
    expect(list[1].capturedAt).toBe('2026-07-01T00:00:00Z');
  });

  it('list(limit) caps result count', async () => {
    for (let i = 0; i < 5; i++) {
      await history.capture({
        queryHash: `q${i}`, sqlTemplate: 'T', sqlOriginal: 'T',
        planJson: '{}', dbType: 'sqlite', profileName: null,
        capturedAt: new Date(Date.now() + i).toISOString(),
        durationMs: 1,
      });
    }
    const list = await history.list(3);
    expect(list.length).toBe(3);
  });
});
