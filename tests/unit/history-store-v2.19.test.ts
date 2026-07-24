/**
 * HistoryStore profile_name + groupBy tests (v2.19)
 *
 * Covers:
 * - record() persists profile_name (nullable)
 * - query() filters by profileName (3-state)
 * - query({ groupBy: 'profile' }) returns aggregates
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { HistoryStore } from '../../src/core/history-store.js';
import type { QueryHistoryInput } from '../../src/core/query-analyzer-types.js';

function cleanup(p: string) {
  if (existsSync(p)) { try { unlinkSync(p); } catch { /* ignore */ } }
}

const baseRow: QueryHistoryInput = {
  ts: '2026-07-24T00:00:00Z',
  db: 'sqlite',
  kind: 'select',
  sql: 'SELECT 1',
  params: null,
  duration_ms: 10,
  rows: 1,
  error: null,
  error_code: null,
  profile_name: null,
};

describe('HistoryStore profile_name + groupBy (v2.19)', () => {
  let dbPath: string;
  let store: HistoryStore;
  beforeEach(() => {
    dbPath = `.tmp-h-v219-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
    cleanup(dbPath);
    store = new HistoryStore(dbPath, { ttlDays: 30, maxRows: 100 });
  });
  afterEach(async () => {
    try { await store.close(); } catch { /* ignore */ }
    cleanup(dbPath);
  });

  it('records profile_name field', async () => {
    await store.record({ ...baseRow, sql: 'A', profile_name: 'prod-mysql' });
    const all = await store.query({});
    expect(all.length).toBe(1);
    expect(all[0].profile_name).toBe('prod-mysql');
  });

  it('omitted profile_name stores null', async () => {
    await store.record({ ...baseRow, sql: 'A' });
    const all = await store.query({});
    expect(all[0].profile_name).toBeNull();
  });

  it('filters by profileName', async () => {
    await store.record({ ...baseRow, sql: 'A', profile_name: 'prod' });
    await store.record({ ...baseRow, sql: 'B', profile_name: 'staging' });
    const prod = await store.query({ profileName: 'prod' });
    expect(prod.length).toBe(1);
    expect(prod[0].sql).toBe('A');
  });

  it('filters by profileName: null returns only null-profile entries', async () => {
    await store.record({ ...baseRow, sql: 'NA', profile_name: null });
    await store.record({ ...baseRow, sql: 'NB', profile_name: null });
    await store.record({ ...baseRow, sql: 'P', profile_name: 'prod' });
    const global = await store.query({ profileName: null });
    expect(global.length).toBe(2);
    expect(global.map(e => e.sql).sort()).toEqual(['NA', 'NB']);
  });

  it('groupBy=profile returns aggregates with count, errors, avg_ms', async () => {
    await store.record({ ...baseRow, sql: 'A1', duration_ms: 10, profile_name: 'prod' });
    await store.record({ ...baseRow, sql: 'A2', duration_ms: 20, profile_name: 'prod' });
    await store.record({ ...baseRow, sql: 'B', duration_ms: 5, error: 'fail', error_code: 'X', profile_name: 'staging' });
    await store.record({ ...baseRow, sql: 'C', duration_ms: 8, profile_name: null });
    const aggregated = await store.query({ groupBy: 'profile' }) as any;
    expect(aggregated.length).toBe(3);
    const prod = aggregated.find((a: any) => a.profileName === 'prod');
    expect(prod?.count).toBe(2);
    expect(prod?.errors).toBe(0);
    expect(prod?.avg_ms).toBe(15);
    const staging = aggregated.find((a: any) => a.profileName === 'staging');
    expect(staging?.count).toBe(1);
    expect(staging?.errors).toBe(1);
    const globalBucket = aggregated.find((a: any) => a.profileName === null);
    expect(globalBucket?.count).toBe(1);
  });

  it('non-groupBy query returns QueryHistoryEntry[] as before', async () => {
    await store.record({ ...baseRow, sql: 'A', profile_name: 'prod' });
    const entries = await store.query({});
    expect(Array.isArray(entries)).toBe(true);
    expect(entries[0]).toHaveProperty('id');
    expect(entries[0]).toHaveProperty('ts');
  });
});
