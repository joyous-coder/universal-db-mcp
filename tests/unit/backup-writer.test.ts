import { describe, it, expect, vi } from 'vitest';
import { listTables } from '../../src/core/backup-writer.js';

// Bug N13: PG listTables 之前只查 default schema,改用排除系统 schema + BASE TABLE。
// 这里不能直接调 listTables(需要 ProfileManager + live connection),但 listTables 是
// 模块内部导出函数 — 我们改测 listTables 通过间接 mock:让 mock 的 adapter.executeQuery
// 记录 SQL,然后断言 PG SQL 含 NOT IN 系统 schema。

describe('BackupWriter listTables (Bug N13 PG all-schemas)', () => {
  it('PG listTables SQL excludes pg_catalog / information_schema', async () => {
    const calls: Array<{ sql: string; params?: any[] }> = [];
    const fakeLive = {
      profile: { name: 'pg-test', type: 'postgres', config: {} },
      adapter: {
        executeQuery: vi.fn(async (sql: string, params?: any[]) => {
          calls.push({ sql, params });
          return { rows: [
            { table_schema: 'public', name: 't1' },
            { table_schema: 'test_smoke', name: 't2' },
          ] };
        }),
      },
    };
    const fakePm = {
      loadProfile: async () => fakeLive,
    } as any;
    const tables = await listTables(fakePm, 'pg-test');

    // SQL 必须排除系统 schema
    const pgCall = calls.find((c) => c.sql.includes('information_schema.tables'));
    expect(pgCall).toBeDefined();
    expect(pgCall!.sql).toMatch(/pg_catalog.*information_schema/);
    expect(pgCall!.sql).toMatch(/BASE TABLE/);
    expect(pgCall!.sql).not.toMatch(/current_schema\(\)/);

    // 返回的 tables 必须包含两个 schema 下的表
    expect(tables).toContain('public.t1');
    expect(tables).toContain('test_smoke.t2');
  });

  it('MySQL listTables still uses DATABASE() (regression check)', async () => {
    const calls: Array<{ sql: string }> = [];
    const fakeLive = {
      profile: { name: 'my-test', type: 'mysql', config: {} },
      adapter: {
        executeQuery: vi.fn(async (sql: string) => {
          calls.push({ sql });
          return { rows: [{ name: 'users' }] };
        }),
      },
    };
    const fakePm = { loadProfile: async () => fakeLive } as any;
    const tables = await listTables(fakePm, 'my-test');
    expect(calls[0].sql).toMatch(/DATABASE\(\)/);
    expect(tables).toContain('users');
  });
});