import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildExportProfilesHandler,
  buildImportProfilesHandler,
  buildGetProfileHandler,
  buildDeleteProfileHandler,
  buildEnableProfileHandler,
  buildDisableProfileHandler,
  buildDisconnectProfileHandler,
} from '../../src/mcp/tools/profile-tools.js';

describe('profile import/export handlers', () => {
  it('buildExportProfilesHandler calls pm.exportProfiles with defaults', async () => {
    const pm = { exportProfiles: vi.fn().mockResolvedValue('yaml-content') } as any;
    const h = buildExportProfilesHandler(pm);
    const r = await h({});
    expect(pm.exportProfiles).toHaveBeenCalledWith('yaml', { includeSecrets: undefined });
    expect(r.content).toBe('yaml-content');
  });

  it('buildImportProfilesHandler passes mode + dryRun', async () => {
    const pm = { importProfiles: vi.fn().mockResolvedValue({ imported: 2 }) } as any;
    const h = buildImportProfilesHandler(pm);
    const r = await h({ input: 'yaml', mode: 'replace', dryRun: true });
    expect(pm.importProfiles).toHaveBeenCalledWith('yaml', {
      format: 'yaml',
      mode: 'replace',
      dryRun: true,
    });
    expect(r.imported).toBe(2);
  });
});

describe('profile lifecycle handlers', () => {
  let pm: any;
  let store: any;

  beforeEach(() => {
    pm = {
      getProfile: vi.fn(),
      deleteProfile: vi.fn(),
      unloadProfile: vi.fn(),
    };
    store = {
      setEnabled: vi.fn(),
    };
  });

  it('buildGetProfileHandler throws when not found', async () => {
    pm.getProfile.mockResolvedValue(null);
    const h = buildGetProfileHandler(pm);
    await expect(h({ name: 'nope' })).rejects.toThrow('not found');
  });

  it('buildGetProfileHandler returns profile', async () => {
    pm.getProfile.mockResolvedValue({ name: 'p1', type: 'mysql' });
    const h = buildGetProfileHandler(pm);
    const r = await h({ name: 'p1' });
    expect(r.profile.name).toBe('p1');
  });

  it('buildDeleteProfileHandler returns deleted count', async () => {
    pm.deleteProfile.mockResolvedValue(true);
    const h = buildDeleteProfileHandler(pm);
    expect(await h({ name: 'p1' })).toEqual({ deleted: true });
  });

  it('buildEnableProfileHandler calls store.setEnabled(true)', async () => {
    pm.getProfile.mockResolvedValue({ name: 'p1' });
    const h = buildEnableProfileHandler(pm, store);
    expect(await h({ name: 'p1' })).toEqual({ enabled: true });
    expect(store.setEnabled).toHaveBeenCalledWith('p1', true);
  });

  it('buildEnableProfileHandler throws when not found', async () => {
    pm.getProfile.mockResolvedValue(null);
    const h = buildEnableProfileHandler(pm, store);
    await expect(h({ name: 'nope' })).rejects.toThrow('not found');
  });

  it('buildDisableProfileHandler unloads then setEnabled(false)', async () => {
    pm.getProfile.mockResolvedValue({ name: 'p1' });
    const h = buildDisableProfileHandler(pm, store);
    expect(await h({ name: 'p1' })).toEqual({ enabled: false });
    expect(pm.unloadProfile).toHaveBeenCalledWith('p1');
    expect(store.setEnabled).toHaveBeenCalledWith('p1', false);
  });

  it('buildDisconnectProfileHandler calls unloadProfile only', async () => {
    const h = buildDisconnectProfileHandler(pm);
    expect(await h({ name: 'p1' })).toEqual({ disconnected: true });
    expect(pm.unloadProfile).toHaveBeenCalledWith('p1');
  });
});