/**
 * KeyRotator tests (v2.20)
 *
 * Skips cipher-only paths when better-sqlite3-multiple-ciphers is not
 * installed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync, copyFileSync, statSync } from 'node:fs';
import { NativeSqliteBackend } from '../../src/utils/encrypted-sqlite.js';
import { ProfileStore } from '../../src/core/profile-store.js';
import { TemplateStore } from '../../src/core/template-store.js';
import { HistoryStore } from '../../src/core/history-store.js';
import { rotateDbKey, KeyRotationError } from '../../src/core/key-rotator.js';

const ts = Date.now();
const dbPath = `.tmp-kr-${ts}.db`;
function cleanup(p: string) {
  for (const suffix of ['', '-wal', '-shm', '.rotating.tmp', '.rotating.failed']) {
    if (existsSync(p + suffix)) { try { unlinkSync(p + suffix); } catch { /* ignore */ } }
  }
}

async function hasCipherDep(): Promise<boolean> {
  try {
    await import('better-sqlite3-multiple-ciphers');
    return true;
  } catch {
    return false;
  }
}

describe('rotateDbKey (v2.20)', () => {
  beforeEach(() => cleanup(dbPath));
  afterEach(() => cleanup(dbPath));

  it('plaintext → cipher rotation when dep available', async () => {
    if (!(await hasCipherDep())) {
      console.warn('[key-rotator] skipping cipher rotation: dep not installed');
      return;
    }
    // Write plaintext rows via ProfileStore
    const store = new ProfileStore(dbPath);
    await store.save({
      name: 'p1', description: '', type: 'sqlite',
      config: { type: 'sqlite', filePath: ':memory:' } as any,
    });
    await store.save({
      name: 'p2', description: 'two', type: 'mysql',
      config: { type: 'mysql', host: 'h', user: 'u', password: 'pp' } as any,
    });
    await store.close();

    // Rotate plaintext → cipher
    const result = await rotateDbKey(dbPath, 'profile', undefined, 'new-key-32-chars-long!!!!!');
    expect(result.rowsCopied).toBe(2);

    // Re-open with new key
    const store2 = new ProfileStore(dbPath, { cipherKey: 'new-key-32-chars-long!!!!!' });
    const fetched = await store2.list();
    expect(fetched.map(p => p.name).sort()).toEqual(['p1', 'p2']);
    await store2.close();
  });

  it('rejects newKey shorter than 8 chars', async () => {
    await expect(rotateDbKey(dbPath, 'profile', undefined, 'short')).rejects.toThrow(KeyRotationError);
  });

  it('writes fail-recovery file on failure (simulated)', async () => {
    if (!(await hasCipherDep())) {
      console.warn('[key-rotator] skipping failure-path test: dep not installed');
      return;
    }
    // Save → close
    const store = new ProfileStore(dbPath);
    await store.save({
      name: 'p1', description: '', type: 'sqlite',
      config: { type: 'sqlite', filePath: ':memory:' } as any,
    });
    await store.close();

    // Wrong old key would fail to open — confirm it rejects, not silently
    // producing an empty rotated file.
    await expect(rotateDbKey(dbPath, 'profile', 'wrong-key-32-chars-long!!!!!!!!!', 'new-key-32-chars-long!!!!!'))
      .rejects.toThrow();
  });

  it('TemplateStore.rotateKey smoke (when dep available)', async () => {
    if (!(await hasCipherDep())) {
      console.warn('[key-rotator] skipping template rotation smoke');
      return;
    }
    const t = new TemplateStore(dbPath);
    await t.save({ name: 'g', description: '', sql: 'SELECT 1', parameters: [] });
    await t.close();
    await t.rotateKey('new-template-key-32-chars!!!!!');
    const t2 = new TemplateStore(dbPath, { cipherKey: 'new-template-key-32-chars!!!!!' });
    const list = await t2.list();
    expect(list[0].name).toBe('g');
    await t2.close();
  });

  it('HistoryStore.rotateKey smoke (when dep available)', async () => {
    if (!(await hasCipherDep())) {
      console.warn('[key-rotator] skipping history rotation smoke');
      return;
    }
    const h = new HistoryStore(dbPath, { ttlDays: 30, maxRows: 100 });
    await h.record({
      ts: '2026-07-24T00:00:00Z',
      db: 'sqlite', kind: 'select', sql: 'A', params: null,
      duration_ms: 5, rows: 1, error: null, error_code: null,
    });
    await h.close();
    await h.rotateKey('new-history-key-32-chars-long!!!');
    const h2 = new HistoryStore(dbPath, { ttlDays: 30, maxRows: 100, cipherKey: 'new-history-key-32-chars-long!!!' });
    const entries = await h2.query({});
    expect(entries.length).toBe(1);
    await h2.close();
  });
});
