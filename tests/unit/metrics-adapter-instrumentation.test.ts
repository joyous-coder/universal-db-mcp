import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { metrics } from '../../src/utils/metrics.js';
import { DatabaseService } from '../../src/core/database-service.js';
import { SQLiteAdapter } from '../../src/adapters/sqlite/index.js';
import { QueryAnalyzer } from '../../src/core/query-analyzer.js';
import type { DbConfig } from '../../src/types/adapter.js';

describe('DatabaseService instrumentation', () => {
  beforeEach(() => metrics.reset());

  it('records query_total + query_seconds on successful SELECT', async () => {
    const adapter = new SQLiteAdapter({ filePath: ':memory:', readonly: false });
    await adapter.connect();
    const svc = new DatabaseService(adapter, { type: 'sqlite', allowWrite: true } as DbConfig);
    await svc.executeQuery('SELECT 1 AS v');
    await adapter.disconnect();

    const json = metrics.toJSON();
    const total = json.counters.find(c => c.name === 'db_query_total');
    expect(total).toBeDefined();
    expect(total!.series[0].value).toBeGreaterThanOrEqual(1);
    const lat = json.histograms.find(h => h.name === 'db_query_seconds');
    expect(lat).toBeDefined();
    expect(lat!.series[0].count).toBeGreaterThanOrEqual(1);
  });

  it('records slow_queries when duration > threshold', async () => {
    const adapter = new SQLiteAdapter({ filePath: ':memory:', readonly: false });
    await adapter.connect();
    const svc = new DatabaseService(adapter, { type: 'sqlite', allowWrite: true } as DbConfig, { slowQueryThresholdMs: 1, slowBufferSize: 5 });
    await svc.executeQuery("SELECT randomblob(1000000)");
    const json = metrics.toJSON();
    const ring = json.rings.find(r => r.name === 'db_slow_queries');
    expect(ring).toBeDefined();
    expect(ring!.size).toBeGreaterThanOrEqual(1);
  });

  it('records query_errors_total on error with code label', async () => {
    const adapter = new SQLiteAdapter({ filePath: ':memory:', readonly: false });
    await adapter.connect();
    const svc = new DatabaseService(adapter, { type: 'sqlite', allowWrite: true } as DbConfig);
    await expect(svc.executeQuery('SELECT * FROM nonexistent_table')).rejects.toThrow();
    const json = metrics.toJSON();
    const errs = json.counters.find(c => c.name === 'db_query_errors_total');
    expect(errs).toBeDefined();
    expect(errs!.series.length).toBeGreaterThan(0);
    await adapter.disconnect();
  });

  // v2.19: DatabaseService.setActiveProfileProvider forwards to QueryAnalyzer
  it('executeQuery history records profile_name from active provider', async () => {
    const adapter = new SQLiteAdapter({ filePath: ':memory:', readonly: false });
    await adapter.connect();
    const svc = new DatabaseService(adapter, { type: 'sqlite', allowWrite: true } as DbConfig);
    const ts = Date.now();
    const tplPath = `.tmp-ds-v219-tpl-${ts}-${Math.random().toString(36).slice(2)}.db`;
    const histPath = `.tmp-ds-v219-hist-${ts}-${Math.random().toString(36).slice(2)}.db`;
    const qa = new QueryAnalyzer({
      enabled: true,
      templatesDbPath: tplPath,
      historyDbPath: histPath,
      historyTtlDays: 30,
      historyMaxRows: 100,
      explainTimeoutMs: 5000,
    });
    svc.setQueryAnalyzer(qa);
    svc.setActiveProfileProvider(() => 'prod-mysql');
    await svc.executeQuery('SELECT 1 AS v');
    // recordQuery is async — give it a moment to flush
    await new Promise(r => setTimeout(r, 50));
    const entries = await qa.getHistory({ profileName: 'prod-mysql' });
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect((entries[0] as any).profile_name).toBe('prod-mysql');
    await qa.close();
    await adapter.disconnect();
    [tplPath, histPath].forEach(p => { if (existsSync(p)) unlinkSync(p); });
  });

  it('setActiveProfileProvider can be cleared with null', () => {
    const adapter = new SQLiteAdapter({ filePath: ':memory:', readonly: false });
    const svc = new DatabaseService(adapter, { type: 'sqlite', allowWrite: true } as DbConfig);
    svc.setActiveProfileProvider(() => 'p1');
    expect(svc.getActiveProfileProvider()).not.toBeNull();
    svc.setActiveProfileProvider(null);
    expect(svc.getActiveProfileProvider()).toBeNull();
  });

  it('setActiveProfileProvider called BEFORE setQueryAnalyzer still propagates', async () => {
    const adapter = new SQLiteAdapter({ filePath: ':memory:', readonly: false });
    await adapter.connect();
    const svc = new DatabaseService(adapter, { type: 'sqlite', allowWrite: true } as DbConfig);
    svc.setActiveProfileProvider(() => 'late-prop');
    const ts = Date.now();
    const tplPath = `.tmp-ds-v219-late-tpl-${ts}.db`;
    const histPath = `.tmp-ds-v219-late-hist-${ts}.db`;
    const qa = new QueryAnalyzer({
      enabled: true,
      templatesDbPath: tplPath,
      historyDbPath: histPath,
      historyTtlDays: 30,
      historyMaxRows: 100,
      explainTimeoutMs: 5000,
    });
    // Wire QueryAnalyzer AFTER setting the provider; both branches covered.
    svc.setQueryAnalyzer(qa);
    await svc.executeQuery('SELECT 2 AS v');
    await new Promise(r => setTimeout(r, 50));
    const entries = await qa.getHistory({ profileName: 'late-prop' });
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect((entries[0] as any).profile_name).toBe('late-prop');
    await qa.close();
    await adapter.disconnect();
    [tplPath, histPath].forEach(p => { if (existsSync(p)) unlinkSync(p); });
  });
});

describe('DatabaseService queryAnalyzer integration (v2.17)', () => {
  const ts = Date.now();
  const tplPath = `.tmp-qa-ds-tpl-${ts}.db`;
  const histPath = `.tmp-qa-ds-hist-${ts}.db`;

  it('executeQuery response includes lint result', async () => {
    const adapter = new SQLiteAdapter({ filePath: ':memory:', readonly: false });
    await adapter.connect();
    const svc = new DatabaseService(adapter, { type: 'sqlite', allowWrite: true } as DbConfig);
    const qa = new QueryAnalyzer({
      enabled: true,
      templatesDbPath: tplPath,
      historyDbPath: histPath,
      historyTtlDays: 30,
      historyMaxRows: 100,
      explainTimeoutMs: 5000,
    });
    svc.setQueryAnalyzer(qa);
    const result = await svc.executeQuery('SELECT * FROM sqlite_master');
    expect((result as any).lint).toBeDefined();
    expect((result as any).lint.issues.some((i: any) => i.rule === 'select-star')).toBe(true);
    await qa.close();
    await adapter.disconnect();
    [tplPath, histPath].forEach(p => { if (existsSync(p)) unlinkSync(p); });
  });

  it('recordQuery is called after executeQuery', async () => {
    const adapter = new SQLiteAdapter({ filePath: ':memory:', readonly: false });
    await adapter.connect();
    const svc = new DatabaseService(adapter, { type: 'sqlite', allowWrite: true } as DbConfig);
    const qa = new QueryAnalyzer({
      enabled: true,
      templatesDbPath: tplPath,
      historyDbPath: histPath,
      historyTtlDays: 30,
      historyMaxRows: 100,
      explainTimeoutMs: 5000,
    });
    svc.setQueryAnalyzer(qa);
    await svc.executeQuery('SELECT 1 AS v');
    await new Promise(r => setTimeout(r, 50));
    const entries = await qa.getHistory({ limit: 10 });
    expect(entries.length).toBeGreaterThanOrEqual(1);
    await qa.close();
    await adapter.disconnect();
    [tplPath, histPath].forEach(p => { if (existsSync(p)) unlinkSync(p); });
  });
});
