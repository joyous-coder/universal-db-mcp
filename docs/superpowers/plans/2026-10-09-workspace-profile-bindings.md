# 工作区 Profile 绑定迁移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把工作区→profile 的激活记录从项目目录的 `.db-profile` 纯文本文件,迁移到 `~/.universal-db-mcp/workspaces.db` 的表,让项目目录不再产生任何 MCP 状态文件。

**Architecture:** 新增 `WorkspaceStore`(SQLite,参照 `TemplateStore` 形状,无加密无迁移),以 `workspace_path` 归一化后的绝对路径为主键。三个接入点替换查询方式:启动自动激活(`mcp-server.ts`)、history/templates 路径解析(`config-loader.ts`)、`use_profile` 同步写入(`profile-tools.ts`)。删除 `path-resolver.ts` 整个文件。

**Tech Stack:** TypeScript (strict), Node 20+, vitest, 复用现有 `detectEncryptedBackend` 多后端 SQLite(node:sqlite / better-sqlite3)

**Spec:** `docs/superpowers/specs/2026-10-09-workspace-profile-bindings-design.md`

## Global Constraints

- **Breaking change** —— `use_profile` 的 `recordToProject` 入参消失;`.db-profile` / `.profile` 不再被读取。CHANGELOG 必须记录。
- **不迁移旧绑定** —— 不实现任何 `.db-profile` → `workspaces.db` 的迁移或 fallback 读。
- **精确匹配 cwd** —— 不做父目录向上查找。语义与现有 `.db-profile` 等价。
- **`use_profile` 无条件写** —— 每次调用都记录当前工作区,无"临时激活"开关。
- **`workspaces.db` 不加密** —— 不接受 `DB_PROFILE_ENCRYPTION_KEY`,只用 native backend。
- **user-visible 文案用简体中文**;内部注释中文(架构决策)/英文(常规)。
- **TS strict** —— 新代码不允许 `any`。
- **提交信息前缀** `feat:` / `fix:` / `refactor:` / `test:` / `docs:` / `chore:`。
- 每个 task 结束必须 `npm test` 与 `npm run build` 全绿才提交。

## Review Focus

以下五类输入/情况 spec 暗示了但没有 task 的测试直接覆盖,是实施时最容易漏且最该被测到的:

1. **db 文件不可达**(`workspaces.db` 路径是目录、权限拒绝、磁盘满)—— `get()` 必须返回 `null` 而非抛出,MCP 启动不能因此中断。归 Task 1。
2. **`set()` 失败但 profile 已激活成功** —— `use_profile` 仍要返回成功,hint 说明"记录失败"而非整体报错。归 Task 4。
3. **并发写同一 `workspaces.db`** —— 两个 MCP 进程同时 `set()` 不同工作区,不能抛 SQLITE_BUSY。归 Task 1。
4. **profile 被删除后残留孤儿绑定** —— `delete_profile` 后 `workspaces.db` 里指向它的行必须消失,否则重启时 `loadProfile` 失败。归 Task 5。
5. **非 ASCII / 含空格的工作区路径** —— `D:\我的项目\a b\` 必须能正常记录与命中。归 Task 1。

---

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `src/core/workspace-store.ts` | **新建** | 工作区绑定的 CRUD,单文件单职责 |
| `src/utils/global-paths.ts` | 修改 | 加 `getWorkspacesDbPath()` 一个函数 |
| `src/utils/path-resolver.ts` | **删除** | `.db-profile` 读写,被 store 取代 |
| `src/utils/config-loader.ts` | 修改 | 路径解析改查表,函数改 async |
| `src/mcp/mcp-server.ts` | 修改 | 启动激活改查表 |
| `src/mcp/tools/profile-tools.ts` | 修改 | `use_profile` 去掉 `recordToProject`,无条件写 |
| `src/core/profile-manager.ts` | 修改 | `deleteProfile` 清理孤儿绑定 |
| `src/index.ts` | 修改 | `loadConfig()` 加 await |
| `src/mcp/mcp-index.ts` | 修改 | `loadConfig()` 加 await(2 处) |
| `src/http/routes/mcp-sse.ts` | 修改 | `loadConfig()` 加 await |
| `tests/unit/workspace-store.test.ts` | **新建** | store 全量测试 |
| `tests/unit/path-resolver.test.ts` | **删除** | 被 store 测试取代 |
| `tests/unit/use-profile-record.test.ts` | 修改 | 改测查表而非读文件 |
| `tests/unit/config-loader.test.ts` | 修改 | 绑定场景改写 |
| `tests/unit/config-loader-global.test.ts` | 修改 | 同上 |
| `README.md` / `README.zh-CN.md` / `docs/**` | 修改 | 文案更新 |
| `CHANGELOG.md` | 修改 | breaking change 记录 |

---

## Task 1: WorkspaceStore

**Files:**
- Create: `src/core/workspace-store.ts`
- Test: `tests/unit/workspace-store.test.ts`

**Interfaces:**
- Consumes: `detectEncryptedBackend` from `src/utils/encrypted-sqlite.js`(传 `undefined` 走 native backend);`isValidProfileName` from `src/core/profile-manager.js`
- Produces:
  ```ts
  export class WorkspaceStore {
    constructor(dbPath: string)
    get(cwd: string): Promise<string | null>
    set(cwd: string, profileName: string): Promise<void>
    remove(cwd: string): Promise<void>
    close(): Promise<void>
  }
  export function normalizeWorkspacePath(p: string): string
  ```

- [ ] **Step 1: 写失败测试 —— 基础 CRUD**

创建 `tests/unit/workspace-store.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { WorkspaceStore } from '../../src/core/workspace-store.js';

describe('WorkspaceStore', () => {
  let tmp: string;
  let dbPath: string;
  let store: WorkspaceStore;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-store-'));
    dbPath = path.join(tmp, 'workspaces.db');
    store = new WorkspaceStore(dbPath);
  });

  afterEach(async () => {
    await store.close();
    try { await fs.rm(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('set() then get() returns the bound profile', async () => {
    await store.set(tmp, 'my-profile');
    expect(await store.get(tmp)).toBe('my-profile');
  });

  it('get() returns null for an unbound workspace', async () => {
    expect(await store.get(tmp)).toBeNull();
  });

  it('set() twice on the same workspace upserts (one row, new value)', async () => {
    await store.set(tmp, 'first');
    await store.set(tmp, 'second');
    expect(await store.get(tmp)).toBe('second');
  });

  it('remove() clears the binding', async () => {
    await store.set(tmp, 'my-profile');
    await store.remove(tmp);
    expect(await store.get(tmp)).toBeNull();
  });

  it('remove() on an unbound workspace is a no-op', async () => {
    await expect(store.remove(tmp)).resolves.toBeUndefined();
  });

  it('set() rejects an invalid profile name', async () => {
    await expect(store.set(tmp, 'has.dot')).rejects.toThrow(/profile name/i);
  });

  it('get() returns null when the db file is unreachable', async () => {
    await store.close();
    // 把 db 路径占成一个目录 —— open 必然失败
    const blocked = path.join(tmp, 'blocked');
    await fs.mkdir(blocked);
    const bad = new WorkspaceStore(path.join(blocked, 'nested.db'));
    expect(await bad.get(tmp)).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run tests/unit/workspace-store.test.ts
```
Expected: FAIL —— `Cannot find module '../../src/core/workspace-store.js'`

- [ ] **Step 3: 写最小实现**

创建 `src/core/workspace-store.ts`:

```ts
/**
 * WorkspaceStore (v5.1.0)
 *
 * 取代 v5.0.0 的 <cwd>/.db-profile 纯文本文件,把「工作区 → 激活 profile」
 * 的映射存入 SQLite。精确匹配 process.cwd(),不做父目录向上查找
 * (与 .db-profile 行为等价)。
 *
 * 本 db 不加密 —— 表内只有本地路径和 profile 名,无凭据。
 */

import path from 'node:path';
import type { SQLiteConnection } from '../adapters/sqlite/types.js';
import { detectEncryptedBackend } from '../utils/encrypted-sqlite.js';
import { isValidProfileName } from './profile-manager.js';

/**
 * 归一化工作区路径:消掉相对路径/..,统一分隔符,转小写。
 * Windows 路径大小写不敏感,转小写避免同一目录被当成两个工作区。
 */
export function normalizeWorkspacePath(p: string): string {
  return path.resolve(p).replace(/\\/g, '/').toLowerCase();
}

function q(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

export class WorkspaceStore {
  private conn: SQLiteConnection | null = null;
  private initPromise: Promise<void> | null = null;
  /** init 失败后的重试闸门 —— get() 吞错时靠它避免每次都重试 */
  private broken = false;

  constructor(public readonly dbPath: string) {}

  private async init(): Promise<void> {
    if (this.conn) return;
    if (this.broken) throw new Error('workspace store unavailable');
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      const backend = detectEncryptedBackend(undefined); // 始终 native,不支持加密
      try {
        this.conn = await backend.open(this.dbPath, { readonly: false });
      } catch (err) {
        this.initPromise = null;
        this.broken = true;
        throw err;
      }
      this.conn.exec(`
        CREATE TABLE IF NOT EXISTS workspace_bindings (
          workspace_path TEXT PRIMARY KEY,
          profile_name   TEXT NOT NULL,
          updated_at     TEXT NOT NULL
        );
      `);
    })();
    return this.initPromise;
  }

  /** 读绑定。db 不可达时返回 null —— 启动期读不到绑定等同"未配置",不该阻断启动。 */
  async get(cwd: string): Promise<string | null> {
    try {
      await this.init();
    } catch {
      return null;
    }
    const rows = this.conn!.prepare(
      `SELECT profile_name FROM workspace_bindings WHERE workspace_path = ${q(normalizeWorkspacePath(cwd))}`,
    ).all() as Array<{ profile_name: string }>;
    return rows[0]?.profile_name ?? null;
  }

  /** UPSERT 绑定。profile 名非法直接抛(调用方负责捕获)。 */
  async set(cwd: string, profileName: string): Promise<void> {
    if (!isValidProfileName(profileName)) {
      throw new Error(
        `WorkspaceStore.set: invalid profile name "${profileName}" (must match /^[a-zA-Z0-9_-]+$/)`,
      );
    }
    await this.init();
    // UPSERT 而非 read-then-write —— 多进程并发 set() 不同工作区时不互相踩
    this.conn!.exec(`
      INSERT INTO workspace_bindings (workspace_path, profile_name, updated_at)
      VALUES (${q(normalizeWorkspacePath(cwd))}, ${q(profileName)}, ${q(new Date().toISOString())})
      ON CONFLICT(workspace_path) DO UPDATE SET
        profile_name = excluded.profile_name,
        updated_at   = excluded.updated_at;
    `);
  }

  /** 移除绑定。不存在时静默。 */
  async remove(cwd: string): Promise<void> {
    await this.init();
    this.conn!.exec(
      `DELETE FROM workspace_bindings WHERE workspace_path = ${q(normalizeWorkspacePath(cwd))}`,
    );
  }

  /** 按 profile 名清理 —— delete_profile 时清孤儿绑定。返回删除行数。 */
  async removeByProfile(profileName: string): Promise<number> {
    await this.init();
    const before = this.conn!.prepare(
      `SELECT workspace_path FROM workspace_bindings WHERE profile_name = ${q(profileName)}`,
    ).all() as Array<{ workspace_path: string }>;
    this.conn!.exec(`DELETE FROM workspace_bindings WHERE profile_name = ${q(profileName)}`);
    return before.length;
  }

  async close(): Promise<void> {
    this.conn = null;
    this.initPromise = null;
    this.broken = false;
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run tests/unit/workspace-store.test.ts
```
Expected: PASS 8/8

若 `get() returns null when the db file is unreachable` 失败(better-sqlite3 可能对嵌套目录路径直接创建),改为在 `blocked` 目录本身放一个同名文件使路径冲突。

- [ ] **Step 5: 补归一化与并发测试**

追加到 `tests/unit/workspace-store.test.ts`:

```ts
describe('normalizeWorkspacePath', () => {
  it('normalizes backslashes to forward slashes', () => {
    expect(normalizeWorkspacePath('D:\\work\\proj')).toBe('d:/work/proj');
  });

  it('lowercases for case-insensitive filesystems', () => {
    expect(normalizeWorkspacePath('D:\\Work\\Proj')).toBe('d:/work/proj');
  });

  it('resolves relative segments and trailing slashes', () => {
    const a = normalizeWorkspacePath('D:\\work\\proj\\sub\\..');
    const b = normalizeWorkspacePath('D:\\work\\proj\\');
    expect(a).toBe(b);
  });

  it('handles non-ASCII and space-containing paths', () => {
    expect(normalizeWorkspacePath('D:\\我的项目\\a b')).toBe('d:/我的项目/a b');
  });
});

describe('WorkspaceStore path normalization', () => {
  it('matches a workspace written with a different separator/case', async () => {
    const store2 = new WorkspaceStore(dbPath);
    await store2.set('D:\\Work\\Proj', 'p1');
    expect(await store2.get('d:/work/proj')).toBe('p1');
    await store2.close();
  });

  it('removeByProfile clears all bindings pointing at that profile', async () => {
    await store.set(tmp, 'victim');
    const n = await store.removeByProfile('victim');
    expect(n).toBe(1);
    expect(await store.get(tmp)).toBeNull();
  });

  it('concurrent set() on distinct workspaces all persist', async () => {
    await Promise.all([
      store.set(tmp, 'a'),
      store.set(path.join(tmp, 'x'), 'b'),
      store.set(path.join(tmp, 'y'), 'c'),
    ]);
    expect(await store.get(tmp)).toBe('a');
    expect(await store.get(path.join(tmp, 'x'))).toBe('b');
    expect(await store.get(path.join(tmp, 'y'))).toBe('c');
  });
});
```

需要在文件顶部 import 里加 `normalizeWorkspacePath`。

- [ ] **Step 6: 跑测试**

```bash
npx vitest run tests/unit/workspace-store.test.ts
```
Expected: PASS 15/15

- [ ] **Step 7: 提交**

```bash
git add src/core/workspace-store.ts tests/unit/workspace-store.test.ts
git commit -m "feat(workspace-store): SQLite 工作区→profile 绑定存储

取代 .db-profile 纯文本文件。workspace_path 归一化后作主键,UPSERT
避免并发 read-then-write 竞态。get() 在 db 不可达时返回 null 而非抛出,
保证启动期不因状态库故障中断。
"
```

---

## Task 2: getWorkspacesDbPath

**Files:**
- Modify: `src/utils/global-paths.ts`(在 `getProfilesDbPath` 后追加)
- Test: `tests/unit/global-paths.test.ts`(已存在,追加用例)

**Interfaces:**
- Consumes: `getGlobalDir()` from `src/utils/global-paths.js`
- Produces: `export function getWorkspacesDbPath(): string` → `<globalDir>/workspaces.db`

- [ ] **Step 1: 写失败测试**

在 `tests/unit/global-paths.test.ts` 末尾追加:

```ts
describe('getWorkspacesDbPath', () => {
  it('resolves to <globalDir>/workspaces.db', () => {
    const p = getWorkspacesDbPath();
    expect(p.endsWith('workspaces.db')).toBe(true);
    expect(path.dirname(p)).toBe(path.resolve(getGlobalDir()));
  });
});
```

在该文件的 import 中加入 `getWorkspacesDbPath`(以及 `getGlobalDir`、`path` 若尚未导入)。

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run tests/unit/global-paths.test.ts
```
Expected: FAIL —— `getWorkspacesDbPath is not a function`

- [ ] **Step 3: 实现**

在 `src/utils/global-paths.ts` 的 `getProfilesDbPath()` 之后插入:

```ts
/** workspaces.db — 工作区→profile 绑定表 (v5.1.0,取代 .db-profile) */
export function getWorkspacesDbPath(): string {
  return path.join(getGlobalDir(), 'workspaces.db');
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run tests/unit/global-paths.test.ts
```
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/utils/global-paths.ts tests/unit/global-paths.test.ts
git commit -m "feat(global-paths): 新增 getWorkspacesDbPath"
```

---

## Task 3: config-loader 改查表并改 async

**Files:**
- Modify: `src/utils/config-loader.ts:12`(import)、`:87`(签名)、`:189-190`(查询)、`:300`(`loadConfig`)
- Modify: `src/index.ts:13`、`src/mcp/mcp-index.ts:134`、`:151`、`src/http/routes/mcp-sse.ts:76`
- Test: `tests/unit/config-loader.test.ts`、`tests/unit/config-loader-global.test.ts`

**Interfaces:**
- Consumes: `WorkspaceStore` / `getWorkspacesDbPath` from Task 1/2
- Produces: `loadFromEnv(): Promise<Partial<AppConfig>>`;`loadConfig(): Promise<AppConfig>`(签名由同步改异步)

**注意:** 这是本计划里唯一有**跨文件连带改动**的 task。`loadConfig()` 的 4 个调用点必须一起改,否则编译不过。

- [ ] **Step 1: 改写 config-loader-global 的绑定用例**

`tests/unit/config-loader-global.test.ts:79-91` 现在靠写 `.db-profile` 文件来触发 per-profile 路径。改为写 workspace 绑定:

```ts
  // v5.1.0: with workspace binding present, paths follow per-profile subdir
  it('historyDbPath follows per-profile subdir when workspace is bound', async () => {
    // 在 tmp cwd 绑 bbz-cq-oracle(mimicking user's setup)
    const { WorkspaceStore } = await import('../../src/core/workspace-store.js');
    const { getWorkspacesDbPath } = await import('../../src/utils/global-paths.js');
    const wsStore = new WorkspaceStore(getWorkspacesDbPath());
    await wsStore.set(tmpCwd, 'bbz-cq-oracle');
    await wsStore.close();

    process.env.DB_QUERY_ANALYZER_ENABLED = 'true';
    const { loadConfig } = await import('../../src/utils/config-loader.js');
    const cfg = await loadConfig();               // v5.1.0: loadConfig 转 async,加 await
    expect(cfg.queryAnalyzer?.historyDbPath).toBe(
      path.join(os.homedir(), '.universal-db-mcp', 'bbz-cq-oracle', 'history.db'),
    );
    expect(cfg.queryAnalyzer?.templatesDbPath).toBe(
      path.join(os.homedir(), '.universal-db-mcp', 'bbz-cq-oracle', 'templates.db'),
    );
  });
```

同时把该文件内**所有** `const cfg = loadConfig();` 改为 `const cfg = await loadConfig();` —— 已核实的调用点:`:61`、`:71`、`:84`、`:96`、`:108`。第 108 行的裸调用 `loadConfig();`(在 stderr 断言里)改为 `await loadConfig();`。

并删除或改写 `:62-63`、`:35-36` 中提到 `.db-profile` 的注释。

- [ ] **Step 1b: 改写 config-loader.test.ts**

`tests/unit/config-loader.test.ts` 同样有 `loadConfig()` 调用,逐个加 `await`:

```bash
grep -n "loadConfig()" tests/unit/config-loader.test.ts
```

对每处命中,把 `loadConfig()` 改为 `await loadConfig()`,并确认所在 `it()` 是 `async` 函数。若有测试专门断言 `.db-profile` 行为,按上例改写为 workspace 绑定。

- [ ] **Step 1c: 跑测试确认失败**

```bash
npx vitest run tests/unit/config-loader.test.ts tests/unit/config-loader-global.test.ts
```
Expected: 改写后的绑定用例 FAIL(绑定写进 store 但 config-loader 仍读文件)

- [ ] **Step 2: 改 config-loader**

`src/utils/config-loader.ts`:

```ts
// import 段(替换 :12 行的 path-resolver import)
import { readProjectProfile } from './path-resolver.js';   // 删
// → 新增
import { getWorkspacesDbPath } from './global-paths.js';   // 与既有 import 合并
import { WorkspaceStore } from '../core/workspace-store.js';
```

把 `export function loadFromEnv(): Partial<AppConfig> {` 改为:

```ts
export async function loadFromEnv(): Promise<Partial<AppConfig>> {
```

把 `:189-190`:

```ts
    const projectProfile = readProjectProfile(process.cwd());
    const activeProfile = projectProfile?.profile ?? null;
```

改为:

```ts
    // v5.1.0: 工作区绑定查 workspaces.db(取代 .db-profile 文件)
    const wsStore = new WorkspaceStore(getWorkspacesDbPath());
    const activeProfile = await wsStore.get(process.cwd());
```

把 `:300` 的 `export function loadConfig(): AppConfig {` 改为 `export async function loadConfig(): Promise<AppConfig> {`,其内部 `const envConfig = loadFromEnv();` 改为 `const envConfig = await loadFromEnv();`。

- [ ] **Step 3: 改 4 个调用点**

- `src/index.ts:13` → `const config = await loadConfig();`
- `src/mcp/mcp-index.ts:134` → `const appConfig = await loadConfig();`
- `src/mcp/mcp-index.ts:151` → `const appConfig = await loadConfig();`
- `src/http/routes/mcp-sse.ts:76` → `await mcpServer.configureFromAppConfig(await loadConfig());`

四处上下文均已 async(已核实)。

- [ ] **Step 4: 跑测试与编译**

```bash
npx vitest run tests/unit/config-loader.test.ts tests/unit/config-loader-global.test.ts
npm run build
```
Expected: 测试 PASS;build 退出码 0(若有 "must return a Promise" 类错误,说明有调用点漏改,用 `grep -rn "loadConfig()" src/` 复查)

- [ ] **Step 5: 提交**

```bash
git add src/utils/config-loader.ts src/index.ts src/mcp/mcp-index.ts src/http/routes/mcp-sse.ts tests/unit/config-loader.test.ts tests/unit/config-loader-global.test.ts
git commit -m "refactor(config-loader): 工作区绑定改查 workspaces.db,loadConfig 转 async

4 个调用点(index.ts / mcp-index.ts ×2 / mcp-sse.ts)均已在 async
上下文内,无额外波及。保留 config-loader.ts:194 的既有 if 守卫。
"
```

---

## Task 4: mcp-server 启动激活 + use_profile 改造

**Files:**
- Modify: `src/mcp/mcp-server.ts:183-206`
- Modify: `src/mcp/tools/profile-tools.ts:115-180`
- Test: `tests/unit/use-profile-record.test.ts`

**Interfaces:**
- Consumes: `WorkspaceStore` / `getWorkspacesDbPath` from Task 1/2
- Produces: `buildUseProfileHandler(pm): (args: { name: string }) => Promise<...>` —— 入参不再有 `recordToProject`

- [ ] **Step 1: 改测试:从"读文件"改为"查表"**

重写 `tests/unit/use-profile-record.test.ts`。它现在 `readFile` 断言 `.db-profile` 内容,改为查表:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildUseProfileHandler } from '../../src/mcp/tools/profile-tools.js';
import { WorkspaceStore } from '../../src/core/workspace-store.js';
import { getWorkspacesDbPath } from '../../src/utils/global-paths.js';

describe('use_profile records workspace binding', () => {
  let tmp: string;
  let pm: any;
  let cwdSpy: any;
  let store: WorkspaceStore;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'use-profile-test-'));
    process.env.DB_GLOBAL_DIR = path.join(tmp, 'global');
    store = new WorkspaceStore(getWorkspacesDbPath());
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmp);
    pm = {
      loadProfile: vi.fn().mockResolvedValue({
        profile: { name: 'test-prof', type: 'oracle', role: 'primary', config: {} },
        adapter: {},
        service: {},
      }),
    };
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    await store.close();
    delete process.env.DB_GLOBAL_DIR;
    try { await fs.rm(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('records the binding in workspaces.db (no .db-profile file created)', async () => {
    const handler = buildUseProfileHandler(pm);
    await handler({ name: 'test-prof' });
    expect(await store.get(tmp)).toBe('test-prof');
    // 项目目录不应产生任何状态文件
    const entries = await fs.readdir(tmp);
    expect(entries).not.toContain('.db-profile');
  });

  it('second use_profile on the same workspace upserts', async () => {
    const handler = buildUseProfileHandler(pm);
    await handler({ name: 'test-prof' });
    await handler({ name: 'other-prof' });
    expect(await store.get(tmp)).toBe('other-prof');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run tests/unit/use-profile-record.test.ts
```
Expected: FAIL —— 绑定未写入,`store.get(tmp)` 为 null

- [ ] **Step 3: 改 profile-tools**

`src/mcp/tools/profile-tools.ts`,`buildUseProfileHandler` 整体替换为:

```ts
export function buildUseProfileHandler(pm: ProfileManager) {
  return async (args: { name: string }) => {
    const live = await pm.loadProfile(args.name);
    // v5.1.0: 工作区→profile 绑定写入 workspaces.db(取代 .db-profile 文件)。
    //   每次 use_profile 都记录当前 cwd —— 无"临时激活"开关。
    //   记录失败不影响激活本身(已成功),只影响下次启动的自动恢复。
    let profileRecordHint: string;
    try {
      const { WorkspaceStore } = await import('../../core/workspace-store.js');
      const { getWorkspacesDbPath } = await import('../../utils/global-paths.js');
      const wsStore = new WorkspaceStore(getWorkspacesDbPath());
      await wsStore.set(process.cwd(), args.name);
      profileRecordHint = `已记录 ${process.cwd()} → profile=${args.name},下次 MCP 启动自动激活。`;
      console.error(`[mcp] profile '${args.name}' activated and bound to this workspace.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : err;
      profileRecordHint = `profile 已激活,但工作区记录失败: ${msg}。下次启动需手动 use_profile。`;
      console.error(`[mcp] profile '${args.name}' activated; workspace record failed: ${msg}`);
    }

    // v4.0.2 Bug #7: 返回整个 LiveProfile —— adapter + service 已由 loadProfile
    // 连好,调用方直接用,**不要**再 createAdapter+connect(DM 池别名会冲突)。
    return {
      name: live.profile.name,
      type: live.profile.type,
      role: live.profile.role,
      profileConfig: live.profile.config,
      adapter: live.adapter,
      service: live.service,
      profileRecordHint,
    };
  };
}
```

**注意**:删除 handler 里 `syncProjectProfile` 函数和 `recordToProject === false` 的整个分支 —— 那是 v5.0.0 为 `.db-profile` 服务的,现已无对应物。`pm.loadProfile(args.name)` 及其后到 `return` 之间的激活主流程**一行都不要改**。

- [ ] **Step 4: 改 mcp-server 启动流程**

`src/mcp/mcp-server.ts:183-206`,把 `readProjectProfile` 换成查表:

```ts
      // v5.1.0: 启动时读 workspaces.db 查本工作区绑定的 profile,自动激活并**完整连接**
      try {
        const { WorkspaceStore } = await import('../core/workspace-store.js');
        const { getWorkspacesDbPath } = await import('../utils/global-paths.js');
        const wsStore = new WorkspaceStore(getWorkspacesDbPath());
        const boundProfile = await wsStore.get(process.cwd());
        if (boundProfile) {
          try {
            const live = await pm.loadProfile(boundProfile);
            await this.activateProfile(boundProfile, {
              adapter: live.adapter,
              service: live.service,
              profileConfig: live.profile.config,
              type: live.profile.type,
            });
            console.error(`[mcp] Auto-loaded + connected profile '${boundProfile}' from workspace binding`);
          } catch (loadErr) {
            console.error(
              `[mcp] workspace binding references '${boundProfile}' but failed: ${loadErr instanceof Error ? loadErr.message : loadErr}`,
            );
          }
        } else {
          console.error('[mcp] No profile activated. Use save_profile + use_profile to set up.');
          console.error('[mcp] Tip: calling use_profile in this directory will bind it for next launch.');
        }
      } catch (resolveErr) {
        console.error(`[mcp] workspace binding resolve failed: ${resolveErr instanceof Error ? resolveErr.message : resolveErr}`);
      }
```

同样:`activateProfile` 的第二参数是 `handlerReturn: any`(见 `mcp-server.ts:243`),上面的四个字段与原调用点完全一致,只换查询来源。

- [ ] **Step 5: 跑测试与编译**

```bash
npx vitest run tests/unit/use-profile-record.test.ts tests/integration/mcp-profile-tools.test.ts tests/unit/mcp-data-governance-tools.test.ts
npm run build
```
Expected: PASS;build 0

`tests/integration/mcp-profile-tools.test.ts` 是集成测试,若它也调用了 `use_profile` 并断言 `.db-profile`,一并改为查表断言。

- [ ] **Step 6: 提交**

```bash
git add src/mcp/tools/profile-tools.ts src/mcp/mcp-server.ts tests/unit/use-profile-record.test.ts
git commit -m "refactor(mcp): use_profile 绑定改写 workspaces.db,去掉 recordToProject

BREAKING: use_profile 入参不再接受 recordToProject。记录失败不阻断
激活,仅影响下次启动的自动恢复。项目目录不再产生 .db-profile。
"
```

---

## Task 5: 删除 path-resolver + delete_profile 孤儿清理

**Files:**
- Delete: `src/utils/path-resolver.ts`
- Delete: `tests/unit/path-resolver.test.ts`
- Modify: `src/core/profile-manager.ts:282-320`(`deleteProfile`)

**Interfaces:**
- Consumes: `WorkspaceStore` from Task 1
- Produces: 无新导出

- [ ] **Step 1: 确认没有残留引用**

```bash
grep -rn "path-resolver\|readProjectProfile\|writeProjectProfile" src/ tests/
```
Expected: 无输出。若有输出,先全部改掉再删文件。

- [ ] **Step 2: 写孤儿清理的失败测试**

在 `tests/unit/profile-lifecycle-tools.test.ts`(或 `profile-manager` 相关的既有测试文件)追加:

```ts
describe('deleteProfile clears workspace bindings', () => {
  it('removes bindings pointing at the deleted profile', async () => {
    // 沿用该文件既有的 pm / tmp / globalDir 构造方式
    const wsStore = new WorkspaceStore(getWorkspacesDbPath());
    await wsStore.set('/ws/a', 'doomed');
    await wsStore.set('/ws/b', 'survivor');

    await pm.deleteProfile('doomed', { confirm: true });

    expect(await wsStore.get('/ws/a')).toBeNull();
    expect(await wsStore.get('/ws/b')).toBe('survivor');
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
npx vitest run tests/unit/profile-lifecycle-tools.test.ts
```
Expected: FAIL —— `/ws/a` 仍返回 `'doomed'`

- [ ] **Step 4: 实现清理**

`src/core/profile-manager.ts` 的 `deleteProfile` 中,在 `:313` 的 `removeProfileDir(name)` 附近追加:

```ts
      // v5.1.0: 清理 workspaces.db 中指向该 profile 的工作区绑定,避免孤儿行
      // 导致下次启动 loadProfile 失败。
      try {
        const { WorkspaceStore } = await import('./workspace-store.js');
        const { getWorkspacesDbPath } = await import('../utils/global-paths.js');
        const n = await new WorkspaceStore(getWorkspacesDbPath()).removeByProfile(name);
        if (n > 0) console.error(`[profile] cleared ${n} workspace binding(s) for '${name}'`);
      } catch (e) {
        // 清理失败不阻断删 profile —— 孤儿行下次启动报错即可修复
        console.error(`[profile] workspace binding cleanup failed: ${e instanceof Error ? e.message : e}`);
      }
```

- [ ] **Step 5: 跑测试确认通过**

```bash
npx vitest run tests/unit/profile-lifecycle-tools.test.ts
```
Expected: PASS

- [ ] **Step 6: 删除 path-resolver**

```bash
git rm src/utils/path-resolver.ts tests/unit/path-resolver.test.ts
```

- [ ] **Step 7: 全量测试 + 编译**

```bash
npm test
npm run build
```

**预期基线**:修复前已有 10 个失败 / 663 个测试(`better-sqlite3-multiple-ciphers` 的 NODE_MODULE_VERSION 137 vs 127 ABI 不匹配,与本改动无关)。若失败数 ≠ 10,说明本次改动引入了回归。

- [ ] **Step 8: 提交**

```bash
git add src/core/profile-manager.ts tests/unit/profile-lifecycle-tools.test.ts
git commit -m "refactor(profile): delete_profile 清理工作区孤儿绑定;删除 path-resolver

BREAKING: .db-profile / .profile 不再被读取,现有绑定失效,需在各目录
重新 use_profile 一次。"
```

---

## Task 6: 文档与 CHANGELOG

**Files:**
- Modify: `README.md`、`README.zh-CN.md`、`.gitignore`、`CHANGELOG.md`
- Modify: `docs/**` 中提及 `.db-profile` / `recordToProject` 的文件

**Interfaces:**
- Consumes: 无代码依赖
- Produces: 无

- [ ] **Step 1: 定位全部文档引用**

```bash
grep -rln "db-profile\|recordToProject\|\.profile" README.md README.zh-CN.md docs/
```
预期命中:`README.md`、`README.zh-CN.md`、`docs/smoke-test-v5.0.0.md`、以及 `docs/07-development` / `docs/09-reference` 下的若干文件。

**注意**:`docs/superpowers/specs/` 和 `docs/superpowers/plans/` 下的历史设计文档**不改** —— 它们是历史记录,描述的是当时的状态。`docs/superpowers/plans/2026-10-09-*.md` 和本计划也不改。

- [ ] **Step 2: 改 README 两份**

把「项目级激活文件」相关章节改写为:

```markdown
### 工作区绑定

`use_profile` 会把「当前目录 → profile」的绑定记入 `~/.universal-db-mcp/workspaces.db`。
下次在该目录启动 MCP 时自动激活对应 profile,无需重复指定。

- 精确匹配启动目录 —— 从子目录启动不会命中父目录的绑定
- 项目目录不产生任何状态文件
- 换 profile 时再次调用 `use_profile` 即覆盖绑定
- 删除某 profile(`delete_profile`)时,其工作区绑定一并清除
```

删除所有 `recordToProject` 的说明段落。`README.zh-CN.md` 同步。

- [ ] **Step 3: 改 .gitignore**

移除上一轮加入的这两行:

```
# 项目级 profile 激活文件 (MCP 启动时读取)
.db-profile
```

`.codegraph/` 和 `sql/` 两条保留。

- [ ] **Step 4: 改 CHANGELOG**

在 `## 未发布` 段落下新增条目:

```markdown
### 破坏性变更

- **`.db-profile` / `.profile` 不再被读取** —— 工作区→profile 的激活记录改存
  `~/.universal-db-mcp/workspaces.db`。现有绑定失效,需在各工作目录重新调用
  `use_profile` 一次。不提供自动迁移。
- **`use_profile` 去掉 `recordToProject` 参数** —— 每次调用都记录当前工作区,
  不再有"临时激活不绑定"的选项。

### 改动

- 新增 `WorkspaceStore`:SQLite 工作区绑定存储,`workspace_path` 归一化后作主键,
  UPSERT 写入。`~/.universal-db-mcp/workspaces.db` 不加密(表内无凭据)。
- `delete_profile` 同步清理指向该 profile 的工作区绑定,避免孤儿行。
- 启动自动激活、`use_profile` 同步、history/templates 路径解析三处均改查表。
```

- [ ] **Step 5: 改剩余 docs 引用**

对 Step 1 列出的非 superpowers 文档,把 `.db-profile` 的描述替换为 workspaces.db 机制。`docs/smoke-test-v5.0.0.md` 里的冒烟测试步骤若涉及该文件,更新为「在目标目录调用 use_profile」。

- [ ] **Step 6: 验证无残留**

```bash
grep -rn "db-profile\|recordToProject" README.md README.zh-CN.md docs/ \
  --exclude-dir=superpowers
```
Expected: 无输出

- [ ] **Step 7: 全量测试 + 提交**

```bash
npm test && npm run build
git add -A
git commit -m "docs: 更新工作区绑定文档,记录 breaking change"
```

---

## 验收标准

全部 task 完成后:

```bash
npm test          # 失败数应为 10(better-sqlite3 ABI 既有基线),不多不少
npm run build     # 退出码 0
grep -rn "db-profile\|recordToProject" src/ README.md README.zh-CN.md
# Expected: src/ 下无输出
```

手动验收(需用户重启 MCP):

1. 在任意目录 `use_profile({name: 'X'})` —— 该目录**不出现** `.db-profile`
2. 重启该目录的 MCP —— 自动激活 X
3. 同目录 `use_profile({name: 'Y'})` —— 重启后自动激活 Y
4. `delete_profile({name: 'Y', confirm: true})` —— 再重启,回落到"未激活"而非报错卡死
