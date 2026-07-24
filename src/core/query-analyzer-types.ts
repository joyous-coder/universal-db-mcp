/**
 * Query Analyzer types (v2.17)
 * Shared types for Explain Plan, SQL Lint, query history, parameterized templates.
 *
 * Implementation: src/core/query-analyzer.ts
 */

export type LintSeverity = 'error' | 'warning' | 'info';
export interface LintIssue {
  rule: string;
  severity: LintSeverity;
  line?: number;
  message: string;
  suggestion?: string;
}
export interface LintResult {
  sql: string;
  issues: LintIssue[];
  hasErrors: boolean;
  hasWarnings: boolean;
}

export interface ExplainRow {
  id?: number;
  select_type?: string;
  table?: string;
  type?: string;
  possible_keys?: string;
  key?: string;
  key_len?: string;
  ref?: string;
  rows?: number;
  Extra?: string;
  operation?: string;
  object_name?: string;
  cost?: number;
}
export interface ExplainResult {
  db: string;
  sql: string;
  plan: ExplainRow[];
  raw: string;
  format: 'tabular' | 'xml' | 'json' | 'text';
  duration_ms: number;
}

export interface QueryHistoryInput {
  ts: string;
  db: string;
  kind: string;
  sql: string;
  params: string | null;
  duration_ms: number;
  rows: number | null;
  error: string | null;
  error_code: string | null;
}
export interface QueryHistoryEntry extends QueryHistoryInput {
  id: number;
}
export interface HistoryFilter {
  db?: string;
  kind?: string;
  since?: string;
  until?: string;
  limit?: number;
  onlyErrors?: boolean;
}

export interface TemplateParam {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'sql_identifier';
  required: boolean;
  default?: unknown;
  description?: string;
}
export interface Template {
  id: string;
  name: string;
  description: string;
  sql: string;
  parameters: TemplateParam[];
  tags: string[];
  created_at: string;
  updated_at: string;
  created_by: string;
  use_count: number;
}
export interface TemplateInput {
  name: string;
  description: string;
  sql: string;
  parameters: Omit<TemplateParam, 'name'>[];
  tags?: string[];
}

export interface QueryAnalyzerOptions {
  enabled: boolean;
  templatesDbPath: string;
  historyDbPath: string;
  historyTtlDays: number;
  historyMaxRows: number;
  explainTimeoutMs: number;
}
