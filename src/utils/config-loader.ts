/**
 * Configuration Loader
 * Unified configuration loading from multiple sources with priority:
 * CLI args > Environment variables > Config file > Defaults
 */

import { config as dotenvConfig } from 'dotenv';
import type { AppConfig, HttpConfig } from '../types/http.js';

// Load environment variables from .env file
dotenvConfig();

/**
 * Default HTTP configuration
 */
const DEFAULT_HTTP_CONFIG: HttpConfig = {
  port: 3000,
  host: '0.0.0.0',
  apiKeys: [],
  cors: {
    origins: '*',
    credentials: false,
  },
  rateLimit: {
    max: 100,
    window: '1m',
  },
  logging: {
    level: 'info',
    pretty: false,
  },
  session: {
    timeout: 3600000, // 1 hour
    cleanupInterval: 300000, // 5 minutes
  },
};

/**
 * Parse a positive integer from env. Returns undefined for invalid/empty/zero/negative.
 */
function parsePositiveInt(val: string | undefined): number | undefined {
  if (!val) return undefined;
  const n = parseInt(val, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Load configuration from environment variables
 */
export function loadFromEnv(): Partial<AppConfig> {
  const config: Partial<AppConfig> = {};

  // Mode
  if (process.env.MODE) {
    config.mode = process.env.MODE as 'mcp' | 'http';
  }

  // HTTP configuration
  if (process.env.HTTP_PORT || process.env.HTTP_HOST || process.env.API_KEYS) {
    config.http = {
      ...DEFAULT_HTTP_CONFIG,
      port: process.env.HTTP_PORT ? parseInt(process.env.HTTP_PORT, 10) : DEFAULT_HTTP_CONFIG.port,
      host: process.env.HTTP_HOST || DEFAULT_HTTP_CONFIG.host,
      apiKeys: process.env.API_KEYS ? process.env.API_KEYS.split(',').map(k => k.trim()) : [],
      cors: {
        origins: process.env.CORS_ORIGINS || DEFAULT_HTTP_CONFIG.cors.origins,
        credentials: process.env.CORS_CREDENTIALS === 'true',
      },
      rateLimit: {
        max: process.env.RATE_LIMIT_MAX ? parseInt(process.env.RATE_LIMIT_MAX, 10) : DEFAULT_HTTP_CONFIG.rateLimit.max,
        window: process.env.RATE_LIMIT_WINDOW || DEFAULT_HTTP_CONFIG.rateLimit.window,
      },
      logging: {
        level: (process.env.LOG_LEVEL as any) || DEFAULT_HTTP_CONFIG.logging.level,
        pretty: process.env.LOG_PRETTY === 'true',
      },
      session: {
        timeout: process.env.SESSION_TIMEOUT ? parseInt(process.env.SESSION_TIMEOUT, 10) : DEFAULT_HTTP_CONFIG.session.timeout,
        cleanupInterval: process.env.SESSION_CLEANUP_INTERVAL ? parseInt(process.env.SESSION_CLEANUP_INTERVAL, 10) : DEFAULT_HTTP_CONFIG.session.cleanupInterval,
      },
    };
  }

  // Database configuration (for single-connection mode)
  if (process.env.DB_TYPE) {
    // P1: Parse pool config from env (DB_POOL_SIZE / DB_POOL_MIN / DB_POOL_IDLE_TIMEOUT_MS)
    // Only include the field if at least one of the three is provided, so adapters
    // can fall back to their own defaults when nothing is configured.
    const poolMax = process.env.DB_POOL_SIZE ? parseInt(process.env.DB_POOL_SIZE, 10) : undefined;
    const poolMin = process.env.DB_POOL_MIN ? parseInt(process.env.DB_POOL_MIN, 10) : undefined;
    const poolIdleTimeoutMs = process.env.DB_POOL_IDLE_TIMEOUT_MS
      ? parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS, 10)
      : undefined;
    const hasAnyPoolEnv = poolMax !== undefined || poolMin !== undefined || poolIdleTimeoutMs !== undefined;

    config.database = {
      type: process.env.DB_TYPE as any,
      host: process.env.DB_HOST,
      port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : undefined,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_DATABASE,
      filePath: process.env.DB_FILE_PATH,
      allowWrite: process.env.DB_ALLOW_WRITE === 'true',
      allowedSqlFilePaths: process.env.DB_ALLOWED_FILE_PATHS
        ? process.env.DB_ALLOWED_FILE_PATHS.split(',').map(p => p.trim()).filter(Boolean)
        : undefined,
      poolConfig: hasAnyPoolEnv
        ? {
            max: poolMax,
            min: poolMin,
            idleTimeoutMs: poolIdleTimeoutMs,
          }
        : undefined,
    };
  }

  // P0-1: parse query timeout / slow threshold env vars (top-level config,
  // independent of DB_TYPE so tests and HTTP service-level config work)
  const queryTimeoutMs = parsePositiveInt(process.env.DB_QUERY_TIMEOUT_MS);
  const slowQueryThresholdMs = parsePositiveInt(process.env.DB_SLOW_QUERY_THRESHOLD_MS);
  if (queryTimeoutMs !== undefined) config.queryTimeoutMs = queryTimeoutMs;
  if (slowQueryThresholdMs !== undefined) config.slowQueryThresholdMs = slowQueryThresholdMs;

  // v2.16: observability settings
  const metricsEnabled = process.env.DB_METRICS_ENABLED;
  const metricsIpAllowList = process.env.DB_METRICS_IP_ALLOWLIST;
  const metricsSlowBuffer = process.env.DB_METRICS_SLOW_BUFFER_SIZE;
  if (metricsEnabled !== undefined || metricsIpAllowList !== undefined || metricsSlowBuffer !== undefined) {
    config.metrics = {
      enabled: metricsEnabled === undefined ? true : /^(true|1|yes)$/i.test(metricsEnabled),
      ipAllowList: metricsIpAllowList
        ? metricsIpAllowList.split(',').map(s => s.trim()).filter(Boolean)
        : [],
      slowBufferSize: parseMetricsBufferSize(metricsSlowBuffer, 100),
    };
  }

  return config;
}

function parseMetricsBufferSize(val: string | undefined, def: number): number {
  if (val === undefined) return def;
  const n = parseInt(val, 10);
  if (!Number.isFinite(n) || n < 0) {
    console.warn(`[config] invalid DB_METRICS_SLOW_BUFFER_SIZE: ${val}, using default ${def}`);
    return def;
  }
  return n;
}

/**
 * Merge multiple configuration objects with priority
 */
export function mergeConfigs(...configs: Partial<AppConfig>[]): AppConfig {
  const merged: AppConfig = {
    mode: 'mcp', // Default mode
    metrics: { enabled: true, ipAllowList: [], slowBufferSize: 100 }, // v2.16 default
  };

  for (const config of configs) {
    if (config.mode) {
      merged.mode = config.mode;
    }
    if (config.database) {
      merged.database = { ...merged.database, ...config.database };
    }
    if (config.http) {
      merged.http = { ...merged.http, ...config.http };
    }
    if (config.metrics) {
      merged.metrics = { ...merged.metrics, ...config.metrics };
    }
  }

  // Ensure HTTP config exists if in HTTP mode
  if (merged.mode === 'http' && !merged.http) {
    merged.http = DEFAULT_HTTP_CONFIG;
  }

  return merged;
}

/**
 * Load complete configuration
 */
export function loadConfig(): AppConfig {
  // Load from environment variables
  const envConfig = loadFromEnv();

  // Merge with defaults
  const config = mergeConfigs(
    {
      mode: 'mcp',
      http: DEFAULT_HTTP_CONFIG,
    },
    envConfig
  );

  return config;
}

/**
 * Validate configuration
 */
export function validateConfig(config: AppConfig): void {
  if (config.mode === 'http') {
    if (!config.http) {
      throw new Error('HTTP 模式需要 HTTP 配置');
    }
    if (config.http.apiKeys.length === 0) {
      // Check escape hatch
      if (process.env.ALLOW_INSECURE_NO_AUTH !== 'true') {
        throw new Error(
          '❌ HTTP 模式启动失败:未配置 API Keys。\n' +
          '安全起见,HTTP 模式必须配置至少一个 API Key。\n' +
          '请设置环境变量 API_KEYS=<comma-separated-keys>\n' +
          '或在开发环境设置 ALLOW_INSECURE_NO_AUTH=true(不推荐,会打印强警告)'
        );
      }
      console.error('⚠️⚠️⚠️ 严重安全警告: ALLOW_INSECURE_NO_AUTH=true 已启用,HTTP 模式无认证!');
      console.error('⚠️⚠️⚠️ 任何能访问此端口的人都可以执行任意数据库操作!');
      console.error('⚠️⚠️⚠️ 仅在本地开发或受控网络中使用!');
    }
  }
}
