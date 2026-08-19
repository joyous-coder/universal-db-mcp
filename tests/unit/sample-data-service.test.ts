import { describe, expect, it, vi } from 'vitest';
import { DatabaseService } from '../../src/core/database-service.js';
import type { DbAdapter, DbConfig, SchemaInfo } from '../../src/types/adapter.js';

function createService(dbType: DbConfig['type'] = 'sqlite', permissions: DbConfig['permissions'] = ['insert', 'batch']) {
  const schema: SchemaInfo = {
    databaseType: dbType,
    databaseName: 'test',
    tables: [{
      name: 'orders',
      primaryKeys: ['id'],
      columns: [
        { name: 'id', type: 'integer', nullable: false },
        { name: 'tenant_id', type: 'varchar', nullable: false },
        { name: 'amount', type: 'decimal', nullable: false },
      ],
    }],
  };
  const executeBatch = vi.fn().mockResolvedValue({
    affectedRowsPerStatement: [1, 1],
    totalAffectedRows: 2,
    executionTime: 1,
  });
  const adapter = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    executeQuery: vi.fn(),
    executeBatch,
    getSchema: vi.fn().mockResolvedValue(schema),
    isWriteOperation: vi.fn(),
  } as unknown as DbAdapter;
  const config: DbConfig = { type: dbType, permissions };
  return { service: new DatabaseService(adapter, config), executeBatch };
}

describe('DatabaseService.generateAndInsertSampleData', () => {
  it('requires both insert and batch permissions', async () => {
    const { service } = createService('sqlite', ['insert']);

    await expect(service.generateAndInsertSampleData('orders', 2))
      .rejects.toThrow('generate_sample_data 需要 insert + batch 权限');
  });

  it('uses ? placeholders for MySQL/SQLite-style dialects', async () => {
    const { service, executeBatch } = createService('sqlite');

    const result = await service.generateAndInsertSampleData('orders', 2, {
      seed: 42,
      columns: ['tenant_id', 'amount'],
      rules: [
        { match: { columnName: 'tenant_id' }, generate: { type: 'fixed', value: 'TENANT_A' } },
        { match: { columnName: 'amount' }, generate: { type: 'range', min: 100, max: 100, decimals: 2 } },
      ],
    });

    expect(executeBatch).toHaveBeenCalledWith(
      'INSERT INTO "orders" ("tenant_id", "amount") VALUES (?, ?)',
      [['TENANT_A', 100], ['TENANT_A', 100]],
      undefined,
    );
    expect(result).toMatchObject({ insertedRows: 2, tableName: 'orders', columns: ['tenant_id', 'amount'] });
    expect(result.executionTime).toEqual(expect.any(Number));
  });

  it('uses $1, $2 placeholders for PostgreSQL', async () => {
    const { service, executeBatch } = createService('postgres');

    await service.generateAndInsertSampleData('orders', 1, {
      seed: 42,
      columns: ['tenant_id', 'amount'],
      rules: [
        { match: { columnName: 'tenant_id' }, generate: { type: 'fixed', value: 'TENANT_A' } },
        { match: { columnName: 'amount' }, generate: { type: 'range', min: 100, max: 100, decimals: 2 } },
      ],
    });

    expect(executeBatch).toHaveBeenCalledWith(
      'INSERT INTO "orders" ("tenant_id", "amount") VALUES ($1, $2)',
      [['TENANT_A', 100]],
      undefined,
    );
  });

  it('uses @p1, @p2 placeholders for SQL Server', async () => {
    const { service, executeBatch } = createService('sqlserver');

    await service.generateAndInsertSampleData('orders', 1, {
      seed: 42,
      columns: ['tenant_id', 'amount'],
      rules: [
        { match: { columnName: 'tenant_id' }, generate: { type: 'fixed', value: 'TENANT_A' } },
        { match: { columnName: 'amount' }, generate: { type: 'range', min: 100, max: 100, decimals: 2 } },
      ],
    });

    expect(executeBatch).toHaveBeenCalledWith(
      'INSERT INTO [orders] ([tenant_id], [amount]) VALUES (@p1, @p2)',
      [['TENANT_A', 100]],
      undefined,
    );
  });

  // v5.0.0 Bug #60 regression: Oracle adapter returns lowercase column names (oracle.ts:339
  // `cn.toLowerCase()`), but LLM users typically pass uppercase column names per Oracle
  // convention. Without case-insensitive lookup, the row stayed empty → 0 bind values →
  // NJS-098 "0 bind values were provided" for INSERT with 3 placeholders.
  it('matches columns case-insensitively when user passes uppercase to Oracle', async () => {
    // Oracle adapter normalizes column names to lowercase.
    const schema: SchemaInfo = {
      databaseType: 'oracle',
      databaseName: 'TEST',
      tables: [{
        name: 'test_regression_tbl',
        primaryKeys: ['id'],
        columns: [
          { name: 'id', type: 'number', nullable: false },
          { name: 'name', type: 'varchar2', nullable: true },
          { name: 'status', type: 'varchar2', nullable: true },
        ],
      }],
    };
    const executeBatch = vi.fn().mockResolvedValue({
      affectedRowsPerStatement: [1, 1],
      totalAffectedRows: 2,
      executionTime: 1,
    });
    const adapter = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      executeQuery: vi.fn(),
      executeBatch,
      getSchema: vi.fn().mockResolvedValue(schema),
      getTableInfo: vi.fn().mockResolvedValue({
        name: 'test_regression_tbl',
        primaryKeys: ['id'],
        columns: [
          { name: 'id', type: 'number', nullable: false },
          { name: 'name', type: 'varchar2', nullable: true },
          { name: 'status', type: 'varchar2', nullable: true },
        ],
      }),
      isWriteOperation: vi.fn(),
    } as unknown as DbAdapter;
    const config: DbConfig = { type: 'oracle', permissions: ['insert', 'batch'] };
    const service = new DatabaseService(adapter, config);

    await service.generateAndInsertSampleData('test_regression_tbl', 2, {
      seed: 42,
      columns: ['ID', 'NAME', 'STATUS'],  // ← uppercase, per Oracle convention
      columnOverrides: {
        ID: 1,
        NAME: 'foo',
        STATUS: 'ok',
      },
    });

    // Oracle quoteSimpleIdentifier uppercases identifier — column list is uppercase.
    expect(executeBatch).toHaveBeenCalledWith(
      'INSERT INTO "TEST_REGRESSION_TBL" ("ID", "NAME", "STATUS") VALUES (?, ?, ?)',
      [[1, 'foo', 'ok'], [1, 'foo', 'ok']],
      undefined,
    );
  });

  // v5.0.0 Bug #60c regression: SELECT MAX("ID") AS M returns row key uppercase "M"
  // on Oracle (Bug #38 removed k.toLowerCase() from adapter). Without case-insensitive
  // lookup, MAX result is read as 0 → PK sequence starts at 1 → collides with existing
  // rows (ORA-00001 unique constraint).
  it('reads MAX(pk) case-insensitively for PK sequence (Oracle uppercase M)', async () => {
    const schema: SchemaInfo = {
      databaseType: 'oracle',
      databaseName: 'TEST',
      tables: [{
        name: 'test_regression_tbl',
        primaryKeys: ['id'],
        columns: [
          { name: 'id', type: 'number', nullable: false },
          { name: 'status', type: 'varchar2', nullable: true },
        ],
      }],
    };
    const executeBatch = vi.fn().mockResolvedValue({
      affectedRowsPerStatement: [1],
      totalAffectedRows: 1,
      executionTime: 1,
    });
    // Oracle returns MAX result with uppercase "M" key (post-Bug #38).
    const executeQuery = vi.fn().mockImplementation(async (sql: string) => {
      if (/MAX/.test(sql)) return { rows: [{ M: 3 }], executionTime: 1, metadata: {} };
      return { rows: [], executionTime: 1, metadata: {} };
    });
    const adapter = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      executeQuery,
      executeBatch,
      getSchema: vi.fn().mockResolvedValue(schema),
      getTableInfo: vi.fn().mockResolvedValue({
        name: 'test_regression_tbl',
        primaryKeys: ['id'],
        columns: [
          { name: 'id', type: 'number', nullable: false },
          { name: 'status', type: 'varchar2', nullable: true },
        ],
      }),
      isWriteOperation: vi.fn(),
    } as unknown as DbAdapter;
    const config: DbConfig = { type: 'oracle', permissions: ['insert', 'batch'] };
    const service = new DatabaseService(adapter, config);

    await service.generateAndInsertSampleData('test_regression_tbl', 1, {
      seed: 42,
      columnOverrides: { STATUS: 'foo' },
    });

    // PK sequence should be MAX(3) + 1 = 4, not 0+1=1 (would collide).
    expect(executeBatch).toHaveBeenCalledWith(
      'INSERT INTO "TEST_REGRESSION_TBL" ("ID", "STATUS") VALUES (?, ?)',
      [[4, 'foo']],
      undefined,
    );
  });
});
