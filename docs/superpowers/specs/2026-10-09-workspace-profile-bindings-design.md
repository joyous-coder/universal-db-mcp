# 工作区 Profile 绑定: `.db-profile` → `workspaces.db`

**日期**: 2026-10-09
**作者**: brainstorm (Claude)
**状态**: 待评审
**影响范围**: 新增 `workspace-store`, 删除 `path-resolver`, `config-loader` 路径解析, `mcp-server` 启动流程, `profile-tools` (MCP tool 入参变更), 21 个测试文件中的相关用例

---

## 1. 背景与目标

### 现状

v5.0.0 引入了 `<cwd>/.db-profile` —— 项目根目录下的单行纯文本文件 `profile=<name>`,用于在 MCP 启动时自动激活该工作区对应的 profile。

三个接入点消费这个文件:

| 位置 | 作用 |
|---|---|
| `src/mcp/mcp-server.ts:184` | 启动时读 → 找到则 `loadProfile` + `activateProfile` |
| `src/utils/config-loader.ts:189` | 读 → 决定 history/templates 落到哪个 profile 子目录 |
| `src/mcp/tools/profile-tools.ts:115` | `use_profile` 时同步覆写 |

`src/utils/path-resolver.ts` 封装读写,含 v4.2.0 旧 `.profile` 的 fallback 读逻辑。

### 问题

在项目目录里生成状态文件有持续性成本:

- 每个绑定的工作区都被塞进一个隐藏文件,`git status` 噪音、编辑器文件树污染、团队成员间"这个文件要不要提交"的困惑
- 用户必须在项目根启动才能命中;从子目录启动静默失效
- 该文件无 `.gitignore` 兜底时会被误提交(`.db-profile` 语义上是机器本地的,提交上去对别人无意义甚至有害)

### 目标

把「工作区 → 激活 profile」的映射搬进 `~/.universal-db-mcp/workspaces.db` 的表里。项目目录不再产生任何 MCP 状态文件。

成功标准:
- 启动自动激活行为与现在等价(精确匹配 cwd)
- `use_profile` 切换时同步更新映射
- 项目目录零状态文件

### 非目标

- **不迁移** 现有 `.db-profile` / `.profile` 绑定。用户需在目标目录重新 `use_profile` 一次
- **不做** 父目录向上查找(保持精确匹配,见 §4.2)
- **不提供** 临时激活开关(见 §5.3)
- **不备份** `workspaces.db`(与现状等同,见 §7)

---

## 2. 存储布局

```
~/.universal-db-mcp/                     # DB_GLOBAL_DIR 可覆盖
├── profiles.db                          # 既有:全局 profile 注册表(可能开 SQLCipher)
├── workspaces.db                        # 新增:工作区 → profile 绑定
└── <profile-name>/
    ├── history.db
    ├── templates.db
    └── plans.db
```

**为什么不复用 `profiles.db`**(考虑过的替代方案):

`profiles.db` 可能配置了 `DB_PROFILE_ENCRYPTION_KEY` 开启 SQLCipher 加密。而工作区绑定的读取发生在**启动早期** —— `mcp-server` 的 activate 流程和 `config-loader` 的路径解析都在初始化阶段。复用意味着启动路径必须先解密整个 profile 库,才能读到一行零敏感信息(路径 + profile 名)。

拆成独立文件让启动路径保持轻量,也避免改动 `profiles.db` 已稳定的 schema 和加密路径。代价是多一个文件 —— 可接受,因为 `workspaces.db` 极小(每工作区一行)。

`workspaces.db` **不受** `DB_PROFILE_ENCRYPTION_KEY` 影响。里面只有本地路径和 profile 名,无凭据。

---

## 3. 数据模型

```sql
CREATE TABLE IF NOT EXISTS workspace_bindings (
  workspace_path TEXT PRIMARY KEY,   -- 归一化后的绝对路径
  profile_name   TEXT NOT NULL,      -- 绑定的 profile 名
  updated_at     TEXT NOT NULL       -- ISO 8601 时间戳
);
```

**设计说明**:

- `workspace_path` 作主键天然去重 —— `use_profile` 重复绑定同一工作区即 UPSERT
- 不建额外索引,主键足够(表规模是「工作区数」,通常 < 20)
- `updated_at` 便于排查「这个绑定是什么时候定的」,也留给将来的 TTL 清理
- 无外键约束到 `profiles.db`(跨库 SQLite 不支持),profile 删除时的孤儿行由应用层清理,见 §6.2

---

## 4. 核心模块

### 4.1 `src/core/workspace-store.ts` (新增)

参照 `src/core/profile-store.ts` 的形状(构造收 dbPath / `init()` 惰性建表),但显著更小 —— 无加密、无迁移、无 CRUD 广度。对标 `template-store.ts` 的规模(~6 KB)。

```ts
export class WorkspaceStore {
  constructor(dbPath: string)

  /** 读工作区绑定。返回 profile 名或 null(未绑定 / db 不可达) */
  get(cwd: string): Promise<string | null>

  /** UPSERT 绑定。profile 名非法时抛错 */
  set(cwd: string, profileName: string): Promise<void>

  /** 移除工作区绑定。不存在时静默 */
  remove(cwd: string): Promise<void>
}
```

**错误处理**:`get()` 在 db 不可达时返回 `null` 而非抛出 —— 启动期读不到绑定等于"未配置",不该阻断 MCP 启动。`set()` 失败则向上抛,由调用方(`use_profile` handler)捕获并记 stderr,不影响 profile 激活本身(激活已经成功了,记录失败只是"下次启动要手动指定")。

**路径归一化**(见下 §4.2)在 `get` / `set` / `remove` 三个入口统一应用。

### 4.2 路径归一化

存储和查询前统一转换,避免同一目录被当成多个工作区:

```ts
function normalizeWorkspacePath(p: string): string {
  return path.resolve(p).replace(/\\/g, '/').toLowerCase();
}
```

- `path.resolve` 消掉相对路径、`..`、尾部斜杠
- `\` → `/` 统一分隔符
- 转小写 —— Windows 路径大小写不敏感

**精确匹配,不做父目录向上查找。** 从 `D:\work\proj\backend` 启动不会命中 `D:\work\proj` 的绑定。这与 `.db-profile` 的现有行为完全等价(文件本就在 cwd 下),不算退步。

### 4.3 `src/utils/global-paths.ts` (修改)

新增:

```ts
/** workspaces.db — 工作区绑定表 */
export function getWorkspacesDbPath(): string {
  return path.join(getGlobalDir(), 'workspaces.db');
}
```

---

## 5. 接入点改造

### 5.1 启动自动激活 — `src/mcp/mcp-server.ts:184`

```ts
// 旧
const { readProjectProfile } = await import('../utils/path-resolver.js');
const projectProfile = readProjectProfile(process.cwd());
if (projectProfile) { ... projectProfile.profile ... }

// 新
const profileName = await workspaceStore.get(process.cwd());
if (profileName) { ... profileName ... }
```

未命中时的 stderr 提示改文案,不再提 `.db-profile`。

### 5.2 history/templates 路径解析 — `src/utils/config-loader.ts:189`

同样替换。该路径决定启用 profile 后 history/templates 落到哪个子目录 —— **行为不变**,仅查询方式从读文件变为查表。

注意此函数当前是同步的(`loadFromEnv` / `loadConfig`),而 `WorkspaceStore` 是异步的。

**处理方式**:把 `loadConfig` / `loadFromEnv` 改为 async,内部 `await workspaceStore.get(process.cwd())`。

已核实全部 4 个调用点均处于 async 上下文,改动安全:

| 调用点 | 上下文 |
|---|---|
| `src/index.ts:13` | `async function main()` 内 |
| `src/mcp/mcp-index.ts:134` | async 分支内,下一行已 `await` |
| `src/mcp/mcp-index.ts:151` | async 分支内,下一行已 `await` |
| `src/http/routes/mcp-sse.ts:76` | 已 `await` |

不选「同步 better-sqlite3 后门」方案 —— 保持 store 单一异步实现,避免两套打开逻辑。

**保留既有守卫**:该段逻辑位于 `config-loader.ts:194` 的 `if` 块内,仅当任一 QA 相关 env 存在时才执行 —— 与现状一致,不要顺手"修正"。

### 5.3 `use_profile` — `src/mcp/tools/profile-tools.ts:115`

```ts
// 旧签名
buildUseProfileHandler(pm) → (args: { name: string; recordToProject?: boolean })

// 新签名
buildUseProfileHandler(pm) → (args: { name: string })
```

处理流程(无分支):

1. `pm.loadProfile(args.name)` — 现有逻辑不动
2. 激活 profile — 现有逻辑不动
3. `workspaceStore.set(process.cwd(), args.name)` — **无条件执行**

返回的 `profileRecordHint` 统一为「已记录 `<cwd>` → profile=<name>,下次 MCP 启动自动激活」。stderr 一条对应提示。

**能力变更**:`recordToProject: false`(临时激活不绑定)**不再存在**。每次 `use_profile` 都记录当前工作区。用户若需清理,事后手动删除 `workspaces.db` 中对应行。

---

## 6. 删除项

### 6.1 整文件删除

- `src/utils/path-resolver.ts` — `readProjectProfile` / `writeProjectProfile` / 旧 `.profile` fallback 全部消失
- `tests/unit/path-resolver.test.ts`

### 6.2 连带清理

| 位置 | 处理 |
|---|---|
| `profile-manager.deleteProfile` | 删 profile 时一并清理 `workspaces.db` 中指向它的绑定行(避免孤儿) |
| `.gitignore` | 移除 `.db-profile` 条目(已无意义) |
| `README.md` / `README.zh-CN.md` | 改写 `.db-profile` 与 `recordToProject` 相关章节 |
| `docs/**` | 所有提及 `.db-profile` / `.profile` / `recordToProject` 的文档 |
| `CHANGELOG.md` | 新版本条目,记录 breaking change |

### 6.3 已知引用点

`grep -rl "db-profile\|\.profile\|recordToProject"` 命中 4 个源文件 + 21 个测试文件。逐个处理,不遗漏。

---

## 7. 风险与权衡

### Breaking change

- `use_profile` 的 `recordToProject` 入参消失
- `.db-profile` / `.profile` 不再被读取,现有绑定静默失效(下次启动变为"未激活")
- v5.0.0 刚完成 `.profile` → `.db-profile` 改名,本变更取代该机制

**缓解**:CHANGELOG 明确记录;`get_active_profile` 在未激活时的提示文案中说明新机制与重新绑定方法。

### 无备份

`workspaces.db` 删除即全部工作区绑定丢失。风险等级与现状等同(删单个 `.db-profile` 只影响一个工作区,删全局文件影响全部)。SQLite 单文件结构使误操作概率极低。

**孤儿清理覆盖面**:`profile-manager.ts:190` 的 `importProfiles` replace 模式复用 `deleteProfile` 完成删除,不是独立路径。因此清理只需挂在 `deleteProfile` 一处(它在 `:313` 已经调 `removeProfileDir`),无需额外入口。

### 并发

多个 MCP 进程(不同工作区)可能同时写 `workspaces.db`。SQLite 的 WAL 模式 + 主键 UPSERT 足以处理;`set()` 应使用 `INSERT ... ON CONFLICT(workspace_path) DO UPDATE` 而非 read-then-write。

---

## 8. 测试策略

### 8.1 新增 `tests/unit/workspace-store.test.ts`

- 基本 CRUD
- 路径归一化:`\` vs `/`、大小写差异、`..` 相对路径、尾部斜杠
- UPSERT 幂等:同工作区写两次,只有一行且 profile 正确
- db 文件不可达时 `get()` 返回 null 而非抛错
- 非法 profile 名 `set()` 抛错

沿用 `DB_GLOBAL_DIR` 隔离测试环境(现有测试已用此模式)。

### 8.2 改造 `tests/unit/use-profile-record.test.ts`

- 默认写入 `workspaces.db`(断言改为查表,而非读文件)
- 重复 `use_profile` 同一工作区 → UPSERT 生效
- `set()` 抛错时 profile 仍激活成功,stderr 有提示

### 8.3 改造 `config-loader` / `config-loader-global` 相关用例

「有 `.db-profile` → 走 profile 子目录」改为「有 workspace 绑定 → 走 profile 子目录」。

### 8.4 删除

`tests/unit/path-resolver.test.ts`

---

## 9. 实施顺序建议

1. `WorkspaceStore` + 单元测试(独立可验证)
2. `global-paths.ts` 加 `getWorkspacesDbPath`
3. 改造 `config-loader`(路径解析,验证 history/templates 落点不变)
4. 改造 `mcp-server` 启动流程
5. 改造 `use_profile` handler
6. 删 `path-resolver` + 连带清理(§6)
7. 文档 + CHANGELOG
8. `npm test` + `npm run build` 全绿
