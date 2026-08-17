#!/usr/bin/env node

/**
 * MCP 数据库万能连接器 - 主服务器
 * 通过 Model Context Protocol 让 Claude Desktop 连接数据库
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  InitializeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { DbAdapter, DbConfig } from '../types/adapter.js';
import type { AppConfig } from '../types/http.js';
import { DatabaseService, SchemaCacheConfig } from '../core/database-service.js';
import { createAdapter, normalizeDbType } from '../utils/adapter-factory.js';
import { resolvePermissions } from '../utils/safety.js';
// v4.0 G1: ToolRegistry + buildToolRegistry deleted
import { buildInstructions } from './instructions.js';
// (Header note: tooling above is intentionally explicit — keep)
import { buildGetMetricsHandler, GET_METRICS_TOOL_DESCRIPTION, type MetricsCategory } from './tools/metrics.js';
import {
  buildExplainQueryHandler,
  buildLintSqlHandler,
  buildGetQueryHistoryHandler,
  buildSaveTemplateHandler,
  buildListTemplatesHandler,
  buildGetTemplateHandler,
  buildDeleteTemplateHandler,
  buildExecuteTemplateHandler,
  TOOL_DESCRIPTIONS,
} from './tools/query-tools.js';
import {
  buildSaveProfileHandler,
  buildListProfilesHandler,
  buildUseProfileHandler,
  buildGetGlobalSchemaHandler,
  PROFILE_TOOL_DESCRIPTIONS,
} from './tools/profile-tools.js';
import type { QueryAnalyzer } from '../core/query-analyzer.js';
import type { ProfileManager } from '../core/profile-manager.js';

/**
 * 数据库 MCP 服务器类
 */
export class DatabaseMCPServer {
  private server: Server;
  private adapter: DbAdapter | null = null;
  private config: DbConfig | null;
  private databaseService: DatabaseService | null = null;
  private cacheConfig: Partial<SchemaCacheConfig>;
  // v2.16: app-level config (for metrics settings, etc.); set via setAppConfig
  private appConfig: AppConfig | null = null;
  // v2.17: query analyzer (optional); set via setQueryAnalyzer
  private queryAnalyzer: QueryAnalyzer | null = null;
  // v2.18: profile manager (optional); set via setProfileManager
  private profileManager: ProfileManager | null = null;
  // v2.18: name of the active profile (set via use_profile or connect_database)
  private activeProfile: string | null = null;
  // v3.2: MCP tool registry for lazy-loading (built when queryAnalyzer + profileManager are set)
  // v4.0 G1: toolRegistry + rebuildToolRegistry deleted (no lazy load)
  // v4.0 G3: sessionClientInfo + currentSessionId + setSessionId removed (no longer needed)
  // v3.1: PlanHistory instance (set via setPlanHistory from entrypoint)
  private planHistory: any = null;

  constructor(config?: DbConfig, cacheConfig?: Partial<SchemaCacheConfig>) {
    this.config = config || null;
    this.cacheConfig = cacheConfig || {};
    this.server = new Server(
      {
        name: 'universal-db-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          // v4.0 G4: tools.listChanged removed. All tools are always visible,
          // no notifications needed (deferred tool search handles lazy schema).
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  /**
   * v2.16: set app-level config (for metrics, etc.). Optional; defaults are used if not set.
   */
  setAppConfig(appConfig: AppConfig): void {
    this.appConfig = appConfig;
  }

  /**
   * v2.17: set the QueryAnalyzer. Optional; when not set, query-experience tools
   * will return a "queryAnalyzer disabled" error.
   */
  setQueryAnalyzer(qa: QueryAnalyzer | null): void {
    this.queryAnalyzer = qa;

  }

  /**
   * v2.18: set the ProfileManager. Optional; when not set, profile tools
   * return a "profileManager not configured" error.
   */
  setProfileManager(pm: ProfileManager | null): void {
    this.profileManager = pm;

  }

  /**
   * v3.1: set the PlanHistory (optional). When set, index-advisor tools
   * (explain_query_with_advice, compare_query_plans, list_query_plans) become available.
   */
  setPlanHistory(ph: any): void {
    this.planHistory = ph;

  }

  /**
   * v3.2: configure all optional dependencies from a loaded AppConfig.
   * Constructs and wires QueryAnalyzer, ProfileManager, PlanHistory when their
   * respective env flags are enabled. Idempotent — safe to call multiple times.
   */
  async configureFromAppConfig(appConfig: AppConfig): Promise<void> {
    this.appConfig = appConfig;

    // v4.0 G5: lazy-load opt-in removed (AppConfig.lazyLoad deleted in http.ts)

    // v2.17: QueryAnalyzer (explain/lint/history/templates)
    if (appConfig.queryAnalyzer?.enabled) {
      const { QueryAnalyzer } = await import('../core/query-analyzer.js');
      this.queryAnalyzer = new QueryAnalyzer({
        enabled: true,
        templatesDbPath: appConfig.queryAnalyzer.templatesDbPath ?? 'templates.db',
        historyDbPath: appConfig.queryAnalyzer.historyDbPath ?? 'history.db',
        historyTtlDays: appConfig.queryAnalyzer.historyTtlDays,
        historyMaxRows: appConfig.queryAnalyzer.historyMaxRows,
        explainTimeoutMs: appConfig.queryAnalyzer.explainTimeoutMs,
        templatesCipherKey: appConfig.queryAnalyzer.templatesCipherKey,
        historyCipherKey: appConfig.queryAnalyzer.historyCipherKey,
        templatesCipherKeyOld: appConfig.queryAnalyzer.templatesCipherKeyOld,
        historyCipherKeyOld: appConfig.queryAnalyzer.historyCipherKeyOld,
      });
    }

    // v2.18: ProfileManager
    if (appConfig.profileManager?.enabled) {
      const { ProfileManager } = await import('../core/profile-manager.js');
      const pm = new ProfileManager({
        enabled: true,
        profilesDbPath: appConfig.profileManager.profilesDbPath ?? 'profiles.db',
        maxProfiles: appConfig.profileManager.maxProfiles,
        defaultRole: appConfig.profileManager.defaultRole,
        readRouting: appConfig.profileManager.readRouting,
        cipherKey: appConfig.profileManager.cipherKey,
        cipherKeyOld: appConfig.profileManager.cipherKeyOld,
      });
      // Wire QueryAnalyzer → ProfileManager so routeQuery records history
      if (this.queryAnalyzer) pm.setQueryAnalyzer(this.queryAnalyzer);
      this.profileManager = pm;
    }

    // v3.1: PlanHistory
    try {
      const path = (appConfig as any).planHistoryPath ?? process.env.DB_PLAN_HISTORY_DB_PATH;
      if (path) {
        const { PlanHistory } = await import('../core/plan-history.js');
        this.planHistory = new PlanHistory({
          dbPath: path,
        });
      }
    } catch {
      // PlanHistory is best-effort; missing native deps shouldn't block startup
    }


  }

  /** v2.18: get the active profile name (null if none). */
  getActiveProfile(): string | null {
    return this.activeProfile;
  }

  // v4.0 G5: setLazyLoadEnabled() removed
  // (setSessionId moved below)

  /**
   * v3.2: set the current MCP session id. stdio uses 'stdio-default'; SSE/Streamable HTTP
   * sets this from the transport's sessionId (in mcp-sse.ts).
   */
  setSessionId(id: string): void {
    void id; // v4.0 G3: deprecated (was for per-session lazy registry); kept for API compat
  }

  /**
   * v3.3.1: detect Claude Code client by clientInfo.name. Claude Code reports
   * names like "claude-code", "Claude Code", "claude-code-ai", depending on
   * version. We match case-insensitively on the substring "claude-code".
   * This is the heuristic the user agreed to in v3.3.1 brainstorming.
   */
  // v4.0 G3: Claude Code detection removed — all clients get identical behavior

// v4.0 G1: rebuildToolRegistry() is now a no-op; will be deleted in Task 8
  // v4.0 G1: rebuildToolRegistry deleted (no lazy load)

  /**
   * v3.2: handle use_tool_group meta-tool — REMOVED in v4.0 (G4)
   * v3.2: handle use_tool_schema meta-tool — REMOVED in v4.0 (G2)
   */
// (deleted)

// v4.0 G1, G2: lazyToolErrorResponse, validationErrorResponse, getStatefulToolsForList
// all removed (their only callers were in the lazy-load branches that no longer execute)

  /**
   * 设置 MCP 协议处理器
   */
  private setupHandlers(): void {
    // v3.3.2: capture clientInfo from initialize request.
    // We OVERRIDE the SDK's default handler so we can capture clientInfo
    // BEFORE delegating to the SDK's _oninitialize. The SDK's default handler
    // is set in Server constructor; we replace it here. This is the only
    // way to reliably read clientInfo — `oninitialized` fires AFTER initialize
    // but reads return undefined (timing issue with private field).
    this.server.setRequestHandler(InitializeRequestSchema, async (request) => {
      // v4.0 G3: simplified — no Claude Code detection, no sessionClientInfo tracking
      // v4.0 G8: inject instructions for deferred tool search
      const result = await (this.server as any)._oninitialize(request);
      return { ...result, instructions: buildInstructions() };
    });

    // 列出可用工具
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      // v4.0 G1, G6: lazy-load branch removed. Task 9 will rewrite ListTools to single path.
      // (treatAsLazyDisabled kept as compatibility for now)
      // (v4.0 G1: lazy-load branch removed — no toolRegistry)
      // v3.1 behavior (unchanged): all tools always listed
      // Compute permissions for tool registration gating
      const resolvedPerms = this.config ? resolvePermissions(this.config) : ['read'];
      const tools: any[] = [
        {
          name: 'execute_query',
          description: '执行 SQL 查询或数据库命令。支持 SELECT、JOIN、聚合等查询操作。如果启用了写入模式，也可以执行 INSERT、UPDATE、DELETE 等操作。',
            inputSchema: {
              type: 'object',
              properties: {
                sql: {
                  type: 'string',
                  description: '要执行的 SQL 语句或数据库命令',
                },
                params: {
                  type: 'array',
                  description: '查询参数（可选，用于参数化查询防止 SQL 注入）',
                  items: {
                    type: 'string',
                  },
                },
              },
              required: ['query'],
            },
          },
          {
            name: 'get_schema',
            description: '获取数据库结构信息，包括所有 Schema 中用户可访问的表名、列名、数据类型、主键、索引等元数据。在执行查询前调用此工具可以帮助理解数据库结构。结果会被缓存以提高性能。',
            inputSchema: {
              type: 'object',
              properties: {
                forceRefresh: {
                  type: 'boolean',
                  description: '是否强制刷新缓存（可选，默认 false）。设为 true 可获取最新的数据库结构。',
                },
              },
            },
          },
          {
            name: 'get_table_info',
            description: '获取指定表的详细信息，包括列定义、索引、预估行数等。用于深入了解某个表的结构。',
            inputSchema: {
              type: 'object',
              properties: {
                tableName: {
                  type: 'string',
                  description: '表名。支持 schema.table_name 格式指定 Schema（如 analytics.users）。不指定 Schema 时查询默认 Schema。',
                },
                forceRefresh: {
                  type: 'boolean',
                  description: '是否强制刷新缓存（可选，默认 false）',
                },
              },
              required: ['tableName'],
            },
          },
          {
            name: 'clear_cache',
            description: '清除 Schema 缓存。当数据库结构发生变化（如新增表、修改列）时，可以调用此工具清除缓存。',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'get_enum_values',
            description: '获取指定列的所有唯一值。用于了解 status、type、category 等枚举类型列的所有可能值，帮助生成准确的 WHERE 条件。例如：获取 orders.status 列的所有状态值（pending, shipped, delivered 等）。',
            inputSchema: {
              type: 'object',
              properties: {
                tableName: {
                  type: 'string',
                  description: '表名。支持 schema.table_name 格式指定 Schema（如 analytics.users）。',
                },
                columnName: {
                  type: 'string',
                  description: '列名（通常是 status、type、category 等枚举类型的列）',
                },
                limit: {
                  type: 'number',
                  description: '最大返回数量（可选，默认 50，最大 100）。如果唯一值超过此数量，说明该列可能不是枚举类型。',
                },
                includeCount: {
                  type: 'boolean',
                  description: '是否包含每个值的出现次数（可选，默认 false）。设为 true 可了解数据分布。',
                },
              },
              required: ['tableName', 'columnName'],
            },
          },
          {
            name: 'get_sample_data',
            description: '获取表的示例数据（已自动脱敏）。用于了解数据格式，如日期格式（2024-01-01 vs 20240101）、ID格式（UUID vs 自增）、金额精度等。敏感数据（手机号、邮箱、身份证等）会自动脱敏保护隐私。',
            inputSchema: {
              type: 'object',
              properties: {
                tableName: {
                  type: 'string',
                  description: '表名。支持 schema.table_name 格式指定 Schema（如 analytics.users）。',
                },
                columns: {
                  type: 'array',
                  items: { type: 'string' },
                  description: '要查看的列（可选，默认全部列）',
                },
                limit: {
                  type: 'number',
                  description: '返回行数（可选，默认 3，最大 10）',
                },
              },
              required: ['tableName'],
            },
          },
          {
            name: 'connect_database',
            description: '连接到数据库。支持动态指定数据库类型和连接参数，无需重启服务。如果当前已有连接，会自动断开旧连接再建立新连接。支持的数据库类型：mysql, postgres, redis, oracle, dm, sqlserver, mongodb, sqlite, kingbase, gaussdb, oceanbase, tidb, clickhouse, polardb, vastbase, highgo, goldendb。',
            inputSchema: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  description: '数据库类型',
                  enum: [
                    'mysql', 'postgres', 'redis', 'oracle', 'dm', 'sqlserver',
                    'mongodb', 'sqlite', 'kingbase', 'gaussdb', 'oceanbase',
                    'tidb', 'clickhouse', 'polardb', 'vastbase', 'highgo', 'goldendb',
                  ],
                },
                host: { type: 'string', description: '数据库主机地址' },
                port: { type: 'number', description: '数据库端口' },
                user: { type: 'string', description: '用户名' },
                password: { type: 'string', description: '密码' },
                database: { type: 'string', description: '数据库名称' },
                filePath: { type: 'string', description: 'SQLite 数据库文件路径' },
                allowWrite: { type: 'boolean', description: '是否允许写操作（默认 false）' },
                permissionMode: {
                  type: 'string',
                  description: '权限模式: safe(只读) | readwrite(读写不删) | full(完全控制)',
                  enum: ['safe', 'readwrite', 'full'],
                },
                authSource: { type: 'string', description: 'MongoDB 认证数据库（默认 admin）' },
                oracleClientPath: { type: 'string', description: 'Oracle Instant Client 路径' },
              },
              required: ['type'],
            },
          },
          {
            name: 'disconnect_database',
            description: '断开当前数据库连接。断开后需要重新调用 connect_database 才能执行查询。',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'get_connection_status',
            description: '获取当前数据库连接状态。返回是否已连接、数据库类型、地址、数据库名、权限模式等信息。',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          // v2.16: observability
          {
            name: 'get_metrics',
            description: GET_METRICS_TOOL_DESCRIPTION,
            inputSchema: {
              type: 'object',
              properties: {
                category: {
                  type: 'string',
                  enum: ['summary', 'slow_queries', 'all'],
                  default: 'summary',
                  description: '返回的指标类别: summary(计数+直方图) / slow_queries(慢查询历史) / all(全部)',
                },
              },
            },
          },
          // v2.17: query experience
          {
            name: 'explain_query',
            description: TOOL_DESCRIPTIONS.explain_query,
            inputSchema: { type: 'object', properties: { sql: { type: 'string' }, params: { type: 'array' } }, required: ['sql'] },
          },
          {
            name: 'lint_sql',
            description: TOOL_DESCRIPTIONS.lint_sql,
            inputSchema: { type: 'object', properties: { sql: { type: 'string' } }, required: ['sql'] },
          },
          {
            name: 'get_query_history',
            description: TOOL_DESCRIPTIONS.get_query_history,
            inputSchema: { type: 'object', properties: {
              db: { type: 'string' }, kind: { type: 'string' }, since: { type: 'string' }, until: { type: 'string' },
              limit: { type: 'number' }, onlyErrors: { type: 'boolean' },
              // v2.19
              profileName: { type: ['string', 'null'], description: "Filter by profile. null = global-only; string = that profile. v2.19." },
              groupBy: { type: 'string', enum: ['profile'], description: "Aggregate query. v2.19." },
            } },
          },
          {
            name: 'save_template',
            description: TOOL_DESCRIPTIONS.save_template,
            inputSchema: { type: 'object', properties: {
              name: { type: 'string' }, description: { type: 'string' }, sql: { type: 'string' },
              parameters: { type: 'array' }, tags: { type: 'array' },
              // v2.19
              profile_name: { type: ['string', 'null'], description: "Bind template to a profile. Omit/null = global. v2.19." },
            }, required: ['name', 'sql'] },
          },
          {
            name: 'list_templates',
            description: TOOL_DESCRIPTIONS.list_templates,
            inputSchema: { type: 'object', properties: {
              tag: { type: 'string' },
              // v2.19
              profileName: { type: ['string', 'null'], description: "Filter by profile. null = global-only; string = that profile. v2.19." },
            } },
          },
          {
            name: 'get_template',
            description: TOOL_DESCRIPTIONS.get_template,
            inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
          },
          {
            name: 'delete_template',
            description: TOOL_DESCRIPTIONS.delete_template,
            inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
          },
          {
            name: 'execute_template',
            description: TOOL_DESCRIPTIONS.execute_template,
            inputSchema: { type: 'object', properties: { id: { type: 'string' }, params: { type: 'object' } }, required: ['id'] },
          },
          // v2.18: multi-DB profile management
          {
            name: 'save_profile',
            description: PROFILE_TOOL_DESCRIPTIONS.save_profile,
            inputSchema: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, type: { type: 'string' }, config: { type: 'object' }, role: { type: 'string', enum: ['primary', 'replica', 'analytics'] }, tags: { type: 'array' }, enabled: { type: 'boolean' } }, required: ['name', 'type', 'config'] },
          },
          {
            name: 'list_profiles',
            description: PROFILE_TOOL_DESCRIPTIONS.list_profiles,
            inputSchema: { type: 'object', properties: { role: { type: 'string' }, tag: { type: 'string' }, enabled: { type: 'boolean' } } },
          },
          {
            name: 'use_profile',
            description: '切换活跃连接到已存 profile。v4.0 修复后实际断开旧 adapter 并用 profile.config 新建连接(之前只设 activeProfile 字段但不切 adapter — Bug #4)。返回的 connection 字段反映新连接状态。',
            inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
          },
          {
            name: 'get_global_schema',
            description: PROFILE_TOOL_DESCRIPTIONS.get_global_schema,
            inputSchema: { type: 'object', properties: {} },
          },
        ]
      ;

      // Conditionally register execute_script
      if (resolvedPerms.includes('script')) {
        tools.push({
          name: 'execute_script',
          description: '执行多语句 SQL 脚本或 PL/SQL 块。需要 permissions 包含 "script"。',
          inputSchema: {
            type: 'object',
            properties: {
              sql: { type: 'string', description: '完整脚本内容' },
              useTransaction: { type: 'boolean', description: '是否在事务中执行(默认 true)', default: true },
              maxStatements: { type: 'number', description: '最大语句数(默认 1000)', default: 1000 },
            },
            required: ['sql'],
          },
        });

        // execute_sql_file requires both script permission and allowed paths
        const allowedPaths = (this.config as any)?.allowedSqlFilePaths as string[] | undefined;
        if (allowedPaths && allowedPaths.length > 0) {
          tools.push({
            name: 'execute_sql_file',
            description: '执行指定的 .sql 文件。支持多语句、PL 块、事务。需要 permissions 包含 "script" 且启动时配置 DB_ALLOWED_FILE_PATHS。',
            inputSchema: {
              type: 'object',
              properties: {
                filePath: { type: 'string', description: 'SQL 文件路径。相对路径相对 MCP 启动时的 CWD。' },
                useTransaction: { type: 'boolean', description: '是否在事务中执行(默认 true)', default: true },
                maxStatements: { type: 'number', description: '最大语句数(默认 1000)', default: 1000 },
              },
              required: ['filePath'],
            },
          });
        }
      }

      // Conditionally register execute_batch
      if (resolvedPerms.includes('batch')) {
        tools.push({
          name: 'execute_batch',
          description: '批量执行同一条 SQL 的多个参数集(最多 1000 行)。需要 permissions 包含 "batch"。返回 affectedRowsPerStatement 数组,推荐用 SELECT 验证副作用以保证数据写入正确。',
          inputSchema: {
            type: 'object',
            properties: {
              sql: { type: 'string', description: '带占位符的 SQL 模板' },
              paramsList: { type: 'array', maxItems: 1000, items: { type: 'array', maxItems: 50, description: '每行参数数组' }, description: '参数集列表' },
              useTransaction: { type: 'boolean', description: '是否在事务中执行(默认 true)', default: true },
              maxBatchSize: { type: 'number', description: '最大行数(默认 1000)', default: 1000 },
            },
            required: ['sql', 'paramsList'],
          },
        });
      }

      // Conditionally register generate_sample_data
      if (resolvedPerms.includes('insert') && resolvedPerms.includes('batch')) {
        tools.push({
          name: 'generate_sample_data',
          description: '根据表结构自动生成并插入样例数据。每个 rule 含 match (columnName / columnNamePattern / tableName / columnType) + generate (9 种类型见下方 inputSchema rules.examples)。内置 pattern 占位符: {year} {month} {day} {date} {sequence} {sequence:Nd} {rowIndex} {timestamp} {uuid}。跨列引用语法: {column_name} / {column_name.lower|upper|first|last} / {column_name.pinyin[.first]} / {column_name.N} (被引用列须定义在前面)。需要 insert + batch 权限。',
          inputSchema: {
            type: 'object',
            properties: {
              tableName: { type: 'string', description: '目标表名' },
              rowCount: { type: 'number', description: '生成行数(默认 10,最大 10000)', default: 10 },
              options: {
                type: 'object',
                properties: {
                  seed: { type: 'number', description: '随机种子(同 seed 可重现)' },
                  columns: { type: 'array', items: { type: 'string' }, description: '只生成这些列,其他列用 DEFAULT 或 NULL' },
                  columnOverrides: { type: 'object', description: '固定值覆盖(优先级最高)', additionalProperties: true },
                  rules: {
                    type: 'array',
                    description: '生成规则数组。每条 rule: { match: {...}, generate: { type, ... } }。具体字段见下方 examples。',
                    items: {
                      type: 'object',
                      properties: {
                        match: {
                          type: 'object',
                          description: '匹配条件 (全部 AND;任意字段可省)',
                          properties: {
                            columnName: { type: 'string' },
                            columnNamePattern: { type: 'string', description: '正则匹配列名' },
                            tableName: { type: 'string' },
                            columnType: { type: 'string' },
                          },
                        },
                        generate: {
                          type: 'object',
                          description: '生成策略 (10 种 type,字段结构见下方 examples)',
                          properties: {
                            type: {
                              type: 'string',
                              enum: ['fixed', 'range', 'pattern', 'faker', 'choice', 'enum', 'sequence', 'regex', 'null', 'skip'],
                              description: '生成类型 (必填)',
                            },
                          },
                          required: ['type'],
                          additionalProperties: true,
                        },
                      },
                      required: ['generate'],
                      additionalProperties: true,
                    },
                    examples: [
                      { match: { columnName: 'tenant_id' }, generate: { type: 'fixed', value: 'EXAMPLE_TENANT' } },
                      { match: { columnName: 'amount' }, generate: { type: 'range', min: 100, max: 10000, decimals: 2 } },
                      { match: { columnName: 'project_code' }, generate: { type: 'pattern', template: 'PRJ-{year}-{sequence:05d}' } },
                      { match: { columnName: 'email' }, generate: { type: 'faker', method: 'internet.email' } },
                      { match: { columnName: 'status' }, generate: { type: 'choice', values: ['pending', 'paid', 'shipped'] } },
                      { match: { columnName: 'id' }, generate: { type: 'sequence', start: 1, step: 1, format: '05d' } },
                      { match: { columnName: 'code' }, generate: { type: 'regex', pattern: '^[A-Z]{3}-\\d{4}$' } },
                      { match: { columnName: 'deleted_at' }, generate: { type: 'null' } },
                      { match: { columnName: 'created_at' }, generate: { type: 'skip' } },
                    ],
                  },
                  overwrite: { type: 'boolean', description: 'TRUNCATE 后插入(危险,需显式 true)', default: false },
                },
              },
            },
            required: ['tableName'],
          },
        });
      }

      // v4.0 G4, G2: use_tool_group + use_tool_schema removed; tools are always visible
      // v3.2.4 Bug #13: execute_script/sql_file/batch/generate_sample_data were gated
      // on perms at server start (config undefined → read-only) so never listed.
      // Move visibility to always-on; CallToolRequest still enforces perms.
      const alwaysOnTools = [
        { name: 'execute_script', description: '执行多语句 SQL 脚本或 PL/SQL 块(最多 1000 条)。需要 permissions 包含 script。返回 lastResult 显示最后一条的 affectedRows,其他语句请用 SELECT 验证副作用。', inputSchema: { type: 'object', properties: { sql: { type: 'string' }, useTransaction: { type: 'boolean', default: true }, maxStatements: { type: 'number', default: 1000 } }, required: ['sql'] } },
        { name: 'execute_sql_file', description: '执行 .sql 文件(最多 1000 条语句)。需要 permissions 包含 script + DB_ALLOWED_FILE_PATHS。⚠️ 路径必须在 DB_ALLOWED_FILE_PATHS 白名单内。', inputSchema: { type: 'object', properties: { filePath: { type: 'string', description: '文件路径(必须在白名单内)' }, useTransaction: { type: 'boolean', default: true }, maxStatements: { type: 'number', default: 1000 }, dryRun: { type: 'boolean', default: false, description: 'v4.0 G8 增强:true = 只解析 + lint,不执行' } }, required: ['filePath'] } },
        { name: 'execute_batch', description: '批量执行同一条 SQL 的多个参数集(最多 1000 行)。需要 permissions 包含 batch。返回 affectedRowsPerStatement 数组,推荐用 SELECT 验证副作用以保证数据写入正确(v4.0 G8 流程改进)。', inputSchema: { type: 'object', properties: { sql: { type: 'string' }, paramsList: { type: 'array', maxItems: 1000, items: { type: 'array', maxItems: 50, description: '每行参数数组' } }, useTransaction: { type: 'boolean', default: true }, maxBatchSize: { type: 'number', default: 1000 } }, required: ['sql', 'paramsList'] } },
        { name: 'generate_sample_data', description: '根据表结构自动生成并插入样例数据。需要 insert+batch 权限。完整 inputSchema 同上(Permission 控制由 CallToolRequest 强制执行)。', inputSchema: { type: 'object', properties: { tableName: { type: 'string' }, rowCount: { type: 'number', default: 10 }, options: { type: 'object', properties: { seed: { type: 'number' }, columns: { type: 'array', items: { type: 'string' } }, columnOverrides: { type: 'object' }, rules: { type: 'array', items: { type: 'object', properties: { match: { type: 'object', properties: { columnName: { type: 'string' }, columnNamePattern: { type: 'string' }, tableName: { type: 'string' }, columnType: { type: 'string' } } }, generate: { type: 'object', properties: { type: { type: 'string', enum: ['fixed', 'range', 'pattern', 'faker', 'choice', 'enum', 'sequence', 'regex', 'null', 'skip'] } }, required: ['type'], additionalProperties: true } }, required: ['generate'], additionalProperties: true } }, overwrite: { type: 'boolean', default: false } } } }, required: ['tableName'] } },
        { name: 'export_profiles', description: '导出 profiles 为 YAML/JSON。', inputSchema: { type: 'object', properties: { format: { type: 'string', enum: ['yaml', 'json'] }, includeSecrets: { type: 'boolean' } } } },
        { name: 'import_profiles', description: '从 YAML/JSON 导入 profiles。', inputSchema: { type: 'object', properties: { input: { type: 'string' }, format: { type: 'string', enum: ['yaml', 'json'] }, mode: { type: 'string', enum: ['merge', 'replace'] }, dryRun: { type: 'boolean' } }, required: ['input'] } },
        { name: 'get_profile', description: '获取指定 profile 的配置。', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
        { name: 'delete_profile', description: '删除指定 profile。', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
        { name: 'enable_profile', description: '启用 profile。', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
        { name: 'disable_profile', description: '禁用 profile。', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
        { name: 'disconnect_profile', description: '断开指定 profile 的连接。', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
        { name: 'compare_profile_schemas', description: '比较两个 profile 的 schema 差异。⚠️ 大库输出可能 >1MB;用 maxTablesPerProfile 限制避免截断。', inputSchema: { type: 'object', properties: { nameA: { type: 'string' }, nameB: { type: 'string' }, maxTablesPerProfile: { type: 'number', default: 100, description: 'v4.0 G8:每 profile 最多列多少表(默认100,大库调到 20-50 避免输出过大)' } }, required: ['nameA', 'nameB'] } },
        { name: 'export_backup', description: '导出 DB 到文件。', inputSchema: { type: 'object', properties: { profileName: { type: 'string' }, schemaOnly: { type: 'boolean' }, tables: { type: 'array', items: { type: 'string' } }, outputPath: { type: 'string' } }, required: ['profileName'] } },
        { name: 'audit_log', description: '查询审计日志。', inputSchema: { type: 'object', properties: { actor: { type: 'string' }, severity: { type: 'string', enum: ['read', 'write', 'ddl'] }, profileName: { type: ['string', 'null'] }, since: { type: 'string' }, until: { type: 'string' }, limit: { type: 'number' } } } },
        { name: 'get_pii_config', description: '获取 PII 脱敏配置。', inputSchema: { type: 'object', properties: {} } },
        { name: 'set_pii_config', description: '设置 PII 脱敏规则。', inputSchema: { type: 'object', properties: { profileName: { type: 'string' }, rules: { type: 'array', items: { type: 'object', properties: { table: { type: 'string' }, column: { type: 'string' }, strategy: { type: 'string', enum: ['mask', 'mask_last4', 'hash', 'redact', 'passthrough'] } }, required: ['table', 'column', 'strategy'] } } }, required: ['profileName', 'rules'] } },
        { name: 'explain_query_with_advice', description: 'EXPLAIN + 索引建议。⚠️ 不支持 ${} 模板占位符(会被作为 SQL 字面量传给 EXPLAIN → 语法错)。用字面量值或 ? + params 数组。', inputSchema: { type: 'object', properties: { sql: { type: 'string' }, profileName: { type: 'string' }, persist: { type: 'boolean', default: false, description: 'true = 持久化 plan 以便后续 compare_query_plans' } }, required: ['sql'] } },
        { name: 'compare_query_plans', description: '比较两个保存的执行计划。⚠️ 需先对相同 queryHash 跑 ≥2 次 explain_query_with_advice({persist:true})。否则返回 "need at least 2 entries with the same queryHash"。', inputSchema: { type: 'object', properties: { queryHash: { type: 'string', description: '要比较的 queryHash(query 文本 hash)' }, entryA: { type: 'number', description: 'entry id A' }, entryB: { type: 'number', description: 'entry id B' } }, required: ['queryHash', 'entryA', 'entryB'] } },
        { name: 'list_query_plans', description: '列出已保存的执行计划。', inputSchema: { type: 'object', properties: { limit: { type: 'number' }, queryHash: { type: 'string' } } } },
      ];
      for (const t of alwaysOnTools) {
        if (!tools.find(x => x.name === t.name)) tools.push(t);
      }

      return { tools };
    });

    // 处理工具调用
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        // v4.0 G1, G6: single dispatch path. Lazy-load branch removed (toolRegistry always null after Task 8)
        // (v4.0 G1: lazy-load branch removed — no toolRegistry)

        // 连接管理类 tool 不需要检查数据库连接
        switch (name) {
          case 'connect_database': {
            const {
              type, host, port, user, password, database,
              filePath, allowWrite, permissionMode, authSource, oracleClientPath,
            } = args as Record<string, any>;

            // 构建新配置
            const newConfig: DbConfig = {
              type: normalizeDbType(type),
              host,
              port,
              user,
              password,
              database,
              filePath,
              allowWrite: allowWrite || false,
              permissionMode: permissionMode || 'safe',
            };

            // MongoDB 特殊配置
            if (newConfig.type === 'mongodb' && authSource) {
              (newConfig as any).authSource = authSource;
            }

            // Oracle 特殊配置
            if (newConfig.type === 'oracle' && oracleClientPath) {
              newConfig.oracleClientPath = oracleClientPath;
            }

            // v3.2.8 Bug #35 fix: carry over server-side env-loaded config (e.g. allowedSqlFilePaths
            // from DB_ALLOWED_FILE_PATHS) into the runtime newConfig. Without this, tools/call
            // for execute_sql_file fails because DatabaseService sees no allowedSqlFilePaths.
            if (this.appConfig?.database) {
              const serverDbCfg = this.appConfig.database as any;
              if (serverDbCfg.allowedSqlFilePaths && !(newConfig as any).allowedSqlFilePaths) {
                (newConfig as any).allowedSqlFilePaths = serverDbCfg.allowedSqlFilePaths;
              }
              if (serverDbCfg.allowWrite !== undefined && newConfig.allowWrite === undefined) {
                newConfig.allowWrite = serverDbCfg.allowWrite;
              }
              if (serverDbCfg.poolConfig && !newConfig.poolConfig) {
                newConfig.poolConfig = serverDbCfg.poolConfig;
              }
            }

            // 断开旧连接(总是清空状态,即使 disconnect 抛错)
            if (this.adapter) {
              console.error('🔄 断开旧数据库连接...');
              if (this.databaseService) {
                this.databaseService!.clearSchemaCache();
              }
              try {
                await this.adapter.disconnect();
              } catch (err) {
                console.error('断开旧适配器时出错:', err instanceof Error ? err.message : String(err));
              }
              this.adapter = null;
              this.databaseService = null;
            }

            // 建立新连接
            console.error(`🔌 正在连接 ${newConfig.type} 数据库...`);
            const newAdapter = createAdapter(newConfig);
            await newAdapter.connect();

            this.adapter = newAdapter;
            this.config = newConfig;
            this.databaseService = new DatabaseService(newAdapter, newConfig, this.cacheConfig);
            // v3.2.4 Bug #17 fix: wire queryAnalyzer to new databaseService so
            // executeQuery records history + applies lint hints. Previously queryAnalyzer
            // was created at server start but never propagated to per-connection service,
            // so get_query_history always returned empty.
            if (this.queryAnalyzer) {
              this.databaseService!.setQueryAnalyzer(this.queryAnalyzer);
              // v3.2.4 Bug #18 fix: attachAdapter wires Explainer for explain_query.
              // Previously attachAdapter was never called so explainer stayed null
              // and explain_query always returned empty plan.
              this.queryAnalyzer.attachAdapter(newAdapter as any, newConfig.type);
            }

            const connInfo = newConfig.type === 'sqlite'
              ? `SQLite: ${newConfig.filePath}`
              : `${newConfig.type}: ${newConfig.host}:${newConfig.port}/${newConfig.database || '(default)'}`;

            console.error(`✅ 数据库连接成功: ${connInfo}`);

            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  message: `已成功连接到 ${connInfo}`,
                  connection: {
                    type: newConfig.type,
                    host: newConfig.host,
                    port: newConfig.port,
                    database: newConfig.database,
                    permissionMode: newConfig.permissionMode || 'safe',
                  },
                }, null, 2),
              }],
            };
          }

          case 'disconnect_database': {
            if (!this.adapter) {
              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify({ success: true, message: '当前没有活跃的数据库连接' }, null, 2),
                }],
              };
            }

            if (this.databaseService) {
              this.databaseService!.clearSchemaCache();
            }

            const oldType = this.config?.type;

            // Try disconnect but always clear state regardless of success
            try {
              await this.adapter.disconnect();
            } catch (err) {
              console.error(`断开适配器时出错 (${oldType}):`, err instanceof Error ? err.message : String(err));
            }

            this.adapter = null;
            this.config = null;
            this.databaseService = null;

            console.error(`👋 数据库连接已断开: ${oldType || ''}`);

            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  message: `已断开 ${oldType || ''} 数据库连接`,
                }, null, 2),
              }],
            };
          }

          case 'get_metrics': {
            // v2.16: observability — does not require a database connection
            const handler = buildGetMetricsHandler({
              enabled: this.appConfig?.metrics?.enabled ?? true,
            }, () => this.profileManager?.getMetricsSnapshot() ?? { enabled: false });
            const result = await handler({ category: (args as any)?.category as MetricsCategory });
            return {
              content: [{
                type: 'text',
                text: JSON.stringify(result, null, 2),
              }],
            };
          }

          // v2.17: query experience tools
          case 'explain_query': {
            if (!this.queryAnalyzer) throw new Error('queryAnalyzer not configured');
            return { content: [{ type: 'text', text: JSON.stringify(await buildExplainQueryHandler(this.queryAnalyzer)(args as any), null, 2) }] };
          }
          case 'lint_sql': {
            if (!this.queryAnalyzer) throw new Error('queryAnalyzer not configured');
            return { content: [{ type: 'text', text: JSON.stringify(buildLintSqlHandler(this.queryAnalyzer)(args as any), null, 2) }] };
          }
          case 'get_query_history': {
            if (!this.queryAnalyzer) throw new Error('queryAnalyzer not configured');
            return { content: [{ type: 'text', text: JSON.stringify(await buildGetQueryHistoryHandler(this.queryAnalyzer)(args as any), null, 2) }] };
          }
          case 'save_template': {
            if (!this.queryAnalyzer) throw new Error('queryAnalyzer not configured');
            return { content: [{ type: 'text', text: JSON.stringify(await buildSaveTemplateHandler(this.queryAnalyzer)(args as any), null, 2) }] };
          }
          case 'list_templates': {
            if (!this.queryAnalyzer) throw new Error('queryAnalyzer not configured');
            return { content: [{ type: 'text', text: JSON.stringify(await buildListTemplatesHandler(this.queryAnalyzer)(args as any), null, 2) }] };
          }
          case 'get_template': {
            if (!this.queryAnalyzer) throw new Error('queryAnalyzer not configured');
            return { content: [{ type: 'text', text: JSON.stringify(await buildGetTemplateHandler(this.queryAnalyzer)(args as any), null, 2) }] };
          }
          case 'delete_template': {
            if (!this.queryAnalyzer) throw new Error('queryAnalyzer not configured');
            return { content: [{ type: 'text', text: JSON.stringify(await buildDeleteTemplateHandler(this.queryAnalyzer)(args as any), null, 2) }] };
          }
          case 'execute_template': {
            if (!this.queryAnalyzer) throw new Error('queryAnalyzer not configured');
            if (!this.adapter) throw new Error('connect database first');
            // v4.0 Bug #5 fix: default args to {} so missing params gives clean error from substituteParams
            const safeArgs = (args ?? {}) as { id?: string; name?: string; params?: Record<string, unknown> };
            // Type satisfies handler signature: handler asserts params presence internally
            return { content: [{ type: 'text', text: JSON.stringify(await buildExecuteTemplateHandler(this.queryAnalyzer)(safeArgs as any, this.adapter), null, 2) }] };
          }

          // v2.18: profile tools
          case 'save_profile': {
            if (!this.profileManager) throw new Error('profileManager not configured');
            return { content: [{ type: 'text', text: JSON.stringify(await buildSaveProfileHandler(this.profileManager)(args as any), null, 2) }] };
          }
          case 'list_profiles': {
            if (!this.profileManager) throw new Error('profileManager not configured');
            return { content: [{ type: 'text', text: JSON.stringify(await buildListProfilesHandler(this.profileManager)(args as any), null, 2) }] };
          }
          case 'use_profile': {
            if (!this.profileManager) throw new Error('profileManager not configured');
            const r = await buildUseProfileHandler(this.profileManager)(args as any);
            // v4.0 Bug #4 fix: use_profile 之前只设 this.activeProfile 但不切 adapter。
            // v4.0.2 Bug #7 fix: 不要重复 createAdapter + connect!ProfileManager.loadProfile
            // 已经做了。第一次连成功后 dmdb 内部用 (host+port+user) 生成 pool alias,第二次
            // createPool 同 alias 会抛 "[20006] 连接池别名已存在"。所以这里直接复用
            // loadProfile 返回的 live.adapter + live.service。
            const liveAdapter = (r as any).adapter;
            const liveService = (r as any).service;
            const profileConfig = (r as any).profileConfig as DbConfig;
            if (!liveAdapter || !liveService || !profileConfig) {
              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    error: 'profile has no usable config',
                    name: r.name,
                  }, null, 2),
                }],
                isError: true,
              };
            }
            // 断开旧 adapter(如果还在连着)
            if (this.adapter && this.adapter !== liveAdapter) {
              try {
                await this.adapter.disconnect();
              } catch (err) {
                console.error('断开旧适配器时出错:', err instanceof Error ? err.message : String(err));
              }
            }
            // 切换到 loadProfile 已经建好的 adapter + service
            this.adapter = liveAdapter;
            this.config = {
              ...profileConfig,
              type: normalizeDbType(r.type),
              permissionMode: profileConfig.permissionMode || 'safe',
            };
            this.databaseService = liveService;
            this.activeProfile = r.name;
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  message: `已切换到 profile: ${r.name}`,
                  connection: {
                    type: r.type,
                    host: profileConfig.host,
                    port: profileConfig.port,
                    permissionMode: this.config.permissionMode,
                  },
                }, null, 2),
              }],
            };
          }
          case 'get_global_schema': {
            if (!this.profileManager) throw new Error('profileManager not configured');
            return { content: [{ type: 'text', text: JSON.stringify(await buildGetGlobalSchemaHandler(this.profileManager)(), null, 2) }] };
          }

          case 'get_connection_status': {
            if (!this.adapter || !this.config) {
              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    connected: false,
                    message: '当前未连接任何数据库。请使用 connect_database 工具连接。',
                  }, null, 2),
                }],
              };
            }

            const status: Record<string, any> = {
              connected: true,
              type: this.config.type,
              permissionMode: this.config.permissionMode || 'safe',
            };

            if (this.config.type === 'sqlite') {
              status.filePath = this.config.filePath;
            } else {
              status.host = this.config.host;
              status.port = this.config.port;
              status.database = this.config.database;
            }

            if (this.databaseService) {
              const cacheStats = this.databaseService!.getCacheStats();
              status.schemaCache = {
                cached: cacheStats.isCached,
                hitRate: this.databaseService!.getCacheHitRate() + '%',
              };
            }

            return {
              content: [{
                type: 'text',
                text: JSON.stringify(status, null, 2),
              }],
            };
          }

          default:
            break;
        }

        // 以下 tool 需要数据库已连接
        // v4.0.2 Bug #13 fix: profile lifecycle tools (delete/enable/disable/disconnect_profile)
        // only need profileManager (SQLite-backed), not a live DB connection. Allow them
        // through even when the session is disconnected.
        const profileOnlyTools = new Set([
          'delete_profile', 'enable_profile', 'disable_profile', 'disconnect_profile',
          'get_profile', 'import_profiles', 'export_profiles',
        ]);
        if (!this.databaseService && !profileOnlyTools.has(name)) {
          throw new Error('数据库未连接。请先使用 connect_database 工具连接数据库。');
        }

        switch (name) {
          case 'execute_script': {
            const { sql, useTransaction, maxStatements } = args as {
              sql: string; useTransaction?: boolean; maxStatements?: number;
            };
            console.error(`📜 执行脚本 (${sql.length} chars)...`);
            const result = await this.databaseService!.executeScript(sql, { useTransaction, maxStatements });
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          case 'execute_sql_file': {
            const { filePath, useTransaction, maxStatements } = args as {
              filePath: string; useTransaction?: boolean; maxStatements?: number;
            };
            console.error(`📂 执行 SQL 文件: ${filePath}`);
            const result = await this.databaseService!.executeSqlFile({ filePath, useTransaction, maxStatements });
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          case 'execute_batch': {
            const { sql, paramsList, useTransaction, maxBatchSize } = args as {
              sql: string; paramsList: unknown[][]; useTransaction?: boolean; maxBatchSize?: number;
            };
            console.error(`📦 批量执行: ${paramsList.length} 行`);
            const result = await this.databaseService!.executeBatch(sql, paramsList, { useTransaction, maxBatchSize });
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          case 'generate_sample_data': {
            if (!this.databaseService) {
              throw new Error('数据库未连接');
            }
            const { tableName, rowCount, options } = args as any;
            const result = await this.databaseService!.generateAndInsertSampleData(
              tableName,
              rowCount ?? 10,
              options
            );
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          case 'execute_query': {
            const { sql, params } = args as { sql: string; params?: unknown[] };

            console.error(`📊 执行查询: ${sql.substring(0, 100)}...`);

            const result = await this.databaseService!.executeQuery(sql, params);

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          case 'get_schema': {
            const { forceRefresh } = (args as { forceRefresh?: boolean }) || {};

            console.error('📋 获取数据库结构...');

            const schema = await this.databaseService!.getSchema(forceRefresh);

            // 添加缓存状态信息
            const cacheStats = this.databaseService!.getCacheStats();
            const response = {
              ...schema,
              _cacheInfo: {
                cached: cacheStats.isCached,
                cachedAt: cacheStats.cachedAt?.toISOString(),
                hitRate: this.databaseService!.getCacheHitRate() + '%',
              },
            };

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(response, null, 2),
                },
              ],
            };
          }

          case 'get_table_info': {
            const { tableName, forceRefresh } = args as { tableName: string; forceRefresh?: boolean };

            console.error(`📄 获取表信息: ${tableName}`);

            const table = await this.databaseService!.getTableInfo(tableName, forceRefresh);

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(table, null, 2),
                },
              ],
            };
          }

          case 'clear_cache': {
            console.error('🗑️ 清除 Schema 缓存...');

            this.databaseService!.clearSchemaCache();

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    message: 'Schema 缓存已清除',
                  }, null, 2),
                },
              ],
            };
          }

          case 'get_enum_values': {
            const { tableName, columnName, limit, includeCount } = args as {
              tableName: string;
              columnName: string;
              limit?: number;
              includeCount?: boolean;
            };

            console.error(`🔢 获取枚举值: ${tableName}.${columnName}`);

            const result = await this.databaseService!.getEnumValues(
              tableName,
              columnName,
              limit,
              includeCount
            );

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          case 'get_sample_data': {
            const { tableName, columns, limit } = args as {
              tableName: string;
              columns?: string[];
              limit?: number;
            };

            console.error(`📝 获取示例数据: ${tableName}`);

            const result = await this.databaseService!.getSampleData(
              tableName,
              columns,
              limit
            );

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          // v3.2: 11 newly registered tools (handlers wired via ToolRegistry, but these
          // cases handle v3.1 fallback when DB_LAZY_LOAD_ENABLED=false and tool is called).
          case 'compare_profile_schemas': {
            if (!this.profileManager) throw new Error('profileManager not configured');
            return { content: [{ type: 'text', text: JSON.stringify(await (await import('./tools/data-governance.js')).buildCompareProfileSchemasHandler(this.profileManager)(args as any), null, 2) }] };
          }
          case 'export_backup': {
            if (!this.profileManager) throw new Error('profileManager not configured');
            return { content: [{ type: 'text', text: JSON.stringify(await (await import('./tools/data-governance.js')).buildExportBackupHandler(this.profileManager)(args as any), null, 2) }] };
          }
          case 'audit_log': {
            if (!this.queryAnalyzer) throw new Error('queryAnalyzer not configured');
            return { content: [{ type: 'text', text: JSON.stringify(await (await import('./tools/data-governance.js')).buildAuditLogHandler(this.queryAnalyzer)(args as any), null, 2) }] };
          }
          case 'get_pii_config': {
            return { content: [{ type: 'text', text: JSON.stringify(await (await import('./tools/data-governance.js')).buildGetPiiConfigHandler()(), null, 2) }] };
          }
          case 'set_pii_config': {
            return { content: [{ type: 'text', text: JSON.stringify(await (await import('./tools/data-governance.js')).buildSetPiiConfigHandler()(args as any), null, 2) }] };
          }
          case 'export_profiles': {
            if (!this.profileManager) throw new Error('profileManager not configured');
            return { content: [{ type: 'text', text: JSON.stringify(await (await import('./tools/profile-tools.js')).buildExportProfilesHandler(this.profileManager)(args as any), null, 2) }] };
          }
          case 'import_profiles': {
            if (!this.profileManager) throw new Error('profileManager not configured');
            return { content: [{ type: 'text', text: JSON.stringify(await (await import('./tools/profile-tools.js')).buildImportProfilesHandler(this.profileManager)(args as any), null, 2) }] };
          }
          case 'get_profile': {
            if (!this.profileManager) throw new Error('profileManager not configured');
            return { content: [{ type: 'text', text: JSON.stringify(await (await import('./tools/profile-tools.js')).buildGetProfileHandler(this.profileManager)(args as any), null, 2) }] };
          }
          case 'delete_profile': {
            if (!this.profileManager) throw new Error('profileManager not configured');
            const r = await (await import('./tools/profile-tools.js')).buildDeleteProfileHandler(this.profileManager)(args as any);
            if (r.deleted && this.activeProfile === (args as any).name) this.activeProfile = null;
            return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
          }
          case 'enable_profile': {
            if (!this.profileManager) throw new Error('profileManager not configured');
            return { content: [{ type: 'text', text: JSON.stringify(await (await import('./tools/profile-tools.js')).buildEnableProfileHandler(this.profileManager, this.profileManager.getProfileStore())(args as any), null, 2) }] };
          }
          case 'disable_profile': {
            if (!this.profileManager) throw new Error('profileManager not configured');
            const r = await (await import('./tools/profile-tools.js')).buildDisableProfileHandler(this.profileManager, this.profileManager.getProfileStore())(args as any);
            if (r.enabled === false && this.activeProfile === (args as any).name) this.activeProfile = null;
            return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
          }
          case 'disconnect_profile': {
            if (!this.profileManager) throw new Error('profileManager not configured');
            const r = await (await import('./tools/profile-tools.js')).buildDisconnectProfileHandler(this.profileManager)(args as any);
            if (r.disconnected && this.activeProfile === (args as any).name) this.activeProfile = null;
            return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
          }
          case 'explain_query_with_advice': {
            if (!this.queryAnalyzer) throw new Error('queryAnalyzer not configured');
            if (!this.planHistory) throw new Error('planHistory not configured');
            return { content: [{ type: 'text', text: JSON.stringify(await (await import('./tools/plan-history.js')).buildExplainQueryWithAdviceHandler(this.queryAnalyzer, this.planHistory)(args as any), null, 2) }] };
          }
          case 'compare_query_plans': {
            if (!this.planHistory) throw new Error('planHistory not configured');
            return { content: [{ type: 'text', text: JSON.stringify(await (await import('./tools/plan-history.js')).buildCompareQueryPlansHandler(this.planHistory)(args as any), null, 2) }] };
          }
          case 'list_query_plans': {
            if (!this.planHistory) throw new Error('planHistory not configured');
            return { content: [{ type: 'text', text: JSON.stringify(await (await import('./tools/plan-history.js')).buildListQueryPlansHandler(this.planHistory)(args as any), null, 2) }] };
          }

          default:
            throw new Error(`未知工具: ${name}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ 错误: ${errorMessage}`);

        return {
          content: [
            {
              type: 'text',
              text: `执行失败: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  /**
   * 设置数据库适配器
   */
  setAdapter(adapter: DbAdapter): void {
    this.adapter = adapter;
    if (this.config) {
      this.databaseService = new DatabaseService(adapter, this.config, this.cacheConfig);
    }
  }

  /**
   * 获取 MCP Server 实例（用于 SSE/HTTP 传输）
   */
  getServer(): Server {
    return this.server;
  }

  /**
   * 连接数据库（不启动传输层）
   */
  async connectDatabase(): Promise<void> {
    if (!this.adapter) {
      throw new Error('必须先设置数据库适配器才能连接数据库');
    }

    // 连接数据库
    console.error('🔌 正在连接数据库...');
    await this.adapter.connect();
    console.error('✅ 数据库连接成功');

    // 显示安全模式状态
    if (this.config?.allowWrite) {
      console.error('⚠️  警告: 写入模式已启用，请谨慎操作！');
    } else {
      console.error('🛡️  安全模式: 只读模式（推荐）');
    }

    // 显示缓存配置
    console.error('📦 Schema 缓存已启用 (默认 TTL: 5 分钟)');
  }

  /**
   * 使用指定的传输层连接 MCP 服务器
   */
  async connect(transport: Transport): Promise<void> {
    await this.server.connect(transport);
  }

  /**
   * 启动服务器（使用 stdio 传输，用于 Claude Desktop）
   */
  async start(): Promise<void> {
    // 如果有初始配置和适配器，先连接；否则等待 AI 调用 connect_database
    if (this.adapter) {
      await this.connectDatabase();
    } else {
      console.error('📡 MCP 服务器以无连接模式启动，等待通过 connect_database 工具连接数据库...');
    }

    // 启动 MCP 服务器（stdio 模式）
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    console.error('🚀 MCP 服务器已启动，等待客户端连接...');
  }

  /**
   * 停止服务器
   */
  async stop(): Promise<void> {
    // 1. 关闭 MCP Server（释放 transport 层资源：stdin/stdout 监听器等）
    try {
      await this.server.close();
    } catch (err) {
      console.error('关闭 MCP Server 时出错:', err instanceof Error ? err.message : String(err));
    }

    // 2. 清理 Schema 缓存
    if (this.databaseService) {
      this.databaseService!.clearSchemaCache();
    }

    // 3. 断开数据库连接
    if (this.adapter) {
      await this.adapter.disconnect();
      console.error('👋 数据库连接已关闭');
    }
  }
}
