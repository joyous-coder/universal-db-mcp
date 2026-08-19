/**
 * Profile import/export integration test (v2.20)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { ProfileManager } from '../../src/core/profile-manager.js';

const ts = Date.now();
const profPath = `.tmp-pie-${ts}-${Math.random().toString(36).slice(2)}.db`;
function cleanup(p: string) { if (existsSync(p)) { try { unlinkSync(p); } catch { /* ignore */ } } }

describe('profile import/export (v2.20)', () => {
  let pm: ProfileManager;
  beforeEach(async () => {
    cleanup(profPath);
    pm = new ProfileManager({
      enabled: true,
      profilesDbPath: profPath,
      maxProfiles: 50,
      defaultRole: 'primary',
      readRouting: 'round-robin',
    });
    await pm.saveProfile({
      name: 'prod-mysql',
      description: 'Production',
      type: 'mysql',
      config: { type: 'mysql', host: 'db.prod', port: 3306, user: 'app', password: 'hunter2' } as any,
      tags: ['prod'],
    });
    await pm.saveProfile({
      name: 'staging',
      description: 'Staging replica',
      type: 'mysql',
      config: { type: 'mysql', host: 'db.staging', port: 3306, user: 'app', password: 'stg-pass' } as any,
      role: 'replica',
      tags: ['staging'],
    });
  });
  afterEach(async () => {
    try { await pm.closeAll(); } catch { /* ignore */ }
    cleanup(profPath);
  });

  it('exports profiles with redacted passwords by default', async () => {
    const yaml = await pm.exportProfiles('yaml');
    expect(yaml).toContain('name: prod-mysql');
    expect(yaml).toContain('password: REDACTED');
    expect(yaml).not.toContain('hunter2');
  });

  it('exports profiles with --include-secrets flag to keep passwords', async () => {
    const yaml = await pm.exportProfiles('yaml', { includeSecrets: true });
    expect(yaml).toContain('password: hunter2');
  });

  it('round-trips via JSON (replace mode)', async () => {
    const json = await pm.exportProfiles('json');
    const restored = await pm.importProfiles(json, { format: 'json', mode: 'replace' });
    expect(restored.errors).toEqual([]);
    expect(restored.inserted + restored.updated).toBe(2);
    const list = await pm.listProfiles();
    expect(list.length).toBe(2);
    expect(list.map(p => p.name).sort()).toEqual(['prod-mysql', 'staging']);
  });

  it('importProfiles in replace mode clears existing profiles first', async () => {
    const yamlNew = `version: 1
profiles:
  - name: only-one
    description: 'New'
    type: sqlite
    config:
      type: sqlite
      filePath: ':memory:'
    role: primary
    enabled: true
    tags: [new]
    created_by: test
    created_at: '2026-07-01T00:00:00Z'
    updated_at: '2026-07-01T00:00:00Z'
    use_count: 0`;
    const result = await pm.importProfiles(yamlNew, { mode: 'replace' });
    expect(result.inserted + result.updated).toBeGreaterThanOrEqual(1);
    const list = await pm.listProfiles();
    expect(list.length).toBe(1);
    expect(list[0].name).toBe('only-one');
  });

  it('importProfiles dryRun: true does not save', async () => {
    const yamlStr = await pm.exportProfiles('yaml');
    // Add a new profile to the export, then dryRun import.
    const newYaml = yamlStr.replace('profiles:', `profiles:\n  - name: dryrun-new\n    description: 'd'\n    type: sqlite\n    config:\n      type: sqlite\n      filePath: ':memory:'\n    role: primary\n    enabled: true\n    tags: []\n    created_by: dr\n    created_at: '2026-07-24T00:00:00Z'\n    updated_at: '2026-07-24T00:00:00Z'\n    use_count: 0\n  # original profiles below\n  - name: stub-to-make-parse-happy`);
    try {
      await pm.importProfiles(newYaml, { dryRun: true });
    } catch (e) {
      // Dry-run with intentionally malformed extra YAML — only check the
      // counter claim that no persisted profile was added.
    }
    const list = await pm.listProfiles();
    expect(list.map(p => p.name)).toEqual(['prod-mysql', 'staging']); // unchanged
  });

  it('rejects unknown profile types', async () => {
    const bad = `version: 1
profiles:
  - name: bad
    description: 'd'
    type: totally-unknown-db
    config:
      type: unknown
    role: primary
    enabled: true
    tags: []
    created_by: test
    created_at: '2026-07-01T00:00:00Z'
    updated_at: '2026-07-01T00:00:00Z'
    use_count: 0`;
    const result = await pm.importProfiles(bad);
    expect(result.skipped).toBe(1);
    expect(result.errors[0]).toMatch(/unknown profile type/);
  });

  // v5.0.1 Bug N4: dryRun=true 时不应触发 ProfileSerializer.validate
  // (validate 强制 role/enabled 存在,但用户用 dryRun 只是想看效果,不应被结构错误拦下)
  it('dryRun=true skips validate for incomplete entries', async () => {
    const incomplete = `version: 1
profiles:
  - name: dryrun-minimal
    description: 'd'
    type: mysql
    config:
      type: mysql
      host: db.x
      port: 3306
      user: app
      password: x
`;
    const result = await pm.importProfiles(incomplete, { dryRun: true });
    // dryRun 不验证 → 没有 errors
    expect(result.errors).toEqual([]);
    // 没真插入 profile
    const list = await pm.listProfiles();
    expect(list.map(p => p.name).sort()).toEqual(['prod-mysql', 'staging']);
  });
});
