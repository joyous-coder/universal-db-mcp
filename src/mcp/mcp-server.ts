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
import { resolvePermissions } from '../utils/safety.js';
import { ensureGlobalDir } from '../utils/global-paths.js';
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
  buildCreateProfileHandler,
  buildUpdateProfileHandler,
  buildListProfilesHandler,
  buildUseProfileHandler,
  buildGetGlobalSchemaHandler,
  PROFILE_TOOL_DESCRIPTIONS,
} from './tools/profile-tools.js';
import { CSV_TOOL_DESCRIPTIONS } from './tools/csv-tools.js';
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

    // v5.0.0: ensure ~/.universal-db-mcp/ 存在 (ProfileStore / PlanHistory 都需要)
    try {
      ensureGlobalDir();
    } catch (err) {
      console.error(`[mcp] ensureGlobalDir failed: ${err instanceof Error ? err.message : err}`);
    }

    // v4.0 G5: lazy-load opt-in removed (AppConfig.lazyLoad deleted in http.ts)

    // v2.17: QueryAnalyzer (explain/lint/history/templates)
    // v4.2.0: 默认路径已由 config-loader 改为 ~/.universal-db-mcp/{kind}.db,
    // 这里只需把 _default 占位路径在 active profile 加载后重定向(PR3 Task 3.2 处理)
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

    // v2.18: ProfileManager — v4.2.0 用全局 profiles.db
    if (appConfig.profileManager?.enabled) {
      const { ProfileManager } = await import('../core/profile-manager.js');
      const { getProfilesDbPath } = await import('../utils/global-paths.js');
      const pm = new ProfileManager({
        enabled: true,
        profilesDbPath: appConfig.profileManager.profilesDbPath ?? getProfilesDbPath(),
        maxProfiles: appConfig.profileManager.maxProfiles,
        defaultRole: appConfig.profileManager.defaultRole,
        readRouting: appConfig.profileManager.readRouting,
        cipherKey: appConfig.profileManager.cipherKey,
        cipherKeyOld: appConfig.profileManager.cipherKeyOld,
      });
      // Wire QueryAnalyzer → ProfileManager so routeQuery records history
      if (this.queryAnalyzer) pm.setQueryAnalyzer(this.queryAnalyzer);
      this.profileManager = pm;

      // v5.0.0: 启动时读 <cwd>/.db-profile(从 .profile 改名),自动激活并**完整连接**
      // (this.adapter + this.config + this.databaseService + this.activeProfile)。
      // 之前只调用 pm.loadProfile 但不 wire mcp-server 的状态,导致 get_active_profile
      // 显示 connected:false,实际数据库 tool 也用不了。
      try {
        const { readProjectProfile } = await import('../utils/path-resolver.js');
        const projectProfile = readProjectProfile(process.cwd());
        if (projectProfile) {
          try {
            const live = await pm.loadProfile(projectProfile.profile);
            await this.activateProfile(projectProfile.profile, {
              adapter: live.adapter,
              service: live.service,
              profileConfig: live.profile.config,
              type: live.profile.type,
            });
            console.error(`[mcp] Auto-loaded + connected profile '${projectProfile.profile}' from .db-profile`);
          } catch (loadErr) {
            console.error(
              `[mcp] .db-profile references '${projectProfile.profile}' but failed: ${loadErr instanceof Error ? loadErr.message : loadErr}`,
            );
          }
        } else {
          console.error('[mcp] No profile activated. Use save_profile + use_profile to set up.');
          console.error("[mcp] Tip: pass recordToProject: true to use_profile to bind this project to a profile.");
        }
      } catch (resolveErr) {
        console.error(`[mcp] .db-profile resolve failed: ${resolveErr instanceof Error ? resolveErr.message : resolveErr}`);
      }
    }

    // v3.1: PlanHistory — v4.2.0 用全局 profile-scoped plans.db
    try {
      const { getProfileDbPath } = await import('../utils/global-paths.js');
      const path = (appConfig as any).planHistoryPath
        ?? (this.profileManager ? undefined : getProfileDbPath('_default', 'plans'))
        ?? process.env.DB_PLAN_HISTORY_DB_PATH;
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

  /**
   * v5.0.0: 激活 profile 并建立完整连接(复用 ProfileManager.loadProfile 已建立的
   * adapter + service,不重复 createPool)。供 use_profile dispatch 和 MCP 启动时
   * .db-profile 自动激活共用。
   *
   * 必须在 profileManager 设置过之后才能用(否则 throw)。
   *
   * @returns true 表示成功,this.adapter / this.config / this.databaseService / this.activeProfile 全部更新;
   *          false 表示 profile 配置缺失(不应该发生)。
   */
  private async activateProfile(name: string, handlerReturn: any): Promise<boolean> {
    if (!this.profileManager) throw new Error('profileManager not configured');
    const liveAdapter = handlerReturn?.adapter;
    const liveService = handlerReturn?.service;
    const profileConfig = handlerReturn?.profileConfig as DbConfig | undefined;
    if (!liveAdapter || !liveService || !profileConfig) return false;
    // v5.0.0: 取完整 Profile 用于 permissionMode 传递(handler 返回的 r 缺字段)
    const fullProfile = await this.profileManager.getProfile(name);
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
      type: handlerReturn.type as DbConfig['type'],
      permissionMode: fullProfile?.permissionMode ?? 'safe',
    };
    this.databaseService = liveService;
    this.activeProfile = name;
    return true;
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
          // v4.2.0 BREAKING: connect_database / disconnect_database 已删除
          // 用 save_profile + use_profile + disconnect_profile 替代
          // v5.0.0: 重命名为 get_active_profile,语义聚焦"激活的 profile"。
          // 返回:activeProfile 名 + profile 元数据 + 连接详情 + schema 缓存。
          {
            name: 'get_active_profile',
            description: 'v5.0.0 (重命名自 get_connection_status):返回当前激活的 profile 名 + 完整 profile 元数据 + 连接状态 + schema 缓存。未激活时返回 null + 提示信息。',
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
          // v5.0.0: 重命名 save_profile → create_profile(INSERT-only),新增 update_profile(UPDATE-only)
          {
            name: 'create_profile',
            description: PROFILE_TOOL_DESCRIPTIONS.create_profile,
            inputSchema: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, type: { type: 'string' }, config: { type: 'object' }, role: { type: 'string', enum: ['primary', 'replica', 'analytics'] }, tags: { type: 'array' }, enabled: { type: 'boolean' }, permissionMode: { type: 'string', enum: ['safe', 'readwrite', 'full'], description: 'v5.0.0: 权限预设。设了之后会自动展开为 config.permissions(read/insert/update/delete/ddl/script/batch 之一)' } }, required: ['name', 'type', 'config'] },
          },
          {
            name: 'update_profile',
            description: PROFILE_TOOL_DESCRIPTIONS.update_profile,
            inputSchema: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, type: { type: 'string' }, config: { type: 'object' }, role: { type: 'string', enum: ['primary', 'replica', 'analytics'] }, tags: { type: 'array' }, enabled: { type: 'boolean' }, permissionMode: { type: 'string', enum: ['safe', 'readwrite', 'full'] } }, required: ['name', 'type', 'config'] },
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
        { name: 'delete_profile', description: '删除指定 profile。[group: profiles] ⚠️ v5.0.0: 破坏性操作,默认走 preview 路径(返回子目录内容摘要),需要 confirm=true 才真正删除 profiles.db 行 + ~/.universal-db-mcp/<name>/ 子目录。', inputSchema: { type: 'object', properties: { name: { type: 'string' }, confirm: { type: 'boolean', default: false, description: 'v5.0.0: 二次确认。默认 false 返回预览,传 true 才执行删除。' } }, required: ['name'] } },
        { name: 'enable_profile', description: '启用 profile。', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
        { name: 'disable_profile', description: '禁用 profile。', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
        { name: 'disconnect_profile', description: '断开指定 profile 的连接。', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
        { name: 'compare_profile_schemas', description: '比较两个 profile 的 schema 差异。⚠️ 大库输出可能 >1MB;用 maxTablesPerProfile 限制避免截断。', inputSchema: { type: 'object', properties: { nameA: { type: 'string' }, nameB: { type: 'string' }, maxTablesPerProfile: { type: 'number', default: 100, description: 'v4.0 G8:每 profile 最多列多少表(默认100,大库调到 20-50 避免输出过大)' } }, required: ['nameA', 'nameB'] } },
        { name: 'export_backup', description: '导出 DB 到文件。', inputSchema: { type: 'object', properties: { profileName: { type: 'string' }, schemaOnly: { type: 'boolean' }, tables: { type: 'array', items: { type: 'string' } }, outputPath: { type: 'string' } }, required: ['profileName'] } },
        { name: 'audit_log', description: '查询审计日志。', inputSchema: { type: 'object', properties: { actor: { type: 'string' }, severity: { type: 'string', enum: ['read', 'write', 'ddl'] }, profileName: { type: ['string', 'null'] }, since: { type: 'string' }, until: { type: 'string' }, limit: { type: 'number' } } } },
        { name: 'get_pii_config', description: '获取 PII 脱敏配置。', inputSchema: { type: 'object', properties: {} } },
        { name: 'set_pii_config', description: '设置 PII 脱敏规则。', inputSchema: { type: 'object', properties: { profileName: { type: 'string' }, rules: { type: 'array', items: { type: 'object', properties: { table: { type: 'string' }, column: { type: 'string' }, strategy: { type: 'string', enum: ['mask', 'mask_last4', 'hash', 'redact', 'passthrough'] } }, required: ['table', 'column', 'strategy'] } } }, required: ['profileName', 'rules'] } },
        { name: 'export_table_csv', description: CSV_TOOL_DESCRIPTIONS.export_table_csv, inputSchema: { type: 'object', properties: { profileName: { type: 'string', description: '可选。省略则使用当前活跃连接。' }, table: { type: 'string', description: '可选 (与 sql 二选一)。schema.table 格式,例如 "BBZ_CQ.MD_PERIOD_TYPE"' }, columns: { type: 'array', items: { type: 'string' } }, where: { type: 'string' }, orderBy: { type: 'string' }, sql: { type: 'string', description: '可选 (与 table 二选一)。自定义 SELECT SQL,用于 Oracle/DM 等方言或带分页的查询。原样执行,不附加 LIMIT/OFFSET。' }, outputPath: { type: 'string', description: '可选。省略时默认 <cwd>/sql/<table-sanitized>.csv (table 模式) 或 <cwd>/sql/query-<时间戳>.csv (sql 模式)。需要 cwd 在 DB_ALLOWED_FILE_PATHS 白名单里。' } }, required: [] } },
        { name: 'import_csv', description: CSV_TOOL_DESCRIPTIONS.import_csv, inputSchema: { type: 'object', properties: { profileName: { type: 'string', description: '可选。省略则使用当前活跃连接。' }, table: { type: 'string' }, filePath: { type: 'string' }, columns: { type: 'array', items: { type: 'string' } }, dryRun: { type: 'boolean', default: false }, batchSize: { type: 'integer', default: 1000 }, hasHeader: { type: 'boolean', default: true }, nullStrings: { type: 'array', items: { type: 'string' } } }, required: ['table', 'filePath'] } },
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

        // v4.2.0 BREAKING: connect_database / disconnect_database 已删除
        // 用 save_profile + use_profile + disconnect_profile 替代
        switch (name) {
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
          case 'create_profile': {
            if (!this.profileManager) throw new Error('profileManager not configured');
            return { content: [{ type: 'text', text: JSON.stringify(await buildCreateProfileHandler(this.profileManager)(args as any), null, 2) }] };
          }
          case 'update_profile': {
            if (!this.profileManager) throw new Error('profileManager not configured');
            return { content: [{ type: 'text', text: JSON.stringify(await buildUpdateProfileHandler(this.profileManager)(args as any), null, 2) }] };
          }
          case 'list_profiles': {
            if (!this.profileManager) throw new Error('profileManager not configured');
            return { content: [{ type: 'text', text: JSON.stringify(await buildListProfilesHandler(this.profileManager)(args as any), null, 2) }] };
          }
          case 'use_profile': {
            if (!this.profileManager) throw new Error('profileManager not configured');
            const r = await buildUseProfileHandler(this.profileManager)(args as any);
            // v5.0.0: 抽到 activateProfile() 共享方法,MCP 启动 .db-profile 自动激活也用它。
            const activated = await this.activateProfile((args as any).name, r);
            if (!activated) {
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
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  message: `已切换到 profile: ${r.name}`,
                  connection: {
                    type: r.type,
                    host: (r.profileConfig as any).host,
                    port: (r.profileConfig as any).port,
                    permissionMode: this.config!.permissionMode,
                  },
                  // v5.0.0: use_profile handler 在 .profile 缺失/不匹配时填的 hint
                  profileRecordHint: (r as any).profileRecordHint,
                }, null, 2),
              }],
            };
          }
          case 'get_global_schema': {
            if (!this.profileManager) throw new Error('profileManager not configured');
            return { content: [{ type: 'text', text: JSON.stringify(await buildGetGlobalSchemaHandler(this.profileManager)(), null, 2) }] };
          }

          case 'get_active_profile': {
            // v5.0.0: 重命名自 get_connection_status。语义从"连接状态"转向"激活的 profile",
            // 因为 v5.0.0 删了 connect_database/disconnect_database,所有连接都通过 use_profile 走。
            // 响应包含:激活的 profile 名 + profile 元数据 + 连接详情 + schema 缓存状态。
            if (!this.activeProfile) {
              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    activeProfile: null,
                    connected: false,
                    message: '当前未激活任何 profile。请使用 use_profile 工具激活 profile。',
                    hint: '想给当前项目固定激活某个 profile?调用 use_profile({name, recordToProject: true}) 写 <cwd>/.profile。',
                  }, null, 2),
                }],
              };
            }

            const fullProfile = this.profileManager
              ? await this.profileManager.getProfile(this.activeProfile)
              : null;

            const isConnected = !!(this.adapter && this.config && this.databaseService);
            const status: Record<string, any> = {
              activeProfile: this.activeProfile,
              connected: isConnected,
              profile: fullProfile
                ? {
                    name: fullProfile.name,
                    description: fullProfile.description,
                    type: fullProfile.type,
                    role: fullProfile.role,
                    tags: fullProfile.tags,
                    enabled: fullProfile.enabled,
                    permissionMode: fullProfile.permissionMode,
                    category: fullProfile.category,
                    productName: fullProfile.productName,
                    version: fullProfile.version,
                    createdAt: fullProfile.created_at,
                    updatedAt: fullProfile.updated_at,
                    useCount: fullProfile.use_count,
                  }
                : null,
            };

            if (isConnected && this.config) {
              status.connection = {
                type: this.config.type,
                permissionMode: this.config.permissionMode || 'safe',
              };
              if (this.config.type === 'sqlite') {
                status.connection.filePath = (this.config as any).filePath;
              } else {
                status.connection.host = (this.config as any).host;
                status.connection.port = (this.config as any).port;
                status.connection.database = (this.config as any).database;
              }
              const cacheStats = this.databaseService!.getCacheStats();
              status.schemaCache = {
                cached: cacheStats.isCached,
                cachedAt: cacheStats.cachedAt?.toISOString() ?? null,
                hitRate: this.databaseService!.getCacheHitRate() + '%',
              };
            } else {
              status.connection = null;
              status.schemaCache = null;
              status.message = `profile '${this.activeProfile}' 已激活但未连接(可能已被 disable 或 disconnect_profile)。重新调用 use_profile 重连。`;
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
          throw new Error('数据库未连接。请先使用 use_profile 工具激活 profile。');
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
            // v5.0.0: defensive type check — MCP SDK doesn't enforce inputSchema array
            // types, so malformed paramsList (e.g. "[completed, 1]" without closing ])
            // would propagate to oracledb and produce a confusing NJS-005 error.
            // Catch early with a clear message.
            if (!Array.isArray(paramsList)) {
              throw new Error(
                `execute_batch: 'paramsList' 必须是二维数组(例如 [["done", 1], ["cancelled", 2]])。` +
                `收到: ${typeof paramsList} = ${JSON.stringify(paramsList).slice(0, 200)}`
              );
            }
            for (let i = 0; i < paramsList.length; i++) {
              if (!Array.isArray(paramsList[i])) {
                throw new Error(
                  `execute_batch: paramsList[${i}] 必须是数组(单行的参数列表)。` +
                  `收到: ${typeof paramsList[i]} = ${JSON.stringify(paramsList[i]).slice(0, 200)}`
                );
              }
            }
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
          // cases handle v3.1 fallback).
          case 'compare_profile_schemas': {
            if (!this.profileManager) throw new Error('profileManager not configured');
            return { content: [{ type: 'text', text: JSON.stringify(await (await import('./tools/data-governance.js')).buildCompareProfileSchemasHandler(this.profileManager)(args as any), null, 2) }] };
          }
          case 'export_backup': {
            if (!this.profileManager) throw new Error('profileManager not configured');
            return { content: [{ type: 'text', text: JSON.stringify(await (await import('./tools/data-governance.js')).buildExportBackupHandler(this.profileManager)(args as any), null, 2) }] };
          }
          case 'export_table_csv': {
            if (!this.profileManager) throw new Error('profileManager not configured');
            return { content: [{ type: 'text', text: JSON.stringify(await (await import('./tools/csv-tools.js')).buildExportTableCsvHandler(this.profileManager, () => this.adapter)(args as any), null, 2) }] };
          }
          case 'import_csv': {
            if (!this.profileManager) throw new Error('profileManager not configured');
            return { content: [{ type: 'text', text: JSON.stringify(await (await import('./tools/csv-tools.js')).buildImportCsvHandler(this.profileManager, () => this.adapter)(args as any), null, 2) }] };
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
            // v5.0.0 Bug #62 fix: clear full mcpServer state, not just this.activeProfile.
            // Previously only `this.activeProfile = null` was set, but this.adapter /
            // this.databaseService / this.config still pointed to the disconnected
            // LiveProfile. Subsequent tools (execute_query, get_active_profile, etc.)
            // either got `isConnected: true` but failing queries, or hit the
            // `if (!this.databaseService ...)` guard with a stale-but-non-null ref.
            if (r.disconnected && this.activeProfile === (args as any).name) {
              this.adapter = null;
              this.databaseService = null;
              this.config = null;
              this.activeProfile = null;
            }
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
