import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { ProfileStore } from '../../src/core/profile-store.js';
import type { ProfileInput } from '../../src/core/profile-manager.js';

const dbPath = `.tmp-test-profiles-${Date.now()}.db`;

describe('ProfileStore', () => {
  let store: ProfileStore;
  beforeEach(() => { store = new ProfileStore(dbPath); });
  afterEach(async () => { await store.close(); if (existsSync(dbPath)) unlinkSync(dbPath); });

  it('saves and retrieves a profile', async () => {
    const input: ProfileInput = {
      name: 'dev-mysql', description: 'Dev MySQL', type: 'mysql',
      config: { type: 'mysql', host: 'localhost', port: 3306, user: 'root', password: 'x' },
    };
    const p = await store.save(input);
    expect(p.id).toBeDefined();
    expect(p.role).toBe('primary');
    const fetched = await store.get('dev-mysql');
    expect(fetched?.config.host).toBe('localhost');
  });

  it('rejects duplicate name', async () => {
    const input: ProfileInput = {
      name: 'dup', description: '', type: 'sqlite', config: { type: 'sqlite', filePath: ':memory:' },
    };
    await store.save(input);
    await expect(store.save(input)).rejects.toThrow();
  });

  it('lists profiles filtered by role', async () => {
    await store.save({ name: 'p', description: '', type: 'sqlite', config: { type: 'sqlite', filePath: ':memory:' }, role: 'primary' });
    await store.save({ name: 'r', description: '', type: 'sqlite', config: { type: 'sqlite', filePath: ':memory:' }, role: 'replica' });
    const replicas = await store.list({ role: 'replica' });
    expect(replicas.length).toBe(1);
    expect(replicas[0].name).toBe('r');
  });

  it('deletes a profile', async () => {
    await store.save({ name: 'tmp', description: '', type: 'sqlite', config: { type: 'sqlite', filePath: ':memory:' } });
    expect(await store.delete('tmp')).toBe(true);
    expect(await store.get('tmp')).toBeNull();
  });

  it('setEnabled toggles enabled flag', async () => {
    await store.save({ name: 'e', description: '', type: 'sqlite', config: { type: 'sqlite', filePath: ':memory:' } });
    await store.setEnabled('e', false);
    expect((await store.get('e'))?.enabled).toBe(false);
  });

  it('incrementUseCount bumps counter', async () => {
    await store.save({ name: 'c', description: '', type: 'sqlite', config: { type: 'sqlite', filePath: ':memory:' } });
    await store.incrementUseCount('c');
    await store.incrementUseCount('c');
    expect((await store.get('c'))?.use_count).toBe(2);
  });

  // v4.2.0: legacy row 缺新字段时给默认值
  it('legacy row (missing v4.2.0 fields) reads with defaults', async () => {
    // 模拟老库:直接写入 12 列的 legacy row (缺 v4.2.0 字段)
    // 通过 raw prepare().run() 而不是 INSERT INTO,因 rowToProfile 在 read 时对缺失字段用 ?? 默认
    const Database = (await import('better-sqlite3')).default;
    const legacyDbPath = `.tmp-legacy-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
    const Db = new Database(legacyDbPath);
    // 用 raw better-sqlite3 直接建老表(只 12 列)
    Db.exec(`CREATE TABLE profiles (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT,
      type TEXT NOT NULL, config_json TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'primary',
      tags_json TEXT NOT NULL DEFAULT '[]', enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by TEXT NOT NULL,
      use_count INTEGER DEFAULT 0
    )`);
    Db.prepare(`INSERT INTO profiles (id, name, description, type, config_json, role, tags_json, enabled, created_at, updated_at, created_by, use_count)
                VALUES ('legacy1', 'legacy-prof', 'desc', 'oracle', '{}', 'primary', '[]', 1, '2025-01-01', '2025-01-01', 'cli', 0)`).run();
    Db.close();
    // 强制释放文件锁(Windows 上 better-sqlite3 关闭后仍可能持有)
    await new Promise(r => setTimeout(r, 50));
    // 用 ProfileStore 打开这个老库 — ALTER TABLE 迁移会跑(因为 4 列缺失)
    const legacyStore = new ProfileStore(legacyDbPath);
    try {
      const p = await legacyStore.get('legacy-prof');
      expect(p).not.toBeNull();
      expect(p!.permissionMode).toBe('readwrite');
      expect(p!.category).toBe('unknown');
      expect(p!.productName).toBeNull();
      expect(p!.version).toBeNull();
    } finally {
      await legacyStore.close();
      try {
        const { unlinkSync, existsSync } = await import('node:fs');
        if (existsSync(legacyDbPath)) unlinkSync(legacyDbPath);
      } catch { /* ignore */ }
    }
  });

  // v4.2.0: 新字段持久化
  it('saves and reads back v4.2.0 metadata fields', async () => {
    const input: ProfileInput = {
      name: 'meta-prof', description: '', type: 'oracle',
      config: { type: 'oracle', host: 'x', port: 1521 },
      permissionMode: 'full',
      category: 'rdbms',
      productName: 'Oracle 19c',
      version: '19.0.0.0',
    };
    await store.save(input);
    const p = await store.get('meta-prof');
    expect(p?.permissionMode).toBe('full');
    expect(p?.category).toBe('rdbms');
    expect(p?.productName).toBe('Oracle 19c');
    expect(p?.version).toBe('19.0.0.0');
  });

  // v5.0.0 Bug N1: update 不传 tags 时应保留原值(PATCH 语义),不能清空
  it('update preserves tags when input.tags is undefined', async () => {
    const input: ProfileInput = {
      name: 'tags-prof', description: 'orig', type: 'sqlite',
      config: { type: 'sqlite', filePath: ':memory:' },
      tags: ['prod', 'critical'],
    };
    await store.create(input);
    const updated = await store.update({
      name: 'tags-prof', description: 'new desc', type: 'sqlite',
      config: { type: 'sqlite', filePath: ':memory:' },
      // tags 故意省略 → 应保留 ['prod', 'critical']
    });
    expect(updated.tags).toEqual(['prod', 'critical']);
    expect(updated.description).toBe('new desc');
    // 持久化验证
    const fetched = await store.get('tags-prof');
    expect(fetched?.tags).toEqual(['prod', 'critical']);
  });

  // v5.0.0 Bug N1: update 显式传 tags: [] 时,允许清空(显式空 ≠ 省略)
  it('update honors explicit empty tags array', async () => {
    const input: ProfileInput = {
      name: 'tags-empty', description: '', type: 'sqlite',
      config: { type: 'sqlite', filePath: ':memory:' },
      tags: ['will-clear'],
    };
    await store.create(input);
    const updated = await store.update({
      name: 'tags-empty', description: '', type: 'sqlite',
      config: { type: 'sqlite', filePath: ':memory:' },
      tags: [],
    });
    expect(updated.tags).toEqual([]);
    const fetched = await store.get('tags-empty');
    expect(fetched?.tags).toEqual([]);
  });
});