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

    // v3.2.8 Bug #38 fix: Oracle's `EXPLAIN PLAN FOR <sql>` doesn't return rows
    // — it populates PLAN_TABLE silently. Need 2-step:
    //   1. EXPLAIN PLAN FOR <sql>
    //   2. SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY())
    if (this.dbType === 'oracle') {
      const explainSql = `EXPLAIN PLAN FOR ${sql.trim().replace(/;$/, '')}`;
      await this.adapter.executeQuery(explainSql, params);
      const displaySql = `SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY())`;
      const displayResult = await this.adapter.executeQuery(displaySql);
      const displayRows = (displayResult.rows ?? []) as Array<Record<string, unknown>>;
      const raw = displayRows.map(r => Object.values(r).join('|')).join('\n');
      const plan = this.parsePlan(displayRows);
      return { db: this.dbType, sql, plan, raw, format: 'tabular', duration_ms: Date.now() - start };
    }

    // v3.2.8 Bug #43 fix: DM (达梦) `EXPLAIN <sql>` doesn't return rows in dmdb driver.
    // v3.2.8 Bug #49 fix: Use `EXPLAIN AS <plan_name> FOR <sql>` syntax which DOES return rows
    // via dmdb (verified with forresttse/dm8:latest image).
    // Returns 19 columns: plan_id, plan_name, create_time, level_id, operation, tab_name,
    // idx_name, scan_type, scan_range, row_nums, bytes, cost, cpu_cost, io_cost,
    // filter, join_cond, advice_info, pstart, pstop.
    if (this.dbType === 'dm') {
      const trimmed = sql.trim().replace(/;$/, '');
      // 生成 session 唯一 plan_name(用 EXPLAIN AS 需要 plan_name 唯一)
      const planName = `MCP_${Date.now().toString(36)}`;
      const explainSql = `EXPLAIN AS ${planName} FOR ${trimmed}`;
      try {
        const result = await this.adapter.executeQuery(explainSql, params);
        const rows = (result.rows ?? []) as Array<Record<string, unknown>>;
        if (rows.length === 0) {
          // v3.2.8 Bug #43 fallback: 兜底(实测 dmdb 总返回 rows,但保留 fallback 兼容未来变化)
          return {
            db: this.dbType,
            sql,
            plan: [],
            raw: `⚠️ DM \`EXPLAIN AS ${planName} FOR <sql>\` returned 0 rows.\n` +
                 `For detailed DM plans use DISQL \`SET AUTOTRACE TRACE\` or DM Manager Studio.`,
            format: 'tabular',
            duration_ms: Date.now() - start,
          };
        }
        // 把 DM 原始行转成 ExplainRow 格式(level_id 0 在底,DM 自下而上)
        const plan = rows.map((r, i) => ({
          id: i + 1,
          level: Number(r.level_id ?? r.LEVEL_ID ?? 0),
          operation: String(r.operation ?? r.OPERATION ?? ''),
          table: String(r.tab_name ?? r.TAB_NAME ?? '') || undefined,
          index: String(r.idx_name ?? r.IDX_NAME ?? '') || undefined,
          scanType: String(r.scan_type ?? r.SCAN_TYPE ?? '') || undefined,
          scanRange: String(r.scan_range ?? r.SCAN_RANGE ?? '') || undefined,
          rows: Number(r.row_nums ?? r.ROW_NUMS ?? 0),
          bytes: Number(r.bytes ?? r.BYTES ?? 0),
          cost: Number(r.cost ?? r.COST ?? 0),
          filter: String(r.filter ?? r.FILTER ?? '') || undefined,
          joinCond: String(r.join_cond ?? r.JOIN_COND ?? '') || undefined,
        }));
        const raw = rows.map(r => {
          const lvl = r.level_id ?? r.LEVEL_ID;
          const op = r.operation ?? r.OPERATION;
          const tab = r.tab_name ?? r.TAB_NAME;
          const idx = r.idx_name ?? r.IDX_NAME;
          return `[L${lvl}] ${op}${tab && tab !== 'NULL' ? ' table=' + tab : ''}${idx && idx !== 'NULL' ? ' idx=' + idx : ''}`;
        }).join('\n');
        return { db: this.dbType, sql, plan, raw, format: 'tabular', duration_ms: Date.now() - start };
      } catch (e) {
        return {
          db: this.dbType,
          sql,
          plan: [],
          raw: `explain_query failed for dm: ${e instanceof Error ? e.message : String(e)}`,
          format: 'tabular',
          duration_ms: Date.now() - start,
        };
      }
    }

    // v3.2.8 Bug #39 fix: SQL Server `SET SHOWPLAN_TEXT ON; <sql>; SET SHOWPLAN_TEXT OFF;`
    // ① SET SHOWPLAN_TEXT must be the only statement in its batch (so 3-statement batch fails).
    // ② The mssql npm package does NOT respect SET options across separate executeQuery
    //    calls — SET runs on one pool connection, the actual query runs on another.
    // ③ Same-connection workaround via `pool.acquire()` also returns data rows instead
    //    of plan rows (verified live against SQL Server 2022 RTM-CU26).
    // Workaround: try the 3-call approach. If it returns data rows (which it does), return
    // them as the raw output with a marker so users see actual data + know the plan
    // retrieval didn't work, rather than a confusing error.
    if (this.dbType === 'sqlserver') {
      const trimmed = sql.trim().replace(/;$/, '');
      try {
        await this.adapter.executeQuery('SET SHOWPLAN_TEXT ON');
        const result = await this.adapter.executeQuery(trimmed, params);
        await this.adapter.executeQuery('SET SHOWPLAN_TEXT OFF');
        const rows = (result.rows ?? []) as Array<Record<string, unknown>>;
        const raw = rows.map(r => Object.values(r).join('|')).join('\n');
        const plan = this.parsePlan(rows);
        // Heuristic: plan rows usually have a `StmtText` or `PhysicalOp` column; data rows
        // don't. If we don't see those markers, SET was ignored and we got data back.
        const firstRowKeys = rows[0] ? Object.keys(rows[0]) : [];
        const isPlanRow = firstRowKeys.some(k => /StmtText|PhysicalOp|Argument|EstimateRows/i.test(k));
        if (!isPlanRow && rows.length > 0) {
          return {
            db: this.dbType,
            sql,
            plan: [],
            raw: '⚠️ SET SHOWPLAN_TEXT not respected by mssql driver — returned data rows instead of plan.\n' +
                 'For SQL Server execution plans, use SSMS or `SET STATISTICS XML ON` directly.\n' +
                 'Data preview:\n' + raw,
            format: 'xml',
            duration_ms: Date.now() - start,
          };
        }
        return { db: this.dbType, sql, plan, raw, format: 'xml', duration_ms: Date.now() - start };
      } catch (e) {
        return {
          db: this.dbType,
          sql,
          plan: [],
          raw: `explain_query failed for sqlserver: ${e instanceof Error ? e.message : String(e)}`,
          format: 'xml',
          duration_ms: Date.now() - start,
        };
      }
    }

    // v5.0.1 Bug N7: MySQL/PG 用 EXPLAIN <sql> + binary protocol + bound params 时,
    // server 端不返回 plan 行(返回空 rows)。改用 FORMAT=JSON 让 server 返回 JSON 文本。
    // JSON 解析走已有的 parseMysqlJson / parsePgJson(`src/core/explain-parser.ts`)。
    const explainSql = this.buildExplainSql(sql);
    const result = await this.adapter.executeQuery(explainSql, params);
    const rows = (result.rows ?? []) as Array<Record<string, unknown>>;
    const isJsonFormat = this.usesJsonFormat();

    if (isJsonFormat) {
      // JSON 形式:rows 通常 1 行,某列含 JSON 文本
      const jsonText = this.extractJsonColumn(rows);
      const raw = jsonText ?? rows.map(r => Object.values(r).join('|')).join('\n');
      const plan = jsonText ? this.parseJsonPlan(jsonText) : [];
      return {
        db: this.dbType, sql, plan, raw,
        format: 'json', duration_ms: Date.now() - start,
      };
    }

    const raw = rows.map(r => Object.values(r).join('|')).join('\n');
    const plan = this.parsePlan(rows);
    const format: ExplainResult['format'] = this.dbType === 'sqlserver' ? 'xml' : 'tabular';
    return { db: this.dbType, sql, plan, raw, format, duration_ms: Date.now() - start };
  }

  private usesJsonFormat(): boolean {
    return this.dbType === 'mysql' || this.dbType === 'mariadb'
      || this.dbType === 'postgres' || this.dbType === 'kingbase'
      || this.dbType === 'gaussdb' || this.dbType === 'vastbase'
      || this.dbType === 'highgo' || this.dbType === 'tidb'
      || this.dbType === 'oceanbase' || this.dbType === 'polardb'
      || this.dbType === 'goldendb';
  }

  /**
   * 从 rows 中提取 JSON 字符串列。MySQL `EXPLAIN FORMAT=JSON` 返回 1 行 1 列,
   * 列名 `EXPLAIN`;PG `EXPLAIN (FORMAT JSON)` 返回 1 行 1 列,列名 `QUERY PLAN`。
   * 兜底:任何 row 的任何 string value 都试一下 JSON.parse。
   */
  private extractJsonColumn(rows: Array<Record<string, unknown>>): string | null {
    for (const row of rows) {
      for (const v of Object.values(row)) {
        if (typeof v === 'string') {
          const s = v.trim();
          if (s.startsWith('{') || s.startsWith('[')) {
            // PG `QUERY PLAN` 在外面包了一层 {...},可能直接是对象字符串
            try { JSON.parse(s); return s; } catch { /* keep looking */ }
          }
        }
      }
    }
    return null;
  }

  /** 把 JSON plan 解析成扁平的 ExplainRow[](顶层算子),便于 LLM 看到结构。 */
  private parseJsonPlan(jsonText: string): ExplainRow[] {
    try {
      const parsed = JSON.parse(jsonText);
      if (this.dbType === 'mysql' || this.dbType === 'mariadb') {
        const root = parsed.query_block;
        if (!root) return [];
        const out: ExplainRow[] = [];
        this.walkMysqlPlan(root, out, 1);
        return out;
      }
      // PG 家族
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      const root = arr[0]?.Plan ?? arr[0];
      if (!root) return [];
      const out: ExplainRow[] = [];
      this.walkPgPlan(root, out, 1);
      return out;
    } catch {
      return [];
    }
  }

  private walkMysqlPlan(node: any, out: ExplainRow[], level: number): void {
    const op = Object.keys(node).find(k => k !== 'cost_info' && k !== 'rows' && k !== 'table');
    const table = node.table?.table_name ?? node.table?.table;
    const index = node.table?.key;
    const cost = node.cost_info?.query_cost;
    const rows = node.rows;
    if (op) {
      out.push({
        id: level,
        select_type: op.toUpperCase(),
        table,
        type: index ? 'ref' : 'ALL',
        key: index,
        rows: typeof rows === 'number' ? rows : undefined,
        Extra: typeof cost === 'number' ? `cost=${cost}` : undefined,
      });
    }
    for (const v of Object.values(node)) {
      if (Array.isArray(v)) v.forEach(c => { if (typeof c === 'object') this.walkMysqlPlan(c, out, level + 1); });
      else if (typeof v === 'object' && v !== node.table && v !== node.cost_info) {
        this.walkMysqlPlan(v, out, level + 1);
      }
    }
  }

  private walkPgPlan(node: any, out: ExplainRow[], level: number): void {
    if (!node || typeof node !== 'object') return;
    out.push({
      id: level,
      select_type: String(node['Node Type'] ?? 'UNKNOWN'),
      table: node['Relation Name'],
      type: node['Index Name'] ? 'index' : 'seq',
      key: node['Index Name'],
      rows: typeof node['Plan Rows'] === 'number' ? node['Plan Rows'] : undefined,
      Extra: typeof node['Total Cost'] === 'number' ? `cost=${node['Total Cost']}` : undefined,
    });
    if (Array.isArray(node.Plans)) {
      node.Plans.forEach((c: any) => this.walkPgPlan(c, out, level + 1));
    }
  }

  private buildExplainSql(sql: string): string {
    const trimmed = sql.trim().replace(/;$/, '');
    switch (this.dbType) {
      case 'sqlite':
        return `EXPLAIN QUERY PLAN ${trimmed}`;
      case 'mysql':
      case 'mariadb':
        // v5.0.1 Bug N7: tabular EXPLAIN + bound params 在 binary protocol 下返回空 rows,
        // 改用 FORMAT=JSON 让 server 返回 JSON 文本
        return `EXPLAIN FORMAT=JSON ${trimmed}`;
      case 'postgres':
      case 'kingbase':
      case 'gaussdb':
      case 'vastbase':
      case 'highgo':
      case 'tidb':
      case 'oceanbase':
      case 'polardb':
      case 'goldendb':
        // v5.0.1 Bug N7: PG 同上,FORMAT JSON 让 server 返回 JSON 文本
        return `EXPLAIN (FORMAT JSON) ${trimmed}`;
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
