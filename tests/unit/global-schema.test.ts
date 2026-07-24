import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { ProfileManager } from '../../src/core/profile-manager.js';
import { buildGlobalSchemaView } from '../../src/core/global-schema-view.js';

const dbPath = `.tmp-gs-${Date.now()}-${Math.random()}`;

describe('GlobalSchemaView', () => {
  let pm: ProfileManager;
  beforeEach(() => { pm = new ProfileManager({ enabled: true, profilesDbPath: dbPath, maxProfiles: 50, defaultRole: 'primary', readRouting: 'round-robin' }); });
  afterEach(async () => { await pm.closeAll(); if (existsSync(dbPath)) unlinkSync(dbPath); });

  it('builds empty view when no profiles saved', async () => {
    const v = await buildGlobalSchemaView(pm);
    expect(v.profiles).toEqual([]);
    expect(v.generatedAt).toBeDefined();
  });

  it('includes saved profiles (load on demand)', async () => {
    await pm.saveProfile({ name: 'p', description: '', type: 'sqlite', config: { type: 'sqlite', filePath: ':memory:' } });
    const v = await buildGlobalSchemaView(pm);
    expect(v.profiles.length).toBe(1);
    expect(v.profiles[0].name).toBe('p');
  });
});