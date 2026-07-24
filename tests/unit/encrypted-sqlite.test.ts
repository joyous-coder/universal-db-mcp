/**
 * EncryptedSqliteBackend unit tests (v2.19)
 *
 * Covers:
 * - Native backend (uses v2.16 multi-backend)
 * - detectEncryptedBackend factory
 * - Cipher backend: only when better-sqlite3-multiple-ciphers is installed
 *   (those tests skip with a clear message otherwise — keep them as smoke
 *   tests for users who do install the optional dep).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import {
  NativeSqliteBackend,
  CipherSqliteBackend,
  detectEncryptedBackend,
} from '../../src/utils/encrypted-sqlite.js';

const ts = Date.now();
const dbPath = `.tmp-enc-${ts}-${Math.random().toString(36).slice(2)}.db`;

function cleanup() {
  if (existsSync(dbPath)) {
    try { unlinkSync(dbPath); } catch { /* ignore */ }
  }
}

// Detect whether the optional SQLCipher build is installed.
async function hasCipherDep(): Promise<boolean> {
  try {
    await import('better-sqlite3-multiple-ciphers');
    return true;
  } catch {
    return false;
  }
}

describe('EncryptedSqliteBackend', () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  describe('NativeSqliteBackend', () => {
    it('opens, writes, reads back', async () => {
      const backend = new NativeSqliteBackend();
      const conn = await backend.open(dbPath, {});
      conn.exec('CREATE TABLE t (x INTEGER)');
      conn.exec('INSERT INTO t VALUES (42)');
      const rows = conn.prepare('SELECT * FROM t').all() as Array<Record<string, unknown>>;
      expect((rows[0] as any).x).toBe(42);
      conn.close();
    });

    it('ignores cipherKey option (no-op for native)', async () => {
      const backend = new NativeSqliteBackend();
      // Passing a key to native is a no-op — must not throw.
      const conn = await backend.open(dbPath, { cipherKey: 'ignored' });
      conn.exec('CREATE TABLE t (x INTEGER)');
      conn.close();
    });
  });

  describe('CipherSqliteBackend (requires optional dep)', () => {
    it('opens encrypted, reads back with same key', async () => {
      if (!(await hasCipherDep())) {
        console.warn('[encrypted-sqlite] skipping cipher test: better-sqlite3-multiple-ciphers not installed');
        return;
      }
      const backend = new CipherSqliteBackend();
      const conn = await backend.open(dbPath, { cipherKey: 'test-key-32-chars-long!!!!' });
      conn.exec('CREATE TABLE t (x INTEGER)');
      conn.exec(`INSERT INTO t VALUES (42)`);
      conn.close();

      const conn2 = await backend.open(dbPath, { cipherKey: 'test-key-32-chars-long!!!!' });
      const rows = conn2.prepare('SELECT * FROM t').all() as Array<Record<string, unknown>>;
      expect((rows[0] as any).x).toBe(42);
      conn2.close();
    });

    it('rejects wrong key with clear error', async () => {
      if (!(await hasCipherDep())) {
        console.warn('[encrypted-sqlite] skipping cipher test: better-sqlite3-multiple-ciphers not installed');
        return;
      }
      const backend = new CipherSqliteBackend();
      const conn = await backend.open(dbPath, { cipherKey: 'right-key-32-chars-long!!!!!!' });
      conn.exec('CREATE TABLE t (x INTEGER)');
      conn.close();

      const conn2 = await backend.open(dbPath, { cipherKey: 'wrong-key-32-chars-long!!!!!!' });
      expect(() => conn2.prepare('SELECT * FROM t').all()).toThrow(/failed to decrypt/);
      conn2.close();
    });
  });

  describe('detectEncryptedBackend', () => {
    it('returns NativeSqliteBackend when cipherKey is undefined', () => {
      expect(detectEncryptedBackend(undefined)).toBeInstanceOf(NativeSqliteBackend);
    });

    it('returns NativeSqliteBackend when cipherKey is empty string', () => {
      expect(detectEncryptedBackend('')).toBeInstanceOf(NativeSqliteBackend);
    });

    it('returns CipherSqliteBackend when cipherKey is non-empty', () => {
      expect(detectEncryptedBackend('my-key')).toBeInstanceOf(CipherSqliteBackend);
    });
  });
});
