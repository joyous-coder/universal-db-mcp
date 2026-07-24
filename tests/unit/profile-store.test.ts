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
});