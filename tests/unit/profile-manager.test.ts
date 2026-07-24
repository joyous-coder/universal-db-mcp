import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { ProfileManager } from '../../src/core/profile-manager.js';
import type { ProfileInput } from '../../src/core/profile-manager.js';

const dbPath = `.tmp-pm-${Date.now()}.db`;

describe('ProfileManager', () => {
  let pm: ProfileManager;
  beforeEach(() => {
    pm = new ProfileManager({ enabled: true, profilesDbPath: dbPath, maxProfiles: 50, defaultRole: 'primary', readRouting: 'round-robin' });
  });
  afterEach(async () => { await pm.closeAll(); if (existsSync(dbPath)) unlinkSync(dbPath); });

  it('saveProfile + listProfiles', async () => {
    const input: ProfileInput = { name: 'p1', description: 'd', type: 'sqlite', config: { type: 'sqlite', filePath: ':memory:' } };
    const p = await pm.saveProfile(input);
    expect(p.name).toBe('p1');
    const list = await pm.listProfiles();
    expect(list.length).toBe(1);
  });

  it('isEnabled() reflects option', () => {
    expect(pm.isEnabled()).toBe(true);
  });

  it('with enabled=false: saveProfile throws', async () => {
    const off = new ProfileManager({ enabled: false, profilesDbPath: dbPath, maxProfiles: 50, defaultRole: 'primary', readRouting: 'round-robin' });
    await expect(off.saveProfile({ name: 'p', description: '', type: 'sqlite', config: { type: 'sqlite', filePath: ':memory:' } })).rejects.toThrow(/disabled/i);
    await off.closeAll();
  });

  it('maxProfiles enforcement', async () => {
    const small = new ProfileManager({ enabled: true, profilesDbPath: `.tmp-pm-small-${Date.now()}-${Math.random()}`, maxProfiles: 2, defaultRole: 'primary', readRouting: 'round-robin' });
    try {
      await small.saveProfile({ name: 'a', description: '', type: 'sqlite', config: { type: 'sqlite', filePath: ':memory:' } });
      await small.saveProfile({ name: 'b', description: '', type: 'sqlite', config: { type: 'sqlite', filePath: ':memory:' } });
      await expect(small.saveProfile({ name: 'c', description: '', type: 'sqlite', config: { type: 'sqlite', filePath: ':memory:' } })).rejects.toThrow(/max/i);
    } finally {
      await small.closeAll();
    }
  });

  it('deleteProfile returns false for unknown name', async () => {
    expect(await pm.deleteProfile('nope')).toBe(false);
  });

  it('getMetricsSnapshot returns current state', () => {
    const snap = pm.getMetricsSnapshot();
    expect(snap.enabled).toBe(true);
    expect(snap.read_routing).toBe('round-robin');
  });
});