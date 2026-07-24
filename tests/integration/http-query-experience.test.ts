import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { createHttpServer } from '../../src/http/server.js';
import type { AppConfig } from '../../src/types/http.js';

const ts = Date.now();
const tpl = `.tmp-http-tpl-${ts}.db`;
const hist = `.tmp-http-hist-${ts}.db`;

let server: any;
const cfg: AppConfig = {
  mode: 'http',
  http: { port: 3010, host: '127.0.0.1', apiKeys: ['k'], cors: { origins: '*', credentials: false }, rateLimit: { max: 100, window: '1m' }, logging: { level: 'error', pretty: false }, session: { timeout: 3600000, cleanupInterval: 300000 } },
  queryAnalyzer: { enabled: true, templatesDbPath: tpl, historyDbPath: hist, historyTtlDays: 30, historyMaxRows: 100, explainTimeoutMs: 5000 },
} as AppConfig;

beforeAll(async () => { server = await createHttpServer(cfg); await server.listen({ port: 3010, host: '127.0.0.1' }); });
afterAll(async () => { await server?.close(); [tpl, hist].forEach(p => { if (existsSync(p)) unlinkSync(p); }); });

describe('HTTP query-experience endpoints', () => {
  it('POST /api/lint returns issues for SELECT *', async () => {
    const res = await server.inject({ method: 'POST', url: '/api/lint', headers: { 'x-api-key': 'k' }, payload: { sql: 'SELECT * FROM t' } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.issues.some((i: any) => i.rule === 'select-star')).toBe(true);
  });

  it('POST /api/templates saves a template', async () => {
    const res = await server.inject({ method: 'POST', url: '/api/templates', headers: { 'x-api-key': 'k' }, payload: { name: 'q1', description: 'd', sql: 'SELECT 1', parameters: [] } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.id).toBeDefined();
  });

  it('GET /api/templates lists', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/templates', headers: { 'x-api-key': 'k' } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.templates.length).toBeGreaterThanOrEqual(1);
  });
});
