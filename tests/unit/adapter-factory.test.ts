/**
 * Adapter Factory Unit Tests
 */

import { describe, it, expect } from 'vitest';
import { createAdapter, normalizeDbType, validateDbConfig } from '../../src/utils/adapter-factory';
import type { DbConfig } from '../../src/types/adapter';

describe('Adapter Factory', () => {
  describe('normalizeDbType', () => {
    it('should normalize mssql to sqlserver', () => {
      expect(normalizeDbType('mssql')).toBe('sqlserver');
    });

    it('should normalize opengauss to gaussdb', () => {
      expect(normalizeDbType('opengauss')).toBe('gaussdb');
    });

    it('should keep valid types unchanged', () => {
      expect(normalizeDbType('mysql')).toBe('mysql');
      expect(normalizeDbType('postgres')).toBe('postgres');
    });

    it('should throw error for invalid types', () => {
      expect(() => normalizeDbType('invalid')).toThrow();
    });
  });

  describe('validateDbConfig', () => {
    it('should validate SQLite config', () => {
      const config: DbConfig = {
        type: 'sqlite',
        filePath: '/path/to/db.sqlite'
      };
      expect(() => validateDbConfig(config)).not.toThrow();
    });

    it('should throw error for SQLite without filePath', () => {
      const config: DbConfig = {
        type: 'sqlite'
      };
      expect(() => validateDbConfig(config)).toThrow('filePath');
    });

    it('should validate MySQL config', () => {
      const config: DbConfig = {
        type: 'mysql',
        host: 'localhost',
        port: 3306
      };
      expect(() => validateDbConfig(config)).not.toThrow();
    });

    it('should throw error for MySQL without host/port', () => {
      const config: DbConfig = {
        type: 'mysql'
      };
      expect(() => validateDbConfig(config)).toThrow();
    });
  });

  describe('createAdapter', () => {
    it('should create MySQL adapter', () => {
      const config: DbConfig = {
        type: 'mysql',
        host: 'localhost',
        port: 3306,
        user: 'root',
        password: 'password',
        database: 'test'
      };
      const adapter = createAdapter(config);
      expect(adapter).toBeDefined();
    });

    it('should create PostgreSQL adapter', () => {
      const config: DbConfig = {
        type: 'postgres',
        host: 'localhost',
        port: 5432,
        user: 'postgres',
        password: 'password',
        database: 'test'
      };
      const adapter = createAdapter(config);
      expect(adapter).toBeDefined();
    });

    it('should pass poolConfig through to MySQL adapter', () => {
      const config: DbConfig = {
        type: 'mysql',
        host: 'localhost',
        port: 3306,
        poolConfig: { max: 10, min: 2, idleTimeoutMs: 30000 },
      };
      const adapter = createAdapter(config) as any;
      expect(adapter.config.poolConfig).toEqual({
        max: 10,
        min: 2,
        idleTimeoutMs: 30000,
      });
    });

    it('should pass poolConfig through to PostgreSQL adapter', () => {
      const config: DbConfig = {
        type: 'postgres',
        host: 'localhost',
        port: 5432,
        poolConfig: { max: 10, min: 2, idleTimeoutMs: 30000 },
      };
      const adapter = createAdapter(config) as any;
      expect(adapter.config.poolConfig).toEqual({
        max: 10,
        min: 2,
        idleTimeoutMs: 30000,
      });
    });

    it('should pass poolConfig through to Oracle adapter', () => {
      const config: DbConfig = {
        type: 'oracle',
        host: 'localhost',
        port: 1521,
        poolConfig: { max: 8, min: 2, idleTimeoutMs: 45000 },
      };
      const adapter = createAdapter(config) as any;
      expect(adapter.config.poolConfig).toEqual({
        max: 8,
        min: 2,
        idleTimeoutMs: 45000,
      });
    });

    it('should pass poolConfig through to all PG-compatible adapters', () => {
      const pgLikeTypes = ['kingbase', 'gaussdb', 'vastbase', 'highgo'] as const;
      for (const t of pgLikeTypes) {
        const config: DbConfig = {
          type: t,
          host: 'localhost',
          port: 5432,
          poolConfig: { max: 7, min: 1, idleTimeoutMs: 60000 },
        };
        const adapter = createAdapter(config) as any;
        expect(adapter.config.poolConfig?.max).toBe(7);
        expect(adapter.config.poolConfig?.min).toBe(1);
        expect(adapter.config.poolConfig?.idleTimeoutMs).toBe(60000);
      }
    });

    it('should pass poolConfig through to all MySQL-compatible adapters', () => {
      const mysqlLikeTypes = ['tidb', 'oceanbase', 'polardb', 'goldendb'] as const;
      for (const t of mysqlLikeTypes) {
        const config: DbConfig = {
          type: t,
          host: 'localhost',
          port: 3306,
          poolConfig: { max: 7, min: 1, idleTimeoutMs: 60000 },
        };
        const adapter = createAdapter(config) as any;
        expect(adapter.config.poolConfig?.max).toBe(7);
        expect(adapter.config.poolConfig?.min).toBe(1);
        expect(adapter.config.poolConfig?.idleTimeoutMs).toBe(60000);
      }
    });

    it('should pass poolConfig through to SQL Server adapter', () => {
      const config: DbConfig = {
        type: 'sqlserver',
        host: 'localhost',
        port: 1433,
        poolConfig: { max: 20, min: 2, idleTimeoutMs: 60000 },
      };
      const adapter = createAdapter(config) as any;
      expect(adapter.config.poolConfig?.max).toBe(20);
      expect(adapter.config.poolConfig?.idleTimeoutMs).toBe(60000);
    });

    it('should pass poolConfig through to DM adapter', () => {
      const config: DbConfig = {
        type: 'dm',
        host: 'localhost',
        port: 5236,
        poolConfig: { max: 5, min: 1, idleTimeoutMs: 60000 },
      };
      const adapter = createAdapter(config) as any;
      expect(adapter.config.poolConfig?.max).toBe(5);
      expect(adapter.config.poolConfig?.idleTimeoutMs).toBe(60000);
    });

    it('should NOT pass poolConfig to adapters that use different models (SQLite, MongoDB, Redis, ClickHouse)', () => {
      const noPoolTypes = [
        { type: 'sqlite', config: { type: 'sqlite', filePath: '/tmp/test.db' } as DbConfig },
        { type: 'mongodb', config: { type: 'mongodb', host: 'localhost', port: 27017 } as DbConfig },
        { type: 'redis', config: { type: 'redis', host: 'localhost', port: 6379 } as DbConfig },
        { type: 'clickhouse', config: { type: 'clickhouse', host: 'localhost', port: 8123 } as DbConfig },
      ];
      for (const { type, config } of noPoolTypes) {
        const adapter = createAdapter({ ...config, poolConfig: { max: 99 } } as DbConfig) as any;
        // SQLite adapter doesn't have poolConfig field at all
        if (type === 'sqlite') {
          expect(adapter.config.poolConfig).toBeUndefined();
        } else {
          // Other adapters receive the field but their connect() ignores it
          // (we just verify the factory call doesn't throw)
          expect(adapter).toBeDefined();
        }
      }
    });

    it('should accept undefined poolConfig (uses adapter defaults)', () => {
      const config: DbConfig = {
        type: 'mysql',
        host: 'localhost',
        port: 3306,
      };
      const adapter = createAdapter(config) as any;
      expect(adapter.config.poolConfig).toBeUndefined();
    });
  });
});
