import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readProjectProfile, writeProjectProfile } from '../../src/utils/path-resolver.js';

describe('.db-profile read/write (path-resolver)', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'profile-test-'));
  });
  afterEach(async () => {
    try {
      await fs.rm(tmp, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  it('reads valid .db-profile', async () => {
    await fs.writeFile(path.join(tmp, '.db-profile'), 'profile=bbz-cq-oracle\n');
    expect(readProjectProfile(tmp)).toEqual({ profile: 'bbz-cq-oracle' });
  });

  it('returns null when .db-profile missing', () => {
    expect(readProjectProfile(tmp)).toBeNull();
  });

  it('ignores malformed .db-profile (returns null)', async () => {
    await fs.writeFile(path.join(tmp, '.db-profile'), 'not a key value pair\n');
    expect(readProjectProfile(tmp)).toBeNull();
  });

  it('ignores malformed profile name (returns null)', async () => {
    await fs.writeFile(path.join(tmp, '.db-profile'), 'profile=has.dot\n');
    expect(readProjectProfile(tmp)).toBeNull();
  });

  it('writes profile=<name> to .db-profile', () => {
    writeProjectProfile(tmp, 'my-profile');
    const content = fsSync.readFileSync(path.join(tmp, '.db-profile'), 'utf8');
    expect(content).toBe('profile=my-profile\n');
  });

  // v5.0.0 迁移:旧 .profile 文件作为 fallback 还能读
  it('legacy .profile file still readable (v5.0.0 migration fallback)', async () => {
    await fs.writeFile(path.join(tmp, '.profile'), 'profile=legacy-pro\n');
    expect(readProjectProfile(tmp)).toEqual({ profile: 'legacy-pro' });
  });

  it('.db-profile takes precedence over .profile', async () => {
    await fs.writeFile(path.join(tmp, '.db-profile'), 'profile=new-pro\n');
    await fs.writeFile(path.join(tmp, '.profile'), 'profile=legacy-pro\n');
    expect(readProjectProfile(tmp)).toEqual({ profile: 'new-pro' });
  });
});