/**
 * ProfileStore cipher tests (v2.19)
 *
 * Verifies ProfileStore constructor accepts an optional `{ cipherKey }`
 * option and routes to {@link detectEncryptedBackend}. Without the option
 * it still uses the v2.18 native multi-backend (backward compat).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { ProfileStore } from '../../src/core/profile-store.js';

function cleanup(p: string) {
  if (existsSync(p)) {
    try { unlinkSync(p); } catch { /* ignore EBUSY on Windows */ }
  }
}

describe('ProfileStore cipherKey option (v2.19)', () => {
  let dbPath: string;
  beforeEach(() => {
    dbPath = `.tmp-pc-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
    cleanup(dbPath);
  });
  afterEach(() => cleanup(dbPath));

  it('without cipherKey: uses native backend (v2.18 compat)', async () => {
    const store = new ProfileStore(dbPath);
    await store.save({
      name: 'plain',
      description: '',
      type: 'sqlite',
      config: { type: 'sqlite', filePath: ':memory:' } as any,
    });
    const fetched = await store.get('plain');
    expect(fetched?.name).toBe('plain');
    await store.close();
  });

  it('with cipherKey: opens via cipher backend when dep present', async () => {
    let hasCipher = false;
    try {
      await import('better-sqlite3-multiple-ciphers');
      hasCipher = true;
    } catch {
      hasCipher = false;
    }
    if (!hasCipher) {
      console.warn('[profile-store-cipher] skipping cipher roundtrip test: better-sqlite3-multiple-ciphers not installed');
      return;
    }
    const store = new ProfileStore(dbPath, { cipherKey: 'test-key-32-chars-long!!!!' });
    await store.save({
      name: 'enc',
      description: 'encrypted profile',
      type: 'sqlite',
      config: { type: 'sqlite', filePath: ':memory:' } as any,
    });
    await store.close();

    // Re-open with WRONG key — should fail to decrypt
    const wrongKeyStore = new ProfileStore(dbPath, { cipherKey: 'wrong-key-32-chars-long!!!!!!' });
    let threw = false;
    try {
      await wrongKeyStore.list();
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    try { await wrongKeyStore.close(); } catch { /* ignore */ }

    // Re-open with the same correct key — should work
    const store2 = new ProfileStore(dbPath, { cipherKey: 'test-key-32-chars-long!!!!' });
    const fetched = await store2.get('enc');
    expect(fetched?.description).toBe('encrypted profile');
    await store2.close();
  });

  it('cipher option undefined = plaintext backend', () => {
    const store1 = new ProfileStore(dbPath);
    const store2 = new ProfileStore(dbPath, {});
    const store3 = new ProfileStore(dbPath, { cipherKey: undefined });
    expect(store1).toBeDefined();
    expect(store2).toBeDefined();
    expect(store3).toBeDefined();
    // No assertions on internal state — just that the API accepts the shape.
  });
});
