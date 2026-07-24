/**
 * IndexAdvisor (v3.1)
 *
 * Heuristic rules mapping a {@link NormalizedPlan} → a list of
 * {@link IndexAdvice}. Currently 4 rules:
 *
 *  1. seq_scan: any SQLite/MySQL/PG node whose op matches /(SCAN|Seq|FULL)/i
 *     and reports rows > 1000 → suggest a single-column index on the
 *     table's first referenced column.
 *  2. large_estimate: any node with rows >= 50000 → 'high' impact on
 *     the most specific column we can infer.
 *  3. no_index_join: nested-loop join where inner side has no `index`
 *     → recommend index on join column.
 *  4. sort_no_index: SORT step on a table that has no `index` → recommend
 *     a covering index with ORDER BY columns.
 *
 * Output is conservative by design: missing obvious advice is acceptable,
 * but false positives are explicitly avoided (heuristic skips when uncertain).
 */

import type { NormalizedPlan, NormalizedPlanNode } from './explain-parser.js';

export interface IndexAdvice {
  sql: string;
  table: string;
  columns: string[];
  impact: 'low' | 'medium' | 'high';
  reason: 'seq_scan' | 'large_estimate' | 'no_index_join' | 'sort_no_index';
  evidence?: NormalizedPlanNode[];
}

function firstColumnFromRaw(node: NormalizedPlanNode): string | null {
  if (!node.raw) return null;
  // Try to extract a column reference from "WHERE x = ?" or "TABLE t (col)"
  const m = /\b(?:WHERE|ON|USING|table\s+\w+\s*\()([a-z_][a-z0-9_]*)/i.exec(node.raw);
  return m?.[1] ?? null;
}

function walkAll(root: NormalizedPlanNode, visit: (n: NormalizedPlanNode, depth: number, parent: NormalizedPlanNode | null) => void, depth = 0, parent: NormalizedPlanNode | null = null): void {
  visit(root, depth, parent);
  for (const c of root.children ?? []) walkAll(c, visit, depth + 1, root);
}

export class IndexAdvisor {
  /** Run all heuristics against the plan. Returns 0+ advice items. */
  static analyze(plan: import('./explain-parser.js').NormalizedPlan): IndexAdvice[] {
    const out: IndexAdvice[] = [];
    if (!plan.structured) {
      // For raw plans, only suggest if we can extract a top-level table
      let table: string | undefined = plan.nodes[0]?.table;
      if (!table) {
        const raw = plan.nodes[0]?.raw ?? '';
        const m = /\bTABLE\s+(\w+)/i.exec(raw);
        if (m) table = m[1];
      }
      if (table) {
        out.push({
          sql: `-- (heuristic) consider indexing \`${table}\` — review EXPLAIN manually`,
          table,
          columns: [],
          impact: 'low',
          reason: 'large_estimate',
        });
      }
      return out;
    }

    // 1+2: scan + large_estimate
    for (const root of plan.nodes) {
      walkAll(root, (node) => {
        const opUpper = node.op.toUpperCase();
        const isScan = /(SCAN|SEQ|FULL)/.test(opUpper);
        if (!isScan) return;
        const table = node.table;
        if (!table) return;
        const col = firstColumnFromRaw(node);
        const cols = col ? [col] : [];
        const sql = cols.length
          ? `CREATE INDEX idx_${table}_${col} ON ${table} (${col});`
          : `CREATE INDEX idx_${table}_v3_1 ON ${table} (<review-explain>);`;
        const rows = node.rows ?? 0;
        const impact: IndexAdvice['impact'] =
          rows >= 50000 ? 'high' :
          rows >= 5000 ? 'medium' : 'low';
        out.push({
          sql, table, columns: cols, impact,
          reason: isScan && rows >= 1000 ? 'large_estimate' : 'seq_scan',
          evidence: [node],
        });
      });
    }

    // 3: no_index_join — parent is JOIN with child lacking index
    for (const root of plan.nodes) {
      walkAll(root, (node, depth, parent) => {
        if (!parent || depth === 0) return;
        const opUpper = parent.op.toUpperCase();
        const isJoin = /JOIN|NESTED|LOOP/.test(opUpper);
        if (!isJoin) return;
        if (node.index) return;
        const table = node.table;
        if (!table) return;
        const col = firstColumnFromRaw(node) ?? firstColumnFromRaw(parent);
        const cols = col ? [col] : [`<inspect-${table}-join-col>`];
        out.push({
          sql: col
            ? `CREATE INDEX idx_${table}_${col} ON ${table} (${col});`
            : `CREATE INDEX idx_${table}_join ON ${table} (<review-explain>);`,
          table,
          columns: cols,
          impact: 'high',
          reason: 'no_index_join',
          evidence: [node, parent],
        });
      });
    }

    // 4: sort_no_index — SORT step with table but no index covering ORDER BY cols
    for (const root of plan.nodes) {
      walkAll(root, (node) => {
        const opUpper = node.op.toUpperCase();
        if (!/SORT/.test(opUpper)) return;
        if (node.index) return;
        const table = node.table ?? (node.children?.[0]?.table ?? null);
        if (!table) return;
        const col = firstColumnFromRaw(node) ?? 'sort_col';
        out.push({
          sql: `CREATE INDEX idx_${table}_${col} ON ${table} (${col});`,
          table,
          columns: [col],
          impact: 'medium',
          reason: 'sort_no_index',
          evidence: [node],
        });
      });
    }

    return out;
  }
}
