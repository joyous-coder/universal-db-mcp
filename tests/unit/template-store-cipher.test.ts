/**
 * TemplateStore cipher tests (v2.20)
 *
 * Verifies that TemplateStore accepts a cipherKey option (like ProfileStore
 * from v2.19). Without the option, plaintext v2.17-v2.19 behavior is preserved.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { TemplateStore } from '../../src/core/template-store.js';

const dbPath = `.tmp-tpl-cipher-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;

async function hasCipherDep(): Promise<boolean> {
  try {
    await import('better-sqlite3-multiple-ciphers');
    return true;
  } catch {
    return false;
  }
}

function cleanup(p: string) {
  if (existsSync(p)) { try { unlinkSync(p); } catch { /* ignore */ } }
}

describe('TemplateStore cipher (v2.20)', () => {
  beforeEach(() => cleanup(dbPath));
  afterEach(() => cleanup(dbPath));

  it('without cipherKey: v2.17-v2.19 plaintext behavior + encrypted flag false', async () => {
    const store = new TemplateStore(dbPath);
    await store.save({ name: 'g', description: '', sql: 'SELECT 1', parameters: [] });
    expect(store.encrypted).toBe(false);
    await store.close();
  });

  it('constructor accepts empty options object', async () => {
    const store = new TemplateStore(dbPath, {});
    await store.save({ name: 'g', description: '', sql: 'SELECT 1', parameters: [] });
    expect(store.encrypted).toBe(false);
    await store.close();
  });

  it('cipherKey present triggers encrypted=true after init', async () => {
    if (!(await hasCipherDep())) {
      console.warn('[template-store-cipher] skipping encrypted-flag check: dep not installed');
      return;
    }
    const store = new TemplateStore(dbPath, { cipherKey: 'test-key-32-chars-long!!!!' });
    await store.save({ name: 'g', description: '', sql: 'SELECT 1', parameters: [] });
    expect(store.encrypted).toBe(true);
    await store.close();
  });

  it('with cipherKey: opens via cipher backend when dep present (roundtrip)', async () => {
    if (!(await hasCipherDep())) {
      console.warn('[template-store-cipher] skipping cipher roundtrip: better-sqlite3-multiple-ciphers not installed');
      return;
    }
    const key = 'test-key-32-chars-long!!!!';
    const store = new TemplateStore(dbPath, { cipherKey: key });
    await store.save({ name: 'g', description: '', sql: 'SELECT 1', parameters: [], profile_name: 'p1' });
    await store.close();
    const store2 = new TemplateStore(dbPath, { cipherKey: key });
    const list = await store2.list({ profileName: 'p1' });
    expect(list.length).toBe(1);
    expect(list[0].name).toBe('g');
    await store2.close();
  });

  it('with wrong cipherKey: throws clear error on read', async () => {
    if (!(await hasCipherDep())) {
      console.warn('[template-store-cipher] skipping wrong-key test: dep not installed');
      return;
    }
    const store = new TemplateStore(dbPath, { cipherKey: 'right-key-32-chars-long!!!!!!' });
    await store.save({ name: 'g', description: '', sql: 'SELECT 1', parameters: [] });
    await store.close();
    const store2 = new TemplateStore(dbPath, { cipherKey: 'wrong-key-32-chars-long!!!!!!' });
    let threw = false;
    try {
      await store2.list();
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    try { await store2.close(); } catch { /* ignore */ }
  });
});
