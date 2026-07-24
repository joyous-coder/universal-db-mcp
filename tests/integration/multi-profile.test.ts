import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { ConnectionManager } from '../../src/core/connection-manager.js';
import { ProfileManager } from '../../src/core/profile-manager.js';

const dbPath = `.tmp-int-prof-${Date.now()}-${Math.random()}`;

describe('ConnectionManager + ProfileManager integration', () => {
  let conn: ConnectionManager;
  let pm: ProfileManager;

  beforeAll(async () => {
    conn = new ConnectionManager();
    pm = new ProfileManager({ enabled: true, profilesDbPath: dbPath, maxProfiles: 50, defaultRole: 'primary', readRouting: 'round-robin' });
    conn.setProfileManager(pm);
  });
  afterAll(async () => { await pm.closeAll(); await conn.disconnectAll(); if (existsSync(dbPath)) unlinkSync(dbPath); });

  it('setProfileManager + getProfileManager', () => {
    conn.setProfileManager(pm);
    expect(conn.getProfileManager()).toBe(pm);
  });

  it('legacy connect (no profile) still works (v2.14 compat)', async () => {
    const sid = await conn.connect({ type: 'sqlite', filePath: ':memory:', allowWrite: true });
    expect(sid).toBeDefined();
    expect(conn.getAdapter(sid)).toBeDefined();
  });
});