/**
 * Cross-profile history integration test (v2.19)
 *
 * End-to-end check that:
 * - ProfileManager.saveProfile persists a profile
 * - ProfileManager.routeQuery executes against the live adapter
 * - When wired with a QueryAnalyzer (via setQueryAnalyzer), history rows
 *   are tagged with profile_name.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { ProfileManager } from '../../src/core/profile-manager.js';
import { QueryAnalyzer } from '../../src/core/query-analyzer.js';
import { DatabaseService } from '../../src/core/database-service.js';
import { SQLiteAdapter } from '../../src/adapters/sqlite/index.js';
import type { DbConfig } from '../../src/types/adapter.js';

const ts = Date.now();
const tplPath = `.tmp-x-prof-tpl-${ts}-${Math.random().toString(36).slice(2)}.db`;
const histPath = `.tmp-x-prof-hist-${ts}-${Math.random().toString(36).slice(2)}.db`;
const profPath = `.tmp-x-prof-db-${ts}-${Math.random().toString(36).slice(2)}.db`;
const sqlitePath = `.tmp-x-prof-sqlite-${ts}-${Math.random().toString(36).slice(2)}.db`;

function cleanup(p: string) {
  if (existsSync(p)) { try { unlinkSync(p); } catch { /* ignore */ } }
}

describe('cross-profile history end-to-end (v2.19)', () => {
  let pm: ProfileManager;
  let qa: QueryAnalyzer;

  beforeEach(async () => {
    [tplPath, histPath, profPath, sqlitePath].forEach(cleanup);
    pm = new ProfileManager({
      enabled: true,
      profilesDbPath: profPath,
      maxProfiles: 50,
      defaultRole: 'primary',
      readRouting: 'round-robin',
    });
    qa = new QueryAnalyzer({
      enabled: true,
      templatesDbPath: tplPath,
      historyDbPath: histPath,
      historyTtlDays: 30,
      historyMaxRows: 100,
      explainTimeoutMs: 5000,
    });
    pm.setQueryAnalyzer(qa);
  });

  afterEach(async () => {
    try { await pm.closeAll(); } catch { /* ignore */ }
    try { await qa.close(); } catch { /* ignore */ }
    [tplPath, histPath, profPath, sqlitePath].forEach(cleanup);
  });

  it('routeQuery writes history with profile_name=sqlite', async () => {
    // Pre-create the file with a table so routeQuery can INSERT into it
    const setup = new SQLiteAdapter({ filePath: sqlitePath, readonly: false });
    await setup.connect();
    await setup.executeQuery('CREATE TABLE t (x INTEGER)');
    await setup.disconnect();

    await pm.saveProfile({
      name: 'sqlite',
      description: 'file sqlite',
      type: 'sqlite',
      config: { type: 'sqlite', filePath: sqlitePath, allowWrite: true } as any,
    });
    await pm.routeQuery('sqlite', 'INSERT INTO t VALUES (1)', 'write');
    await new Promise(r => setTimeout(r, 100));
    const entries = await qa.getHistory({ profileName: 'sqlite' });
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect((entries[0] as any).profile_name).toBe('sqlite');
  });

  it('routeQuery without queryAnalyzer wired: still works, no history', async () => {
    const setup = new SQLiteAdapter({ filePath: sqlitePath, readonly: false });
    await setup.connect();
    await setup.executeQuery('CREATE TABLE t (x INTEGER)');
    await setup.disconnect();

    const pm2 = new ProfileManager({
      enabled: true,
      profilesDbPath: profPath + '.nohist',
      maxProfiles: 50,
      defaultRole: 'primary',
      readRouting: 'round-robin',
    });
    await pm2.saveProfile({
      name: 'sqlite',
      description: 's',
      type: 'sqlite',
      config: { type: 'sqlite', filePath: sqlitePath, allowWrite: true } as any,
    });
    const result = await pm2.routeQuery('sqlite', 'SELECT 1 AS v', 'read');
    expect((result as any).rows).toBeDefined();
    await pm2.closeAll();
    cleanup(profPath + '.nohist');
  });

  it('multiple routeQuery calls record under same profile', async () => {
    const setup = new SQLiteAdapter({ filePath: sqlitePath, readonly: false });
    await setup.connect();
    await setup.executeQuery('CREATE TABLE t (x INTEGER)');
    await setup.disconnect();

    await pm.saveProfile({
      name: 'sqlite',
      description: 'p',
      type: 'sqlite',
      config: { type: 'sqlite', filePath: sqlitePath, allowWrite: true } as any,
    });
    await pm.routeQuery('sqlite', 'SELECT 1 AS v', 'read');
    await pm.routeQuery('sqlite', 'SELECT 2 AS v', 'read');
    await new Promise(r => setTimeout(r, 100));
    const entries = await qa.getHistory({ profileName: 'sqlite' });
    expect(entries.length).toBeGreaterThanOrEqual(2);
  });
});
