/**
 * MCP get_metrics tool unit tests (v2.16)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { metrics } from '../../src/utils/metrics.js';
import { buildGetMetricsHandler } from '../../src/mcp/tools/metrics.js';

describe('MCP get_metrics tool', () => {
  beforeEach(() => metrics.reset());

  it('returns summary shape with category=summary', async () => {
    metrics.counter('db_query_total', 'Q').inc({ db: 'sqlite' });
    const handler = buildGetMetricsHandler({ enabled: true });
    const res = await handler({ category: 'summary' });
    expect(res.counters).toBeDefined();
    expect(res.counters!.length).toBeGreaterThan(0);
    expect(res.slow_queries).toBeUndefined();
  });

  it('returns slow queries with category=slow_queries', async () => {
    metrics.ringBuffer('db_slow_queries', 10).push({
      ts: '2026-07-24T08:00:00Z',
      db: 'sqlite',
      kind: 'select',
      seconds: 1.0,
      sql: 'SELECT 1',
      error: null,
    });
    const handler = buildGetMetricsHandler({ enabled: true });
    const res = await handler({ category: 'slow_queries' });
    expect(res.slow_queries).toBeDefined();
    expect(res.slow_queries!.length).toBe(1);
    expect(res.slow_queries![0].db).toBe('sqlite');
  });

  it('returns error when disabled', async () => {
    const handler = buildGetMetricsHandler({ enabled: false });
    await expect(handler({ category: 'summary' })).rejects.toThrow(/metrics disabled/i);
  });

  it('defaults to summary when category omitted', async () => {
    metrics.counter('db_query_total', 'Q').inc({ db: 'sqlite' });
    const handler = buildGetMetricsHandler({ enabled: true });
    const res = await handler({});
    expect(res.counters).toBeDefined();
  });
});
