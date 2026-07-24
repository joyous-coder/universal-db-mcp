/**
 * SQLite Backend Abstraction
 *
 * Multi-backend support: tries `node:sqlite` (Node 22.5+, zero deps, fastest)
 * first, then falls back to `better-sqlite3` (any Node with prebuilt binary).
 *
 * Both backends expose the same minimal interface needed by the SQLiteAdapter.
 *
 * Note: `node:sqlite` is a built-in module accessed via the `node:` URL scheme.
 * We use createRequire to load it from CJS, since vitest's ESM resolver
 * doesn't recognize the `node:` scheme for built-in modules.
 */

import { createRequire } from 'node:module';
const builtinRequire = createRequire(import.meta.url);

export interface SQLiteConnection {
  /** Execute a multi-statement SQL script with no result */
  exec(sql: string): void;

  /** Prepare a parameterized statement */
  prepare(sql: string): SQLiteStatement;

  /** Set PRAGMA (e.g. foreign_keys = ON) */
  pragma(key: string, value: string): void;

  /** Close the connection */
  close(): void;
}

export interface SQLiteStatement {
  /** Run a SELECT and return all rows as objects */
  all(...params: unknown[]): Record<string, unknown>[];

  /** Run a SELECT and return the first row (or undefined) */
  get(...params: unknown[]): Record<string, unknown> | undefined;

  /** Run INSERT/UPDATE/DELETE; return changes count and lastInsertRowid */
  run(...params: unknown[]): SQLiteRunResult;
}

export interface SQLiteRunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface SQLiteBackend {
  name: 'node-sqlite' | 'better-sqlite3';

  /**
   * Open a connection to a database file (or ':memory:' for in-memory).
   * `readonly: true` is supported when the backend allows it.
   */
  open(filePath: string, options: { readonly?: boolean }): Promise<SQLiteConnection>;
}

/**
 * Try `node:sqlite` first (Node 22.5+ built-in, no native module).
 * On failure (older Node, missing module, etc.) fall back to `better-sqlite3`.
 *
 * Cached: the first successful detection is reused for the process lifetime.
 */
let cachedBackend: SQLiteBackend | null = null;
let cachedBackendName: string | null = null;

export async function detectSqliteBackend(): Promise<SQLiteBackend> {
  if (cachedBackend) {
    return cachedBackend;
  }

  // 1) Try `node:sqlite` (Node 22.5+). Load via builtin require to bypass
  //    vitest's ESM resolver which doesn't recognize the `node:` scheme.
  try {
    const mod = builtinRequire('node:sqlite') as any;
    const { DatabaseSync } = mod;
    if (typeof DatabaseSync === 'function') {
      const backend: SQLiteBackend = {
        name: 'node-sqlite',
        async open(filePath, options) {
          const db = new DatabaseSync(filePath, {
            readOnly: options.readonly ?? false,
          });
          return wrapNodeSqlite(db);
        },
      };
      // Smoke test: open in-memory, exec, close.
      const tmp = new DatabaseSync(':memory:');
      tmp.exec('CREATE TABLE _probe (x INTEGER)');
      tmp.exec('DROP TABLE _probe');
      tmp.close();
      cachedBackend = backend;
      cachedBackendName = 'node-sqlite';
      console.error(`[sqlite] Using backend: node:sqlite (Node ${process.versions.node})`);
      return backend;
    }
  } catch (e) {
    console.error(`[sqlite] node:sqlite not available: ${e instanceof Error ? e.message : String(e)}`);
    // node:sqlite not available (Node < 22.5) — try fallback
  }

  // 2) Fall back to `better-sqlite3`.
  try {
    const mod = await import('better-sqlite3');
    const Database = (mod as any).default ?? mod;
    if (typeof Database === 'function') {
      const backend: SQLiteBackend = {
        name: 'better-sqlite3',
        async open(filePath, options) {
          const db = new Database(filePath, {
            readonly: options.readonly ?? false,
            fileMustExist: false,
          });
          return wrapBetterSqlite3(db);
        },
      };
      // Smoke test: in-memory doesn't work with readonly, use a tmp file.
      const tmpPath = `${process.cwd()}/.sqlite-probe-${Date.now()}.db`;
      try {
        const tmp = new Database(tmpPath, { fileMustExist: false });
        tmp.exec('CREATE TABLE _probe (x INTEGER)');
        tmp.exec('DROP TABLE _probe');
        tmp.close();
        require('node:fs').unlinkSync(tmpPath);
      } catch (e) {
        throw new Error(`better-sqlite3 failed smoke test: ${e instanceof Error ? e.message : String(e)}`);
      }
      cachedBackend = backend;
      cachedBackendName = 'better-sqlite3';
      console.error(`[sqlite] Using backend: better-sqlite3 (Node ${process.versions.node})`);
      return backend;
    }
  } catch (e) {
    throw new Error(
      `No SQLite backend available. Tried node:sqlite and better-sqlite3. ` +
      `Last error: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  throw new Error('No SQLite backend available');
}

export function getActiveBackendName(): string | null {
  return cachedBackendName;
}

/**
 * Wrap a better-sqlite3-compatible Database instance to expose the
 * SQLiteConnection interface. Used by EncryptedSqliteBackend when opening
 * SQLCipher-encrypted databases via `better-sqlite3-multiple-ciphers`.
 *
 * Exported so other modules (e.g. encrypted-sqlite.ts) can reuse the wrapper.
 */
export function wrapBetterSqlite3(db: any): SQLiteConnection {
  return {
    exec(sql) {
      db.exec(sql);
    },
    prepare(sql) {
      const stmt = db.prepare(sql);
      return {
        all(...params) {
          return stmt.all(...params) as Record<string, unknown>[];
        },
        get(...params) {
          return stmt.get(...params) as Record<string, unknown> | undefined;
        },
        run(...params) {
          const r = stmt.run(...params);
          return {
            changes: Number(r.changes ?? 0),
            lastInsertRowid: Number(r.lastInsertRowid ?? 0),
          };
        },
      };
    },
    pragma(key, value) {
      db.pragma(`${key} = ${value}`);
    },
    close() {
      try { db.close(); } catch { /* ignore */ }
    },
  };
}

// ============================================================================
// Wrappers: adapt each backend's API to the SQLiteConnection interface
// ============================================================================

function wrapNodeSqlite(db: any): SQLiteConnection {
  return {
    exec(sql) {
      db.exec(sql);
    },
    prepare(sql) {
      const stmt = db.prepare(sql);
      return {
        all(...params) {
          return stmt.all(...params) as Record<string, unknown>[];
        },
        get(...params) {
          return stmt.get(...params) as Record<string, unknown> | undefined;
        },
        run(...params) {
          const r = stmt.run(...params);
          return {
            changes: Number(r.changes ?? 0),
            lastInsertRowid: r.lastInsertRowid ?? 0,
          };
        },
      };
    },
    pragma(key, value) {
      // node:sqlite doesn't expose a generic pragma() helper; emulate via exec.
      db.exec(`PRAGMA ${key} = ${value}`);
    },
    close() {
      try { db.close(); } catch { /* ignore */ }
    },
  };
}
