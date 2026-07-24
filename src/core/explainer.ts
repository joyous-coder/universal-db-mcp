/**
 * Explainer (v2.17)
 *
 * Per-DB EXPLAIN abstraction. Returns both parsed ExplainRow[] (best effort)
 * and raw DB output as fallback.
 */

import type { BaseAdapter } from '../adapters/base.js';
import type { ExplainResult, ExplainRow } from './query-analyzer-types.js';

export class Explainer {
  constructor(public readonly adapter: BaseAdapter, public readonly dbType: string) {}

  async explain(sql: string, params?: unknown[]): Promise<ExplainResult> {
    const start = Date.now();
    const explainSql = this.buildExplainSql(sql);
    const result = await this.adapter.executeQuery(explainSql, params);
    const rows = (result.rows ?? []) as Array<Record<string, unknown>>;
    const raw = rows.map(r => Object.values(r).join('|')).join('\n');
    const plan = this.parsePlan(rows);
    const format: ExplainResult['format'] = this.dbType === 'sqlserver' ? 'xml' : 'tabular';
    return { db: this.dbType, sql, plan, raw, format, duration_ms: Date.now() - start };
  }

  private buildExplainSql(sql: string): string {
    const trimmed = sql.trim().replace(/;$/, '');
    switch (this.dbType) {
      case 'sqlite':
        return `EXPLAIN QUERY PLAN ${trimmed}`;
      case 'mysql':
      case 'mariadb':
      case 'postgres':
      case 'kingbase':
      case 'gaussdb':
      case 'vastbase':
      case 'highgo':
      case 'tidb':
      case 'oceanbase':
      case 'polardb':
      case 'goldendb':
      case 'dm':
      case 'clickhouse':
        return `EXPLAIN ${trimmed}`;
      case 'oracle':
        return `EXPLAIN PLAN FOR ${trimmed}`;
      case 'sqlserver':
        return `SET SHOWPLAN_TEXT ON; ${trimmed}; SET SHOWPLAN_TEXT OFF;`;
      default:
        return `EXPLAIN ${trimmed}`;
    }
  }

  private parsePlan(rows: Array<Record<string, unknown>>): ExplainRow[] {
    if (!rows.length) return [];
    const out: ExplainRow[] = [];
    for (const row of rows) {
      const normalized: Record<string, unknown> = {};
      for (const k of Object.keys(row)) {
        normalized[k.toLowerCase()] = row[k];
      }
      out.push({
        id: normalized.id as number | undefined,
        select_type: (normalized.select_type as string) ?? undefined,
        table: (normalized.table as string) ?? (normalized['table_name'] as string) ?? undefined,
        type: (normalized.type as string) ?? (normalized['access type'] as string) ?? undefined,
        possible_keys: (normalized.possible_keys as string) ?? undefined,
        key: (normalized.key as string) ?? undefined,
        key_len: (normalized.key_len as string) ?? undefined,
        ref: (normalized.ref as string) ?? undefined,
        rows: (normalized.rows as number) ?? undefined,
        Extra: (normalized.extra as string) ?? undefined,
      });
    }
    return out;
  }
}
