/**
 * AuditLog facade (v3.x)
 *
 * Thin wrapper over HistoryStore that classifies query severity
 * ('read' | 'write' | 'ddl') and supports audit-specific filters.
 */

import type { QueryAnalyzer } from './query-analyzer.js';
import type { QueryHistoryEntry, HistoryFilter } from './query-analyzer-types.js';

export interface AuditMetadata {
  actor: string;
  clientIp?: string;
  severity: 'read' | 'write' | 'ddl';
  metadata?: Record<string, unknown>;
}

/** Heuristic SQL classifier — best-effort, not a full SQL parser. */
export function classifySeverity(sql: string): 'read' | 'write' | 'ddl' {
  const trimmed = sql.trim().toUpperCase();
  // DDL keywords
  if (/^(CREATE|ALTER|DROP|TRUNCATE|RENAME|COMMENT|GRANT|REVOKE)\s/i.test(trimmed)) return 'ddl';
  // Write keywords
  if (/^(INSERT|UPDATE|DELETE|REPLACE|MERGE|UPSERT)\s/i.test(trimmed)) return 'write';
  // Read everything else (SELECT, PRAGMA, EXPLAIN, SHOW, ...)
  return 'read';
}

export class AuditLog {
  /**
   * Record one audit entry. Severity is auto-derived from `sql` if not supplied.
   * Always goes through HistoryStore.record so audit rows are queryable via
   * the standard `get_query_history` tool.
   */
  static async record(
    qa: QueryAnalyzer,
    sql: string,
    db: string,
    kind: string,
    meta: AuditMetadata,
  ): Promise<void> {
    const severity = meta.severity ?? classifySeverity(sql);
    await qa.recordQuery({
      ts: new Date().toISOString(),
      db,
      kind,
      sql,
      params: null,
      duration_ms: 0,
      rows: null,
      error: null,
      error_code: null,
      actor: meta.actor,
      client_ip: meta.clientIp ?? null,
      severity,
      audit_metadata_json: meta.metadata ? JSON.stringify(meta.metadata) : null,
    });
  }

  /** Query audit entries with audit-specific filters. */
  static async query(qa: QueryAnalyzer, filter: HistoryFilter): Promise<QueryHistoryEntry[]> {
    return qa.getHistory(filter) as Promise<QueryHistoryEntry[]>;
  }
}
