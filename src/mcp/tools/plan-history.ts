/**
 * MCP plan-history tools (v3.1)
 *
 * 3 tools:
 *  - explain_query_with_advice: EXPLAIN + IndexAdvisor
 *  - compare_query_plans: PlanDiff between two snapshots
 *  - list_query_plans: recent PlanHistory entries
 */

import type { QueryAnalyzer } from '../../core/query-analyzer.js';
import type { PlanHistory } from '../../core/plan-history.js';
import { ExplainPlanParser } from '../../core/explain-parser.js';
import { IndexAdvisor } from '../../core/index-advisor.js';
import { PlanDiff } from '../../core/plan-diff.js';
import { SqlNormalizer } from '../../utils/sql-normalizer.js';

export function buildExplainQueryWithAdviceHandler(qa: QueryAnalyzer, planHistory: PlanHistory) {
  return async (args: { sql: string; profileName?: string; persist?: boolean }) => {
    const baseResult = await qa.explain(args.sql, []);
    // Try normalizing + advice via ExplainPlanParser
    let planJson = '';
    try {
      planJson = JSON.stringify(baseResult.plan ?? []);
    } catch {
      planJson = JSON.stringify({ raw: baseResult.raw });
    }
    const dbType = (baseResult as any).db || 'sqlite';
    const norm = ExplainPlanParser.normalize(JSON.stringify({ rowData: baseResult.plan, raw: baseResult.raw }), dbType);
    const advice = IndexAdvisor.analyze(norm);

    // Capture to PlanHistory when requested (fire-and-forget).
    if (args.persist && planHistory) {
      const sqlNorm = SqlNormalizer.normalize(args.sql);
      await planHistory.capture({
        queryHash: sqlNorm.hash,
        sqlTemplate: sqlNorm.template,
        sqlOriginal: args.sql,
        planJson,
        dbType,
        profileName: args.profileName ?? null,
        capturedAt: new Date().toISOString(),
        durationMs: baseResult.duration_ms ?? 0,
      });
    }

    return {
      explain: baseResult,
      advice,
      captured: !!args.persist,
    };
  };
}

export function buildCompareQueryPlansHandler(planHistory: PlanHistory) {
  return async (args: { queryHash: string; entryA?: number; entryB?: number }) => {
    const all = await planHistory.getByHash(args.queryHash);
    if (all.length < 2) {
      return { error: 'need at least 2 entries with the same queryHash', count: all.length };
    }
    // Default: compare oldest vs newest
    const a = args.entryA !== undefined ? all.find(e => e.id === args.entryA) ?? all[0] : all[0];
    const b = args.entryB !== undefined ? all.find(e => e.id === args.entryB) ?? all[all.length - 1] : all[all.length - 1];
    const planA = ExplainPlanParser.normalize(a.planJson, a.dbType);
    const planB = ExplainPlanParser.normalize(b.planJson, b.dbType);
    const diff = PlanDiff.compare(planA, planB);
    return {
      from: { id: a.id, capturedAt: a.capturedAt, sqlOriginal: a.sqlOriginal },
      to: { id: b.id, capturedAt: b.capturedAt, sqlOriginal: b.sqlOriginal },
      diff,
    };
  };
}

export function buildListQueryPlansHandler(planHistory: PlanHistory) {
  return async (args: { limit?: number; queryHash?: string }) => {
    const list = args.queryHash
      ? await planHistory.getByHash(args.queryHash)
      : await planHistory.list(args.limit ?? 50);
    return { plans: list.map(p => ({ id: p.id, queryHash: p.queryHash, capturedAt: p.capturedAt, sqlOriginal: p.sqlOriginal, dbType: p.dbType, profileName: p.profileName })) };
  };
}

export const PLAN_HISTORY_TOOL_DESCRIPTIONS = {
  explain_query_with_advice: 'Run EXPLAIN and return IndexAdvisor advice (CREATE INDEX SQL). Optionally persist to PlanHistory.',
  compare_query_plans: 'Compare two PlanHistory snapshots for the same queryHash. Returns added/removed/changed + costDelta.',
  list_query_plans: 'Recent EXPLAIN snapshots (or filter by queryHash).',
};
