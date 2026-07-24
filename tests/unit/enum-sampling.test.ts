/**
 * Database Service Enum Sampling Unit Tests (P1)
 *
 * Validates that buildEnumValuesQuery:
 * - Uses a sampling subquery (ORDER BY RANDOM() / RAND() LIMIT 10000)
 * - Selects the correct random function per dialect
 * - Preserves identifier quoting
 * - Works with various LIMIT clauses
 */

import { describe, it, expect } from 'vitest';
import { DatabaseService } from '../../src/core/database-service';
import type { DbAdapter, DbConfig, SchemaInfo, TableInfo } from '../../src/types/adapter';

/**
 * Stub adapter that returns a fixed table info (no real DB).
 * Schema-info only - getEnumValues doesn't actually need to call into the adapter
 * because we only inspect the generated SQL via the captured executeQuery argument.
 */
class StubAdapter implements Partial<DbAdapter> {
  capturedQuery: string | null = null;
  async executeQuery(query: string): Promise<any> {
    this.capturedQuery = query;
    return { rows: [], executionTime: 0, metadata: {} };
  }
  async getSchema(): Promise<SchemaInfo> {
    return {
      databaseType: 'mysql',
      databaseName: 'test',
      tables: [],
    };
  }
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  isWriteOperation(): boolean { return false; }
}

function makeService(dbType: string, adapter: StubAdapter): DatabaseService {
  const config: DbConfig = {
    type: dbType as any,
    host: 'localhost',
    port: 3306,
    user: 'u',
    password: 'p',
    database: 'd',
  };
  return new DatabaseService(adapter as any, config);
}

function getTableInfo(): TableInfo {
  return {
    name: 'orders',
    columns: [
      { name: 'id', type: 'INTEGER', nullable: false },
      { name: 'status', type: 'TEXT', nullable: false },
    ],
    primaryKeys: ['id'],
  };
}

describe('DatabaseService.getEnumValues - P1 sampling', () => {
  it('uses RAND() for MySQL dialect', async () => {
    const adapter = new StubAdapter();
    const service = makeService('mysql', adapter);

    // Bypass table-info lookup by stubbing the captured query path
    // We mock getTableInfo via the getSchema path is overkill; instead we
    // inspect the SQL by using a method-shim approach.
    const origExecuteQuery = adapter.executeQuery.bind(adapter);
    adapter.executeQuery = async (q: string) => {
      adapter.capturedQuery = q;
      return { rows: [{ value: 'paid' }, { value: 'pending' }], executionTime: 0, metadata: {} };
    };

    // Patch getTableInfo to skip validation
    (service as any).getTableInfo = async () => getTableInfo();

    await service.getEnumValues('orders', 'status', 50, false);

    expect(adapter.capturedQuery).not.toBeNull();
    expect(adapter.capturedQuery).toMatch(/ORDER BY RAND\(\) LIMIT 10000/);
    expect(adapter.capturedQuery).toMatch(/LIMIT 51/); // safeLimit + 1 = 51
  });

  it('uses RANDOM() for PostgreSQL dialect', async () => {
    const adapter = new StubAdapter();
    const service = makeService('postgres', adapter);
    (service as any).getTableInfo = async () => getTableInfo();

    await service.getEnumValues('orders', 'status', 50, false);

    expect(adapter.capturedQuery).toMatch(/ORDER BY RANDOM\(\) LIMIT 10000/);
    expect(adapter.capturedQuery).toMatch(/LIMIT 51/);
  });

  it('uses RAND() for TiDB, OceanBase, PolarDB, GoldenDB (MySQL-compatible)', async () => {
    for (const dbType of ['tidb', 'oceanbase', 'polardb', 'goldendb']) {
      const adapter = new StubAdapter();
      const service = makeService(dbType, adapter);
      (service as any).getTableInfo = async () => getTableInfo();

      await service.getEnumValues('orders', 'status', 50, false);

      expect(adapter.capturedQuery, `${dbType} should use RAND()`).toMatch(/ORDER BY RAND\(\) LIMIT 10000/);
    }
  });

  it('uses RANDOM() for SQLite', async () => {
    const adapter = new StubAdapter();
    const service = makeService('sqlite', adapter);
    (service as any).getTableInfo = async () => getTableInfo();

    await service.getEnumValues('orders', 'status', 50, false);

    expect(adapter.capturedQuery).toMatch(/ORDER BY RANDOM\(\) LIMIT 10000/);
    expect(adapter.capturedQuery).toMatch(/LIMIT 51/);
  });

  it('preserves identifier quoting (MySQL backticks)', async () => {
    const adapter = new StubAdapter();
    const service = makeService('mysql', adapter);
    (service as any).getTableInfo = async () => getTableInfo();

    await service.getEnumValues('orders', 'status', 50, false);

    expect(adapter.capturedQuery).toContain('`orders`');
    expect(adapter.capturedQuery).toContain('`status`');
  });

  it('preserves identifier quoting (PostgreSQL double quotes)', async () => {
    const adapter = new StubAdapter();
    const service = makeService('postgres', adapter);
    (service as any).getTableInfo = async () => getTableInfo();

    await service.getEnumValues('orders', 'status', 50, false);

    expect(adapter.capturedQuery).toContain('"orders"');
    expect(adapter.capturedQuery).toContain('"status"');
  });

  it('falls back to non-sampling DISTINCT for Oracle dialect', async () => {
    const adapter = new StubAdapter();
    const service = makeService('oracle', adapter);
    (service as any).getTableInfo = async () => getTableInfo();

    await service.getEnumValues('orders', 'status', 50, false);

    // Oracle cannot use RANDOM() / LIMIT in subquery → fallback to simple DISTINCT
    expect(adapter.capturedQuery).not.toMatch(/ORDER BY RANDOM/);
    expect(adapter.capturedQuery).toMatch(/SELECT DISTINCT "status" as value FROM "orders"/);
    // appendLimit should still use Oracle's FETCH FIRST
    expect(adapter.capturedQuery).toMatch(/FETCH FIRST 51 ROWS ONLY/);
  });

  it('falls back to non-sampling DISTINCT for SQL Server dialect', async () => {
    const adapter = new StubAdapter();
    const service = makeService('sqlserver', adapter);
    (service as any).getTableInfo = async () => getTableInfo();

    await service.getEnumValues('orders', 'status', 50, false);

    // SQL Server falls back the same way (no RANDOM() support in derived subquery)
    expect(adapter.capturedQuery).not.toMatch(/ORDER BY RANDOM/);
    // Note: appendLimit rewrites the leading SELECT as SELECT TOP N, so we
    // allow optional "TOP 51 " between SELECT and DISTINCT.
    expect(adapter.capturedQuery).toMatch(/SELECT(?: TOP 51)? DISTINCT \[status\] as value FROM \[orders\]/);
    // TOP replacement of leading SELECT
    expect(adapter.capturedQuery).toMatch(/SELECT TOP 51 DISTINCT/);
  });

  it('respects the limit parameter (uses limit + 1 sentinel)', async () => {
    const adapter = new StubAdapter();
    const service = makeService('postgres', adapter);
    (service as any).getTableInfo = async () => getTableInfo();

    await service.getEnumValues('orders', 'status', 10, false);

    expect(adapter.capturedQuery).toMatch(/LIMIT 11/);
  });

  it('caps limit at 100 (limit + 1 = 101)', async () => {
    const adapter = new StubAdapter();
    const service = makeService('postgres', adapter);
    (service as any).getTableInfo = async () => getTableInfo();

    await service.getEnumValues('orders', 'status', 500, false); // request 500, capped to 100

    expect(adapter.capturedQuery).toMatch(/LIMIT 101/);
  });

  it('with-count mode does not use sampling (uses GROUP BY count)', async () => {
    const adapter = new StubAdapter();
    const service = makeService('postgres', adapter);
    (service as any).getTableInfo = async () => getTableInfo();

    await service.getEnumValues('orders', 'status', 50, true); // includeCount = true

    // Count-mode SQL must not be modified by sampling
    expect(adapter.capturedQuery).not.toMatch(/ORDER BY RANDOM/);
    expect(adapter.capturedQuery).toMatch(/GROUP BY/);
    expect(adapter.capturedQuery).toMatch(/COUNT\(\*\)/);
  });
});
