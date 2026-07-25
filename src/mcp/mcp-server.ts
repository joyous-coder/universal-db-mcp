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
} from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { DbAdapter, DbConfig } from '../types/adapter.js';
import type { AppConfig } from '../types/http.js';
import { DatabaseService, SchemaCacheConfig } from '../core/database-service.js';
import { createAdapter, normalizeDbType } from '../utils/adapter-factory.js';
import { resolvePermissions } from '../utils/safety.js';
import { ToolRegistry, type ToolGroup } from './tool-registry.js';
import { buildToolRegistry } from './tool-definitions.js';
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
  private toolRegistry: ToolRegistry | null = null;
  // v3.2: per-session MCP sessionId (stdio uses 'stdio-default'; HTTP/SSE uses transport sessionId)
  private currentSessionId: string = 'stdio-default';
  // v3.2: whether lazy-loading is enabled (DB_LAZY_LOAD_ENABLED; default false = v3.1 behavior)
  private lazyLoadEnabled: boolean = false;
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
    this.rebuildToolRegistry();
  }

  /**
   * v2.18: set the ProfileManager. Optional; when not set, profile tools
   * return a "profileManager not configured" error.
   */
  setProfileManager(pm: ProfileManager | null): void {
    this.profileManager = pm;
    this.rebuildToolRegistry();
  }

  /**
   * v3.1: set the PlanHistory (optional). When set, index-advisor tools
   * (explain_query_with_advice, compare_query_plans, list_query_plans) become available.
   */
  setPlanHistory(ph: any): void {
    this.planHistory = ph;
    this.rebuildToolRegistry();
  }

  /**
   * v3.2: configure all optional dependencies from a loaded AppConfig.
   * Constructs and wires QueryAnalyzer, ProfileManager, PlanHistory when their
   * respective env flags are enabled. Idempotent — safe to call multiple times.
   */
  async configureFromAppConfig(appConfig: AppConfig): Promise<void> {
    this.appConfig = appConfig;

    // v3.2: lazy-loading opt-in
    if (appConfig.lazyLoad?.enabled) {
      this.lazyLoadEnabled = true;
    }

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

    this.rebuildToolRegistry();
  }

  /** v2.18: get the active profile name (null if none). */
  getActiveProfile(): string | null {
    return this.activeProfile;
  }

  /**
   * v3.2: set lazy-loading enabled (DB_LAZY_LOAD_ENABLED). When true, ListToolsRequest
   * returns only core+meta+info-lazy (14 tools), and lazy tools must be activated via use_tool_group.
   */
  setLazyLoadEnabled(enabled: boolean): void {
    this.lazyLoadEnabled = enabled;
    this.rebuildToolRegistry();
  }

  /**
   * v3.2: set the current MCP session id. stdio uses 'stdio-default'; SSE/Streamable HTTP
   * sets this from the transport's sessionId (in mcp-sse.ts).
   */
  setSessionId(id: string): void {
    this.currentSessionId = id;
  }

  /**
   * v3.2: rebuild the ToolRegistry after dependencies change.
   */
  private rebuildToolRegistry(): void {
    if (!this.lazyLoadEnabled) {
      this.toolRegistry = null;
      return;
    }
    const profileStore = this.profileManager?.getProfileStore() ?? null;
    this.toolRegistry = buildToolRegistry({
      queryAnalyzer: this.queryAnalyzer,
      profileManager: this.profileManager,
      profileStore,
      config: this.config,
      planHistory: this.planHistory,
      lazyLoadEnabled: true,
      defaultActiveGroups: this.appConfig?.lazyLoad?.defaultActiveGroups ?? [],
    });
  }

  /**
   * v3.2: handle use_tool_group meta-tool.
   */
  private async handleUseToolGroup(args: { name: string }) {
    if (!this.toolRegistry) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'registry not initialized' }) }], isError: true };
    }
    // v3.2.1: validate args.name against enum (fix finding #11)
    const VALID_GROUPS: ToolGroup[] = ['query-experience', 'profiles', 'data-governance', 'index-advisor'];
    if (!args || typeof args.name !== 'string' || !VALID_GROUPS.includes(args.name as ToolGroup)) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: 'invalid group name',
            provided: args?.name ?? '(undefined)',
            valid: VALID_GROUPS,
          }, null, 2),
        }],
        isError: true,
      };
    }
    const r = this.toolRegistry.activateGroup(this.currentSessionId, args.name as ToolGroup);
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }

  /**
   * v3.2: handle use_tool_schema meta-tool.
   */
  private async handleUseToolSchema(args: { name: string }) {
    if (!this.toolRegistry) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'registry not initialized' }) }], isError: true };
    }
    const schema = this.toolRegistry.getFullSchema(args.name);
    if (!schema) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: `tool ${args.name} is not info-lazy or not found`, available: ['generate_sample_data'] }) }], isError: true };
    }
    return { content: [{ type: 'text', text: JSON.stringify({ name: args.name, schema }, null, 2) }] };
  }

  /**
   * v3.2: return error response when LLM calls a lazy tool without activating the group.
   */
  private lazyToolErrorResponse(toolName: string, group: ToolGroup) {
    const activeGroups = this.toolRegistry ? this.toolRegistry.getActiveGroups(this.currentSessionId) : [];
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'tool not available in current session',
          tool: toolName,
          group,
          hint: `call use_tool_group({ name: "${group}" }) first`,
          activeGroups,
        }, null, 2),
      }],
      isError: true,
    };
  }

  /**
   * v3.2: return validation error response (info-lazy missing fields, etc).
   */
  private validationErrorResponse(validation: { ok: boolean; error?: string; hint?: string }) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ error: validation.error ?? 'invalid arguments', hint: validation.hint }, null, 2),
      }],
      isError: true,
    };
  }

  /**
   * v3.2.1: list always-on stateful tools (connect, execute_query, etc.) so they appear
   * in lazy-mode ListToolsResponse. They are routed through the v3.1 fallback switch on call.
   */
  private getStatefulToolsForList(): any[] {
    const perms = this.config ? resolvePermissions(this.config) : ['read'];
    const tools: any[] = [
      { name: 'execute_query', description: '执行 SQL 查询或数据库命令。支持 SELECT、JOIN、聚合等查询操作。如果启用了写入模式，也可以执行 INSERT、UPDATE、DELETE 等操作。', inputSchema: { type: 'object', properties: { query: { type: 'string', description: '要执行的 SQL 语句或数据库命令' }, params: { type: 'array', description: '查询参数（可选，用于参数化查询防止 SQL 注入）', items: { type: 'string' } } }, required: ['query'] } },
      { name: 'get_schema', description: '获取数据库结构信息，包括所有 Schema 中用户可访问的表名、列名、数据类型、主键、索引等元数据。', inputSchema: { type: 'object', properties: { forceRefresh: { type: 'boolean', description: '是否强制刷新缓存（可选，默认 false）' } } } },
      { name: 'get_table_info', description: '获取指定表的详细信息，包括列定义、索引、预估行数等。', inputSchema: { type: 'object', properties: { tableName: { type: 'string', description: '表名。支持 schema.table_name 格式' }, forceRefresh: { type: 'boolean' } }, required: ['tableName'] } },
      { name: 'clear_cache', description: '清除 Schema 缓存。', inputSchema: { type: 'object', properties: {} } },
      { name: 'get_enum_values', description: '获取指定列的所有唯一值。', inputSchema: { type: 'object', properties: { tableName: { type: 'string' }, columnName: { type: 'string' }, limit: { type: 'number' }, includeCount: { type: 'boolean' } }, required: ['tableName', 'columnName'] } },
      { name: 'get_sample_data', description: '获取表的示例数据（已自动脱敏）。', inputSchema: { type: 'object', properties: { tableName: { type: 'string' }, columns: { type: 'array', items: { type: 'string' } }, limit: { type: 'number' } }, required: ['tableName'] } },
      { name: 'connect_database', description: '连接到数据库。', inputSchema: { type: 'object', properties: { type: { type: 'string', enum: ['mysql','postgres','redis','oracle','dm','sqlserver','mongodb','sqlite','kingbase','gaussdb','oceanbase','tidb','clickhouse','polardb','vastbase','highgo','goldendb'] }, host: { type: 'string' }, port: { type: 'number' }, user: { type: 'string' }, password: { type: 'string' }, database: { type: 'string' }, filePath: { type: 'string' }, allowWrite: { type: 'boolean' }, permissionMode: { type: 'string', enum: ['safe','readwrite','full'] }, authSource: { type: 'string' }, oracleClientPath: { type: 'string' } }, required: ['type'] } },
      { name: 'disconnect_database', description: '断开当前数据库连接。', inputSchema: { type: 'object', properties: {} } },
      { name: 'get_connection_status', description: '获取当前数据库连接状态。', inputSchema: { type: 'object', properties: {} } },
      // Stateful lazy tools (kept here so they're visible; routed via fallback switch)
      { name: 'execute_template', description: TOOL_DESCRIPTIONS?.execute_template ?? 'Execute a saved template with params.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, params: { type: 'object' } }, required: ['id'] } },
      { name: 'get_metrics', description: 'Get server observability metrics. category=summary|slow_queries|all.', inputSchema: { type: 'object', properties: { category: { type: 'string', enum: ['summary','slow_queries','all','multi_db'], default: 'summary' } } } },
      { name: 'use_profile', description: 'Switch active connection to a saved profile.', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
    ];
    if (perms.includes('script')) {
      tools.push({ name: 'execute_script', description: '执行多语句 SQL 脚本或 PL/SQL 块。需要 script 权限。', inputSchema: { type: 'object', properties: { query: { type: 'string' }, useTransaction: { type: 'boolean', default: true }, maxStatements: { type: 'number', default: 1000 } }, required: ['query'] } });
      const allowedPaths = (this.config as any)?.allowedSqlFilePaths as string[] | undefined;
      if (allowedPaths && allowedPaths.length > 0) {
        tools.push({ name: 'execute_sql_file', description: '执行 .sql 文件。需要 script + DB_ALLOWED_FILE_PATHS。', inputSchema: { type: 'object', properties: { filePath: { type: 'string' }, useTransaction: { type: 'boolean', default: true }, maxStatements: { type: 'number', default: 1000 } }, required: ['filePath'] } });
      }
    }
    if (perms.includes('batch')) {
      tools.push({ name: 'execute_batch', description: '批量执行同一条 SQL 的多个参数集。需要 batch 权限。', inputSchema: { type: 'object', properties: { sql: { type: 'string' }, paramsList: { type: 'array', items: { type: 'array' } }, useTransaction: { type: 'boolean', default: true }, maxBatchSize: { type: 'number', default: 1000 } }, required: ['sql', 'paramsList'] } });
    }
    if (perms.includes('insert') && perms.includes('batch')) {
      tools.push({ name: 'generate_sample_data', description: '按表结构生成 + 插入样例数据。需要 insert+batch 权限。完整参数用 use_tool_schema 拿。', inputSchema: { type: 'object', properties: { tableName: { type: 'string' }, rowCount: { type: 'number', default: 10 } }, required: ['tableName'] } });
    }
    return tools;
  }

  /**
   * 设置 MCP 协议处理器
   */
  private setupHandlers(): void {
    // 列出可用工具
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      // v3.2: when lazy-loading is enabled, ListToolsRequest returns core+meta+info-lazy + active groups
      // from the registry. Otherwise, fall through to v3.1 behavior (all 22+4 conditional tools).
      if (this.lazyLoadEnabled && this.toolRegistry) {
        const active = this.toolRegistry.listActiveTools(this.currentSessionId);
        const tools: any[] = active.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
        // v3.2.1: append always-on stateful tools so clients can discover connect/execute_query/etc.
        // (these are routed through the v3.1 fallback switch in CallToolRequest)
        const statefulTools = this.getStatefulToolsForList();
        for (const st of statefulTools) {
          if (!tools.find(t => t.name === st.name)) tools.push(st);
        }
        return { tools };
      }
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
                query: {
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
            description: PROFILE_TOOL_DESCRIPTIONS.use_profile,
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
              query: { type: 'string', description: '完整脚本内容' },
              useTransaction: { type: 'boolean', description: '是否在事务中执行(默认 true)', default: true },
              maxStatements: { type: 'number', description: '最大语句数(默认 1000)', default: 1000 },
            },
            required: ['query'],
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
          description: '批量执行同一条 SQL 的多个参数集(类似 JdbcTemplate.batchUpdate)。需要 permissions 包含 "batch"。',
          inputSchema: {
            type: 'object',
            properties: {
              sql: { type: 'string', description: '带占位符的 SQL 模板' },
              paramsList: { type: 'array', items: { type: 'array' }, description: '参数集列表' },
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
                      { match: { columnName: 'tenant_id' }, generate: { type: 'fixed', value: 'BBZ_PROVINCE_EG' } },
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

      return { tools };
    });

    // 处理工具调用
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        // v3.2.1: meta-tool + registry routing inside try/catch (fix finding #13)
        if (this.lazyLoadEnabled && this.toolRegistry) {
          if (name === 'use_tool_group') {
            return await this.handleUseToolGroup(args as any);
          }
          if (name === 'use_tool_schema') {
            return await this.handleUseToolSchema(args as any);
          }
          // v3.2: route lazy/info-lazy tools through registry
          if (this.toolRegistry.isToolActive(this.currentSessionId, name)) {
            // info-lazy validation
            const v = this.toolRegistry.validateArgs(name, args);
            if (!v.ok) {
              return this.validationErrorResponse(v);
            }
            const result = await this.toolRegistry.callTool(name, args, this.currentSessionId);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }
          // Tool not active in current session → lazy error
          const t = this.toolRegistry.findToolByName(name);
          if (t && t.group) {
            return this.lazyToolErrorResponse(name, t.group as ToolGroup);
          }
          // Tool not in registry at all — fall through to switch (stateful tools)
        }

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

            // 断开旧连接(总是清空状态,即使 disconnect 抛错)
            if (this.adapter) {
              console.error('🔄 断开旧数据库连接...');
              if (this.databaseService) {
                this.databaseService.clearSchemaCache();
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
              this.databaseService.clearSchemaCache();
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
            return { content: [{ type: 'text', text: JSON.stringify(await buildExecuteTemplateHandler(this.queryAnalyzer)(args as any, this.adapter), null, 2) }] };
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
            this.activeProfile = r.name;
            return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
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
              const cacheStats = this.databaseService.getCacheStats();
              status.schemaCache = {
                cached: cacheStats.isCached,
                hitRate: this.databaseService.getCacheHitRate() + '%',
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
        if (!this.databaseService) {
          throw new Error('数据库未连接。请先使用 connect_database 工具连接数据库。');
        }

        switch (name) {
          case 'execute_script': {
            const { query, useTransaction, maxStatements } = args as {
              query: string; useTransaction?: boolean; maxStatements?: number;
            };
            console.error(`📜 执行脚本 (${query.length} chars)...`);
            const result = await this.databaseService.executeScript(query, { useTransaction, maxStatements });
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          case 'execute_sql_file': {
            const { filePath, useTransaction, maxStatements } = args as {
              filePath: string; useTransaction?: boolean; maxStatements?: number;
            };
            console.error(`📂 执行 SQL 文件: ${filePath}`);
            const result = await this.databaseService.executeSqlFile({ filePath, useTransaction, maxStatements });
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          case 'execute_batch': {
            const { sql, paramsList, useTransaction, maxBatchSize } = args as {
              sql: string; paramsList: unknown[][]; useTransaction?: boolean; maxBatchSize?: number;
            };
            console.error(`📦 批量执行: ${paramsList.length} 行`);
            const result = await this.databaseService.executeBatch(sql, paramsList, { useTransaction, maxBatchSize });
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          case 'generate_sample_data': {
            if (!this.databaseService) {
              throw new Error('数据库未连接');
            }
            const { tableName, rowCount, options } = args as any;
            const result = await this.databaseService.generateAndInsertSampleData(
              tableName,
              rowCount ?? 10,
              options
            );
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          case 'execute_query': {
            const { query, params } = args as { query: string; params?: unknown[] };

            console.error(`📊 执行查询: ${query.substring(0, 100)}...`);

            const result = await this.databaseService.executeQuery(query, params);

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

            const schema = await this.databaseService.getSchema(forceRefresh);

            // 添加缓存状态信息
            const cacheStats = this.databaseService.getCacheStats();
            const response = {
              ...schema,
              _cacheInfo: {
                cached: cacheStats.isCached,
                cachedAt: cacheStats.cachedAt?.toISOString(),
                hitRate: this.databaseService.getCacheHitRate() + '%',
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

            const table = await this.databaseService.getTableInfo(tableName, forceRefresh);

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

            this.databaseService.clearSchemaCache();

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

            const result = await this.databaseService.getEnumValues(
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

            const result = await this.databaseService.getSampleData(
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
      this.databaseService.clearSchemaCache();
    }

    // 3. 断开数据库连接
    if (this.adapter) {
      await this.adapter.disconnect();
      console.error('👋 数据库连接已关闭');
    }
  }
}
