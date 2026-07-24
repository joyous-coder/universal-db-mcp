/**
 * ExplainPlanParser (v3.1)
 *
 * Adapter-aware normalizer for EXPLAIN output. SQLite/MySQL/PostgreSQL/MongoDB
 * have native parsers; the rest 11 adapters return a raw text passthrough
 * shape (so the LLM can still see the plan, even if we can't structure-diff it).
 * Redis / similar get 'unsupported'.
 */

import type { ExplainRow } from './query-analyzer-types.js';

export interface NormalizedPlanNode {
  /** Operation label (e.g. 'SCAN TABLE', 'INDEX RANGE SCAN', 'Seq Scan', 'FULL SCAN') */
  op: string;
  /** Target table or relation (when parseable) */
  table?: string;
  /** Index used (when applicable) */
  index?: string;
  /** Estimated rows (when present) */
  rows?: number;
  /** Cost estimate (when present) */
  cost?: number;
  /** Raw text of this row (preserved for LLM) */
  raw?: string;
  /** Nested child nodes (when plan is hierarchical) */
  children?: NormalizedPlanNode[];
}

export interface NormalizedPlan {
  /** Adapters we could parse into structured form */
  dbType: string;
  /** True when this adapter is fully supported; false → raw text mode */
  structured: boolean;
  /** Total estimated cost (when present) */
  totalCost?: number;
  /** Total estimated rows (when present) */
  totalRows?: number;
  /** Hierarchical plan nodes */
  nodes: NormalizedPlanNode[];
  /** Raw text passthrough (always populated for LLM context) */
  rawText: string;
}

const NATIVE_TYPES = new Set(['sqlite', 'mysql', 'postgresql', 'postgres', 'mongodb', 'mongo']);
const UNSUPPORTED_TYPES = new Set(['redis']);

/**
 * Strip numeric literal / single-quoted string / in-list values from raw
 * EXPLAIN text so identical plans with different params hash to the same.
 */
function normalizeRawText(text: string): string {
  return text
    .replace(/'[^']*'/g, '\'?\'')
    .replace(/\b\d+(\.\d+)?\b/g, '?')
    .replace(/\s+/g, ' ')
    .trim();
}

/** SQLite EXPLAIN QUERY PLAN row parser: `id|parent|notused|detail`. */
function parseSqliteExplain(rows: ExplainRow[]): NormalizedPlanNode[] {
  // Each row has columns like: id, parent, notused, detail
  // detail starts with SCAN/SEARCH/USING/...
  return rows.map(r => {
    const detail = String((r as any).detail ?? '');
    const opMatch = /^(SCAN|SEARCH|USING|CO-ROUTINE|BLOB)\b/.exec(detail);
    const op = opMatch ? detail.split(' ')[0] : detail.split(' ')[0] ?? 'UNKNOWN';
    const tableMatch = /\bTABLE\s+(\w+)/.exec(detail);
    const indexMatch = /\bUSING\s+(?:INDEX\s+)?(\w+)/i.exec(detail);
    return {
      op,
      table: tableMatch?.[1],
      index: indexMatch?.[1],
      raw: detail,
    };
  });
}

/** MySQL EXPLAIN FORMAT=JSON tree walker. */
function parseMysqlJson(jsonText: string): NormalizedPlanNode | null {
  try {
    const obj = JSON.parse(jsonText);
    return walkMysql(obj.query_block ?? obj);
  } catch {
    return null;
  }
  function walkMysql(node: any): NormalizedPlanNode {
    if (!node || typeof node !== 'object') {
      return { op: 'UNKNOWN', raw: JSON.stringify(node) };
    }
    const op = Object.keys(node).find(k => k !== 'cost_info' && k !== 'rows' && k !== 'table') ?? 'OP';
    const table = node.table?.table_name ?? node.table?.table;
    const index = node.table?.key;
    const cost = node.cost_info?.query_cost;
    const rows = node.rows;
    const children: NormalizedPlanNode[] = [];
    for (const v of Object.values(node)) {
      if (Array.isArray(v)) v.forEach(c => { if (typeof c === 'object') children.push(walkMysql(c)); });
      else if (typeof v === 'object' && v !== node.table && v !== node.cost_info) children.push(walkMysql(v));
    }
    return { op: op.toUpperCase(), table, index, rows, cost, children };
  }
}

/** PostgreSQL EXPLAIN (FORMAT JSON) tree walker. */
function parsePgJson(jsonText: string): NormalizedPlanNode | null {
  try {
    const parsed = JSON.parse(jsonText);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    const root = arr[0]?.Plan ?? arr[0];
    if (!root) return null;
    return walkPg(root);
  } catch { return null; }
  function walkPg(node: any): NormalizedPlanNode {
    const op = String(node['Node Type'] ?? 'UNKNOWN');
    const table = node['Relation Name'];
    const index = node['Index Name'];
    const cost = node['Total Cost'];
    const rows = node['Plan Rows'];
    const children = (node.Plans ?? []).map(walkPg);
    return { op, table, index, rows, cost, children };
  }
}

/** MongoDB .explain() executionStats walker. */
function parseMongo(jsonText: string): NormalizedPlanNode | null {
  try {
    const obj = JSON.parse(jsonText);
    const stages = obj.executionStats?.executionStages ?? obj.stages ?? null;
    if (!stages) return null;
    return walkMongo(stages);
  } catch { return null; }
  function walkMongo(n: any): NormalizedPlanNode {
    const op = String(n.stage ?? 'STAGE');
    const table = n.indexName ?? n.collection;
    const rows = n.totalDocsExamined ?? n.nReturned;
    const children: NormalizedPlanNode[] = [];
    if (n.inputStage) children.push(walkMongo(n.inputStage));
    if (Array.isArray(n.inputStages)) n.inputStages.forEach((s: any) => children.push(walkMongo(s)));
    return { op, table, rows, children };
  }
}

export class ExplainPlanParser {
  /**
   * Normalize EXPLAIN output from a real adapter.
   * `dbType` matches ProfileManager's `profile.type` string.
   */
  static normalize(rawText: string, dbType: string): NormalizedPlan {
    const dt = dbType.toLowerCase();
    if (UNSUPPORTED_TYPES.has(dt)) {
      return { dbType: dt, structured: false, nodes: [], rawText, totalCost: undefined, totalRows: undefined };
    }
    if (!NATIVE_TYPES.has(dt)) {
      return { dbType: dt, structured: false, nodes: [{ op: 'RAW', raw: rawText }], rawText, totalCost: undefined, totalRows: undefined };
    }
    // Native path — try to parse
    if (dt === 'sqlite') {
      // SQLite EXPLAIN QUERY PLAN output is already an array of ExplainRow
      // coming from the Explainer's tabular output. Caller passes
      // rows[].detail as rawText here for parsing.
      const lines = rawText.split('\n').filter(Boolean);
      const rows = lines.map(line => {
        const parts = line.split('|');
        return { detail: parts[parts.length - 1]?.trim() ?? line, id: parts[0], parent: parts[1], notused: parts[2] };
      });
      const nodes = parseSqliteExplain(rows as any);
      return { dbType: dt, structured: true, nodes, rawText, totalCost: undefined, totalRows: undefined };
    }
    if (dt === 'mysql') {
      const root = parseMysqlJson(rawText);
      return { dbType: dt, structured: !!root, nodes: root ? [root] : [{ op: 'RAW', raw: rawText }], rawText };
    }
    if (dt === 'postgresql' || dt === 'postgres') {
      const root = parsePgJson(rawText);
      return { dbType: dt, structured: !!root, nodes: root ? [root] : [{ op: 'RAW', raw: rawText }], rawText };
    }
    if (dt === 'mongodb' || dt === 'mongo') {
      const root = parseMongo(rawText);
      return { dbType: dt, structured: !!root, nodes: root ? [root] : [{ op: 'RAW', raw: rawText }], rawText };
    }
    return { dbType: dt, structured: false, nodes: [{ op: 'RAW', raw: rawText }], rawText };
  }

  /** Compute SHA-256 hash of normalized raw text (for query identity). */
  static hashNormalized(plan: NormalizedPlan): string {
    const norm = normalizeRawText(plan.rawText);
    return require('node:crypto').createHash('sha256').update(plan.dbType + '|' + norm).digest('hex').slice(0, 16);
  }
}
