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
});
