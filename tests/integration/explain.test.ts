import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Explainer } from '../../src/core/explainer.js';
import { SQLiteAdapter } from '../../src/adapters/sqlite/index.js';

describe('Explainer (SQLite integration)', () => {
  let adapter: SQLiteAdapter;
  let explainer: Explainer;

  beforeAll(async () => {
    adapter = new SQLiteAdapter({ filePath: ':memory:', readonly: false });
    await adapter.connect();
    await adapter.executeQuery('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)');
    await adapter.executeQuery('CREATE INDEX idx_users_email ON users(email)');
    explainer = new Explainer(adapter, 'sqlite');
  });
  afterAll(async () => { await adapter.disconnect(); });

  it('explains a SELECT with table scan', async () => {
    const r = await explainer.explain('SELECT * FROM users WHERE name = ?', ['alice']);
    expect(r.db).toBe('sqlite');
    expect(r.raw).toMatch(/SCAN|SEARCH/i);
    expect(r.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('explains a SELECT with index usage', async () => {
    const r = await explainer.explain('SELECT * FROM users WHERE email = ?', ['a@b.com']);
    expect(r.raw).toMatch(/USING INDEX/i);
  });

  it('returns raw output for trivial queries', async () => {
    const r = await explainer.explain('SELECT 1');
    expect(r.raw).toBeTruthy();
  });
});
