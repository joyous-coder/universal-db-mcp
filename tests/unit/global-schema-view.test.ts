import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { ProfileManager } from '../../src/core/profile-manager.js';
import { buildGlobalSchemaView } from '../../src/core/global-schema-view.js';

const dbPath = `.tmp-gsv-${Date.now()}.db`;

describe('GlobalSchemaView (Bug N3 warnings)', () => {
  let pm: ProfileManager;
  beforeEach(() => {
    pm = new ProfileManager({
      enabled: true,
      profilesDbPath: dbPath,
      maxProfiles: 50,
      defaultRole: 'primary',
      readRouting: 'round-robin',
    });
  });
  afterEach(async () => {
    await pm.closeAll();
    if (existsSync(dbPath)) unlinkSync(dbPath);
  });

  it('captures warnings when loadProfile fails (unreachable host)', async () => {
    await pm.saveProfile({
      name: 'broken',
      description: '',
      type: 'sqlite',
      // 文件路径让 sqlite 加载失败 → loadProfile 抛错 → 被 catch 转成 warnings
      config: { type: 'sqlite', filePath: '/nonexistent_dir_for_smoke_test/x.db' },
    });
    const view = await buildGlobalSchemaView(pm);
    const p = view.profiles.find((p) => p.name === 'broken');
    expect(p).toBeDefined();
    expect(p!.warnings).toBeDefined();
    expect(p!.warnings!.length).toBeGreaterThan(0);
    // 错误消息应非空(ENOENT / no such file 等)
    expect(p!.warnings![0].length).toBeGreaterThan(0);
  });

  it('successful profile has no warnings', async () => {
    await pm.saveProfile({
      name: 'ok',
      description: '',
      type: 'sqlite',
      config: { type: 'sqlite', filePath: ':memory:' },
    });
    const view = await buildGlobalSchemaView(pm);
    const p = view.profiles.find((p) => p.name === 'ok');
    expect(p).toBeDefined();
    // ok profile 没有 warnings 或 warnings 是 undefined
    expect(p!.warnings === undefined || p!.warnings!.length === 0).toBe(true);
  });
});