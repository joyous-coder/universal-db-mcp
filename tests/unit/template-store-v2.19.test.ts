/**
 * TemplateStore profile_name tests (v2.19)
 *
 * Covers:
 * - save() persists profile_name (or null when omitted)
 * - list() filter: `profileName: null` = global only; `profileName: 'name'` = local only; omitted = all
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { TemplateStore } from '../../src/core/template-store.js';

function cleanup(p: string) {
  if (existsSync(p)) { try { unlinkSync(p); } catch { /* ignore */ } }
}

describe('TemplateStore profile_name (v2.19)', () => {
  let dbPath: string;
  let store: TemplateStore;
  beforeEach(async () => {
    dbPath = `.tmp-t-v219-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
    cleanup(dbPath);
    store = new TemplateStore(dbPath);
  });
  afterEach(async () => {
    try { await store.close(); } catch { /* ignore */ }
    cleanup(dbPath);
  });

  it('saves with profile_name = null when omitted (global)', async () => {
    const t = await store.save({
      name: 'g',
      description: '',
      sql: 'SELECT 1',
      parameters: [],
    });
    expect(t.profile_name).toBeNull();
  });

  it('saves with profile_name = "prod-mysql" when provided', async () => {
    const t = await store.save({
      name: 'p',
      description: '',
      sql: 'SELECT 1',
      parameters: [],
      profile_name: 'prod-mysql',
    });
    expect(t.profile_name).toBe('prod-mysql');
  });

  it('explicit null profile_name maps to NULL column (global)', async () => {
    const t = await store.save({
      name: 'gn',
      description: '',
      sql: 'SELECT 2',
      parameters: [],
      profile_name: null,
    });
    expect(t.profile_name).toBeNull();
  });

  it('filter.profileName=null returns only global templates', async () => {
    await store.save({ name: 'g1', description: '', sql: 'SELECT 1', parameters: [] });
    await store.save({ name: 'g2', description: '', sql: 'SELECT 2', parameters: [], profile_name: null });
    await store.save({ name: 'p1', description: '', sql: 'SELECT 3', parameters: [], profile_name: 'prod' });
    const list = await store.list({ profileName: null });
    const names = list.map(t => t.name).sort();
    expect(names).toEqual(['g1', 'g2']);
  });

  it('filter.profileName="prod" returns only that profile templates', async () => {
    await store.save({ name: 'g', description: '', sql: 'SELECT 1', parameters: [] });
    await store.save({ name: 'p', description: '', sql: 'SELECT 2', parameters: [], profile_name: 'prod' });
    await store.save({ name: 's', description: '', sql: 'SELECT 3', parameters: [], profile_name: 'staging' });
    const list = await store.list({ profileName: 'prod' });
    expect(list.length).toBe(1);
    expect(list[0].name).toBe('p');
    expect(list[0].profile_name).toBe('prod');
  });

  it('filter.profileName undefined returns all (backward compat)', async () => {
    await store.save({ name: 'g', description: '', sql: 'SELECT 1', parameters: [] });
    await store.save({ name: 'p', description: '', sql: 'SELECT 2', parameters: [], profile_name: 'prod' });
    const list = await store.list();
    expect(list.length).toBe(2);
  });

  it("migration: existing templates.db without profile_name column gets ALTER'd", async () => {
    // Create a store, insert templates, close, then re-open to verify ALTER TABLE ran
    await store.save({ name: 'legacy', description: '', sql: 'SELECT 1', parameters: [] });
    await store.close();
    const store2 = new TemplateStore(dbPath);
    const list = await store2.list({});
    expect(list[0].profile_name).toBeNull();
    await store2.close();
  });
});
