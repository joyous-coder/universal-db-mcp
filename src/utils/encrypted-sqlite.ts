/**
 * EncryptedSqliteBackend (v2.19)
 *
 * Extends v2.16 SQLite multi-backend to support transparent SQLCipher
 * encryption of `profiles.db` (and any other SQLite file the caller wants
 * to encrypt). Two implementations:
 *
 * - {@link NativeSqliteBackend} — opens via the existing v2.16
 *   `detectSqliteBackend()` (tries `node:sqlite`, falls back to
 *   `better-sqlite3`). No encryption.
 *
 * - {@link CipherSqliteBackend} — opens via the optional
 *   `better-sqlite3-multiple-ciphers` package (SQLCipher build of
 *   better-sqlite3) and runs `PRAGMA cipher='sqlcipher'` + `PRAGMA key=...`
 *   immediately after open. Throws a clear error when the dependency is
 *   not installed.
 *
 * Selection is driven by {@link detectEncryptedBackend}: if a non-empty
 * `cipherKey` is supplied, it returns the cipher backend; otherwise the
 * native backend (v2.18 behavior, plaintext).
 *
 * The two backends return the same {@link SQLiteConnection} interface, so
 * consumers like {@link ProfileStore} can swap them transparently.
 */

import {
  detectSqliteBackend,
  wrapBetterSqlite3,
  type SQLiteConnection,
} from '../adapters/sqlite/types.js';

export interface EncryptedSqliteBackend {
  readonly name: 'native' | 'cipher';
  open(
    dbPath: string,
    options: { readonly?: boolean; cipherKey?: string },
  ): Promise<SQLiteConnection>;
}

export class NativeSqliteBackend implements EncryptedSqliteBackend {
  readonly name = 'native' as const;
  async open(
    dbPath: string,
    options: { readonly?: boolean; cipherKey?: string },
  ): Promise<SQLiteConnection> {
    // Route through the existing v2.16 multi-backend (node:sqlite → better-sqlite3).
    const backend = await detectSqliteBackend();
    return backend.open(dbPath, { readonly: options.readonly ?? false });
  }
}

export class CipherSqliteBackend implements EncryptedSqliteBackend {
  readonly name = 'cipher' as const;
  async open(
    dbPath: string,
    options: { readonly?: boolean; cipherKey?: string },
  ): Promise<SQLiteConnection> {
    if (!options.cipherKey) {
      throw new Error(
        'CipherSqliteBackend requires a non-empty cipherKey option',
      );
    }
    // Load the optional SQLCipher build. If absent, fail loudly — never
    // silently fall back to plaintext (would defeat the purpose).
    //
    // The package is optional — only present when the user installs it.
    // The import is dynamic and only resolved at runtime if the package
    // exists on disk.
    //
    // @ts-ignore — runtime-only dependency; optionalDependency in Task 10.
    let Database: any;
    try {
      // @ts-ignore — see comment above.
      const mod: any = await import('better-sqlite3-multiple-ciphers');
      Database = mod.default ?? mod;
    } catch (err) {
      throw new Error(
        'better-sqlite3-multiple-ciphers not installed; cannot open encrypted database. ' +
          'Install it (npm install better-sqlite3-multiple-ciphers) or set DB_PROFILE_ENCRYPTION_KEY="" to use plaintext.',
      );
    }
    const db = new Database(dbPath, {
      readonly: options.readonly ?? false,
      fileMustExist: false,
    });
    // Apply SQLCipher pragmas. Escape embedded quotes in the key to defend
    // against PRAGMA injection (the key is user-controlled env var).
    db.pragma(`cipher='sqlcipher'`);
    const safeKey = options.cipherKey.replace(/'/g, "''");
    db.pragma(`key='${safeKey}'`);
    // Verify key by reading cipher_version. If the key is wrong, this throws.
    try {
      db.pragma('cipher_version');
    } catch (err) {
      try { db.close(); } catch { /* ignore */ }
      throw new Error(
        `failed to decrypt profiles.db — check DB_PROFILE_ENCRYPTION_KEY: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    return wrapBetterSqlite3(db);
  }
}

/**
 * Pick the right backend for the given key.
 *
 * - Non-empty `cipherKey` → {@link CipherSqliteBackend} (SQLCipher).
 * - Empty/undefined → {@link NativeSqliteBackend} (v2.16 multi-backend).
 *
 * Note: this returns a fresh instance each call. The `CipherSqliteBackend`
 * has no per-instance state, so this is cheap. If you want to swap at
 * runtime, just call this factory again.
 */
export function detectEncryptedBackend(
  cipherKey: string | undefined,
): EncryptedSqliteBackend {
  if (cipherKey && cipherKey.length > 0) {
    return new CipherSqliteBackend();
  }
  return new NativeSqliteBackend();
}
