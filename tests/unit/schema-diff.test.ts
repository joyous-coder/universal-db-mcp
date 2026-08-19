import { describe, it, expect } from 'vitest';
import { SchemaDiff } from '../../src/core/schema-diff.js';
import type { ProfileSchema } from '../../src/core/global-schema-view.js';

// Bug N5: PG adapter 在 `name` 字段返回 "schema.table"(已含 schema 前缀),
// `schema` 字段单独也有。原 flatten 会拼成 "schema.schema.table" 双前缀。
// 修复后: 检测 t.name 是否含 `.`,含则直接用,不再加 t.schema 前缀。

function pgLike(name: string, schema: string, cols: Array<{ name: string; type: string; nullable?: boolean }>): any {
  return {
    schema,
    name, // 已含 "schema." 前缀(模拟 PG adapter 行为)
    columns: cols,
    primaryKey: [],
    foreignKeys: [],
    indexes: [],
  };
}

function mysqlLike(name: string, schema: string, cols: Array<{ name: string; type: string; nullable?: boolean }>): any {
  return {
    schema,
    name, // 不含点(模拟 MySQL/Oracle/DM adapter 行为)
    columns: cols,
    primaryKey: [],
    foreignKeys: [],
    indexes: [],
  };
}

// 模拟 ProfileManager 让 SchemaDiff.compareProfiles 拿到固定 schema
function mockPm(profileSchemas: Record<string, ProfileSchema>) {
  return {
    isEnabled: () => true,
    listProfiles: async () => Object.values(profileSchemas).map(p => ({
      name: p.name, type: p.type, role: p.role, enabled: true,
      config: {}, tags: [], created_at: '', updated_at: '',
      created_by: '', use_count: 0, permissionMode: 'readwrite',
      category: 'unknown', productName: null, version: null,
    })),
    loadProfile: async (name: string) => {
      const p = profileSchemas[name];
      if (!p) throw new Error('not found');
      // 不必真连 DB,Schemadiff 只用 buildGlobalSchemaView 走
      return { profile: p, adapter: {}, service: { getSchema: async () => ({ tables: p.tables }) }, connectedAt: new Date() };
    },
  } as any;
}

describe('SchemaDiff (Bug N5 no double-prefix)', () => {
  it('does not double-prefix when t.name already contains a dot (PG path)', async () => {
    const aTables = [pgLike('public.users', 'public', [{ name: 'id', type: 'integer' }])];
    const bTables = [pgLike('public.orders', 'public', [{ name: 'id', type: 'integer' }])];

    const a: ProfileSchema = { name: 'pg-a', type: 'postgres', role: 'primary', tables: aTables };
    const b: ProfileSchema = { name: 'pg-b', type: 'postgres', role: 'primary', tables: bTables };

    // 走真实 SchemaDiff: 用真实 ProfileManager 不好直接注入,这里直接调用 buildGlobalSchemaView
    // → 用本地 minProfileSchema mock buildGlobalSchemaView 行为
    const pm = mockPm({ 'pg-a': a, 'pg-b': b });
    const result = await SchemaDiff.compareProfiles(pm, 'pg-a', 'pg-b');

    // 期望 added: orders, removed: users(都是单层 prefix "public.x")
    // 实际 bug: 会拼成 "public.public.orders" → 完全对不上 → 全 added + 全 removed
    const addedFullNames = result.added.map((e: any) => e.table);
    const removedFullNames = result.removed.map((e: any) => e.table);

    expect(addedFullNames).toContain('public.orders');
    expect(removedFullNames).toContain('public.users');
    // 双前缀 bug 标记:不该出现 "public.public." 这样的 key
    expect(addedFullNames.find((n: string) => n.includes('public.public.'))).toBeUndefined();
    expect(removedFullNames.find((n: string) => n.includes('public.public.'))).toBeUndefined();
  });

  it('correctly prefixes when t.name is plain (MySQL path)', async () => {
    const aTables = [mysqlLike('users', 'test_smoke', [{ name: 'id', type: 'integer' }])];
    const bTables = [mysqlLike('orders', 'test_smoke', [{ name: 'id', type: 'integer' }])];
    const a: ProfileSchema = { name: 'my-a', type: 'mysql', role: 'primary', tables: aTables };
    const b: ProfileSchema = { name: 'my-b', type: 'mysql', role: 'primary', tables: bTables };

    const pm = mockPm({ 'my-a': a, 'my-b': b });
    const result = await SchemaDiff.compareProfiles(pm, 'my-a', 'my-b');

    // MySQL adapter: t.name 是纯表名,需要 ${t.schema}.${t.name} 拼装
    const addedFullNames = result.added.map((e: any) => e.table);
    expect(addedFullNames).toContain('test_smoke.orders');
  });
});