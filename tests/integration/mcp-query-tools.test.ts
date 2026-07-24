import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { buildSaveTemplateHandler, buildListTemplatesHandler, buildExecuteTemplateHandler } from '../../src/mcp/tools/query-tools.js';
import { QueryAnalyzer } from '../../src/core/query-analyzer.js';
import { SQLiteAdapter } from '../../src/adapters/sqlite/index.js';

const ts = Date.now();
const tpl = `.tmp-mcp-tpl-${ts}.db`;
const hist = `.tmp-mcp-mcp-hist-${ts}.db`;

describe('MCP query tools handlers', () => {
  let qa: QueryAnalyzer;
  beforeAll(async () => {
    qa = new QueryAnalyzer({ enabled: true, templatesDbPath: tpl, historyDbPath: hist, historyTtlDays: 30, historyMaxRows: 100, explainTimeoutMs: 5000 });
  });
  afterAll(async () => { await qa.close(); [tpl, hist].forEach(p => { if (existsSync(p)) unlinkSync(p); }); });

  it('save_template + list_templates', async () => {
    const save = buildSaveTemplateHandler(qa);
    const list = buildListTemplatesHandler(qa);
    const t = await save({ name: 'q1', description: 'd', sql: 'SELECT 1', parameters: [] });
    expect(t.id).toBeDefined();
    const r = await list({});
    expect(r.templates.length).toBe(1);
  });

  it('execute_template substitutes params + uses sqlite adapter', async () => {
    const save = buildSaveTemplateHandler(qa);
    const exec = buildExecuteTemplateHandler(qa);
    await save({ name: 'q2', description: 'd', sql: 'SELECT ${n} AS v', parameters: [{ name: 'n', type: 'number', required: true }] });
    const adapter = new SQLiteAdapter({ filePath: ':memory:', readonly: false });
    await adapter.connect();
    const list = await qa.listTemplates();
    const target = list.find(t => t.name === 'q2')!;
    const r = await exec({ id: target.id, params: { n: 42 } }, adapter);
    expect((r as any).rows?.[0]?.v).toBe(42);
    await adapter.disconnect();
  });
});
