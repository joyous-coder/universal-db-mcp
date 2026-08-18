# v5.0.0 全局持久化 + Profile 隔离 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 profiles + history + templates + plans 从 cwd-relative 改为 `~/.universal-db-mcp/` 全局目录,profile-scoped 隔离 history/templates/plans,`<cwd>/.profile` 自动激活,删除 `connect_database`/`disconnect_database` tool。

**Architecture:**

- `profiles.db` 在全局根目录,`<profile-name>/` 子目录存放该 profile 的 history/templates/plans
- MCP 启动读 `<cwd>/.profile`,自动激活其中指定的 profile
- `save_profile` 必填 `permissionMode`;`use_profile` 加 `recordToProject` 参数
- 严格禁止直连路径(`connect_database`/`disconnect_database` 删除,`.mcp.json` 凭据 env 静默忽略)

**Tech Stack:** TypeScript, Node 20+, SQLite (better-sqlite3 / node:sqlite), SQLCipher (optional)

**Spec:** `docs/superpowers/specs/2026-08-18-global-state-and-profile-isolation-design.md`

## Global Constraints

- Node 20+ (来自现有 CLAUDE.md)
- TypeScript strict mode (来自现有 CLAUDE.md)
- Commit prefix: `feat:` / `fix:` / `refactor:` / `test:` / `docs:` / `chore:` (Conventional Commits)
- 命名规范: profile name 必须匹配 `/^[a-zA-Z0-9_-]+$/`
- 跨平台: Windows (`%USERPROFILE%\.universal-db-mcp`) + macOS/Linux (`~/.universal-db-mcp`)
- 不破坏现有测试 (51+ 个测试用例,512+ assertions 必须全绿)
- BREAKING 变更必须在 PR4 + PR5 单独提交,CHANGELOG 标注 **BREAKING**

---

## File Structure

**新增文件**:

- `src/utils/path-resolver.ts` — `.profile` 解析与写入 (~50 LOC)
- `src/utils/global-paths.ts` — 集中全局路径解析 (~40 LOC)
- `src/utils/product-detector.ts` — adapter `detectProductInfo()` 通用接口 + base impl (~30 LOC)
- `tests/unit/path-resolver.test.ts` — `.profile` 解析测试 (~80 LOC)
- `tests/unit/global-paths.test.ts` — 全局路径解析测试 (~60 LOC)
- `tests/unit/profile-name-regex.test.ts` — name 校验测试 (~50 LOC)
- `tests/integration/.profile-flow.test.ts` — `.profile` 端到端 (~100 LOC)

**修改文件**:

- `src/core/profile-manager.ts` — Profile 接口加 permissionMode/category/productName/version,name 校验
- `src/core/profile-store.ts` — DB schema 加新字段 (ALTER TABLE 兼容老库)
- `src/utils/config-loader.ts` — 默认路径改全局,删除凭据 env 读取,新增 DB_GLOBAL_DIR
- `src/mcp/mcp-server.ts` — 启动序列加 .profile 读取,移除 connect/disconnect_database dispatch
- `src/mcp/tools/profile-tools.ts` — save_profile handler 校验 name + permissionMode 必填
- `src/mcp/tools/database-tools.ts` (若存在) 或 mcp-server — 删除 connect_database handler
- 各 adapter (`src/adapters/oracle.ts`, `mysql.ts`, `postgres.ts`, `redis.ts`, 等) — 加 `detectProductInfo()` 方法
- `README.md` — 快速开始改写
- `CHANGELOG.md` — v5.0.0 段
- `tests/unit/profile-store.test.ts` — 加新字段测试
- `tests/unit/csv-tools.test.ts` 等 — 任何引用 connect_database 的测试需更新

---

## PR1: Profile 模型 + 名字正则 + permissionMode 字段

**范围**: Profile 接口加 4个新字段,DB schema 迁移,save_profile 加 name + permissionMode 校验。向后兼容现有 profile 记录。

### Task 1.1: Profile 接口扩展 (类型层)

**Files:**

- Modify: `src/core/profile-manager.ts:19-35` (Profile interface)
- Test: `tests/unit/profile-name-regex.test.ts` (NEW)

**Interfaces:**

- Produces: `Profile.permissionMode`, `Profile.category`, `Profile.productName`, `Profile.version` 字段

- [ ] **Step 1: 写测试 — name 正则**

```ts
// tests/unit/profile-name-regex.test.ts
import { describe, expect, it } from 'vitest';
import { isValidProfileName } from '../../src/core/profile-manager.js';

describe('isValidProfileName', () => {
  it('accepts alphanumeric + dash + underscore', () => {
    expect(isValidProfileName('bbz-cq-oracle')).toBe(true);
    expect(isValidProfileName('prod_db_1')).toBe(true);
    expect(isValidProfileName('MyProfile123')).toBe(true);
  });
  it('rejects dots, spaces, Chinese', () => {
    expect(isValidProfileName('bbz.cq')).toBe(false);
    expect(isValidProfileName('has space')).toBe(false);
    expect(isValidProfileName('中文')).toBe(false);
    expect(isValidProfileName('foo/bar')).toBe(false);
    expect(isValidProfileName('')).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试,确认 fail**

Run: `npx vitest run tests/unit/profile-name-regex.test.ts`
Expected: FAIL — `isValidProfileName` not exported

- [ ] **Step 3: 实现 name 校验 + Profile 接口扩展**

```ts
// src/core/profile-manager.ts (追加在文件底部)
export function isValidProfileName(name: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(name);
}
```

然后修改 `Profile` interface (line 19-35):

```ts
export interface Profile {
  id: string;
  name: string;
  description: string;
  type: string;
  config: Record<string, unknown>;
  role: ProfileRole;
  tags: string[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
  created_by: string;
  use_count: number;
  // v5.0.0 新增:
  permissionMode: 'safe' | 'readwrite' | 'full';
  category: 'rdbms' | 'kv' | 'document' | 'columnar' | 'search' | 'unknown';
  productName: string | null;
  version: string | null;
}
```

- [ ] **Step 4: 跑测试,确认 pass**

Run: `npx vitest run tests/unit/profile-name-regex.test.ts`
Expected: PASS

- [ ] **Step 5: 跑全量单测,确认其他测试因 Profile 字段缺失而 fail**

Run: `npm run test:unit`
Expected: 大批 fail (因 Profile 类型新增必填字段,所有返回 Profile 的地方都缺字段)

- [ ] **Step 6: Commit**

```bash
git add src/core/profile-manager.ts tests/unit/profile-name-regex.test.ts
git commit -m "feat(profile): add permissionMode + category + productName/version fields, isValidProfileName helper"
```

### Task 1.2: ProfileStore schema 迁移 (DB 层)

**Files:**

- Modify: `src/core/profile-store.ts:58-76` (CREATE TABLE + ALTER TABLE 迁移)
- Test: `tests/unit/profile-store.test.ts` (现有测试,加新字段断言)

**Interfaces:**

- Consumes: Profile 接口 (Task 1.1)
- Produces: `save(input)` 写入新字段,`rowToProfile()` 读出新字段

- [ ] **Step 1: 写测试 — 老 profile 缺字段时自动用默认值**

```ts
// tests/unit/profile-store.test.ts 追加
it('migrates legacy profile rows (missing new fields) with defaults', async () => {
  // 准备:插入一行"老格式"(缺新字段)
  const store = await makeStore();
  const before = Date.now();
  store.rawExec(`INSERT INTO profiles (id, name, description, type, config_json, role, tags_json, enabled, created_at, updated_at, created_by, use_count)
                  VALUES ('legacy1', 'old-profile', 'legacy', 'oracle', '{}', 'primary', '[]', 1, '${new Date().toISOString()}', '${new Date().toISOString()}', 'cli', 0)`);
  // 取出来
  const p = await store.get('old-profile');
  expect(p).not.toBeNull();
  expect(p!.permissionMode).toBe('readwrite');  // 默认
  expect(p!.category).toBe('unknown');
  expect(p!.productName).toBeNull();
  expect(p!.version).toBeNull();
});
```

- [ ] **Step 2: 跑测试,确认 fail**

Run: `npx vitest run tests/unit/profile-store.test.ts -t "migrates legacy"`
Expected: FAIL — TypeError: cannot read 'permissionMode' of undefined

- [ ] **Step 3: 改 schema + rowToProfile + save**

在 `init()` 的 CREATE TABLE 加新字段:

```sql
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  type TEXT NOT NULL,
  config_json TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'primary',
  tags_json TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  use_count INTEGER DEFAULT 0,
  -- v5.0.0 新增:
  permission_mode TEXT NOT NULL DEFAULT 'readwrite',
  category TEXT NOT NULL DEFAULT 'unknown',
  product_name TEXT,
  version TEXT
);
```

紧接着加 ALTER 兼容老库:

```sql
-- v5.0.0 迁移: 添加缺失字段(老库兼容)
-- SQLite 不支持 IF NOT EXISTS for ADD COLUMN,需 catch error
```

实际用 try/catch:

```ts
const alterStmts = [
  `ALTER TABLE profiles ADD COLUMN permission_mode TEXT NOT NULL DEFAULT 'readwrite'`,
  `ALTER TABLE profiles ADD COLUMN category TEXT NOT NULL DEFAULT 'unknown'`,
  `ALTER TABLE profiles ADD COLUMN product_name TEXT`,
  `ALTER TABLE profiles ADD COLUMN version TEXT`,
];
for (const stmt of alterStmts) {
  try { this.conn.exec(stmt); } catch { /* column exists */ }
}
```

改 `save()` 加新字段:

```ts
this.conn.exec(
  `INSERT INTO profiles (id, name, description, type, config_json, role, tags_json, enabled, created_at, updated_at, created_by, use_count, permission_mode, category, product_name, version)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [id, input.name, input.description, input.type, JSON.stringify(input.config),
   role, JSON.stringify(input.tags ?? []), enabled ? 1 : 0, now, now, createdBy, 0,
   input.permissionMode ?? 'readwrite',
   input.category ?? 'unknown',
   input.productName ?? null,
   input.version ?? null]
);
```

改 `rowToProfile()` 读新字段 (映射 rowToProfile 函数,把每行转为 Profile,加字段映射)。

- [ ] **Step 4: 跑测试,确认 pass**

Run: `npx vitest run tests/unit/profile-store.test.ts -t "migrates legacy"`
Expected: PASS

- [ ] **Step 5: 跑全量,确认 store 测试全绿**

Run: `npx vitest run tests/unit/profile-store.test.ts`
Expected: PASS (新增 + 现有)

- [ ] **Step 6: Commit**

```bash
git add src/core/profile-store.ts tests/unit/profile-store.test.ts
git commit -m "feat(profile-store): schema migration + permissionMode/category/productName/version fields"
```

### Task 1.3: save_profile handler 加 name + permissionMode 校验

**Files:**

- Modify: `src/mcp/tools/profile-tools.ts` (save_profile 的 handler)
- Test: `tests/unit/csv-tools.test.ts` 邻近的 `profile-tools.test.ts` (现有测试)

**Interfaces:**

- Consumes: `isValidProfileName`, ProfileInput
- Produces: save_profile 拒绝不合法名字,自动填 default permissionMode='readwrite'

- [ ] **Step 1: 写测试**

```ts
it('save_profile rejects invalid name', async () => {
  const handler = buildSaveProfileHandler(mockPm);
  await expect(
    handler({ name: 'has space', type: 'oracle', config: {} })
  ).rejects.toThrow(/invalid.*name|name.*regex/i);
});

it('save_profile defaults permissionMode to readwrite when omitted', async () => {
  const handler = buildSaveProfileHandler(mockPm);
  // 调用 + 验证 store 收到的 permissionMode 是 'readwrite'
});
```

- [ ] **Step 2: 跑测试 fail**
- [ ] **Step 3: 改 handler — 头部加校验**

```ts
import { isValidProfileName } from '../../core/profile-manager.js';

// 在 save handler 顶部:
if (!isValidProfileName(args.name)) {
  throw new Error(`invalid profile name: "${args.name}" (must match /^[a-zA-Z0-9_-]+$/)`);
}
const permissionMode = args.permissionMode ?? 'readwrite';
// 传给 store 的 input 包含 permissionMode
```

- [ ] **Step 4: 跑测试 pass**
- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools/profile-tools.ts tests/unit/profile-tools.test.ts
git commit -m "feat(profile-tools): save_profile rejects invalid name, defaults permissionMode"
```

---

## PR2: 全局路径解析 + `~/.universal-db-mcp/` 默认

**范围**: 新增 `global-paths.ts`,config-loader 默认值改全局,删除 cwd-relative fallback,新增 `DB_GLOBAL_DIR` env。

### Task 2.1: global-paths.ts 工具模块

**Files:**

- Create: `src/utils/global-paths.ts`
- Test: `tests/unit/global-paths.test.ts`

**Interfaces:**

- Produces:
  - `getGlobalDir(): string` — 返回 `~/.universal-db-mcp` (env `DB_GLOBAL_DIR` 覆盖)
  - `getProfilesDbPath(): string` — `{globalDir}/profiles.db`
  - `getProfileDbPath(profileName: string): string` — `{globalDir}/{profileName}/{history|templates|plans}.db`

- [ ] **Step 1: 写测试**

```ts
// tests/unit/global-paths.test.ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';

describe('global-paths', () => {
  let origDir: string | undefined;
  beforeEach(() => { origDir = process.env.DB_GLOBAL_DIR; });
  afterEach(() => { if (origDir === undefined) delete process.env.DB_GLOBAL_DIR; else process.env.DB_GLOBAL_DIR = origDir; });

  it('getGlobalDir defaults to ~/.universal-db-mcp', async () => {
    delete process.env.DB_GLOBAL_DIR;
    const { getGlobalDir } = await import('../../src/utils/global-paths.js');
    expect(getGlobalDir()).toBe(path.join(os.homedir(), '.universal-db-mcp'));
  });

  it('getGlobalDir respects DB_GLOBAL_DIR override', async () => {
    process.env.DB_GLOBAL_DIR = '/tmp/custom-global';
    const { getGlobalDir } = await import('../../src/utils/global-paths.js?v=2');
    expect(getGlobalDir()).toBe('/tmp/custom-global');
  });

  it('getProfilesDbPath is {globalDir}/profiles.db', async () => {
    process.env.DB_GLOBAL_DIR = '/tmp/g';
    const { getProfilesDbPath } = await import('../../src/utils/global-paths.js?v=3');
    expect(getProfilesDbPath()).toBe('/tmp/g/profiles.db');
  });

  it('getProfileDbPath is {globalDir}/{name}/{type}.db', async () => {
    process.env.DB_GLOBAL_DIR = '/tmp/g';
    const { getProfileDbPath } = await import('../../src/utils/global-paths.js?v=4');
    expect(getProfileDbPath('my-profile', 'history')).toBe('/tmp/g/my-profile/history.db');
  });
});
```

- [ ] **Step 2: 跑测试 fail**
- [ ] **Step 3: 实现 global-paths.ts**

```ts
// src/utils/global-paths.ts
import path from 'node:path';
import os from 'node:os';

export function getGlobalDir(): string {
  return process.env.DB_GLOBAL_DIR ?? path.join(os.homedir(), '.universal-db-mcp');
}

export function getProfilesDbPath(): string {
  return path.join(getGlobalDir(), 'profiles.db');
}

export function getProfileDbPath(profileName: string, kind: 'history' | 'templates' | 'plans'): string {
  return path.join(getGlobalDir(), profileName, `${kind}.db`);
}
```

- [ ] **Step 4: 跑测试 pass**
- [ ] **Step 5: Commit**

```bash
git add src/utils/global-paths.ts tests/unit/global-paths.test.ts
git commit -m "feat(global-paths): ~/.universal-db-mcp default with DB_GLOBAL_DIR override"
```

### Task 2.2: config-loader 默认值改全局

**Files:**

- Modify: `src/utils/config-loader.ts:172-211`
- Test: `tests/unit/config-loader.test.ts` (现有)

**Interfaces:**

- Consumes: `getProfilesDbPath`, `getProfileDbPath` (Task 2.1)
- Produces: profileManager.profilesDbPath, queryAnalyzer.historyDbPath/templatesDbPath, planHistoryPath 默认走全局

- [ ] **Step 1: 写测试**

```ts
// tests/unit/config-loader.test.ts 追加
it('profileManager.profilesDbPath defaults to global', () => {
  process.env.DB_PROFILE_ENCRYPTION_KEY = '';  // reset
  const cfg = loadConfig();
  expect(cfg.profileManager.profilesDbPath).toMatch(/\.universal-db-mcp[/\\]profiles\.db$/);
});

it('historyDbPath defaults to global {profile-active}/history.db (when profileManager enabled)', () => {
  process.env.DB_HISTORY_DB_PATH = '';
  const cfg = loadConfig();
  // history 默认路径应该是 active profile 目录下 — 但启动时不知道 profile,所以用 {globalDir}/_default/history.db
  expect(cfg.queryAnalyzer.historyDbPath).toMatch(/\.universal-db-mcp[/\\].*[/\\]history\.db$/);
});
```

- [ ] **Step 2: 跑测试 fail**
- [ ] **Step 3: 改 config-loader**

在 line 172-211 区域:

```ts
// 替换默认 fallback:
const defaultProfilesDb = getProfilesDbPath();  // 新增 import
// line 202: profilesDbPath: pmProfilesPath || defaultProfilesDb,

// 同理 historyDbPath / templatesDbPath:
// 当未显式设置,默认到 {globalDir}/_default/{type}.db
// 注: 启动时不知道 active profile,所以用 _default 占位
// mcp-server 启动后根据 active profile 重定向(在 PR3 处理)
const defaultHistory = getProfileDbPath('_default', 'history');
const defaultTemplates = getProfileDbPath('_default', 'templates');
// line 174: historyDbPath: qaHistory || defaultHistory,
// line 173: templatesDbPath: qaTemplates || defaultTemplates,
```

- [ ] **Step 4: 跑测试 pass**
- [ ] **Step 5: 跑全量**

Run: `npx vitest run tests/unit/config-loader.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/utils/config-loader.ts tests/unit/config-loader.test.ts
git commit -m "feat(config-loader): default paths use ~/.universal-db-mcp"
```

### Task 2.3: mcp-server 使用全局路径初始化

**Files:**

- Modify: `src/mcp/mcp-server.ts:150-170` (ProfileManager 初始化)
- Modify: `src/mcp/mcp-server.ts:130-145` (QueryAnalyzer 初始化)
- Modify: `src/mcp/mcp-server.ts:170-185` (PlanHistory 初始化)

**Interfaces:**

- Consumes: `getProfilesDbPath`, `getProfileDbPath` (Task 2.1)

- [ ] **Step 1: 改 ProfileManager 初始化 — 用全局 profiles 路径**

```ts
// src/mcp/mcp-server.ts:154-162
const pm = new ProfileManager({
  enabled: true,
  profilesDbPath: appConfig.profileManager.profilesDbPath ?? getProfilesDbPath(),
  // ... 其余字段不变
});
```

- [ ] **Step 2: 改 QueryAnalyzer 初始化 — 用 profile-scoped history/templates 路径**

```ts
// line 137-145 区域:
const activeProfileName = ...;  // 暂用 '_default',PR3 改成实际 active profile
this.queryAnalyzer = new QueryAnalyzer({
  enabled: true,
  templatesDbPath: appConfig.queryAnalyzer.templatesDbPath ?? getProfileDbPath(activeProfileName, 'templates'),
  historyDbPath: appConfig.queryAnalyzer.historyDbPath ?? getProfileDbPath(activeProfileName, 'history'),
  // ...
});
```

- [ ] **Step 3: 改 PlanHistory 初始化 — 同上**

```ts
// line 173-175:
this.planHistory = new PlanHistory({
  dbPath: path ?? getProfileDbPath(activeProfileName, 'plans'),
});
```

- [ ] **Step 4: 跑 build + 全测**

Run: `npm run build && npm run test:unit`
Expected: 全绿 (无行为变化,只是路径变了)

- [ ] **Step 5: 手动 smoke test(用临时目录,不碰用户已有数据)**

```bash
# 用临时目录模拟 cwd,绝不触碰 ~/.universal-db-mcp/profiles.db 已存在的数据
TESTDIR=$(mktemp -d)
cd "$TESTDIR"
DB_GLOBAL_DIR=$(mktemp -d)/.universal-db-mcp node dist/index.js &
PID=$!
# 等启动
sleep 2
# 调 save_profile 测试 profile
# 验证 $DB_GLOBAL_DIR/profiles.db 被创建 (而不是 $TESTDIR/profiles.db)
kill $PID
rm -rf "$TESTDIR" "${DB_GLOBAL_DIR}"
```

注意:**绝不** 从 cwd 老 profiles.db 迁移任何数据到全局目录;用户手动用 `export_profiles` / `import_profiles` 处理(PR5 文档说明)。

- [ ] **Step 6: Commit**

```bash
git add src/mcp/mcp-server.ts
git commit -m "feat(mcp-server): use global paths for profiles/history/templates/plans"
```

---

## PR3: 项目 `.profile` 自动激活 + `use_profile` recordToProject

**范围**: 新增 `path-resolver.ts`,启动序列读 `.profile`,`use_profile` 加 `recordToProject` 参数。

### Task 3.1: path-resolver.ts — `.profile` 读写

**Files:**

- Create: `src/utils/path-resolver.ts`
- Test: `tests/unit/path-resolver.test.ts`

**Interfaces:**

- Produces:
  - `readProjectProfile(cwd: string): { profile: string } | null` — 读 `.profile`,parse key=value
  - `writeProjectProfile(cwd: string, profileName: string): void` — 写 `profile=NAME\n`

- [ ] **Step 1: 写测试**

```ts
// tests/unit/path-resolver.test.ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('path-resolver .profile', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'profile-test-'));
  });
  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

  it('reads valid .profile', async () => {
    await fs.writeFile(path.join(tmp, '.profile'), 'profile=bbz-cq-oracle\n');
    const { readProjectProfile } = await import('../../src/utils/path-resolver.js');
    const r = readProjectProfile(tmp);
    expect(r).toEqual({ profile: 'bbz-cq-oracle' });
  });

  it('returns null when .profile missing', async () => {
    const { readProjectProfile } = await import('../../src/utils/path-resolver.js');
    expect(readProjectProfile(tmp)).toBeNull();
  });

  it('ignores malformed .profile (returns null)', async () => {
    await fs.writeFile(path.join(tmp, '.profile'), 'not a key value pair\n');
    const { readProjectProfile } = await import('../../src/utils/path-resolver.js');
    expect(readProjectProfile(tmp)).toBeNull();
  });

  it('writes profile=<name> to .profile', async () => {
    const { writeProjectProfile } = await import('../../src/utils/path-resolver.js');
    writeProjectProfile(tmp, 'my-profile');
    const content = await fs.readFile(path.join(tmp, '.profile'), 'utf8');
    expect(content).toBe('profile=my-profile\n');
  });
});
```

- [ ] **Step 2: 跑测试 fail**
- [ ] **Step 3: 实现 path-resolver.ts**

```ts
// src/utils/path-resolver.ts
import fs from 'node:fs';
import path from 'node:path';

const PROFILE_FILE = '.profile';

export function readProjectProfile(cwd: string): { profile: string } | null {
  const filePath = path.join(cwd, PROFILE_FILE);
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;  // 文件不存在
  }
  const line = content.split('\n').find(l => l.trim().length > 0);
  if (!line) return null;
  const m = line.match(/^profile=([a-zA-Z0-9_-]+)$/);
  if (!m) return null;
  return { profile: m[1] };
}

export function writeProjectProfile(cwd: string, profileName: string): void {
  const filePath = path.join(cwd, PROFILE_FILE);
  fs.writeFileSync(filePath, `profile=${profileName}\n`, 'utf8');
}
```

- [ ] **Step 4: 跑测试 pass**
- [ ] **Step 5: Commit**

```bash
git add src/utils/path-resolver.ts tests/unit/path-resolver.test.ts
git commit -m "feat(path-resolver): read/write .profile for project profile binding"
```

### Task 3.2: mcp-server 启动读 `.profile` 自动激活

**Files:**

- Modify: `src/mcp/mcp-server.ts` 启动序列(PR2 Task 2.3 之后)

**Interfaces:**

- Consumes: `readProjectProfile` (Task 3.1), ProfileManager

- [ ] **Step 1: 改启动序列 step 3**

在 PR2 启动序列的 step 3 (读 .profile) 实现:

```ts
// 在 ProfileManager 加载后,PlanHistory 加载前:
import { readProjectProfile } from '../utils/path-resolver.js';

const cwd = process.cwd();
const projectProfile = readProjectProfile(cwd);
if (projectProfile) {
  try {
    await pm.loadProfile(projectProfile.profile);  // 触发连接
    console.error(`[mcp] Auto-loaded profile '${projectProfile.profile}' from .profile`);
  } catch (err) {
    console.error(`[mcp] .profile references '${projectProfile.profile}' but it failed: ${err}`);
    // 不阻塞
  }
} else {
  console.error(`[mcp] No profile activated. Use save_profile + use_profile to set up.`);
  console.error(`[mcp] Tip: pass recordToProject: true to use_profile to bind this project.`);
}
```

- [ ] **Step 2: 测试 — 手动 e2e**

```bash
# 准备:全局存一个 test profile
mkdir -p ~/.universal-db-mcp
# (用 save_profile 工具)

# 在 cwd 创建 .profile
echo 'profile=bbz-cq-oracle' > .profile

# 启动 MCP (用 claude code 或直接 node)
# 验证启动日志有 "Auto-loaded profile 'bbz-cq-oracle' from .profile"
# 验证 use_profile 无需传参,直接激活的是 bbz-cq-oracle
```

- [ ] **Step 3: Commit**

```bash
git add src/mcp/mcp-server.ts
git commit -m "feat(mcp-server): auto-load profile from <cwd>/.profile at startup"
```

### Task 3.3: `use_profile` 加 `recordToProject` 参数

**Files:**

- Modify: `src/mcp/tools/profile-tools.ts` (use_profile handler)
- Test: `tests/unit/profile-tools.test.ts`

- [ ] **Step 1: 写测试**

```ts
it('use_profile with recordToProject=true writes .profile', async () => {
  const { writeProjectProfile } = await import('../../src/utils/path-resolver.js');
  const { buildUseProfileHandler } = await import('../../src/mcp/tools/profile-tools.js');
  const tmp = await fs.mkdtemp(...);
  process.chdir(tmp);
  const handler = buildUseProfileHandler(mockPm);
  await handler({ name: 'my-profile', recordToProject: true });
  const content = await fs.readFile(path.join(tmp, '.profile'), 'utf8');
  expect(content).toBe('profile=my-profile\n');
});
```

- [ ] **Step 2: 跑测试 fail**
- [ ] **Step 3: 改 handler**

```ts
// src/mcp/tools/profile-tools.ts use_profile handler
export function buildUseProfileHandler(pm: any) {
  return async (args: {
    name: string;
    recordToProject?: boolean;
  }) => {
    const live = await pm.loadProfile(args.name);
    if (args.recordToProject) {
      try {
        const { writeProjectProfile } = await import('../../utils/path-resolver.js');
        writeProjectProfile(process.cwd(), args.name);
      } catch (err) {
        console.error(`[mcp] failed to write .profile: ${err}`);
      }
    } else {
      console.error(`[mcp] profile '${args.name}' activated. Pass recordToProject: true to bind this project.`);
    }
    return live;
  };
}
```

- [ ] **Step 4: 跑测试 pass**
- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools/profile-tools.ts tests/unit/profile-tools.test.ts
git commit -m "feat(profile-tools): use_profile adds recordToProject option for .profile binding"
```

---

## PR4: 删除 `connect_database` / `disconnect_database` (BREAKING)

**范围**: 移除 2 个 tool,config-loader 静默忽略凭据 env + 一次性 hint。

### Task 4.1: 删除 `connect_database` tool

**Files:**

- Modify: `src/mcp/mcp-server.ts` (line 356, 667-722 等 — schema + dispatch + handler)
- Test: 任何引用 connect_database 的测试需更新

**Interfaces:**

- Produces: connect_database tool 不再注册

- [ ] **Step 1: grep 所有 connect_database 引用**

Run: `grep -rn "connect_database" src/ tests/`
Expected: 找到所有引用点

- [ ] **Step 2: 删除 schema 注册(line 356 附近)**
- [ ] **Step 3: 删除 dispatch case (line 667-722)**
- [ ] **Step 4: 删除或注释 handler 函数**
- [ ] **Step 5: 跑测试,确认无引用错误**

Run: `npm run test:unit`
Expected: PASS (现有测试应该已经覆盖断开 connect_database 的依赖;若有失败,改测试用 save_profile + use_profile 替代)

- [ ] **Step 6: Commit**

```bash
git add src/mcp/mcp-server.ts
git commit -m "refactor(mcp): BREAKING remove connect_database tool — use save_profile + use_profile instead"
```

### Task 4.2: 删除 `disconnect_database` tool

**Files:**

- Modify: `src/mcp/mcp-server.ts` (line 389-390 schema, 771-794 dispatch)

- [ ] **Step 1: grep + 删除 schema + dispatch + handler**
- [ ] **Step 2: 测试 + commit**

```bash
npm run test:unit  # 应全绿
git add src/mcp/mcp-server.ts
git commit -m "refactor(mcp): BREAKING remove disconnect_database tool — use disconnect_profile instead"
```

### Task 4.3: config-loader 静默忽略凭据 env

**Files:**

- Modify: `src/utils/config-loader.ts:1-100`

**Interfaces:**

- Produces: `DB_HOST`/`DB_USER`/`DB_PASSWORD`/`DB_TYPE`/`DB_PORT`/`DB_NAME`/`DB_SERVICE_NAME`/`DB_SID`/`DB_FILE_PATH`/`DB_AUTH_SOURCE` 全部忽略,首次启动 stderr 一次性 hint

- [ ] **Step 1: 写测试**

```ts
it('ignores legacy credential env vars', () => {
  process.env.DB_HOST = 'should-be-ignored';
  process.env.DB_USER = 'foo';
  const cfg = loadConfig();
  expect(cfg).not.toHaveProperty('database.host');
});

it('emits one-time stderr hint when legacy credential env detected', () => {
  process.env.DB_HOST = 'foo';
  process.env.DB_USER = 'bar';
  process.env.DB_PASSWORD = 'baz';
  const stderrSpy = vi.spyOn(console, 'error');
  loadConfig();
  expect(stderrSpy).toHaveBeenCalledWith(expect.stringMatching(/deprecated|凭据|save_profile/i));
});
```

- [ ] **Step 2: 跑测试 fail**
- [ ] **Step 3: 改 config-loader**

```ts
// 在 loadConfig() 顶部加一次性 hint 检测:
const LEGACY_ENV_KEYS = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_TYPE', 'DB_PORT', 'DB_NAME', 'DB_SERVICE_NAME', 'DB_SID', 'DB_FILE_PATH', 'DB_AUTH_SOURCE'];
const legacyFound = LEGACY_ENV_KEYS.filter(k => process.env[k]);
if (legacyFound.length > 0) {
  console.error(`⚠️ 已废弃的凭据 env 被忽略 (${legacyFound.join(', ')})。请用 save_profile 管理凭据。`);
}
```

然后删除(或跳过)处理这些 env 的代码块(line 1-100 范围)。

- [ ] **Step 4: 跑测试 pass**
- [ ] **Step 5: Commit**

```bash
git add src/utils/config-loader.ts tests/unit/config-loader.test.ts
git commit -m "feat(config-loader): silently ignore legacy credential env vars with one-time stderr hint"
```

---

## PR5: 文档更新 (README + CHANGELOG)

### Task 5.1: README 快速开始改写

**Files:**

- Modify: `README.md` (顶部 "Quick Start" / "快速开始" section)

- [ ] **Step 1: 找到 Quick Start section**

Run: `grep -n -i "quick.*start\|快速\|getting started\|# 快速" README.md`

- [ ] **Step 2: 重写 section**

新的 Quick Start 应强调:

1. 第一次: `save_profile` 创建 profile
2. 日常: `use_profile({name, recordToProject: true})` 激活 + 绑项目
3. 后续启动: 自动从 `.profile` 加载

移除任何 `connect_database` 引用

- [ ] **Step 3: 加 ".profile" + "~/.universal-db-mcp" 说明**
- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(readme): rewrite Quick Start for profile-based flow + .profile"
```

### Task 5.2: CHANGELOG v5.0.0 段

**Files:**

- Modify: `CHANGELOG.md` (顶部加新段)

- [ ] **Step 1: 加 `## [4.2.0] - 2026-08-18` 段**

```markdown
## [4.2.0] - 2026-08-18

### ✨ 改进

- **全局持久化**: profiles / history / templates / plans 移到 `~/.universal-db-mcp/`(可 `DB_GLOBAL_DIR` 覆盖)。跨项目共享 profile,history/templates/plans 按 profile 隔离在子目录。
- **`<cwd>/.profile` 自动激活**: 项目根放 `profile=NAME` 文件,MCP 启动自动加载该 profile。
- **`use_profile` 新增 `recordToProject: true`**: 激活 profile 时写入 `.profile`,下次自动加载。
- **`save_profile` 必填 `permissionMode`** (默认 `readwrite`),不再从 env 读取。
- **Profile 新增元字段**: `category` / `productName` / `version`,首次连接自动探测缓存。

### 🔥 BREAKING 变更

- **`connect_database` / `disconnect_database` tool 已删除**。请用 `save_profile` + `use_profile` + `disconnect_profile`。
- **`.mcp.json` 凭据 env 已废弃** (`DB_HOST`/`DB_USER`/`DB_PASSWORD` 等)。静默忽略,功能失效。
- **cwd-relative 默认路径已移除** (`profiles.db` 等)。所有持久化统一到 `~/.universal-db-mcp/`。

### 📚 文档

- README Quick Start 重写
- 配置文件简化示例
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): v5.0.0 global state + profile isolation"
```

---

## 验证清单 (所有 PR 完成后)

- [ ] `npm run test:unit` — 512+ 测试全绿
- [ ] `npm run build` — 0 error
- [ ] `npm run lint:instructions` — pass
- [ ] 手动 e2e (PR3 PR5 后):
  - `rm -rf ~/.universal-db-mcp` 清理
  - save_profile 一个 test profile
  - 验证 `~/.universal-db-mcp/profiles.db` 创建
  - use_profile(recordToProject=true)
  - 验证 `<cwd>/.profile` 内容
  - 重启 MCP,验证自动激活日志
  - 验证 query_history 写到 `~/.universal-db-mcp/{profileName}/history.db`
- [ ] Windows EISDIR 复测 (沿用 v4.0.9 path-guard 修复)

## Self-Review

- Spec §1 (背景与目标) → 全部 PR1-5 覆盖
- Spec §2 (存储布局) → PR2 Task 2.1-2.3
- Spec §3 (Profile 模型) → PR1 全部
- Spec §4 (.profile 生命周期) → PR3 全部
- Spec §5 (API 改动) → PR1 (save_profile), PR3 (use_profile), PR4 (删除)
- Spec §6 (加密) → 沿用现有 SQLCipher,无新代码
- Spec §7 (向后兼容) → PR4 全部
- Spec §8 (测试) → 每个 PR 都有对应测试任务
- Spec §11 (PR 拆分) → 完全对齐

类型一致性:

- `isValidProfileName(name: string)` 在 Task 1.1 定义,Task 1.3 复用 ✓
- `getProfilesDbPath()` 在 Task 2.1 定义,Task 2.2/2.3 复用 ✓
- `getProfileDbPath(name, kind)` 在 Task 2.1 定义,Task 2.3/3.2 复用 ✓
- `readProjectProfile(cwd)` 在 Task 3.1 定义,Task 3.2 复用 ✓
- `writeProjectProfile(cwd, name)` 在 Task 3.1 定义,Task 3.3 复用 ✓

占位符扫描:
-无 "TBD"/"TODO"/"implement later" 模式

- 无 "fill in details"
- 所有代码块有具体内容

Scope 检查: 5 PR 各自独立可测,完整后形成 working software。
