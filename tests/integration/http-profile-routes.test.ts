import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { createHttpServer } from '../../src/http/server.js';
import type { AppConfig } from '../../src/types/http.js';

const dbPath = `.tmp-http-prof-${Date.now()}-${Math.random()}`;
let server: any;
const cfg: AppConfig = {
  mode: 'http',
  http: { port: 3020, host: '127.0.0.1', apiKeys: ['k'], cors: { origins: '*', credentials: false }, rateLimit: { max: 100, window: '1m' }, logging: { level: 'error', pretty: false }, session: { timeout: 3600000, cleanupInterval: 300000 } },
  profileManager: { enabled: true, profilesDbPath: dbPath, maxProfiles: 50, defaultRole: 'primary', readRouting: 'round-robin' },
} as AppConfig;

beforeAll(async () => { server = await createHttpServer(cfg); await server.listen({ port: 3020, host: '127.0.0.1' }); });
afterAll(async () => { await server?.close(); if (existsSync(dbPath)) unlinkSync(dbPath); });

describe('HTTP profile routes', () => {
  it('POST /api/profiles saves a profile', async () => {
    const res = await server.inject({ method: 'POST', url: '/api/profiles', headers: { 'x-api-key': 'k' }, payload: { name: 'p1', description: 'd', type: 'sqlite', config: { type: 'sqlite', filePath: ':memory:' } } });
    expect(res.statusCode).toBe(200);
  });

  it('GET /api/profiles lists', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/profiles', headers: { 'x-api-key': 'k' } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.profiles.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/global-schema returns view', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/global-schema', headers: { 'x-api-key': 'k' } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.profiles).toBeDefined();
  });

  it('GET /api/profiles/:name 404 for missing', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/profiles/nope', headers: { 'x-api-key': 'k' } });
    expect(res.statusCode).toBe(404);
  });

  it('POST /api/profiles/:name/disable toggles', async () => {
    const res = await server.inject({ method: 'POST', url: '/api/profiles/p1/disable', headers: { 'x-api-key': 'k' } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.enabled).toBe(false);
  });
});