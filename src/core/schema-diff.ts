/**
 * SchemaDiff (v3.x)
 *
 * Compares schema between two profiles using v2.18 GlobalSchemaView.
 * Reports added/removed/modified tables + column-level changes.
 */

import type { ProfileManager } from './profile-manager.js';
import {
  buildGlobalSchemaView,
  type ProfileSchema,
} from './global-schema-view.js';

export interface SchemaColumn {
  name: string;
  type: string;
  nullable: boolean;
}

export interface SchemaDiffEntry {
  table: string;
  in: 'A' | 'B';
  columns: SchemaColumn[];
}

export interface SchemaDiffModified {
  table: string;
  columnsAdded: SchemaColumn[];
  columnsRemoved: SchemaColumn[];
  columnsChanged: { column: string; from: SchemaColumn | null; to: SchemaColumn | null }[];
}

export interface SchemaDiffResult {
  /** Tables present in B but missing in A. */
  added: SchemaDiffEntry[];
  /** Tables present in A but missing in B. */
  removed: SchemaDiffEntry[];
  /** Tables present in both but with column differences. */
  modified: SchemaDiffModified[];
  /** True when added/removed/modified are all empty. */
  identical: boolean;
  /** Helpful summary for LLM. */
  summary: string;
}

interface FlatTable {
  fullName: string;
  columns: Map<string, SchemaColumn>;
}

/** Flatten a profile's schema into a Map of `schema.tableName → columns`. */
function flatten(schema: ProfileSchema): Map<string, FlatTable> {
  const out = new Map<string, FlatTable>();
  for (const t of schema.tables) {
    // v5.0.1 Bug N5: PG adapter 已在 `name` 字段返回 "schema.table"(`schema` 字段单独也有),
    // 直接拼成 "schema.schema.table" 双前缀。其他 adapter(MySQL/Oracle/DM)的 t.name
    // 不含点,才需要 `${t.schema}.${t.name}` 拼装。统一规则: t.name 已含 . 时直接用。
    const fullName = t.schema && !t.name.includes('.') ? `${t.schema}.${t.name}` : t.name;
    const cols = new Map<string, SchemaColumn>();
    for (const c of t.columns) {
      cols.set(c.name, { name: c.name, type: c.type, nullable: c.nullable });
    }
    out.set(fullName, { fullName, columns: cols });
  }
  return out;
}

function tableColumns(a: FlatTable): SchemaColumn[] {
  return [...a.columns.values()];
}

export class SchemaDiff {
  /**
   * Compare schema of two profiles. Returns added (in B), removed (in A),
   * modified (column additions / removals / type changes), and identical
   * (a boolean).
   *
   * Profiles are loaded via {@link ProfileManager.loadProfile}, which creates
   * live connections as needed. Reuse ProfileManager's existing connection
   * cache by leveraging the global schema view; we still call buildGlobalSchemaView
   * to keep dependencies minimal.
   */
  static async compareProfiles(
    pm: ProfileManager,
    nameA: string,
    nameB: string,
    options: { maxTablesPerProfile?: number } = {},
  ): Promise<SchemaDiffResult> {
    if (!pm.isEnabled()) throw new Error('ProfileManager disabled');
    const view = await buildGlobalSchemaView(pm);
    const a = view.profiles.find(p => p.name === nameA);
    const b = view.profiles.find(p => p.name === nameB);
    if (!a) throw new Error(`profile not found: ${nameA}`);
    if (!b) throw new Error(`profile not found: ${nameB}`);
    // v4.0 G8: cap per-profile tables to avoid 1MB+ output on big DBs
    const max = options.maxTablesPerProfile ?? 100;
    if (a.tables.length > max) a.tables = a.tables.slice(0, max);
    if (b.tables.length > max) b.tables = b.tables.slice(0, max);

    const flatA = flatten(a);
    const flatB = flatten(b);

    const added: SchemaDiffEntry[] = [];
    const removed: SchemaDiffEntry[] = [];
    const modified: SchemaDiffModified[] = [];

    // Tables in B but not A
    for (const [name, t] of flatB) {
      if (!flatA.has(name)) {
        added.push({ table: name, in: 'B', columns: tableColumns(t) });
      }
    }
    // Tables in A but not B
    for (const [name, t] of flatA) {
      if (!flatB.has(name)) {
        removed.push({ table: name, in: 'A', columns: tableColumns(t) });
      }
    }
    // Tables in both — compare columns
    for (const [name, ta] of flatA) {
      const tb = flatB.get(name);
      if (!tb) continue;
      const colsAdded: SchemaColumn[] = [];
      const colsRemoved: SchemaColumn[] = [];
      const colsChanged: { column: string; from: SchemaColumn | null; to: SchemaColumn | null }[] = [];
      for (const [cname, cb] of tb.columns) {
        const ca = ta.columns.get(cname);
        if (!ca) {
          colsAdded.push(cb);
        } else if (ca.type !== cb.type || ca.nullable !== cb.nullable) {
          colsChanged.push({ column: cname, from: ca, to: cb });
        }
      }
      for (const [cname, ca] of ta.columns) {
        if (!tb.columns.has(cname)) colsRemoved.push(ca);
      }
      if (colsAdded.length || colsRemoved.length || colsChanged.length) {
        modified.push({ table: name, columnsAdded: colsAdded, columnsRemoved: colsRemoved, columnsChanged: colsChanged });
      }
    }

    const identical = added.length === 0 && removed.length === 0 && modified.length === 0;
    const summary = identical
      ? `profiles ${nameA} and ${nameB} have identical schema`
      : `compared ${nameA} vs ${nameB}: ${added.length} added, ${removed.length} removed, ${modified.length} modified tables`;
    return { added, removed, modified, identical, summary };
  }
}
