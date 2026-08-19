/**
 * v5.0.0: <cwd>/.db-profile 项目级激活文件
 *
 * (v4.2.0 之前叫 .profile — v5.0.0 改名避免与 shell/profile 工具冲突)
 *
 * 单行格式:`profile=<name>`
 * 命名约束同 Profile:/^[a-zA-Z0-9_-]+$/
 *
 * - readProjectProfile(cwd): 读 .db-profile,parse + 校验,有则返回 { profile },无/格式错返 null
 * - writeProjectProfile(cwd, name): 同步写 `profile=<name>\n`
 */
import fs from 'node:fs';
import path from 'node:path';
import { isValidProfileName } from '../core/profile-manager.js';

// v5.0.0: 从 .profile 改名为 .db-profile,避免与 shell / IDE / 其他工具的 .profile 冲突。
// v4.2.0 → v5.0.0 的迁移逻辑:readProjectProfile 仍会读旧 .profile 作为 fallback,
// 找到后用 writeProjectProfile 写到新位置。
const PROFILE_FILE = '.db-profile';
const LEGACY_PROFILE_FILE = '.profile';

export function readProjectProfile(cwd: string): { profile: string } | null {
  // v5.0.0: 优先读 .db-profile,fallback 到旧 .profile(v4.2.0 → v5.0.0 迁移)
  for (const filename of [PROFILE_FILE, LEGACY_PROFILE_FILE]) {
    const filePath = path.join(cwd, filename);
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;  // 当前文件不存在,试下一个
    }
    // 取第一非空行
    const line = content.split('\n').find(l => l.trim().length > 0);
    if (!line) continue;
    // 严格匹配 profile=<valid-name>
    const m = line.match(/^profile=([a-zA-Z0-9_-]+)$/);
    if (!m) continue;
    const name = m[1];
    // 二次防御:regex 已限制字符集,但用 isValidProfileName 再确认
    if (!isValidProfileName(name)) continue;
    return { profile: name };
  }
  return null;
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