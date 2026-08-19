import { describe, it, expect, vi } from 'vitest';
import { Explainer } from '../../src/core/explainer.js';

// Bug N7: MySQL/PG 用 tabular EXPLAIN + bound params 在 binary protocol 下返回空 rows。
// 修复: 改用 EXPLAIN FORMAT=JSON / EXPLAIN (FORMAT JSON),返回的 JSON 文本应被解析
// 成非空 plan。

describe('Explainer (Bug N7 FORMAT=JSON)', () => {
  it('MySQL: emits EXPLAIN FORMAT=JSON and parses JSON into non-empty plan', async () => {
    const mysqlJson = JSON.stringify({
      query_block: {
        select_id: 1,
        cost_info: { query_cost: '2.40' },
        table: {
          table_name: 'users',
          access_type: 'const',
          key: 'PRIMARY',
          rows_examined_per_scan: 1,
          filtered: 100,
        },
      },
    });
    const adapter = {
      executeQuery: vi.fn(async (sql: string) => {
        // EXPLAIN FORMAT=JSON 返回 1 行 1 列,列名 `EXPLAIN`
        return { rows: [{ EXPLAIN: mysqlJson }] };
      }),
    } as any;
    const exp = new Explainer(adapter, 'mysql');
    const result = await exp.explain('SELECT * FROM users WHERE id = ?', [42]);

    expect(adapter.executeQuery).toHaveBeenCalledWith(
      expect.stringContaining('EXPLAIN FORMAT=JSON'),
      [42],
    );
    expect(result.plan.length).toBeGreaterThan(0);
    expect(result.plan[0].table).toBe('users');
    expect(result.format).toBe('json');
    expect(result.raw).toContain('query_block');
  });

  it('PostgreSQL: emits EXPLAIN (FORMAT JSON) and parses Plan tree', async () => {
    const pgJson = JSON.stringify({
      Plan: {
        'Node Type': 'Index Scan',
        'Relation Name': 'users',
        'Index Name': 'users_pkey',
        'Plan Rows': 1,
        'Total Cost': 0.27,
      },
    });
    const adapter = {
      executeQuery: vi.fn(async (sql: string) => {
        // PG FORMAT JSON 返回 1 行 1 列,列名 `QUERY PLAN`
        return { rows: [{ 'QUERY PLAN': pgJson }] };
      }),
    } as any;
    const exp = new Explainer(adapter, 'postgres');
    const result = await exp.explain('SELECT * FROM users WHERE id = $1', [42]);

    expect(adapter.executeQuery).toHaveBeenCalledWith(
      expect.stringContaining('EXPLAIN (FORMAT JSON)'),
      [42],
    );
    expect(result.plan.length).toBeGreaterThan(0);
    expect(result.plan[0].table).toBe('users');
    expect(result.plan[0].key).toBe('users_pkey');
    expect(result.plan[0].select_type).toBe('Index Scan');
  });

  it('SQLite: still uses EXPLAIN QUERY PLAN tabular (no JSON change)', async () => {
    const adapter = {
      executeQuery: vi.fn(async () => ({
        rows: [{ id: 0, parent: 0, notused: 0, detail: 'SCAN TABLE users' }],
      })),
    } as any;
    const exp = new Explainer(adapter, 'sqlite');
    const result = await exp.explain('SELECT * FROM users');
    expect(adapter.executeQuery).toHaveBeenCalledWith(
      expect.stringContaining('EXPLAIN QUERY PLAN'),
      undefined,
    );
    expect(result.plan.length).toBeGreaterThan(0);
    expect(result.format).toBe('tabular');
  });

  // v5.0.1 Bug N8: Explainer 实例在 dbType 字段上正确暴露 dbType,
  // plan-history.ts 用 (result as any).db 拿 dbType — 这里 result.db 来源于 dbType
  it('Explainer populates result.db from dbType', async () => {
    const adapter = {
      executeQuery: vi.fn(async () => ({
        rows: [{ EXPLAIN: JSON.stringify({ query_block: { select_id: 1, table: { table_name: 't' } } }) }],
      })),
    } as any;
    const exp = new Explainer(adapter, 'mysql');
    const result = await exp.explain('SELECT * FROM t');
    // result.db 字段是关键(plan-history.ts:27 读它)
    expect(result.db).toBe('mysql');
    expect(exp.dbType).toBe('mysql');
  });
});