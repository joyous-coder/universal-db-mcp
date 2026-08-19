/**
 * Adapter Factory - Centralized database adapter creation
 * Extracts adapter creation logic for reuse across MCP and HTTP modes
 */

import type { DbAdapter, DbConfig } from '../types/adapter.js';
import { MySQLAdapter } from '../adapters/mysql.js';
import { PostgreSQLAdapter } from '../adapters/postgres.js';
import { RedisAdapter } from '../adapters/redis.js';
import { OracleAdapter } from '../adapters/oracle.js';
import { DMAdapter } from '../adapters/dm.js';
import { SQLServerAdapter } from '../adapters/sqlserver.js';
import { MongoDBAdapter } from '../adapters/mongodb.js';
import { SQLiteAdapter } from '../adapters/sqlite/index.js';
import { KingbaseAdapter } from '../adapters/kingbase.js';
import { GaussDBAdapter } from '../adapters/gaussdb.js';
import { OceanBaseAdapter } from '../adapters/oceanbase.js';
import { TiDBAdapter } from '../adapters/tidb.js';
import { ClickHouseAdapter } from '../adapters/clickhouse.js';
import { PolarDBAdapter } from '../adapters/polardb.js';
import { VastbaseAdapter } from '../adapters/vastbase.js';
import { HighGoAdapter } from '../adapters/highgo.js';
import { GoldenDBAdapter } from '../adapters/goldendb.js';

/**
 * Supported database types
 */
export type DbType =
  | 'mysql'
  | 'postgres'
  | 'redis'
  | 'oracle'
  | 'dm'
  | 'sqlserver'
  | 'mongodb'
  | 'sqlite'
  | 'kingbase'
  | 'gaussdb'
  | 'oceanbase'
  | 'tidb'
  | 'clickhouse'
  | 'polardb'
  | 'vastbase'
  | 'highgo'
  | 'goldendb';

/**
 * Normalize database type aliases to canonical names
 */
export function normalizeDbType(type: string): DbType {
  const normalized = type.toLowerCase();

  // Handle aliases
  if (normalized === 'mssql') {
    return 'sqlserver';
  }
  if (normalized === 'opengauss') {
    return 'gaussdb';
  }

  // Validate type
  const validTypes: DbType[] = [
    'mysql',
    'postgres',
    'redis',
    'oracle',
    'dm',
    'sqlserver',
    'mongodb',
    'sqlite',
    'kingbase',
    'gaussdb',
    'oceanbase',
    'tidb',
    'clickhouse',
    'polardb',
    'vastbase',
    'highgo',
    'goldendb',
  ];

  if (!validTypes.includes(normalized as DbType)) {
    throw new Error(
      `不支持的数据库类型: ${type}。支持的类型: ${validTypes.join(', ')}`
    );
  }

  return normalized as DbType;
}

/**
 * Validate database configuration
 */
export function validateDbConfig(config: DbConfig): void {
  // Normalize type
  const dbType = normalizeDbType(config.type);

  // SQLite special validation
  if (dbType === 'sqlite') {
    if (!config.filePath) {
      throw new Error('SQLite 数据库需要指定 filePath 参数');
    }
    return;
  }

  // Other databases need host and port
  if (!config.host || !config.port) {
    throw new Error(`${dbType} 数据库需要指定 host 和 port 参数`);
  }
}

/**
 * Create database adapter based on configuration
 */
export function createAdapter(config: DbConfig): DbAdapter {
  // Validate configuration
  validateDbConfig(config);

  // Normalize type
  const dbType = normalizeDbType(config.type);

  // Create adapter based on type
  // v5.0.1: 在 config 里注入 type 字段(除了 SQLite adapter 自己在 constructor 注入,
  // 这里给所有 adapter 统一注入)。下游(如 csv-tools.ts rejectNoSql) 需要靠
  // adapter.config.type 识别 NoSQL,Redis/MySQL/Postgres 之前没注入导致 N9 guard 失效。
  const normalizedConfig = { ...config, type: dbType };
  const adapter = ((): DbAdapter => {
  switch (dbType) {
    case 'mysql':
      return new MySQLAdapter({
        host: normalizedConfig.host!,
        port: normalizedConfig.port!,
        user: normalizedConfig.user,
        password: normalizedConfig.password,
        database: normalizedConfig.database,
        poolConfig: normalizedConfig.poolConfig,
      });

    case 'postgres':
      return new PostgreSQLAdapter({
        host: normalizedConfig.host!,
        port: normalizedConfig.port!,
        user: normalizedConfig.user,
        password: normalizedConfig.password,
        database: normalizedConfig.database,
        poolConfig: normalizedConfig.poolConfig,
      });

    case 'redis':
      return new RedisAdapter({
        host: normalizedConfig.host!,
        port: normalizedConfig.port!,
        password: normalizedConfig.password,
        database: normalizedConfig.database,
      });

    case 'oracle':
      return new OracleAdapter({
        host: normalizedConfig.host!,
        port: normalizedConfig.port!,
        user: normalizedConfig.user,
        password: normalizedConfig.password,
        database: normalizedConfig.database,
        oracleClientPath: normalizedConfig.oracleClientPath,
        poolConfig: normalizedConfig.poolConfig,
      });

    case 'dm':
      return new DMAdapter({
        host: normalizedConfig.host!,
        port: normalizedConfig.port!,
        user: normalizedConfig.user,
        password: normalizedConfig.password,
        database: normalizedConfig.database,
        poolConfig: normalizedConfig.poolConfig,
      });

    case 'sqlserver':
      return new SQLServerAdapter({
        host: normalizedConfig.host!,
        port: normalizedConfig.port!,
        user: normalizedConfig.user,
        password: normalizedConfig.password,
        database: normalizedConfig.database,
        poolConfig: normalizedConfig.poolConfig,
      });

    case 'mongodb':
      return new MongoDBAdapter({
        host: normalizedConfig.host!,
        port: normalizedConfig.port!,
        user: normalizedConfig.user,
        password: normalizedConfig.password,
        database: normalizedConfig.database,
        authSource: (normalizedConfig as any).authSource,
      });

    case 'sqlite':
      return new SQLiteAdapter({
        filePath: normalizedConfig.filePath!,
        readonly: !normalizedConfig.allowWrite,
      });

    case 'kingbase':
      return new KingbaseAdapter({
        host: config.host!,
        port: config.port!,
        user: config.user,
        password: config.password,
        database: config.database,
        poolConfig: config.poolConfig,
      });

    case 'gaussdb':
      return new GaussDBAdapter({
        host: config.host!,
        port: config.port!,
        user: config.user,
        password: config.password,
        database: config.database,
        poolConfig: config.poolConfig,
      });

    case 'oceanbase':
      return new OceanBaseAdapter({
        host: config.host!,
        port: config.port!,
        user: config.user,
        password: config.password,
        database: config.database,
        poolConfig: config.poolConfig,
      });

    case 'tidb':
      return new TiDBAdapter({
        host: config.host!,
        port: config.port!,
        user: config.user,
        password: config.password,
        database: config.database,
        poolConfig: config.poolConfig,
      });

    case 'clickhouse':
      return new ClickHouseAdapter({
        host: config.host!,
        port: config.port!,
        user: config.user,
        password: config.password,
        database: config.database,
      });

    case 'polardb':
      return new PolarDBAdapter({
        host: config.host!,
        port: config.port!,
        user: config.user,
        password: config.password,
        database: config.database,
        poolConfig: config.poolConfig,
      });

    case 'vastbase':
      return new VastbaseAdapter({
        host: config.host!,
        port: config.port!,
        user: config.user,
        password: config.password,
        database: config.database,
        poolConfig: config.poolConfig,
      });

    case 'highgo':
      return new HighGoAdapter({
        host: config.host!,
        port: config.port!,
        user: config.user,
        password: config.password,
        database: config.database,
        poolConfig: config.poolConfig,
      });

    case 'goldendb':
      return new GoldenDBAdapter({
        host: config.host!,
        port: config.port!,
        user: config.user,
        password: config.password,
        database: config.database,
        poolConfig: config.poolConfig,
      });

    default:
      throw new Error(`不支持的数据库类型: ${dbType}`);
  }
  })();
  // v5.0.1: 给所有 adapter 的 config 注入 type(SQLite 在 constructor 已注入,其他 adapter 需要后置)。
  // 下游 (csv-tools rejectNoSql, csv-reader null guard 等) 都靠 adapter.config.type 识别。
  (adapter as any).config = { ...((adapter as any).config ?? {}), type: dbType };
  return adapter;
}
