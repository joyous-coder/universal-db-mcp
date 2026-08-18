import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { buildSaveProfileHandler } from '../../src/mcp/tools/profile-tools.js';
import { ProfileManager } from '../../src/core/profile-manager.js';
import type { ProfileInput } from '../../src/core/profile-manager.js';

const dbPath = `.tmp-test-pm-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;

describe('save_profile handler (v4.2.0)', () => {
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

  it('rejects invalid profile name (with dot)', async () => {
    const handler = buildSaveProfileHandler(pm);
    const bad: ProfileInput = {
      name: 'has.dot',
      description: '',
      type: 'oracle',
      config: { type: 'oracle', host: 'x', port: 1521 },
    };
    await expect(handler(bad)).rejects.toThrow(/invalid.*name|name.*regex/i);
  });

  it('rejects name with space', async () => {
    const handler = buildSaveProfileHandler(pm);
    const bad: ProfileInput = {
      name: 'has space',
      description: '',
      type: 'oracle',
      config: { type: 'oracle', host: 'x' },
    };
    await expect(handler(bad)).rejects.toThrow(/invalid/i);
  });

  it('accepts valid name', async () => {
    const handler = buildSaveProfileHandler(pm);
    const good: ProfileInput = {
      name: 'valid-name_123',
      description: '',
      type: 'oracle',
      config: { type: 'oracle', host: 'x' },
    };
    await expect(handler(good)).resolves.toBeDefined();
  });

  it('defaults permissionMode to readwrite when omitted', async () => {
    const handler = buildSaveProfileHandler(pm);
    const input: ProfileInput = {
      name: 'no-perm',
      description: '',
      type: 'oracle',
      config: { type: 'oracle', host: 'x' },
    };
    const profile = await handler(input);
    expect(profile.permissionMode).toBe('readwrite');
  });

  it('respects explicit permissionMode=full', async () => {
    const handler = buildSaveProfileHandler(pm);
    const input: ProfileInput = {
      name: 'full-perm',
      description: '',
      type: 'oracle',
      config: { type: 'oracle', host: 'x' },
      permissionMode: 'full',
    };
    const profile = await handler(input);
    expect(profile.permissionMode).toBe('full');
  });
});