/**
 * execute_sql_file default path resolution (v5.0.0)
 *
 * - Bare filename ("data.sql") → <cwd>/sql/data.sql (matches csv-tools default)
 * - Path with separator ("sql/data.sql") → used as cwd-relative
 * - Absolute path ("D:/.../data.sql") → used as-is
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseService } from '../../src/core/database-service.js';
import type { DbAdapter, DbConfig } from '../../src/types/adapter.js';

function createStubAdapter(): DbAdapter {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    executeQuery: vi.fn(),
    executeBatch: vi.fn(),
    executeScript: vi.fn().mockResolvedValue({ rows: [], executionTime: 1, metadata: { statementCount: 1 } }),
    getSchema: vi.fn(),
    isWriteOperation: vi.fn(),
  } as unknown as DbAdapter;
}

describe('executeSqlFile — bare filename defaults to <cwd>/sql/', () => {
  let tmpCwd: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;
  let adapter: DbAdapter;
  let service: DatabaseService;
  let scriptMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-sql-cwd-'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpCwd);
    adapter = createStubAdapter();
    scriptMock = adapter.executeScript as ReturnType<typeof vi.fn>;
    scriptMock.mockClear();
    const config: DbConfig = {
      type: 'sqlite',
      host: 'localhost',
      permissions: ['read', 'script'],
    };
    service = new DatabaseService(adapter, config);
    // Sanity: stub adapter file path for executeScript call assertion
    fs.mkdirSync(path.join(tmpCwd, 'sql'), { recursive: true });
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    fs.rmSync(tmpCwd, { recursive: true, force: true });
    delete process.env.DB_ALLOWED_FILE_PATHS;
  });

  it('resolves bare filename to <cwd>/sql/<filename>', async () => {
    fs.writeFileSync(path.join(tmpCwd, 'sql', 'data.sql'), 'SELECT 1;');

    await service.executeSqlFile({ filePath: 'data.sql' });

    expect(scriptMock).toHaveBeenCalledTimes(1);
    const [sqlArg] = scriptMock.mock.calls[0];
    expect(sqlArg).toBe('SELECT 1;');
  });

  it('does NOT prepend <cwd>/sql/ when path contains separator', async () => {
    // Create the file at the relative location the user specified
    const nested = path.join(tmpCwd, 'other-dir');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, 'data.sql'), 'SELECT 2;');

    await service.executeSqlFile({ filePath: 'other-dir/data.sql' });

    expect(scriptMock).toHaveBeenCalledTimes(1);
    const [sqlArg] = scriptMock.mock.calls[0];
    expect(sqlArg).toBe('SELECT 2;');
  });

  it('does NOT prepend <cwd>/sql/ when path is absolute', async () => {
    const absPath = path.join(tmpCwd, 'abs.sql');
    fs.writeFileSync(absPath, 'SELECT 3;');

    await service.executeSqlFile({ filePath: absPath });

    expect(scriptMock).toHaveBeenCalledTimes(1);
    const [sqlArg] = scriptMock.mock.calls[0];
    expect(sqlArg).toBe('SELECT 3;');
  });

  it('auto-creates <cwd>/sql/ before reading (defensive mkdir -p)', async () => {
    // Delete sql/ entirely; service should mkdirSync before statSync.
    fs.rmSync(path.join(tmpCwd, 'sql'), { recursive: true, force: true });
    expect(fs.existsSync(path.join(tmpCwd, 'sql'))).toBe(false);

    // File doesn't exist either — service must mkdirSync (creating empty dir)
    // and then fail with ENOENT on the missing file. Verifies mkdirSync runs.
    await expect(service.executeSqlFile({ filePath: 'auto.sql' })).rejects.toThrow(/ENOENT|no such file/);
    expect(fs.existsSync(path.join(tmpCwd, 'sql'))).toBe(true);
  });

  it('still throws ENOENT for missing bare-filename file', async () => {
    await expect(service.executeSqlFile({ filePath: 'missing.sql' })).rejects.toThrow(/ENOENT|no such file/);
  });
});