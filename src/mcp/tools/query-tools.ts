/**
 * MCP query-experience tools (v2.17 + v2.19 profile_name params)
 *
 * 8 tools: explain_query / lint_sql / get_query_history / save_template /
 *          list_templates / get_template / delete_template / execute_template
 *
 * v2.19: get_query_history adds `profileName` + `groupBy: 'profile'`;
 *        save_template adds optional `profile_name`;
 *        list_templates adds `profileName` filter.
 */

import type { QueryAnalyzer } from '../../core/query-analyzer.js';
import type { DbAdapter } from '../../types/adapter.js';

export function buildExplainQueryHandler(qa: QueryAnalyzer) {
  return async (args: { sql: string; params?: unknown[] }) => qa.explain(args.sql, args.params);
}

export function buildLintSqlHandler(qa: QueryAnalyzer) {
  return (args: { sql: string }) => qa.lint(args.sql);
}

export function buildGetQueryHistoryHandler(qa: QueryAnalyzer) {
  return async (args: {
    db?: string;
    kind?: string;
    since?: string;
    until?: string;
    limit?: number;
    onlyErrors?: boolean;
    /** v2.19: profile name to filter (null = global-only). */
    profileName?: string | null;
    /** v2.19: when set to 'profile', return aggregates instead of entries. */
    groupBy?: 'profile';
  }) => {
    const entries = await qa.getHistory(args);
    return { entries };
  };
}

export function buildSaveTemplateHandler(qa: QueryAnalyzer) {
  return async (args: {
    name: string;
    description: string;
    sql: string;
    parameters?: any[];
    tags?: string[];
    /** v2.19: bind template to a profile (omit/null for global). */
    profile_name?: string | null;
  }) => {
    // v5.0.0: defensive type check — inputSchema declares array but MCP SDK doesn't
    // enforce. If user passes `parameters: {object}` or `parameters: "string"`,
    // `(args.parameters ?? []).map` would throw "is not a function". Catch early
    // with a clear error message.
    if (args.parameters !== undefined && !Array.isArray(args.parameters)) {
      throw new Error(
        `save_template: 'parameters' 必须是数组(例如 [{"name":"id","type":"string"}] 或 ["id"])。` +
        `收到: ${typeof args.parameters} = ${JSON.stringify(args.parameters).slice(0, 100)}`
      );
    }
    // v4.0.2 Bug #6 fix: accept EITHER:
    //   (a) array of strings, e.g. ["id", "name"]  — most common MCP call style
    //   (b) array of {name|type|required} objects  — internal/template-store style
    //   (c) array of {item|type|required} objects — alternate MCP call style
    // Internally TemplateInput.parameters is Omit<TemplateParam, 'name'>[] — convert
    // strings and {item:...} into proper {type, required} so substituteParams can find them.
    const params: any[] = (args.parameters ?? []).map((p: any) => {
      if (typeof p === 'string') {
        return { type: 'string', required: false, name: p };
      }
      const name = p?.name ?? p?.item;
      if (!name) return p; // already has its own shape; pass through
      // Strip `item` field if present; normalize required to boolean.
      const { item: _omit, ...rest } = p;
      return {
        ...rest,
        name,
        type: rest.type ?? 'string',
        required: rest.required === true || rest.required === 'true' ? true : false,
      };
    });
    return qa.saveTemplate({ ...args, parameters: params });
  };
}

export function buildListTemplatesHandler(qa: QueryAnalyzer) {
  return async (args: { tag?: string; profileName?: string | null }) => {
    const templates = await qa.listTemplates(args);
    return { templates };
  };
}

export function buildGetTemplateHandler(qa: QueryAnalyzer) {
  return async (args: { id: string }) => {
    const t = await qa.getTemplate(args.id);
    return { template: t };
  };
}

export function buildDeleteTemplateHandler(qa: QueryAnalyzer) {
  return async (args: { id: string }) => {
    const deleted = await qa.deleteTemplate(args.id);
    return { deleted };
  };
}

export function buildExecuteTemplateHandler(qa: QueryAnalyzer) {
  return async (args: { id?: string; name?: string; params?: Record<string, unknown> }, adapter: DbAdapter) => {
    // v3.2.6 fix: accept either `id` (short hash) or `name` (user-friendly).
    // Lookup by name if id not provided.
    let templateId = args.id;
    if (!templateId && args.name) {
      // Scan all templates via internal store to find by name
      const all: any[] = await (qa as any).templates?.list?.() ?? [];
      const match = all.find((t: any) => t.name === args.name);
      if (match) templateId = match.id;
      if (!templateId) throw new Error(`template not found by name: ${args.name}`);
    }
    if (!templateId) throw new Error('either id or name is required');
    // v4.0.2 Bug #6 fix: default args.params to {} so missing params gives clean
    // "missing required param: <name>" from substituteParams rather than
    // "Cannot read properties of undefined (reading 'id')" deep in handler chain.
    const params = args.params ?? {};
    return qa.executeTemplate(templateId, params, adapter);
  };
}

export const TOOL_DESCRIPTIONS = {
  explain_query: 'Get EXPLAIN plan for a SQL query. Returns plan + raw output + duration.',
  lint_sql: 'Lint a SQL query. Returns issues array (error/warning/info). Advisory, never blocks.',
  get_query_history: "Get recent query history. Filters: db, kind, since, until, onlyErrors, limit (default 50). v2.19: profileName (string | null) + groupBy='profile' (aggregates).",
  save_template: 'Save a parameterized SQL template. Reusable across team. Use ${param} placeholders. v2.19: optional profile_name.',
  list_templates: 'List saved templates. Optional tag filter. v2.19: profileName (null=global, name=local, omit=all).',
  get_template: 'Get one template by id.',
  delete_template: 'Delete a template by id.',
  execute_template: 'Execute a saved template with params. Returns query result + increments use_count.',
};
