/**
 * MCP query-experience tools (v2.17)
 *
 * 8 tools: explain_query / lint_sql / get_query_history / save_template /
 *          list_templates / get_template / delete_template / execute_template
 */

import type { QueryAnalyzer } from '../../core/query-analyzer.js';
import type { BaseAdapter } from '../../adapters/base.js';

export function buildExplainQueryHandler(qa: QueryAnalyzer) {
  return async (args: { sql: string; params?: unknown[] }) => qa.explain(args.sql, args.params);
}

export function buildLintSqlHandler(qa: QueryAnalyzer) {
  return (args: { sql: string }) => qa.lint(args.sql);
}

export function buildGetQueryHistoryHandler(qa: QueryAnalyzer) {
  return async (args: { db?: string; kind?: string; since?: string; until?: string; limit?: number; onlyErrors?: boolean }) => {
    const entries = await qa.getHistory(args);
    return { entries };
  };
}

export function buildSaveTemplateHandler(qa: QueryAnalyzer) {
  return async (args: { name: string; description: string; sql: string; parameters: any[]; tags?: string[] }) => {
    return qa.saveTemplate(args);
  };
}

export function buildListTemplatesHandler(qa: QueryAnalyzer) {
  return async (args: { tag?: string }) => {
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
  return async (args: { id: string; params: Record<string, unknown> }, adapter: BaseAdapter) => {
    return qa.executeTemplate(args.id, args.params, adapter);
  };
}

export const TOOL_DESCRIPTIONS = {
  explain_query: 'Get EXPLAIN plan for a SQL query. Returns plan + raw output + duration.',
  lint_sql: 'Lint a SQL query. Returns issues array (error/warning/info). Advisory, never blocks.',
  get_query_history: 'Get recent query history. Filters: db, kind, since, until, onlyErrors, limit (default 50).',
  save_template: 'Save a parameterized SQL template. Reusable across team. Use ${param} placeholders.',
  list_templates: 'List saved templates. Optional tag filter.',
  get_template: 'Get one template by id.',
  delete_template: 'Delete a template by id.',
  execute_template: 'Execute a saved template with params. Returns query result + increments use_count.',
};
