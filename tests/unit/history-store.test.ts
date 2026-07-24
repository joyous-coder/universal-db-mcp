import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { HistoryStore } from '../../src/core/history-store.js';

const dbPath = `.tmp-test-history-${Date.now()}.db`;

describe('HistoryStore', () => {
  let store: HistoryStore;
  beforeEach(() => {
    store = new HistoryStore(dbPath, { ttlDays: 30, maxRows: 100 });
  });
  afterEach(async () => { await store.close(); if (existsSync(dbPath)) unlinkSync(dbPath); });

  it('records and queries a query', async () => {
    await store.record({
      ts: new Date().toISOString(), db: 'sqlite', kind: 'select',
      sql: 'SELECT 1', params: null, duration_ms: 5, rows: 1, error: null, error_code: null,
    });
    const entries = await store.query({ limit: 10 });
    expect(entries.length).toBe(1);
    expect(entries[0].sql).toBe('SELECT 1');
  });

  it('queries by db filter', async () => {
    await store.record({ ts: '2026-07-24T00:00:00Z', db: 'mysql', kind: 'select', sql: 'A', params: null, duration_ms: 1, rows: 0, error: null, error_code: null });
    await store.record({ ts: '2026-07-24T00:00:00Z', db: 'postgres', kind: 'select', sql: 'B', params: null, duration_ms: 1, rows: 0, error: null, error_code: null });
    const mysql = await store.query({ db: 'mysql' });
    expect(mysql.length).toBe(1);
    expect(mysql[0].sql).toBe('A');
  });

  it('queries onlyErrors filter', async () => {
    await store.record({ ts: 't', db: 'x', kind: 's', sql: 'OK', params: null, duration_ms: 1, rows: 0, error: null, error_code: null });
    await store.record({ ts: 't', db: 'x', kind: 's', sql: 'BAD', params: null, duration_ms: 1, rows: 0, error: 'oops', error_code: 'E' });
    const errors = await store.query({ onlyErrors: true });
    expect(errors.length).toBe(1);
    expect(errors[0].sql).toBe('BAD');
  });

  it('LRU-evicts when exceeding maxRows', async () => {
    const lruPath = `.tmp-lru-${Date.now()}.db`;
    const small = new HistoryStore(lruPath, { ttlDays: 30, maxRows: 5 });
    try {
      for (let i = 0; i < 10; i++) {
        await small.record({ ts: `2026-07-24T00:00:0${i}Z`, db: 'x', kind: 's', sql: `q${i}`, params: null, duration_ms: 1, rows: 0, error: null, error_code: null });
      }
      const all = await small.query({ limit: 100 });
      expect(all.length).toBeLessThanOrEqual(5);
      expect(all.some(e => e.sql === 'q9')).toBe(true);
    } finally {
      await small.close();
      if (existsSync(lruPath)) unlinkSync(lruPath);
    }
  });

  it('TTL cleanup removes old entries', async () => {
    const old = `2020-01-01T00:00:00Z`;
    await store.record({ ts: old, db: 'x', kind: 's', sql: 'old', params: null, duration_ms: 1, rows: 0, error: null, error_code: null });
    await store.record({ ts: new Date().toISOString(), db: 'x', kind: 's', sql: 'new', params: null, duration_ms: 1, rows: 0, error: null, error_code: null });
    const r = await store.cleanup();
    expect(r.deleted).toBeGreaterThanOrEqual(1);
    const remaining = await store.query({ limit: 10 });
    expect(remaining.every(e => e.sql !== 'old')).toBe(true);
  });
});
