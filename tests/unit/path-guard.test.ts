/**
 * Path Guard Tests
 * Tests file path validation against allowlist.
 */

import { describe, it, expect } from 'vitest';
import { resolveAndValidatePath } from '../../src/utils/path-guard.js';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

describe('resolveAndValidatePath', () => {
  const allowedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'allowed-'));
  const blockedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blocked-'));

  it('accepts path within allowed dir', () => {
    const filePath = path.join(allowedDir, 'safe.sql');
    fs.writeFileSync(filePath, '');
    const result = resolveAndValidatePath(filePath, [allowedDir], process.cwd());
    expect(result).toBe(fs.realpathSync(filePath));
  });

  it('rejects path outside allowed dirs', () => {
    const filePath = path.join(blockedDir, 'secret.sql');
    fs.writeFileSync(filePath, '');
    expect(() => resolveAndValidatePath(filePath, [allowedDir], process.cwd())).toThrow(/not in allowlist/i);
  });

  it('rejects path traversal attempt', () => {
    expect(() => resolveAndValidatePath(path.join(allowedDir, '..', 'secret.sql'), [allowedDir], process.cwd())).toThrow(/not in allowlist/i);
  });

  it('throws when no allowed dirs', () => {
    expect(() => resolveAndValidatePath('anywhere.sql', [], process.cwd())).toThrow(/not in allowlist/i);
  });

  it('v4.0.9 regression: returns FILE path (not parent dir) when file does not exist', () => {
    // 旧 bug:文件不存在时,函数返回 realParent(目录路径)。
    // csv-writer 用此路径 createWriteStream 会触发 EISDIR,进程崩溃。
    // 修复后:返回用户传入的文件路径(只要父目录在白名单里)。
    const filePath = path.join(allowedDir, 'not-yet-created.csv');
    const result = resolveAndValidatePath(filePath, [allowedDir], process.cwd());
    expect(result).toBe(filePath);   // 必须是文件路径,不是父目录
    expect(result.endsWith('not-yet-created.csv')).toBe(true);
  });
});