/**
 * HTTP /metrics Integration Tests (v2.16)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHttpServer } from '../../src/http/server';
import type { AppConfig } from '../../src/types/http';
import { metrics } from '../../src/utils/metrics.js';

let server: any;
let blockedServer: any;
let disabledServer: any;
const baseCfg: AppConfig = {
  mode: 'http',
  http: {
    port: 3002,
    host: '127.0.0.1',
    apiKeys: ['k'],
    cors: { origins: '*', credentials: false },
    rateLimit: { max: 100, window: '1m' },
    logging: { level: 'error', pretty: false },
    session: { timeout: 3600000, cleanupInterval: 300000 },
  },
  metrics: { enabled: true, ipAllowList: [], slowBufferSize: 100 },
} as AppConfig;

beforeAll(async () => {
  server = await createHttpServer(baseCfg);
  await server.listen({ port: baseCfg.http!.port, host: baseCfg.http!.host });

  const blocked: AppConfig = JSON.parse(JSON.stringify(baseCfg));
  blocked.http!.port = 3003;
  blocked.metrics = { enabled: true, ipAllowList: ['10.99.99.0/24'], slowBufferSize: 100 };
  blockedServer = await createHttpServer(blocked);
  await blockedServer.listen({ port: 3003, host: '127.0.0.1' });

  const off: AppConfig = JSON.parse(JSON.stringify(baseCfg));
  off.http!.port = 3004;
  off.metrics = { enabled: false, ipAllowList: [], slowBufferSize: 100 };
  disabledServer = await createHttpServer(off);
  await disabledServer.listen({ port: 3004, host: '127.0.0.1' });
});
afterAll(async () => {
  await server?.close();
  await blockedServer?.close();
  await disabledServer?.close();
});

describe('GET /metrics', () => {
  it('returns 200 + Prometheus text format (bypasses auth)', async () => {
    metrics.counter('probe_hits_total', 'Probe').inc({ route: '/x' });
    const res = await server.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.body).toMatch(/^# HELP probe_hits_total/m);
    expect(res.body).toMatch(/^probe_hits_total\{route="\/x"\} 1$/m);
  });

  it('returns 403 when IP not in allowlist', async () => {
    const res = await blockedServer.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(403);
  });

  it('returns empty body when disabled (still 200)', async () => {
    const res = await disabledServer.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('');
  });
});

describe('/api/health extension (v2.16)', () => {
  it('includes uptime_seconds and active_db', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.status).toBe('healthy');
    expect(typeof body.data.uptime_seconds).toBe('number');
    expect(body.data.uptime_seconds).toBeGreaterThanOrEqual(0);
  });
});
