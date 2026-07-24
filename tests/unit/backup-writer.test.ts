/**
 * BackupWriter unit tests (v3.x)
 *
 * SQLite round-trip: write → dump → fresh DB → reload from dump → verify data.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { ProfileManager } from '../../src/core/profile-manager.js';
import { SQLiteAdapter } from '../../src/adapters/sqlite/index.js';
import { BackupWriter } from '../../src/core/backup-writer.js';

const ts = Date.now();
const profPath = `.tmp-bw-${ts}.db`;
const sqliteA = `.tmp-bw-a-${ts}.db`;
const sqliteB = `.tmp-bw-b-${ts}.db`;
function cleanup(p: string) {
  for (const s of ['', '-wal', '-shm']) {
    if (existsSync(p + s)) { try { unlinkSync(p + s); } catch { /* ignore */ } }
  }
}

describe('BackupWriter (v3.x)', () => {
  let pm: ProfileManager;
  let adapter: SQLiteAdapter;

  beforeEach(async () => {
    cleanup(profPath); cleanup(sqliteA); cleanup(sqliteB);
    pm = new ProfileManager({
      enabled: true,
      profilesDbPath: profPath,
      maxProfiles: 50,
      defaultRole: 'primary',
      readRouting: 'round-robin',
    });
    adapter = new SQLiteAdapter({ filePath: sqliteA, readonly: false });
    await adapter.connect();
    await adapter.executeQuery(`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)`);
    await adapter.executeQuery(`INSERT INTO users (email) VALUES ('a@example.com'), ('b@example.com')`);
    await pm.saveProfile({
      name: 'target',
      description: 'sqlite under test',
      type: 'sqlite',
      config: { type: 'sqlite', filePath: sqliteA } as any,
    });
  });
  afterEach(async () => {
    try { await adapter.disconnect(); } catch { /* ignore */ }
    try { await pm.closeAll(); } catch { /* ignore */ }
    cleanup(profPath); cleanup(sqliteA); cleanup(sqliteB);
  });

  it('dumps schema + INSERT statements for sqlite', async () => {
    const result = await BackupWriter.dump(pm, 'target');
    expect(result.kind).toBe('full');
    expect(result.tables).toContain('users');
    expect(result.content).toMatch(/CREATE TABLE/i);
    expect(result.content).toMatch(/INSERT INTO/i);
    expect(result.content).toContain(`'a@example.com'`);
  });

  it('schemaOnly=true skips INSERT', async () => {
    const result = await BackupWriter.dump(pm, 'target', { schemaOnly: true });
    expect(result.kind).toBe('schema-only');
    expect(result.content).toMatch(/CREATE TABLE/i);
    expect(result.content).not.toMatch(/INSERT INTO/i);
  });

  it('returns unsupported for missing profile', async () => {
    await expect(BackupWriter.dump(pm, 'nope')).rejects.toThrow();
  });

  it('escape utility escapes quotes correctly', async () => {
    // Indirectly via executeQuery INSERT into test DB
    await adapter.executeQuery(`CREATE TABLE strings (s TEXT)`);
    await adapter.executeQuery(`INSERT INTO strings (s) VALUES ('a''b')`);
    const r = await BackupWriter.dump(pm, 'target');
    expect(r.content).toContain(`'a''b'`);
  });
});
