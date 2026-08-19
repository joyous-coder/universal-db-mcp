/**
 * MySQL adapter executeQuery / tx.executeQuery text-protocol fallback (Bug N6)
 *
 * mysql2 在 prepared-statement 路径 (`pool.execute`) 严格要求 params 数组长度
 * 与 `?` 占位符匹配,否则抛 "Incorrect arguments to COM_STMT_EXECUTE"。
 * 修复:无 params 时走 text protocol (`pool.query` / `conn.query`),有 params 时
 * 走 prepared-statement (`pool.execute` / `conn.execute`)。
 */
import { describe, it, expect, vi } from 'vitest';
import { MySQLAdapter } from '../../src/adapters/mysql.js';

function makeFakePool() {
  const execute = vi.fn(async () => [[], []]);
  const query = vi.fn(async () => [[], []]);
  const pool = {
    execute,
    query,
    getConnection: async () => ({
      execute: vi.fn(async () => [[], []]),
      query: vi.fn(async () => [[], []]),
      release: () => {},
    }),
    end: async () => {},
  };
  return { pool, execute, query };
}

describe('MySQLAdapter (Bug N6 text-protocol fallback)', () => {
  it('executeQuery with no params uses pool.query (text protocol)', async () => {
    const fake = makeFakePool();
    const adapter = new MySQLAdapter({ type: 'mysql', host: 'x', port: 3306, user: 'u', password: 'p' });
    // 直接注入 pool(避开真实 mysql2 连接)
    (adapter as any).pool = fake.pool;

    await adapter.executeQuery('SELECT 1');
    expect(fake.query).toHaveBeenCalledTimes(1);
    expect(fake.query).toHaveBeenCalledWith('SELECT 1');
    // 不应调 execute
    expect(fake.execute).not.toHaveBeenCalled();
  });

  it('executeQuery with params uses pool.execute (prepared statement)', async () => {
    const fake = makeFakePool();
    const adapter = new MySQLAdapter({ type: 'mysql', host: 'x', port: 3306, user: 'u', password: 'p' });
    (adapter as any).pool = fake.pool;

    await adapter.executeQuery('SELECT ? AS x', [42]);
    expect(fake.execute).toHaveBeenCalledTimes(1);
    expect(fake.execute).toHaveBeenCalledWith('SELECT ? AS x', [42]);
    // 不应调 query
    expect(fake.query).not.toHaveBeenCalled();
  });

  it('executeQuery with empty params array [] falls back to pool.query', async () => {
    const fake = makeFakePool();
    const adapter = new MySQLAdapter({ type: 'mysql', host: 'x', port: 3306, user: 'u', password: 'p' });
    (adapter as any).pool = fake.pool;

    await adapter.executeQuery('SELECT 1', []);
    expect(fake.query).toHaveBeenCalledTimes(1);
    expect(fake.execute).not.toHaveBeenCalled();
  });

  it('executeQuery with `?` placeholder but no params does NOT crash', async () => {
    // 模拟 Bug N6 复现:executeQuery("SELECT 1 WHERE 1 = ?", undefined)
    // 修复前:mysql2.execute 报 "Incorrect arguments to COM_STMT_EXECUTE"
    // 修复后:走 pool.query text protocol,不绑定参数,SQL 中的 `?` 当字面字符
    const fake = makeFakePool();
    const adapter = new MySQLAdapter({ type: 'mysql', host: 'x', port: 3306, user: 'u', password: 'p' });
    (adapter as any).pool = fake.pool;

    // 不应抛错
    await expect(adapter.executeQuery('SELECT 1 WHERE 1 = ?')).resolves.toBeDefined();
    expect(fake.query).toHaveBeenCalledWith('SELECT 1 WHERE 1 = ?');
  });
});