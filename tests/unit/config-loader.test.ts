/**
 * Configuration Loader Unit Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadFromEnv, mergeConfigs } from '../../src/utils/config-loader';

describe('Configuration Loader', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('loadFromEnv', () => {
    it('should load MODE from environment', () => {
      process.env.MODE = 'http';
      const config = loadFromEnv();
      expect(config.mode).toBe('http');
    });

    it('should load HTTP configuration', () => {
      process.env.HTTP_PORT = '8080';
      process.env.HTTP_HOST = '127.0.0.1';
      process.env.API_KEYS = 'key1,key2';

      const config = loadFromEnv();
      expect(config.http?.port).toBe(8080);
      expect(config.http?.host).toBe('127.0.0.1');
      expect(config.http?.apiKeys).toEqual(['key1', 'key2']);
    });

    it('should load database configuration', () => {
      process.env.DB_TYPE = 'mysql';
      process.env.DB_HOST = 'localhost';
      process.env.DB_PORT = '3306';

      const config = loadFromEnv();
      expect(config.database?.type).toBe('mysql');
      expect(config.database?.host).toBe('localhost');
      expect(config.database?.port).toBe(3306);
    });

    it('should load pool config when DB_POOL_* env vars are set', () => {
      process.env.DB_TYPE = 'mysql';
      process.env.DB_HOST = 'localhost';
      process.env.DB_PORT = '3306';
      process.env.DB_POOL_SIZE = '10';
      process.env.DB_POOL_MIN = '2';
      process.env.DB_POOL_IDLE_TIMEOUT_MS = '30000';

      const config = loadFromEnv();
      expect(config.database?.poolConfig).toEqual({
        max: 10,
        min: 2,
        idleTimeoutMs: 30000,
      });
    });

    it('should leave poolConfig undefined when no DB_POOL_* env vars are set', () => {
      process.env.DB_TYPE = 'mysql';
      process.env.DB_HOST = 'localhost';
      process.env.DB_PORT = '3306';
      delete process.env.DB_POOL_SIZE;
      delete process.env.DB_POOL_MIN;
      delete process.env.DB_POOL_IDLE_TIMEOUT_MS;

      const config = loadFromEnv();
      expect(config.database?.poolConfig).toBeUndefined();
    });

    it('should parse partial pool config (only some DB_POOL_* env vars)', () => {
      process.env.DB_TYPE = 'mysql';
      process.env.DB_HOST = 'localhost';
      process.env.DB_PORT = '3306';
      delete process.env.DB_POOL_MIN;
      delete process.env.DB_POOL_IDLE_TIMEOUT_MS;
      process.env.DB_POOL_SIZE = '5';

      const config = loadFromEnv();
      expect(config.database?.poolConfig?.max).toBe(5);
      expect(config.database?.poolConfig?.min).toBeUndefined();
      expect(config.database?.poolConfig?.idleTimeoutMs).toBeUndefined();
    });
  });

  describe('mergeConfigs', () => {
    it('should merge multiple configs with priority', () => {
      const config1 = { mode: 'mcp' as const };
      const config2 = { mode: 'http' as const };

      const merged = mergeConfigs(config1, config2);
      expect(merged.mode).toBe('http');
    });

    it('should merge HTTP configs', () => {
      const config1 = {
        http: {
          port: 3000,
          host: '0.0.0.0',
          apiKeys: ['key1'],
          cors: { origins: '*', credentials: false },
          rateLimit: { max: 100, window: '1m' },
          logging: { level: 'info' as const, pretty: false },
          session: { timeout: 3600000, cleanupInterval: 300000 }
        }
      };
      const config2 = {
        http: {
          port: 8080,
          apiKeys: ['key2']
        }
      };

      const merged = mergeConfigs(config1, config2);
      expect(merged.http?.port).toBe(8080);
      expect(merged.http?.apiKeys).toEqual(['key2']);
    });
  });

  describe('metrics (v2.16)', () => {
    it('mergeConfigs provides default metrics when not configured', () => {
      const merged = mergeConfigs({});
      expect(merged.metrics).toEqual({ enabled: true, ipAllowList: [], slowBufferSize: 100 });
    });

    it('reads DB_METRICS_ENABLED=false', () => {
      process.env.DB_METRICS_ENABLED = 'false';
      const config = loadFromEnv();
      expect(config.metrics?.enabled).toBe(false);
    });

    it('parses DB_METRICS_IP_ALLOWLIST into array', () => {
      process.env.DB_METRICS_IP_ALLOWLIST = '10.0.0.0/8,192.168.1.5';
      const config = loadFromEnv();
      expect(config.metrics?.ipAllowList).toEqual(['10.0.0.0/8', '192.168.1.5']);
    });

    it('warns and falls back to default on invalid slow buffer size', () => {
      process.env.DB_METRICS_SLOW_BUFFER_SIZE = 'not-a-number';
      const config = loadFromEnv();
      expect(config.metrics?.slowBufferSize).toBe(100);
    });

    it('accepts 0 to disable slow query recording', () => {
      process.env.DB_METRICS_SLOW_BUFFER_SIZE = '0';
      const config = loadFromEnv();
      expect(config.metrics?.slowBufferSize).toBe(0);
    });
  });

  describe('queryAnalyzer config (v2.17)', () => {
    it('mergeConfigs provides default queryAnalyzer', () => {
      const merged = mergeConfigs({});
      expect(merged.queryAnalyzer).toEqual({
        enabled: true,
        templatesDbPath: undefined,
        historyDbPath: undefined,
        historyTtlDays: 30,
        historyMaxRows: 10000,
        explainTimeoutMs: 10000,
      });
    });

    it('reads DB_QUERY_ANALYZER_ENABLED=false', () => {
      process.env.DB_QUERY_ANALYZER_ENABLED = 'false';
      const cfg = loadFromEnv();
      expect(cfg.queryAnalyzer?.enabled).toBe(false);
    });

    it('warns and falls back on invalid historyTtlDays', () => {
      process.env.DB_HISTORY_TTL_DAYS = 'abc';
      const cfg = loadFromEnv();
      expect(cfg.queryAnalyzer?.historyTtlDays).toBe(30);
    });
  });

  describe('profileManager config (v2.18)', () => {
    it('mergeConfigs provides default profileManager', () => {
      const merged = mergeConfigs({});
      expect(merged.profileManager).toEqual({
        enabled: true,
        profilesDbPath: undefined,
        maxProfiles: 50,
        defaultRole: 'primary',
        readRouting: 'round-robin',
      });
    });

    it('reads DB_MULTI_DB_ENABLED=false', () => {
      process.env.DB_MULTI_DB_ENABLED = 'false';
      const cfg = loadFromEnv();
      expect(cfg.profileManager?.enabled).toBe(false);
    });

    it('warns and falls back on invalid maxProfiles', () => {
      process.env.DB_PROFILES_MAX = 'abc';
      const cfg = loadFromEnv();
      expect(cfg.profileManager?.maxProfiles).toBe(50);
    });

    it('accepts DB_DEFAULT_PROFILE_ROLE=replica', () => {
      process.env.DB_DEFAULT_PROFILE_ROLE = 'replica';
      const cfg = loadFromEnv();
      expect(cfg.profileManager?.defaultRole).toBe('replica');
    });

    it('falls back to round-robin on invalid DB_READ_ROUTING', () => {
      process.env.DB_READ_ROUTING = 'foo';
      const cfg = loadFromEnv();
      expect(cfg.profileManager?.readRouting).toBe('round-robin');
    });
  });
});
