/**
 * v4.0: Central assembly of MCP tool definitions.
 *
 * NOTE: stateful core tools (connect_database, disconnect_database,
 *       get_connection_status, execute_query, get_schema, get_table_info,
 *       clear_cache, get_enum_values, get_sample_data, execute_script,
 *       execute_sql_file, execute_batch) are NOT in this file — they
 *       stay in DatabaseMCPServer's CallToolRequest switch because they
 *       need `this.adapter` / `this.config` references.
 *
 * v4.0 G7: All tools (route-able + stateful + meta + infoLazy) are flat —
 * no more 4-group classification. `buildToolDefinitions()` returns a single
 * `tools: ToolDefinition[]` array.
 */

import type { QueryAnalyzer } from '../core/query-analyzer.js';
import type { ProfileManager } from '../core/profile-manager.js';
import type { ProfileStore } from '../core/profile-store.js';
import type { DbConfig } from '../types/adapter.js';

// v4.0 G1: ToolRegistry deleted. ToolDefinition inlined.
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  call: (args: any) => Promise<any>;
}

import { buildGetMetricsHandler as _unused1 } from './tools/metrics.js';
import {
  buildExplainQueryHandler,
  buildLintSqlHandler,
  buildGetQueryHistoryHandler,
  buildSaveTemplateHandler,
  buildListTemplatesHandler,
  buildGetTemplateHandler,
  buildDeleteTemplateHandler,
  buildExecuteTemplateHandler as _unused2,
  TOOL_DESCRIPTIONS,
} from './tools/query-tools.js';
import {
  buildSaveProfileHandler,
  buildListProfilesHandler,
  buildUseProfileHandler as _unused3,
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
  buildExportTableCsvHandler,
  buildImportCsvHandler,
  CSV_TOOL_DESCRIPTIONS,
} from './tools/csv-tools.js';
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

// v4.0 G7: GroupName type removed (no group concept)
export interface ToolDefinitions {
  tools: ToolDefinition[];
}

function tool(name: string, description: string, inputSchema: any, call: any): ToolDefinition {
  return { name, description, inputSchema, call };
}

export function buildToolDefinitions(deps: ToolDeps): ToolDefinitions {
  // v4.0 G7: flat tools array. All tools always visible.
  const tools: ToolDefinition[] = [];

  // query-experience tools (require queryAnalyzer)
  if (deps.queryAnalyzer) {
    const qa = deps.queryAnalyzer;
    tools.push(
      tool('explain_query', TOOL_DESCRIPTIONS.explain_query, { type: 'object', properties: { sql: { type: 'string' }, params: { type: 'array' } }, required: ['sql'] }, buildExplainQueryHandler(qa) as any),
      tool('lint_sql', TOOL_DESCRIPTIONS.lint_sql, { type: 'object', properties: { sql: { type: 'string' } }, required: ['sql'] }, buildLintSqlHandler(qa) as any),
      tool('get_query_history', TOOL_DESCRIPTIONS.get_query_history, { type: 'object', properties: { db: { type: 'string' }, kind: { type: 'string' }, since: { type: 'string' }, until: { type: 'string' }, limit: { type: 'number' }, onlyErrors: { type: 'boolean' }, profileName: { type: ['string', 'null'] }, groupBy: { type: 'string', enum: ['profile'] } } }, buildGetQueryHistoryHandler(qa) as any),
      tool('save_template', TOOL_DESCRIPTIONS.save_template, { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, sql: { type: 'string' }, parameters: { type: 'array' }, tags: { type: 'array' }, profile_name: { type: ['string', 'null'] } }, required: ['name', 'sql'] }, buildSaveTemplateHandler(qa) as any),
      tool('list_templates', TOOL_DESCRIPTIONS.list_templates, { type: 'object', properties: { tag: { type: 'string' }, profileName: { type: ['string', 'null'] } } }, buildListTemplatesHandler(qa) as any),
      tool('get_template', TOOL_DESCRIPTIONS.get_template, { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, buildGetTemplateHandler(qa) as any),
      tool('delete_template', TOOL_DESCRIPTIONS.delete_template, { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, buildDeleteTemplateHandler(qa) as any),
      // execute_template + get_metrics: stateful (need adapter/appConfig) — handled in mcp-server switch
    );
  }

  // profile tools
  if (deps.profileManager) {
    const pm = deps.profileManager;
    const store = (deps.profileStore ?? pm.getProfileStore()) as ProfileStore;
    tools.push(
      tool('save_profile', PROFILE_TOOL_DESCRIPTIONS.save_profile, { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, type: { type: 'string' }, config: { type: 'object' }, role: { type: 'string', enum: ['primary', 'replica', 'analytics'] }, tags: { type: 'array' }, enabled: { type: 'boolean' } }, required: ['name', 'type', 'config'] }, buildSaveProfileHandler(pm) as any),
      tool('list_profiles', PROFILE_TOOL_DESCRIPTIONS.list_profiles, { type: 'object', properties: { role: { type: 'string' }, tag: { type: 'string' }, enabled: { type: 'boolean' } } }, buildListProfilesHandler(pm) as any),
      // use_profile: stateful — handled in mcp-server switch
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

  // data-governance tools (part require profileManager, part queryAnalyzer)
  if (deps.profileManager) {
    const pm = deps.profileManager;
    tools.push(
      tool('compare_profile_schemas', DATA_GOVERNANCE_TOOL_DESCRIPTIONS.compare_profile_schemas, { type: 'object', properties: { nameA: { type: 'string' }, nameB: { type: 'string' } }, required: ['nameA', 'nameB'] }, buildCompareProfileSchemasHandler(pm) as any),
      tool('export_backup', DATA_GOVERNANCE_TOOL_DESCRIPTIONS.export_backup, { type: 'object', properties: { profileName: { type: 'string' }, schemaOnly: { type: 'boolean' }, tables: { type: 'array', items: { type: 'string' } }, outputPath: { type: 'string' } }, required: ['profileName'] }, buildExportBackupHandler(pm) as any),
      tool('export_table_csv', CSV_TOOL_DESCRIPTIONS.export_table_csv, { type: 'object', properties: { profileName: { type: 'string' }, table: { type: 'string' }, columns: { type: 'array', items: { type: 'string' } }, where: { type: 'string' }, orderBy: { type: 'string' }, limit: { type: 'integer', default: 0 }, offset: { type: 'integer', default: 0 }, outputPath: { type: 'string' }, batchSize: { type: 'integer', default: 5000 } }, required: ['profileName', 'table', 'outputPath'] }, buildExportTableCsvHandler(pm) as any),
      tool('import_csv', CSV_TOOL_DESCRIPTIONS.import_csv, { type: 'object', properties: { profileName: { type: 'string' }, table: { type: 'string' }, filePath: { type: 'string' }, columns: { type: 'array', items: { type: 'string' } }, dryRun: { type: 'boolean', default: false }, batchSize: { type: 'integer', default: 1000 }, hasHeader: { type: 'boolean', default: true }, nullStrings: { type: 'array', items: { type: 'string' } } }, required: ['profileName', 'table', 'filePath'] }, buildImportCsvHandler(pm) as any),
    );
  }
  if (deps.queryAnalyzer) {
    tools.push(
      tool('audit_log', DATA_GOVERNANCE_TOOL_DESCRIPTIONS.audit_log, { type: 'object', properties: { actor: { type: 'string' }, severity: { type: 'string', enum: ['read', 'write', 'ddl'] }, profileName: { type: ['string', 'null'] }, since: { type: 'string' }, until: { type: 'string' }, limit: { type: 'number' } } }, buildAuditLogHandler(deps.queryAnalyzer) as any),
    );
  }
  tools.push(
    tool('get_pii_config', DATA_GOVERNANCE_TOOL_DESCRIPTIONS.get_pii_config, { type: 'object', properties: {} }, buildGetPiiConfigHandler() as any),
    tool('set_pii_config', DATA_GOVERNANCE_TOOL_DESCRIPTIONS.set_pii_config, { type: 'object', properties: { profileName: { type: 'string' }, rules: { type: 'array', items: { type: 'object', properties: { table: { type: 'string' }, column: { type: 'string' }, strategy: { type: 'string', enum: ['mask', 'mask_last4', 'hash', 'redact', 'passthrough'] } }, required: ['table', 'column', 'strategy'] } } }, required: ['profileName', 'rules'] }, buildSetPiiConfigHandler() as any),
  );

  // index-advisor tools (require queryAnalyzer + planHistory)
  if (deps.queryAnalyzer && deps.planHistory) {
    const qa = deps.queryAnalyzer;
    const ph = deps.planHistory;
    tools.push(
      tool('explain_query_with_advice', PLAN_HISTORY_TOOL_DESCRIPTIONS.explain_query_with_advice, { type: 'object', properties: { sql: { type: 'string' }, profileName: { type: 'string' }, persist: { type: 'boolean' } }, required: ['sql'] }, buildExplainQueryWithAdviceHandler(qa, ph) as any),
      tool('compare_query_plans', PLAN_HISTORY_TOOL_DESCRIPTIONS.compare_query_plans, { type: 'object', properties: { queryHash: { type: 'string' }, entryA: { type: 'number' }, entryB: { type: 'number' } }, required: ['queryHash'] }, buildCompareQueryPlansHandler(ph) as any),
      tool('list_query_plans', PLAN_HISTORY_TOOL_DESCRIPTIONS.list_query_plans, { type: 'object', properties: { limit: { type: 'number' }, queryHash: { type: 'string' } } }, buildListQueryPlansHandler(ph) as any),
    );
  }

  // generate_sample_data: v4.0 G2 — full schema inline (no infoLazy split)
  // Execution lives in mcp-server switch (stateful); this stub is never called.
  tools.push({
    name: 'generate_sample_data',
    description: '按表结构生成 + 插入样例数据。需要 insert+batch 权限。',
    inputSchema: {
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
            overwrite: { type: 'boolean', default: false },
          },
        },
      },
      required: ['tableName'],
    },
    call: async () => ({ error: 'generate_sample_data must be routed by mcp-server (stateful)' }),
  });

  return { tools };
}