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
      poolConfig: hasAnyPoolEnv
        ? {
            max: poolMax,
            min: poolMin,
            idleTimeoutMs: poolIdleTimeoutMs,
          }
        : undefined,
    };
  }

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
    config.queryAnalyzer = {
      enabled: qaEnabled === undefined ? true : /^(true|1|yes)$/i.test(qaEnabled),
      templatesDbPath: qaTemplates || undefined,
      historyDbPath: qaHistory || undefined,
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
      profilesDbPath: pmProfilesPath || undefined,
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

  // v3.2: MCP tool lazy-loading
  const lazyEnabled = process.env.DB_LAZY_LOAD_ENABLED;
  const lazyDefaultGroups = process.env.DB_LAZY_DEFAULT_GROUP;
  if (lazyEnabled !== undefined || lazyDefaultGroups !== undefined) {
    const allGroups = ['query-experience', 'profiles', 'data-governance', 'index-advisor'] as const;
    // v3.2.4 Bug #8 fix: when DB_LAZY_LOAD_ENABLED=true and DB_LAZY_DEFAULT_GROUP is unset,
    // default to ALL groups active. Claude Code MCP client doesn't refresh on listChanged
    // notification, so without pre-activating all groups, 25 tools + meta remain invisible.
    // Users who explicitly want opt-in lazy behavior can set DB_LAZY_DEFAULT_GROUP explicitly.
    const defaultGroups: ReadonlyArray<typeof allGroups[number]> = (lazyDefaultGroups ?? '')
      .split(',')
      .map(s => s.trim())
      .filter((s): s is typeof allGroups[number] => allGroups.includes(s as typeof allGroups[number]));
    const activeGroups: Array<typeof allGroups[number]> = defaultGroups.length === 0
      ? (lazyDefaultGroups === undefined ? [...allGroups] : [])  // unset → all active; explicit empty → none
      : [...defaultGroups];
    config.lazyLoad = {
      enabled: lazyEnabled === undefined ? true : /^(true|1|yes)$/i.test(lazyEnabled),
      defaultActiveGroups: activeGroups,
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
    queryAnalyzer: { enabled: true, historyTtlDays: 30, historyMaxRows: 10000, explainTimeoutMs: 10000 }, // v2.17 default
    profileManager: { enabled: true, maxProfiles: 50, defaultRole: 'primary', readRouting: 'round-robin' }, // v2.18 default
    lazyLoad: { enabled: false, defaultActiveGroups: [] }, // v3.2 default: SAFE = disabled (no behavior change from v3.1)
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
    if (config.lazyLoad) {
      merged.lazyLoad = { ...merged.lazyLoad, ...config.lazyLoad };
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
