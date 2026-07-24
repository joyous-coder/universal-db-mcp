import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { buildSaveProfileHandler, buildListProfilesHandler } from '../../src/mcp/tools/profile-tools.js';
import { ProfileManager } from '../../src/core/profile-manager.js';

const dbPath = `.tmp-mcp-prof-${Date.now()}-${Math.random()}`;

describe('MCP profile tools handlers', () => {
  let pm: ProfileManager;
  beforeAll(() => { pm = new ProfileManager({ enabled: true, profilesDbPath: dbPath, maxProfiles: 50, defaultRole: 'primary', readRouting: 'round-robin' }); });
  afterAll(async () => { await pm.closeAll(); if (existsSync(dbPath)) unlinkSync(dbPath); });

  it('save_profile + list_profiles', async () => {
    const save = buildSaveProfileHandler(pm);
    const list = buildListProfilesHandler(pm);
    const p = await save({ name: 'p1', description: 'd', type: 'sqlite', config: { type: 'sqlite', filePath: ':memory:' } });
    expect(p.name).toBe('p1');
    const r = await list({});
    expect(r.profiles.length).toBe(1);
  });
});