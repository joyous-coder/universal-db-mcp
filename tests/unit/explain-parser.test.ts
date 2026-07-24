/**
 * ExplainPlanParser + IndexAdvisor unit tests (v3.1)
 */

import { describe, it, expect } from 'vitest';
import { ExplainPlanParser, type NormalizedPlan } from '../../src/core/explain-parser.js';
import { IndexAdvisor } from '../../src/core/index-advisor.js';

describe('ExplainPlanParser (v3.1)', () => {
  it('parses SQLite EXPLAIN QUERY PLAN', () => {
    const raw = '0|0|0|SCAN TABLE users\n0|0|0|USE TEMP B-TREE FOR ORDER BY';
    const plan = ExplainPlanParser.normalize(raw, 'sqlite');
    expect(plan.structured).toBe(true);
    expect(plan.nodes.length).toBeGreaterThan(0);
    const scan = plan.nodes[0];
    expect(scan.op).toBe('SCAN');
    expect(scan.table).toBe('users');
  });

  it('parses MySQL EXPLAIN JSON', () => {
    const json = JSON.stringify({
      query_block: {
        table: { table_name: 'users', access_type: 'ALL', rows: 5000 },
        cost_info: { query_cost: '12.34' },
      },
    });
    const plan = ExplainPlanParser.normalize(json, 'mysql');
    expect(plan.structured).toBe(true);
    expect(plan.nodes[0].table).toBe('users');
  });

  it('parses PostgreSQL EXPLAIN JSON', () => {
    const json = JSON.stringify([{
      Plan: {
        'Node Type': 'Seq Scan',
        'Relation Name': 'orders',
        'Total Cost': 99.5,
        'Plan Rows': 5000,
      },
    }]);
    const plan = ExplainPlanParser.normalize(json, 'postgresql');
    expect(plan.structured).toBe(true);
    expect(plan.nodes[0].op).toBe('Seq Scan');
    expect(plan.nodes[0].table).toBe('orders');
  });

  it('parses MongoDB .explain() executionStats', () => {
    const json = JSON.stringify({
      executionStats: {
        executionStages: {
          stage: 'COLLSCAN',
          collection: 'users',
          totalDocsExamined: 1500,
          nReturned: 10,
        },
      },
    });
    const plan = ExplainPlanParser.normalize(json, 'mongodb');
    expect(plan.structured).toBe(true);
    expect(plan.nodes[0].table).toBe('users');
  });

  it('falls back to raw text for unsupported-but-listed adapters', () => {
    const plan = ExplainPlanParser.normalize('-- oracle raw plan', 'oracle');
    expect(plan.structured).toBe(false);
    expect(plan.nodes[0].op).toBe('RAW');
    expect(plan.rawText).toBe('-- oracle raw plan');
  });

  it('returns unsupported for redis', () => {
    const plan = ExplainPlanParser.normalize('irrelevant', 'redis');
    expect(plan.structured).toBe(false);
    expect(plan.nodes.length).toBe(0);  // empty
    expect(plan.dbType).toBe('redis');
  });

  it('dameng + kingbase + gaussdb etc. fall back to raw passthrough', () => {
    const plan = ExplainPlanParser.normalize('SELECT STATEMENT ...', 'kingbase');
    expect(plan.structured).toBe(false);
    expect(plan.nodes[0].op).toBe('RAW');
  });
});

describe('IndexAdvisor (v3.1)', () => {
  it('advices CREATE INDEX on seq_scan node', () => {
    const plan: NormalizedPlan = {
      dbType: 'sqlite', structured: true,
      nodes: [{ op: 'SCAN', table: 'users', rows: 5000, raw: 'SCAN TABLE users WHERE id = ?' }],
      rawText: '',
    };
    const advice = IndexAdvisor.analyze(plan);
    expect(advice.length).toBeGreaterThan(0);
    expect(advice[0].table).toBe('users');
    expect(advice[0].sql.toUpperCase()).toContain('CREATE INDEX');
    expect(advice[0].reason).toBe('large_estimate');  // rows=5000 → large_estimate path
    expect(advice[0].impact).toBe('medium');
  });

  it('flags high impact for >50K rows', () => {
    const plan: NormalizedPlan = {
      dbType: 'sqlite', structured: true,
      nodes: [{ op: 'SCAN', table: 'events', rows: 60000, raw: 'SCAN TABLE events WHERE user_id = ?' }],
      rawText: '',
    };
    const advice = IndexAdvisor.analyze(plan);
    expect(advice[0].impact).toBe('high');
  });

  it('low impact for tiny scans (<1000 rows)', () => {
    const plan: NormalizedPlan = {
      dbType: 'sqlite', structured: true,
      nodes: [{ op: 'SCAN', table: 'tiny', rows: 100, raw: 'SCAN TABLE tiny' }],
      rawText: '',
    };
    const advice = IndexAdvisor.analyze(plan);
    expect(advice[0].impact).toBe('low');
    expect(advice[0].reason).toBe('seq_scan');
  });

  it('no advice when all nodes have indexes', () => {
    const plan: NormalizedPlan = {
      dbType: 'sqlite', structured: true,
      nodes: [{ op: 'SEARCH', table: 'users', index: 'idx_id', rows: 100, raw: 'SEARCH TABLE users USING INDEX idx_id' }],
      rawText: '',
    };
    const advice = IndexAdvisor.analyze(plan);
    expect(advice.length).toBe(0);
  });

  it('flags no_index_join when inner side has no index', () => {
    const plan: NormalizedPlan = {
      dbType: 'sqlite', structured: true,
      nodes: [
        {
          op: 'JOIN', table: 'orders', rows: 100, raw: 'NESTED LOOP JOIN',
          children: [{ op: 'SCAN', table: 'users', rows: 5000, raw: 'SCAN TABLE users WHERE id = ?' }],
        },
      ],
      rawText: '',
    };
    const advice = IndexAdvisor.analyze(plan);
    const joinAdvice = advice.find(a => a.reason === 'no_index_join');
    expect(joinAdvice).toBeDefined();
    expect(joinAdvice!.impact).toBe('high');
  });

  it('skips raw plan without clear table', () => {
    const plan: NormalizedPlan = {
      dbType: 'oracle', structured: false,
      nodes: [{ op: 'RAW', raw: '' }], rawText: 'irrelevant',
    };
    const advice = IndexAdvisor.analyze(plan);
    expect(advice).toEqual([]);
  });

  it('raw plan with detectable table gives low-impact advice', () => {
    const plan: NormalizedPlan = {
      dbType: 'oracle', structured: false,
      nodes: [{ op: 'RAW', raw: 'TABLE users' }], rawText: '',
    };
    const advice = IndexAdvisor.analyze(plan);
    expect(advice.length).toBe(1);
    expect(advice[0].impact).toBe('low');
  });
});
