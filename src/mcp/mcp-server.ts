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
import type { QueryAnalyzer } from '../core/query-analyzer.js';

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
  }

  /**
   * 设置 MCP 协议处理器
   */
  private setupHandlers(): void {
    // 列出可用工具
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
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
            inputSchema: { type: 'object', properties: { db: { type: 'string' }, kind: { type: 'string' }, since: { type: 'string' }, until: { type: 'string' }, limit: { type: 'number' }, onlyErrors: { type: 'boolean' } } },
          },
          {
            name: 'save_template',
            description: TOOL_DESCRIPTIONS.save_template,
            inputSchema: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, sql: { type: 'string' }, parameters: { type: 'array' }, tags: { type: 'array' } }, required: ['name', 'sql'] },
          },
          {
            name: 'list_templates',
            description: TOOL_DESCRIPTIONS.list_templates,
            inputSchema: { type: 'object', properties: { tag: { type: 'string' } } },
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
          description: `根据表结构自动生成并插入样例数据,适用于开发、测试、Demo 场景。

LLM 应根据用户的自然语言描述生成 inline rules 数组(见 options.rules)。

## 权限要求
- insert + batch 权限

## 输入参数
- tableName: 目标表名(必填)
- rowCount: 生成行数(默认 10,最大 10000)
- options.seed: 随机种子(传入相同 seed 可复现同样的数据)
- options.columns: 只生成这些列,其他列用 DEFAULT 或 NULL
- options.columnOverrides: 临时固定值覆盖(优先级最高)
- options.rules: 列生成规则数组(LLM 根据用户描述生成)
- options.overwrite: 是否 TRUNCATE 后插入(危险,需显式)

## 列生成规则 schema

每条规则: { match: { ... }, generate: { ... } }

match 支持:
- columnName: 精确匹配列名
- columnNamePattern: 正则匹配列名
- tableName: 仅对某表生效
- columnType: 类型匹配

generate 类型:
- { type: 'fixed', value: any }                    固定值
- { type: 'range', min, max, decimals? }          数值范围
- { type: 'pattern', template }                    模板字符串
- { type: 'faker', method, args? }                  faker 方法(如 'internet.email')
- { type: 'choice', values }                        从列表随机
- { type: 'enum' }                                  从 DB enum_values 取
- { type: 'sequence', start?, step?, format? }     自增序列
- { type: 'regex', pattern }                        匹配正则的随机串
- { type: 'null' }                                  总是 NULL
- { type: 'skip' }                                  不生成,用 DB default

## pattern 占位符

内置: {year} {month} {day} {date} {sequence} {sequence:Nd} {rowIndex} {timestamp} {uuid}

跨列引用(被引用列必须在 schema 中定义在被引用列之前):
- {column_name}              直接引用
- {column_name.lower}        小写
- {column_name.upper}        大写
- {column_name.first}        首字符
- {column_name.last}         末字符
- {column_name.pinyin}       中文转拼音(无声调)
- {column_name.pinyin.first} 拼音首字母
- {column_name.N}            前 N 个字符

## 中文数据支持

faker 内置中文(姓名/手机号/地址/身份证等 zh_CN locale)。

业务特定中文(项目名/省份等):用 choice + 中文列表,或 pattern + 跨列引用组合业务术语。

LLM 当领域专家:用户描述模糊时,LLM 应根据表名/列名推断业务领域,生成合理的 choice 列表。

## 示例

用户:"生成 100 条订单,所有订单 tenant 都是 BBZ_PROVINCE_EG,project_code 用 PRJ-{年}-{序号},amount 在 100-10000 之间,status 从 [pending, paid, shipped] 随机"

调用:
{
  tableName: "orders",
  rowCount: 100,
  options: {
    seed: 42,
    rules: [
      { match: { columnName: "tenant_id" }, generate: { type: "fixed", value: "BBZ_PROVINCE_EG" } },
      { match: { columnName: "project_code" }, generate: { type: "pattern", template: "PRJ-{year}-{sequence:05d}" } },
      { match: { columnName: "amount" }, generate: { type: "range", min: 100, max: 10000, decimals: 2 } },
      { match: { columnName: "status" }, generate: { type: "choice", values: ["pending", "paid", "shipped"] } }
    ]
  }
}
`,
          inputSchema: {
            type: 'object',
            properties: {
              tableName: { type: 'string', description: '目标表名' },
              rowCount: { type: 'number', description: '生成行数(默认 10,最大 10000)', default: 10 },
              options: {
                type: 'object',
                properties: {
                  seed: { type: 'number', description: '随机种子(可重现)' },
                  columns: { type: 'array', items: { type: 'string' }, description: '只生成这些列' },
                  columnOverrides: { type: 'object', description: '固定值覆盖' },
                  rules: { type: 'array', description: '生成规则数组' },
                  overwrite: { type: 'boolean', description: 'TRUNCATE 后插入', default: false },
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
            });
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
