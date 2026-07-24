/**
 * SQLite Adapter Unit Tests
 *
 * Note: Internal schema caching was removed in favor of DatabaseService's
 * shared TTL cache. This file focuses on basic adapter behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteAdapter } from '../../src/adapters/sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

function createTempDbFile(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-test-'));
  return path.join(tmpDir, 'test.db');
}

describe('SQLiteAdapter', () => {
  let dbPath: string;
  let adapter: SQLiteAdapter;

  beforeEach(async () => {
    dbPath = createTempDbFile();
    adapter = new SQLiteAdapter({ filePath: dbPath, readonly: false });
    await adapter.connect();

    // Create a small test schema
    await adapter.executeQuery('CREATE TABLE users (id INTEGER PRIMARY KEY, status TEXT NOT NULL, name TEXT)');
    await adapter.executeQuery("INSERT INTO users (status, name) VALUES ('active', 'Alice'), ('inactive', 'Bob'), ('active', 'Carol')");
  });

  afterEach(async () => {
    await adapter.disconnect();
    try {
      fs.unlinkSync(dbPath);
    } catch {
      // ignore
    }
  });

  describe('getSchema()', () => {
    it('returns schema reflecting current tables and columns', async () => {
      const schema = await adapter.getSchema();

      expect(schema.databaseType).toBe('sqlite');
      expect(schema.tables.length).toBe(1);
      const table = schema.tables[0];
      expect(table.name).toBe('users');
      expect(table.columns.map(c => c.name).sort()).toEqual(['id', 'name', 'status']);
    });

    it('does not maintain its own internal cache (each call re-queries)', async () => {
      const first = await adapter.getSchema();
      // Add a new table to the DB
      await adapter.executeQuery('CREATE TABLE orders (id INTEGER PRIMARY KEY)');

      // Without an internal cache, the second call MUST see the new table.
      const second = await adapter.getSchema();
      expect(second.tables.length).toBe(2);
      expect(second.tables.map(t => t.name).sort()).toEqual(['orders', 'users']);

      // Reference inequality is expected since we no longer cache
      expect(second).not.toBe(first);
    });

    it('clearSchemaCache() is a safe no-op (no internal cache to clear)', () => {
      // Should not throw
      expect(() => adapter.clearSchemaCache()).not.toThrow();
    });
  });
});
