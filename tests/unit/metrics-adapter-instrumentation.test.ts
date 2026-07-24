import { describe, it, expect, beforeEach } from 'vitest';
import { metrics } from '../../src/utils/metrics.js';
import { DatabaseService } from '../../src/core/database-service.js';
import { SQLiteAdapter } from '../../src/adapters/sqlite/index.js';
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
});
