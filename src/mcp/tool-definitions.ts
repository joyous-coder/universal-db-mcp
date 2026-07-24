/**
 * Central assembly of MCP tool definitions routed via ToolRegistry (v3.2).
 *
 * NOTE: stateful core tools (connect_database, disconnect_database,
 *       get_connection_status, execute_query, get_schema, get_table_info,
 *       clear_cache, get_enum_values, get_sample_data, execute_script,
 *       execute_sql_file, execute_batch) are NOT in this registry — they
 *       stay in DatabaseMCPServer's CallToolRequest switch because they
 *       need `this.adapter` / `this.config` references.
 *
 * This file registers only the route-able subset:
 *   - 4 lazy groups (28 tools)
 *   - infoLazy (1: generate_sample_data)
 *   - meta (2: use_tool_group, use_tool_schema)
 */

import type { QueryAnalyzer } from '../core/query-analyzer.js';
import type { ProfileManager } from '../core/profile-manager.js';
import type { ProfileStore } from '../core/profile-store.js';
import type { DbConfig } from '../types/adapter.js';
import { ToolRegistry, type ToolDefinition } from './tool-registry.js';

import { buildGetMetricsHandler } from './tools/metrics.js';
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
  buildExportProfilesHandler,
  buildImportProfilesHandler,
  buildGetProfileHandler,
  buildDeleteProfileHandler,
  buildEnableProfileHandler,
  buildDisableProfileHandler,
  buildDisconnectProfileHandler,
  PROFILE_TOOL_DESCRIPTIONS,
} from './tools/profile-tools.js';
import {
  buildCompareProfileSchemasHandler,
  buildExportBackupHandler,
  buildAuditLogHandler,
  buildGetPiiConfigHandler,
  buildSetPiiConfigHandler,
  DATA_GOVERNANCE_TOOL_DESCRIPTIONS,
} from './tools/data-governance.js';
import {
  buildExplainQueryWithAdviceHandler,
  buildCompareQueryPlansHandler,
  buildListQueryPlansHandler,
  PLAN_HISTORY_TOOL_DESCRIPTIONS,
} from './tools/plan-history.js';

export interface ToolDeps {
  queryAnalyzer: QueryAnalyzer | null;
  profileManager: ProfileManager | null;
  profileStore: ProfileStore | null;
  config: DbConfig | null;
  planHistory?: any;
}

export type GroupName = 'query-experience' | 'profiles' | 'data-governance' | 'index-advisor';

export interface ToolDefinitions {
  groups: Partial<Record<GroupName, ToolDefinition[]>>;
  meta: ToolDefinition[];
  infoLazy: ToolDefinition[];
}

function tool(name: string, description: string, inputSchema: any, call: any): ToolDefinition {
  return { name, description, inputSchema, group: null, call };
}

export function buildToolDefinitions(deps: ToolDeps): ToolDefinitions {
  // ─── LAZY: query-experience (9 tools) ──────────────────────────────
  const queryExperience: ToolDefinition[] = [];
  if (deps.queryAnalyzer) {
    const qa = deps.queryAnalyzer;
    queryExperience.push(
      tool('explain_query', TOOL_DESCRIPTIONS.explain_query + ' [group: query-experience]', { type: 'object', properties: { sql: { type: 'string' }, params: { type: 'array' } }, required: ['sql'] }, buildExplainQueryHandler(qa) as any),
      tool('lint_sql', TOOL_DESCRIPTIONS.lint_sql + ' [group: query-experience]', { type: 'object', properties: { sql: { type: 'string' } }, required: ['sql'] }, buildLintSqlHandler(qa) as any),
      tool('get_query_history', TOOL_DESCRIPTIONS.get_query_history + ' [group: query-experience]', { type: 'object', properties: { db: { type: 'string' }, kind: { type: 'string' }, since: { type: 'string' }, until: { type: 'string' }, limit: { type: 'number' }, onlyErrors: { type: 'boolean' }, profileName: { type: ['string', 'null'] }, groupBy: { type: 'string', enum: ['profile'] } } }, buildGetQueryHistoryHandler(qa) as any),
      tool('save_template', TOOL_DESCRIPTIONS.save_template + ' [group: query-experience]', { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, sql: { type: 'string' }, parameters: { type: 'array' }, tags: { type: 'array' }, profile_name: { type: ['string', 'null'] } }, required: ['name', 'sql'] }, buildSaveTemplateHandler(qa) as any),
      tool('list_templates', TOOL_DESCRIPTIONS.list_templates + ' [group: query-experience]', { type: 'object', properties: { tag: { type: 'string' }, profileName: { type: ['string', 'null'] } } }, buildListTemplatesHandler(qa) as any),
      tool('get_template', TOOL_DESCRIPTIONS.get_template + ' [group: query-experience]', { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, buildGetTemplateHandler(qa) as any),
      tool('delete_template', TOOL_DESCRIPTIONS.delete_template + ' [group: query-experience]', { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, buildDeleteTemplateHandler(qa) as any),
      tool('execute_template', TOOL_DESCRIPTIONS.execute_template + ' [group: query-experience]', { type: 'object', properties: { id: { type: 'string' }, params: { type: 'object' } }, required: ['id'] }, async (args: any) => buildExecuteTemplateHandler(qa)(args, null as any)),
      tool('get_metrics', 'Get server observability metrics. category=summary|slow_queries|all. Returns JSON. [group: query-experience]', { type: 'object', properties: { category: { type: 'string', enum: ['summary', 'slow_queries', 'all'], default: 'summary' } } }, buildGetMetricsHandler({ enabled: true }) as any),
    );
  }

  // ─── LAZY: profiles (11 tools) ──────────────────────────────────────
  const profiles: ToolDefinition[] = [];
  if (deps.profileManager) {
    const pm = deps.profileManager;
    const store = (deps.profileStore ?? (pm as any).profileStore) as ProfileStore;
    profiles.push(
      tool('save_profile', PROFILE_TOOL_DESCRIPTIONS.save_profile, { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, type: { type: 'string' }, config: { type: 'object' }, role: { type: 'string', enum: ['primary', 'replica', 'analytics'] }, tags: { type: 'array' }, enabled: { type: 'boolean' } }, required: ['name', 'type', 'config'] }, buildSaveProfileHandler(pm) as any),
      tool('list_profiles', PROFILE_TOOL_DESCRIPTIONS.list_profiles, { type: 'object', properties: { role: { type: 'string' }, tag: { type: 'string' }, enabled: { type: 'boolean' } } }, buildListProfilesHandler(pm) as any),
      tool('use_profile', PROFILE_TOOL_DESCRIPTIONS.use_profile, { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, buildUseProfileHandler(pm) as any),
      tool('get_global_schema', PROFILE_TOOL_DESCRIPTIONS.get_global_schema, { type: 'object', properties: {} }, buildGetGlobalSchemaHandler(pm) as any),
      tool('export_profiles', PROFILE_TOOL_DESCRIPTIONS.export_profiles, { type: 'object', properties: { format: { type: 'string', enum: ['yaml', 'json'] }, includeSecrets: { type: 'boolean' } } }, buildExportProfilesHandler(pm) as any),
      tool('import_profiles', PROFILE_TOOL_DESCRIPTIONS.import_profiles, { type: 'object', properties: { input: { type: 'string' }, format: { type: 'string', enum: ['yaml', 'json'] }, mode: { type: 'string', enum: ['merge', 'replace'] }, dryRun: { type: 'boolean' } }, required: ['input'] }, buildImportProfilesHandler(pm) as any),
      tool('get_profile', PROFILE_TOOL_DESCRIPTIONS.get_profile, { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, buildGetProfileHandler(pm) as any),
      tool('delete_profile', PROFILE_TOOL_DESCRIPTIONS.delete_profile, { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, buildDeleteProfileHandler(pm) as any),
      tool('enable_profile', PROFILE_TOOL_DESCRIPTIONS.enable_profile, { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, buildEnableProfileHandler(pm, store) as any),
      tool('disable_profile', PROFILE_TOOL_DESCRIPTIONS.disable_profile, { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, buildDisableProfileHandler(pm, store) as any),
      tool('disconnect_profile', PROFILE_TOOL_DESCRIPTIONS.disconnect_profile, { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, buildDisconnectProfileHandler(pm) as any),
    );
  }

  // ─── LAZY: data-governance (5 tools) ────────────────────────────────
  const dataGovernance: ToolDefinition[] = [];
  if (deps.profileManager) {
    const pm = deps.profileManager;
    dataGovernance.push(
      tool('compare_profile_schemas', DATA_GOVERNANCE_TOOL_DESCRIPTIONS.compare_profile_schemas, { type: 'object', properties: { nameA: { type: 'string' }, nameB: { type: 'string' } }, required: ['nameA', 'nameB'] }, buildCompareProfileSchemasHandler(pm) as any),
      tool('export_backup', DATA_GOVERNANCE_TOOL_DESCRIPTIONS.export_backup, { type: 'object', properties: { profileName: { type: 'string' }, schemaOnly: { type: 'boolean' }, tables: { type: 'array', items: { type: 'string' } }, outputPath: { type: 'string' } }, required: ['profileName'] }, buildExportBackupHandler(pm) as any),
    );
  }
  if (deps.queryAnalyzer) {
    dataGovernance.push(
      tool('audit_log', DATA_GOVERNANCE_TOOL_DESCRIPTIONS.audit_log, { type: 'object', properties: { actor: { type: 'string' }, severity: { type: 'string', enum: ['read', 'write', 'ddl'] }, profileName: { type: ['string', 'null'] }, since: { type: 'string' }, until: { type: 'string' }, limit: { type: 'number' } } }, buildAuditLogHandler(deps.queryAnalyzer) as any),
    );
  }
  dataGovernance.push(
    tool('get_pii_config', DATA_GOVERNANCE_TOOL_DESCRIPTIONS.get_pii_config, { type: 'object', properties: {} }, buildGetPiiConfigHandler() as any),
    tool('set_pii_config', DATA_GOVERNANCE_TOOL_DESCRIPTIONS.set_pii_config, { type: 'object', properties: { profileName: { type: 'string' }, rules: { type: 'array', items: { type: 'object', properties: { table: { type: 'string' }, column: { type: 'string' }, strategy: { type: 'string', enum: ['mask', 'mask_last4', 'hash', 'redact', 'passthrough'] } }, required: ['table', 'column', 'strategy'] } } }, required: ['profileName', 'rules'] }, buildSetPiiConfigHandler() as any),
  );

  // ─── LAZY: index-advisor (3 tools) ──────────────────────────────────
  const indexAdvisor: ToolDefinition[] = [];
  if (deps.queryAnalyzer && deps.planHistory) {
    const qa = deps.queryAnalyzer;
    const ph = deps.planHistory;
    indexAdvisor.push(
      tool('explain_query_with_advice', PLAN_HISTORY_TOOL_DESCRIPTIONS.explain_query_with_advice + ' [group: index-advisor]', { type: 'object', properties: { sql: { type: 'string' }, profileName: { type: 'string' }, persist: { type: 'boolean' } }, required: ['sql'] }, buildExplainQueryWithAdviceHandler(qa, ph) as any),
      tool('compare_query_plans', PLAN_HISTORY_TOOL_DESCRIPTIONS.compare_query_plans + ' [group: index-advisor]', { type: 'object', properties: { queryHash: { type: 'string' }, entryA: { type: 'number' }, entryB: { type: 'number' } }, required: ['queryHash'] }, buildCompareQueryPlansHandler(ph) as any),
      tool('list_query_plans', PLAN_HISTORY_TOOL_DESCRIPTIONS.list_query_plans + ' [group: index-advisor]', { type: 'object', properties: { limit: { type: 'number' }, queryHash: { type: 'string' } } }, buildListQueryPlansHandler(ph) as any),
    );
  }

  // ─── META (always-on) ───────────────────────────────────────────────
  const meta: ToolDefinition[] = [
    tool('use_tool_group', '激活一个 tool group 以解锁其下的工具。已激活的 group 重复调用是 no-op。group: query-experience|profiles|data-governance|index-advisor', { type: 'object', properties: { name: { type: 'string', enum: ['query-experience', 'profiles', 'data-governance', 'index-advisor'] } }, required: ['name'] }, async () => ({ error: 'use_tool_group must be routed by ToolRegistry' })),
    tool('use_tool_schema', '加载 info-lazy 工具的完整 schema。仅 generate_sample_data 是 info-lazy。', { type: 'object', properties: { name: { type: 'string', enum: ['generate_sample_data'] } }, required: ['name'] }, async () => ({ error: 'use_tool_schema must be routed by ToolRegistry' })),
  ];

  // ─── INFO-LAZY (1: generate_sample_data) ────────────────────────────
  const lightSchema = {
    type: 'object',
    properties: {
      tableName: { type: 'string', description: '目标表名' },
      rowCount: { type: 'number', description: '生成行数(默认 10)', default: 10 },
    },
    required: ['tableName'],
  };
  const fullSchema = {
    type: 'object',
    properties: {
      tableName: { type: 'string' },
      rowCount: { type: 'number', default: 10 },
      options: {
        type: 'object',
        properties: {
          seed: { type: 'number' },
          columns: { type: 'array', items: { type: 'string' } },
          columnOverrides: { type: 'object' },
          rules: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                match: {
                  type: 'object',
                  properties: {
                    columnName: { type: 'string' },
                    columnNamePattern: { type: 'string' },
                    tableName: { type: 'string' },
                    columnType: { type: 'string' },
                  },
                },
                generate: {
                  type: 'object',
                  properties: {
                    type: {
                      type: 'string',
                      enum: ['fixed', 'range', 'pattern', 'faker', 'choice', 'enum', 'sequence', 'regex', 'null', 'skip'],
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
            ],
          },
          overwrite: { type: 'boolean', default: false },
        },
      },
    },
    required: ['tableName'],
  };
  const infoLazy: ToolDefinition[] = [
    {
      name: 'generate_sample_data',
      description: '按表结构生成 + 插入样例数据。需要 insert+batch 权限。详细参数用 use_tool_schema(\'generate_sample_data\') 拿。',
      inputSchema: lightSchema,
      group: null,
      infoLazy: true,
      fullInputSchema: fullSchema,
      call: async () => ({ error: 'generate_sample_data must be routed by mcp-server (stateful)' }),
    },
  ];

  return {
    groups: {
      'query-experience': queryExperience,
      profiles,
      'data-governance': dataGovernance,
      'index-advisor': indexAdvisor,
    },
    meta,
    infoLazy,
  };
}

export function buildToolRegistry(
  deps: ToolDeps & {
    lazyLoadEnabled: boolean;
    defaultActiveGroups: GroupName[];
  }
): ToolRegistry {
  const defs = buildToolDefinitions(deps);
  return new ToolRegistry({
    tools: { core: [...defs.meta, ...defs.infoLazy], groups: defs.groups },
    lazyLoadEnabled: deps.lazyLoadEnabled,
    defaultActiveGroups: deps.defaultActiveGroups,
  });
}