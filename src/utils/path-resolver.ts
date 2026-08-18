/**
 * v4.2.0: <cwd>/.profile 项目级激活文件
 *
 * 单行格式:`profile=<name>`
 * 命名约束同 Profile:/^[a-zA-Z0-9_-]+$/
 *
 * - readProjectProfile(cwd): 读 .profile,parse + 校验,有则返回 { profile },无/格式错返 null
 * - writeProjectProfile(cwd, name): 同步写 `profile=<name>\n`
 */
import fs from 'node:fs';
import path from 'node:path';
import { isValidProfileName } from '../core/profile-manager.js';

const PROFILE_FILE = '.profile';

export function readProjectProfile(cwd: string): { profile: string } | null {
  const filePath = path.join(cwd, PROFILE_FILE);
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;  // 文件不存在
  }
  // 取第一非空行
  const line = content.split('\n').find(l => l.trim().length > 0);
  if (!line) return null;
  // 严格匹配 profile=<valid-name>
  const m = line.match(/^profile=([a-zA-Z0-9_-]+)$/);
  if (!m) return null;
  const name = m[1];
  // 二次防御:regex 已限制字符集,但用 isValidProfileName 再确认
  if (!isValidProfileName(name)) return null;
  return { profile: name };
}

export function writeProjectProfile(cwd: string, profileName: string): void {
  // 防御:即使外部绕过 handler 校验,这里也确保合法
  if (!isValidProfileName(profileName)) {
    throw new Error(
      `writeProjectProfile: invalid profile name "${profileName}" (must match /^[a-zA-Z0-9_-]+$/)`,
    );
  }
  const filePath = path.join(cwd, PROFILE_FILE);
  fs.writeFileSync(filePath, `profile=${profileName}\n`, 'utf8');
}