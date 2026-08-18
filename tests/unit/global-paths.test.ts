import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { getGlobalDir, getProfilesDbPath, getProfileDbPath } from '../../src/utils/global-paths.js';

describe('global-paths', () => {
  let origDir: string | undefined;

  beforeEach(() => {
    origDir = process.env.DB_GLOBAL_DIR;
  });
  afterEach(() => {
    if (origDir === undefined) delete process.env.DB_GLOBAL_DIR;
    else process.env.DB_GLOBAL_DIR = origDir;
  });

  it('getGlobalDir defaults to ~/.universal-db-mcp', () => {
    delete process.env.DB_GLOBAL_DIR;
    expect(getGlobalDir()).toBe(path.join(os.homedir(), '.universal-db-mcp'));
  });

  it('getGlobalDir respects DB_GLOBAL_DIR override', () => {
    process.env.DB_GLOBAL_DIR = path.join(os.tmpdir(), 'custom-global-test');
    expect(getGlobalDir()).toBe(process.env.DB_GLOBAL_DIR);
  });

  it('getProfilesDbPath is {globalDir}/profiles.db', () => {
    process.env.DB_GLOBAL_DIR = path.join(os.tmpdir(), 'g1');
    expect(getProfilesDbPath()).toBe(path.join(process.env.DB_GLOBAL_DIR, 'profiles.db'));
  });

  it('getProfileDbPath is {globalDir}/{name}/{kind}.db', () => {
    process.env.DB_GLOBAL_DIR = path.join(os.tmpdir(), 'g2');
    expect(getProfileDbPath('my-profile', 'history')).toBe(
      path.join(process.env.DB_GLOBAL_DIR, 'my-profile', 'history.db'),
    );
    expect(getProfileDbPath('another', 'templates')).toBe(
      path.join(process.env.DB_GLOBAL_DIR, 'another', 'templates.db'),
    );
    expect(getProfileDbPath('p3', 'plans')).toBe(
      path.join(process.env.DB_GLOBAL_DIR, 'p3', 'plans.db'),
    );
  });
});