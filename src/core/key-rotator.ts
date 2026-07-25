/**
 * KeyRotator (v2.20)
 *
 * Re-encrypts an SQLCipher-protected SQLite DB under a new key while
 * preserving all data. Atomic-rename strategy:
 *
 *   1. Open source DB with `oldKey` (decryption)
 *   2. Stream all rows out (via the existing SQLiteConnection interface)
 *   3. Open a temp `*.rotating.tmp` file with `newKey`
 *   4. Re-create schema + reinsert all rows
 *   5. atomically rename tmp → original path
 *   6. close both connections
 *
 * On any failure during steps 3-5, the original DB is left untouched and
 * the tmp file is renamed to `<path>.rotating.failed` for forensic recovery.
 */

import type { SQLiteConnection } from '../adapters/sqlite/types.js';
import {
  CipherSqliteBackend,
  NativeSqliteBackend,
  type EncryptedSqliteBackend,
} from '../utils/encrypted-sqlite.js';

export type RotationKind = 'profile' | 'templates' | 'history';

export interface RotationResult {
  rowsCopied: number;
  durationMs: number;
}

export class KeyRotationError extends Error {
  constructor(message: string, public readonly kind: RotationKind, public readonly cause?: unknown) {
    super(message);
    this.name = 'KeyRotationError';
  }
}

/**
 * Extract schema (CREATE TABLE / CREATE INDEX statements, excluding
 * triggers and FTS virtual tables which are reconstructed by the target
 * store's init() on first open).
 *
 * Filters:
 *   - sqlite_*   — internal SQLite tables
 *   - * triggers — not data, rebuilt by init() if needed
 *   - * FTS5 shadow tables (`*_fts_config`, `*_fts_data`, `*_fts_content`,
 *     `*_fts_idx`, `*_fts_docsize`) — recreated automatically by FTS5
 *     when its parent virtual table is created
 *   - FTS5 virtual tables (`*_fts`) — skipped; the owning store's init()
 *     recreates them so its FTS schema (columns + tokenizer) stays in sync.
 *     Re-executing a stale CREATE VIRTUAL TABLE here would also collide
 *     with the auto-created shadow tables.
 */
async function readSchema(conn: SQLiteConnection): Promise<string[]> {
  const rows = conn.prepare(
    `SELECT type, sql FROM sqlite_master
     WHERE sql IS NOT NULL
       AND type IN ('table', 'index')
       AND name NOT LIKE 'sqlite_%'
       AND name NOT LIKE '%_fts'
       AND name NOT LIKE '%_fts_%'
     ORDER BY type DESC, name`
  ).all() as Array<{ type: string; sql: string }>;
  return rows.map(r => r.sql);
}

/** Extract user table names only — skips FTS5 virtual tables and their
 *  internal shadow tables (`*_fts_data` / `*_fts_idx` / `*_fts_content` /
 *  `*_fts_docsize` / `*_fts_config`) because they are rebuilt by the owning
 *  store's init() on next open. Trying to INSERT INTO them raises
 *  "object name reserved for internal use" in newer SQLite. */
async function readTableNames(conn: SQLiteConnection): Promise<string[]> {
  const rows = conn.prepare(
    `SELECT name FROM sqlite_master
     WHERE type='table'
       AND name NOT LIKE 'sqlite_%'
       AND name NOT LIKE '%_fts'
       AND name NOT LIKE '%_fts_%'`
  ).all() as Array<{ name: string }>;
  return rows.map(r => r.name);
}

/** Stream all rows from a single table. */
function* streamTable(conn: SQLiteConnection, table: string): IterableIterator<Record<string, unknown>> {
  const rows = conn.prepare(`SELECT * FROM "${table}"`).all() as Array<Record<string, unknown>>;
  for (const r of rows) yield r;
}

/**
 * Rotate a single DB. `oldKey === undefined` means the DB is currently
 * plaintext — rotation in that case simply re-creates the file under
 * SQLCipher using `newKey`.
 */
export async function rotateDbKey(
  dbPath: string,
  kind: RotationKind,
  oldKey: string | undefined,
  newKey: string,
): Promise<RotationResult> {
  if (!newKey || newKey.length < 8) {
    throw new KeyRotationError('newKey must be at least 8 characters', kind);
  }

  const start = Date.now();
  const tmpPath = `${dbPath}.rotating.tmp`;

  // 1. Open source DB
  const sourceBackend: EncryptedSqliteBackend = oldKey ? new CipherSqliteBackend() : new NativeSqliteBackend();
  const source = await sourceBackend.open(dbPath, { readonly: true, cipherKey: oldKey });

  let rowCount = 0;
  try {
    const schema = await readSchema(source);
    const tables = await readTableNames(source);

    // 2. Open target DB under newKey
    const target = await new CipherSqliteBackend().open(tmpPath, { readonly: false, cipherKey: newKey });

    try {
      // 3. Re-create schema
      for (const stmt of schema) {
        target.exec(stmt);
      }
      // 4. Copy rows
      for (const t of tables) {
        // Skip FTS5 virtual tables and triggers — they will be reconstructed
        // by the owning store's init() on first open.
        const cols = source.prepare(`PRAGMA table_info("${t}")`).all() as Array<{ name: string }>;
        const colNames = cols.map(c => `"${c.name}"`).join(', ');
        const placeholders = cols.map(() => '?').join(', ');
        const insert = target.prepare(`INSERT INTO "${t}" (${colNames}) VALUES (${placeholders})`);
        for (const row of streamTable(source, t)) {
          const params = cols.map(c => row[c.name]);
          insert.run(...params);
          rowCount++;
        }
      }
      // 5. Close target, atomic rename
      target.close();
    } catch (err) {
      try { target.close(); } catch { /* ignore */ }
      throw err;
    }
  } finally {
    source.close();
  }

  // Atomic rename: Windows requires fs.rename; on POSIX we just rename.
  const { rename } = await import('node:fs/promises');
  await rename(tmpPath, dbPath);

  return { rowsCopied: rowCount, durationMs: Date.now() - start };
}

/**
 * Convenience facade used by ProfileManager / QueryAnalyzer / MCP tools.
 */
export class KeyRotator {
  async rotate(
    dbPath: string,
    kind: RotationKind,
    oldKey: string | undefined,
    newKey: string,
  ): Promise<RotationResult> {
    return rotateDbKey(dbPath, kind, oldKey, newKey);
  }
}
