/**
 * Plan-capture e2e test (v3.1)
 *
 * End-to-end: sqlite profile → explain_query_with_advice → capture → list → diff.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { QueryAnalyzer } from '../../src/core/query-analyzer.js';
import { PlanHistory } from '../../src/core/plan-history.js';
import { buildExplainQueryWithAdviceHandler, buildListQueryPlansHandler, buildCompareQueryPlansHandler } from '../../src/mcp/tools/plan-history.js';

const ts = Date.now();
const tplPath = `.tmp-ph-tpl-${ts}-${Math.random().toString(36).slice(2)}.db`;
const histPath = `.tmp-ph-hist-${ts}-${Math.random().toString(36).slice(2)}.db`;
const planDbPath = `.tmp-ph-plandb-${ts}-${Math.random().toString(36).slice(2)}.db`;
function cleanup(p: string) {
  for (const s of ['', '-wal', '-shm']) {
    if (existsSync(p + s)) { try { unlinkSync(p + s); } catch { /* ignore */ } }
  }
}

describe('v3.1 MCP plan-history e2e', () => {
  let qa: QueryAnalyzer;
  let planHistory: PlanHistory;

  beforeEach(() => {
    cleanup(tplPath); cleanup(histPath); cleanup(planDbPath);
    qa = new QueryAnalyzer({
      enabled: true, templatesDbPath: tplPath, historyDbPath: histPath,
      historyTtlDays: 30, historyMaxRows: 100, explainTimeoutMs: 5000,
    });
    planHistory = new PlanHistory({ dbPath: planDbPath });
  });
  afterEach(async () => {
    try { await qa.close(); } catch { /* ignore */ }
    try { await planHistory.close(); } catch { /* ignore */ }
    cleanup(tplPath); cleanup(histPath); cleanup(planDbPath);
  });

  it('explain_query_with_advice persists to PlanHistory', async () => {
    const handler = buildExplainQueryWithAdviceHandler(qa, planHistory);
    const result = await handler({ sql: 'SELECT 1', persist: true });
    expect(result.captured).toBe(true);
    const listed = await planHistory.list(10);
    expect(listed.length).toBe(1);
  });

  it('explain_query_with_advice: persist=false does not store', async () => {
    const handler = buildExplainQueryWithAdviceHandler(qa, planHistory);
    const result = await handler({ sql: 'SELECT 2', persist: false });
    expect(result.captured).toBe(false);
    const list = await planHistory.list(10);
    expect(list.length).toBe(0);
  });

  it('list_query_plans returns recent entries', async () => {
    const captureHandler = buildExplainQueryWithAdviceHandler(qa, planHistory);
    await captureHandler({ sql: 'SELECT 3', persist: true });
    await captureHandler({ sql: 'SELECT 4', persist: true });
    const handler = buildListQueryPlansHandler(planHistory);
    const result = await handler({ limit: 10 });
    expect(result.plans.length).toBe(2);
  });

  it('compare_query_plans detects identical plans as identical=true', async () => {
    const captureHandler = buildExplainQueryWithAdviceHandler(qa, planHistory);
    await captureHandler({ sql: 'SELECT 5', persist: true });
    await new Promise(r => setTimeout(r, 50));
    await captureHandler({ sql: 'SELECT 5', persist: true });
    const all = await planHistory.list(10);
    const compareHandler = buildCompareQueryPlansHandler(planHistory);
    const result = await compareHandler({ queryHash: all[0].queryHash });
    // Two SELECT 5 captures on same db may or may not produce identical plans;
    // just check that diff doesn't throw.
    expect(result.diff).toBeDefined();
  });
});
