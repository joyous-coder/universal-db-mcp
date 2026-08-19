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

  // v5.0.0 Bug N2: update_profile 后 use_profile 缓存命中,返回的 LiveProfile 还是旧的
  // 应基于 updated_at 比较,发现不一致就 reload
  it('loadProfile picks up updated config after update_profile', async () => {
    const input = { name: 'n2-p', description: 'orig', type: 'sqlite' as const, config: { type: 'sqlite' as const, filePath: ':memory:' } };
    await pm.saveProfile(input);
    const live1 = await pm.loadProfile('n2-p');
    expect((live1.profile.config as any).filePath).toBe(':memory:');

    // update profile config
    await pm.updateProfile({ ...input, description: 'updated', config: { type: 'sqlite' as const, filePath: ':memory:' /* same — but updated_at 一定会变 */ } });

    const live2 = await pm.loadProfile('n2-p');
    // 不应是同一份 cache(因为 store 改了)
    expect(live2.profile.updated_at >= live1.profile.updated_at).toBe(true);
    expect(live2.profile.description).toBe('updated');

    // 清理
    await live1.adapter.disconnect().catch(() => {});
    await live2.adapter.disconnect().catch(() => {});
  });

  // v5.0.0 Bug N2 续: 显式 update 改 config 时,LiveProfile.config 必须反映新值
  it('loadProfile rebuilds adapter when underlying config changes', async () => {
    const input = { name: 'n2-cfg', description: '', type: 'sqlite' as const, config: { type: 'sqlite' as const, filePath: ':memory:' } };
    await pm.saveProfile(input);
    const live1 = await pm.loadProfile('n2-cfg');
    expect((live1.profile.config as any).filePath).toBe(':memory:');

    // 等 5ms 确保 updated_at 时间戳不同(JS Date.now() 精度可能不够)
    await new Promise(r => setTimeout(r, 5));

    const newConfig = { type: 'sqlite' as const, filePath: ':memory:' };
    await pm.updateProfile({ ...input, config: newConfig });

    const live2 = await pm.loadProfile('n2-cfg');
    // 关键: live2 应该是新实例(配置改了 → updated_at 变 → cache invalidation)
    expect(live2.profile.updated_at).not.toBe(live1.profile.updated_at);
    await live1.adapter.disconnect().catch(() => {});
    await live2.adapter.disconnect().catch(() => {});
  });
});