/**
 * Configuration Loader
 * Unified configuration loading from multiple sources with priority:
 * CLI args > Environment variables > Config file > Defaults
 *
 * v4.2.0: 默认路径改全局 ~/.universal-db-mcp/ — cwd 相对 fallback 已移除
 */

import { config as dotenvConfig } from 'dotenv';
import type { AppConfig, HttpConfig } from '../types/http.js';
import { getProfilesDbPath, getGlobalDir, getProfileDbPath } from './global-paths.js';
import { readProjectProfile } from './path-resolver.js';
import path from 'node:path';

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
 *
 * v4.2.0: 旧版 .mcp.json 凭据 env (DB_TYPE/DB_HOST/DB_USER/DB_PASSWORD/...) 已废弃。
 * 这些 env 静默忽略(不抛错),功能失效。首次启动 stderr 打一行告警。
 * 用 save_profile 管理凭据,use_profile 激活。
 */
const LEGACY_CREDENTIAL_ENV_KEYS = [
  'DB_TYPE',
  'DB_HOST',
  'DB_PORT',
  'DB_USER',
  'DB_PASSWORD',
  'DB_DATABASE',
  'DB_NAME',
  'DB_SERVICE_NAME',
  'DB_SID',
  'DB_FILE_PATH',
  'DB_AUTH_SOURCE',
  'DB_ORACLE_CLIENT_PATH',
  'DB_ALLOW_WRITE',
] as const;

function warnLegacyCredentialsOnce(): void {
  // 单次 stderr 告警(per process)— 用 globalThis 标志避免重复
  const g = globalThis as any;
  if (g.__universal_db_mcp_legacy_warned) return;
  const found = LEGACY_CREDENTIAL_ENV_KEYS.filter((k) => process.env[k] !== undefined);
  if (found.length === 0) return;
  g.__universal_db_mcp_legacy_warned = true;
  console.error(
    `⚠️ 已废弃的凭据 env 被忽略 (${found.join(', ')})。请用 save_profile 管理凭据,use_profile 激活。`,
  );
}

export function loadFromEnv(): Partial<AppConfig> {
  warnLegacyCredentialsOnce();
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

  // v4.2.0: 旧的 single-connection env 配置块已弃用
  // connect_database 工具删除后,DB_TYPE/DB_HOST/... 等 env 无法触发连接(不报错,功能失效)
  // 用户必须用 save_profile 管理凭据。stderr 一次性告警在 warnLegacyCredentialsOnce() 中处理。
  // 保留此分支只为兼容旧 .mcp.json(空值/仅凭据)不让 loadFromEnv 抛错 — 直接跳过。

  // v3.2.8 Bug #34 fix: parse DB_ALLOWED_FILE_PATHS even when DB_TYPE is unset
  // (dynamic connect_database mode). Previously the env var was gated inside the
  // DB_TYPE branch, so users with DB_TYPE="" (e.g. .mcp.json default) couldn't
  // use execute_sql_file even though DB_ALLOWED_FILE_PATHS was set.
  if (process.env.DB_ALLOWED_FILE_PATHS) {
    if (!config.database) {
      config.database = {} as any;
    }
    (config.database as any).allowedSqlFilePaths =
      process.env.DB_ALLOWED_FILE_PATHS.split(',').map(p => p.trim()).filter(Boolean);
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

  // v2.17: query analyzer settings
  const qaEnabled = process.env.DB_QUERY_ANALYZER_ENABLED;
  const qaTemplates = process.env.DB_TEMPLATES_DB_PATH;
  const qaHistory = process.env.DB_HISTORY_DB_PATH;
  const qaTtl = process.env.DB_HISTORY_TTL_DAYS;
  const qaMax = process.env.DB_HISTORY_MAX_ROWS;
  const qaTimeout = process.env.DB_EXPLAIN_TIMEOUT_MS;
  // v2.20: cipher keys for templates.db / history.db (was v2.19 placeholder in profileManager;
  // moved to queryAnalyzer where the stores belong).
  const qaTemplatesKey = process.env.DB_TEMPLATES_DB_KEY;
  const qaHistoryKey = process.env.DB_HISTORY_DB_KEY;
  // v2.20: rotation old key for the same pair.
  const qaTemplatesKeyOld = process.env.DB_TEMPLATES_DB_KEY_OLD;
  const qaHistoryKeyOld = process.env.DB_HISTORY_DB_KEY_OLD;

  // v3.1: PlanHistory db path
  const planHistoryPath = process.env.DB_PLAN_HISTORY_DB_PATH;
  if (
    qaEnabled !== undefined || qaTemplates !== undefined || qaHistory !== undefined ||
    qaTtl !== undefined || qaMax !== undefined || qaTimeout !== undefined ||
    qaTemplatesKey !== undefined || qaHistoryKey !== undefined ||
    qaTemplatesKeyOld !== undefined || qaHistoryKeyOld !== undefined
  ) {
    // v5.0.0: 路径解析流程
    //   1. 启动时读 <cwd>/.db-profile 找 active profile(优先 — 和 mcp-server 用同一份)
//   2. 没有 .db-profile → 用根目录 templates.db / history.db 作 fallback(单文件,
//      profile_name 字段区分;用户首次 use_profile 后会被覆盖)
//   3. 有 .db-profile → 用 getProfileDbPath(activeProfile, kind) — 每个 profile
//      独立 subdir,delete_profile 时子目录一并清理
    const projectProfile = readProjectProfile(process.cwd());
    const activeProfile = projectProfile?.profile ?? null;
    const defaultTemplatesPath = activeProfile
      ? getProfileDbPath(activeProfile, 'templates')
      : path.join(getGlobalDir(), 'templates.db');
    const defaultHistoryPath = activeProfile
      ? getProfileDbPath(activeProfile, 'history')
      : path.join(getGlobalDir(), 'history.db');
    config.queryAnalyzer = {
      enabled: qaEnabled === undefined ? true : /^(true|1|yes)$/i.test(qaEnabled),
      templatesDbPath: qaTemplates || defaultTemplatesPath,
      historyDbPath: qaHistory || defaultHistoryPath,
      historyTtlDays: parsePositiveInt(qaTtl) ?? 30,
      historyMaxRows: parsePositiveInt(qaMax) ?? 10000,
      explainTimeoutMs: parsePositiveInt(qaTimeout) ?? 10000,
      // v2.20: empty string → undefined (fallback plaintext)
      templatesCipherKey: qaTemplatesKey ? qaTemplatesKey : undefined,
      historyCipherKey: qaHistoryKey ? qaHistoryKey : undefined,
      templatesCipherKeyOld: qaTemplatesKeyOld ? qaTemplatesKeyOld : undefined,
      historyCipherKeyOld: qaHistoryKeyOld ? qaHistoryKeyOld : undefined,
    };
  }

  // v2.18: multi-DB profile manager
  const pmEnabled = process.env.DB_MULTI_DB_ENABLED;
  const pmProfilesPath = process.env.DB_PROFILES_DB_PATH;
  const pmMax = process.env.DB_PROFILES_MAX;
  const pmDefaultRole = process.env.DB_DEFAULT_PROFILE_ROLE;
  const pmReadRouting = process.env.DB_READ_ROUTING;
  // v2.19: cipher key for profiles.db. v2.20: rotation env (DB_PROFILE_ENCRYPTION_KEY_OLD).
  const pmCipherKey = process.env.DB_PROFILE_ENCRYPTION_KEY;
  const pmCipherKeyOld = process.env.DB_PROFILE_ENCRYPTION_KEY_OLD;
  if (
    pmEnabled !== undefined || pmProfilesPath !== undefined || pmMax !== undefined ||
    pmDefaultRole !== undefined || pmReadRouting !== undefined ||
    pmCipherKey !== undefined || pmCipherKeyOld !== undefined
  ) {
    config.profileManager = {
      enabled: pmEnabled === undefined ? true : /^(true|1|yes)$/i.test(pmEnabled),
      profilesDbPath: pmProfilesPath || getProfilesDbPath(),
      maxProfiles: parsePositiveInt(pmMax) ?? 50,
      defaultRole: ['primary', 'replica', 'analytics'].includes(pmDefaultRole ?? '') ? (pmDefaultRole as 'primary' | 'replica' | 'analytics') : 'primary',
      readRouting: ['round-robin', 'random', 'least-loaded'].includes(pmReadRouting ?? '') ? (pmReadRouting as 'round-robin' | 'random' | 'least-loaded') : 'round-robin',
      // v2.19: empty string → undefined (fallback plaintext)
      cipherKey: pmCipherKey ? pmCipherKey : undefined,
      // v2.20: rotation — old key still valid alongside new key for one startup cycle
      cipherKeyOld: pmCipherKeyOld ? pmCipherKeyOld : undefined,
    };
  }

  // v3.1: standalone plan_history.db path
  if (planHistoryPath) {
    (config as any).planHistoryPath = planHistoryPath;
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
    queryAnalyzer: { enabled: true, historyTtlDays: 30, historyMaxRows: 10000, explainTimeoutMs: 10000 }, // v2.17 default
    profileManager: { enabled: true, maxProfiles: 50, defaultRole: 'primary', readRouting: 'round-robin' }, // v2.18 default
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
    if (config.queryAnalyzer) {
      merged.queryAnalyzer = { ...merged.queryAnalyzer, ...config.queryAnalyzer };
    }
    if (config.profileManager) {
      merged.profileManager = { ...merged.profileManager, ...config.profileManager };
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
