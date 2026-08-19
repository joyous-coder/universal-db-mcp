/**
 * OracleAdapter.executeBatch validation tests
 *
 * Bug: OracleAdapter.executeBatch (src/adapters/oracle.ts:980) overrides
 * BaseAdapter.executeBatch and routes through `withTransaction` without
 * running the `maxBatchSize` and empty-paramsList pre-checks that
 * BaseAdapter.executeBatch performs (src/adapters/base.ts:214-219).
 *
 * As a result:
 *  - maxBatchSize is silently ignored
 *  - empty paramsList silently returns {affectedRowsPerStatement: [], totalAffectedRows: 0}
 *
 * These tests instantiate OracleAdapter WITHOUT calling connect(), then
 * spy on `withTransaction` to assert it is never reached when validation
 * should fail. Once the fix lands, withTransaction may still be reached
 * for valid input (we don't assert on that path here — that needs a real DB).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OracleAdapter } from '../../src/adapters/oracle';

function makeAdapter(): OracleAdapter {
  // Bare-minimum config — we never call connect(), so no real DB is touched.
  return new OracleAdapter({
    host: 'mock-host',
    port: 1521,
    user: 'mock-user',
    password: 'mock-pass',
    serviceName: 'MOCK',
  });
}

describe('OracleAdapter.executeBatch validation', () => {
  let adapter: OracleAdapter;

  beforeEach(() => {
    adapter = makeAdapter();
  });

  it('throws "exceeds limit" when paramsList.length > maxBatchSize and never invokes withTransaction', async () => {
    const spy = vi.spyOn(adapter, 'withTransaction');
    const sql = 'INSERT INTO t (id) VALUES (:1)';

    await expect(
      adapter.executeBatch(sql, [[1], [3]], { maxBatchSize: 1 }),
    ).rejects.toThrow(/exceeds limit 1/);

    expect(spy).not.toHaveBeenCalled();
  });

  it('throws "no parameter sets" for empty paramsList and never invokes withTransaction', async () => {
    const spy = vi.spyOn(adapter, 'withTransaction');
    const sql = 'INSERT INTO t (id) VALUES (:1)';

    await expect(
      adapter.executeBatch(sql, [], { useTransaction: true }),
    ).rejects.toThrow(/no parameter sets/);

    expect(spy).not.toHaveBeenCalled();
  });

  it('uses default maxBatchSize=1000 when option is omitted', async () => {
    const spy = vi.spyOn(adapter, 'withTransaction');
    const sql = 'INSERT INTO t (id) VALUES (:1)';

    // 1001 rows should exceed the default cap (1000). We don't care whether
    // the body executes; we only assert the throw fires.
    const tooMany: number[][] = Array.from({ length: 1001 }, (_, i) => [i + 1]);

    await expect(
      adapter.executeBatch(sql, tooMany),
    ).rejects.toThrow(/exceeds limit 1000/);

    expect(spy).not.toHaveBeenCalled();
  });
});