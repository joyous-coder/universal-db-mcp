import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { TemplateStore } from '../../src/core/template-store.js';
import type { TemplateInput } from '../../src/core/query-analyzer-types.js';

const dbPath = `.tmp-test-templates-${Date.now()}.db`;

describe('TemplateStore', () => {
  let store: TemplateStore;
  beforeEach(() => { store = new TemplateStore(dbPath); });
  afterEach(async () => { await store.close(); if (existsSync(dbPath)) unlinkSync(dbPath); });

  it('saves and retrieves a template', async () => {
    const input: TemplateInput = {
      name: 'monthly_active',
      description: 'Monthly active users',
      sql: 'SELECT * FROM users WHERE created_at > ${start_date}',
      parameters: [{ name: 'start_date', type: 'date', required: true }],
    };
    const t = await store.save(input);
    expect(t.id).toBeDefined();
    expect(t.name).toBe('monthly_active');
    const fetched = await store.get(t.id);
    expect(fetched?.sql).toBe(input.sql);
  });

  it('rejects duplicate name', async () => {
    const input: TemplateInput = {
      name: 'dup',
      description: 'x',
      sql: 'SELECT 1',
      parameters: [],
    };
    await store.save(input);
    await expect(store.save(input)).rejects.toThrow();
  });

  it('lists templates filtered by tag', async () => {
    await store.save({ name: 'a', description: '', sql: 'SELECT 1', parameters: [], tags: ['report'] });
    await store.save({ name: 'b', description: '', sql: 'SELECT 2', parameters: [], tags: ['adhoc'] });
    const reports = await store.list({ tag: 'report' });
    expect(reports.length).toBe(1);
    expect(reports[0].name).toBe('a');
  });

  it('deletes a template', async () => {
    const t = await store.save({ name: 'tmp', description: '', sql: 'SELECT 1', parameters: [] });
    const ok = await store.delete(t.id);
    expect(ok).toBe(true);
    expect(await store.get(t.id)).toBeNull();
  });

  it('increments use_count', async () => {
    const t = await store.save({ name: 'cnt', description: '', sql: 'SELECT 1', parameters: [] });
    await store.incrementUseCount(t.id);
    await store.incrementUseCount(t.id);
    const fetched = await store.get(t.id);
    expect(fetched?.use_count).toBe(2);
  });
});
