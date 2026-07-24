import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { QueryAnalyzer } from '../../src/core/query-analyzer.js';

const ts = Date.now();
const tplPath = `.tmp-qa-tpl-${ts}.db`;
const histPath = `.tmp-qa-hist-${ts}.db`;

describe('QueryAnalyzer', () => {
  let qa: QueryAnalyzer;
  beforeEach(() => {
    qa = new QueryAnalyzer({
      templatesDbPath: tplPath,
      historyDbPath: histPath,
      historyTtlDays: 30,
      historyMaxRows: 100,
      enabled: true,
      explainTimeoutMs: 5000,
    });
  });
  afterEach(async () => {
    await qa.close();
    [tplPath, histPath].forEach(p => { if (existsSync(p)) unlinkSync(p); });
  });

  it('lint delegates to sql-linter', () => {
    const r = qa.lint('SELECT * FROM users');
    expect(r.issues.some(i => i.rule === 'select-star')).toBe(true);
  });

  it('recordQuery + getHistory roundtrip', async () => {
    await qa.recordQuery({
      ts: new Date().toISOString(), db: 'sqlite', kind: 'select',
      sql: 'SELECT 1', params: null, duration_ms: 5, rows: 1, error: null, error_code: null,
    });
    const entries = await qa.getHistory({ limit: 10 });
    expect(entries.length).toBe(1);
  });

  it('saveTemplate + listTemplates + deleteTemplate', async () => {
    const t = await qa.saveTemplate({ name: 'a', description: 'd', sql: 'SELECT 1', parameters: [] });
    expect(t.id).toBeDefined();
    const list = await qa.listTemplates();
    expect(list.length).toBe(1);
    expect(await qa.deleteTemplate(t.id)).toBe(true);
    expect((await qa.listTemplates()).length).toBe(0);
  });

  it('saveTemplate initializes use_count to 0', async () => {
    const t = await qa.saveTemplate({ name: 'q', description: 'd', sql: 'SELECT ${n} AS v', parameters: [{ type: 'number', required: true }] });
    expect(t.use_count).toBe(0);
  });

  it('isEnabled() returns option', () => {
    expect(qa.isEnabled()).toBe(true);
  });

  it('with enabled=false: lint returns empty, recordQuery is no-op', async () => {
    const off = new QueryAnalyzer({
      templatesDbPath: tplPath, historyDbPath: histPath,
      historyTtlDays: 30, historyMaxRows: 100, enabled: false, explainTimeoutMs: 5000,
    });
    expect(off.lint('SELECT *').issues).toEqual([]);
    await off.recordQuery({ ts: 't', db: 'x', kind: 's', sql: 'q', params: null, duration_ms: 0, rows: 0, error: null, error_code: null });
    expect((await off.getHistory()).length).toBe(0);
    await off.close();
  });
});
