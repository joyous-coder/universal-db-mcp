# 全局持久化 + Profile 隔离 (v4.2.0)

**日期**: 2026-08-18
**作者**: brainstorm (Claude)
**状态**: 待评审
**影响范围**: `config-loader`, `mcp-server` 启动流程, `profile-store`, `history-store`, `template-store`, `plan-history`, MCP tool 表面 (新增 / 移除)

---

## 1. 背景与目标

现状问题:
1. 持久化默认 cwd-relative (`profiles.db` 等),换项目就丢 — 跨项目用同一 DB 需重复 `save_profile`
2. 启动时历史 / 模板 / plan 也是项目级,跨项目不复用
3. 凭据可以塞 `.mcp.json` env (`DB_HOST`/`DB_USER`/`DB_PASSWORD`) — 泄露风险,且和 Profile 系统并存,容易不一致
4. 权限 (`safe`/`readwrite`/`full`) 与连接耦合,不像"DB 用户的固有属性"

目标:
- **全局唯一** 持久化层,跨项目共享 profiles + history + templates + plans
- **profile-scoped 隔离**:history / templates / plans 按 profile 拆目录(避免不同 DB 的查询历史混淆)
- **项目级激活文件** `<cwd>/.profile` 自动加载,简化日常使用
- **移除直连路径**:删除 `connect_database` / `disconnect_database` (凭据直传) 与 `.mcp.json` 凭据 env,所有连接走 `save_profile` + `use_profile` + `disconnect_profile`
- **权限绑 profile**:profile 自带 `permissionMode`,运行时不可覆盖

---

## 2. 存储布局

```
~/.universal-db-mcp/                                # Windows: %USERPROFILE%\.universal-db-mcp
├── profiles.db                                     # 全局 profile 注册表
├── config.json                                     # 版本/迁移提示标志
├── bbz-cq-oracle/                                  # profile 名作为子目录 (名字约束见 §3.1)
│   ├── history.db
│   ├── templates.db
│   └── plans.db
└── other-profile/
    ├── history.db
    ├── templates.db
    └── plans.db
```

扁平化:`profiles.db` 在根(全局索引),其他 DB 在 `<profile-name>/` 下(按 profile 隔离)。

### 2.1 路径解析优先级

| 资源 | 优先级 |
|---|---|
| 1. 显式 env (`DB_PROFILES_DB_PATH` 等) | 高 — 高级用户完全控制 |
| 2. 全局默认 | 中 — `~/.universal-db-mcp/<...>` |
| 3. cwd 相对 (旧行为) | **已移除** — 不再 fallback |

新增 env: `DB_GLOBAL_DIR` (默认 `~/.universal-db-mcp`)。

---

## 3. Profile 模型

### 3.1 命名约束

Profile name 必须匹配 `/^[a-zA-Z0-9_-]+$/` — 严格限制避免路径问题(`bbz-cq-oracle` ✓, `bbz.cq` ✗, `中文 profile` ✗)。

`save_profile` 校验,不合规返回明确错误。

### 3.2 字段 (Profile 表)

```ts
interface Profile {
  id: string;                        // nanoid,内部唯一
  name: string;                      // 上面正则约束
  description: string;
  type: string;                      // ★ REQUIRED,adapter 路由 (oracle/mysql/postgres/redis/...)
  config: {                          // 连接参数
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
    serviceName?: string;           // Oracle 特有
    sid?: string;
    filePath?: string;              // SQLite 特有
    authSource?: string;            // MongoDB 特有
    oracleClientPath?: string;
  };
  category: 'rdbms' | 'kv' | 'document' | 'columnar' | 'search' | 'unknown';  // 辅助元,默认 unknown
  productName: string | null;       // e.g. "Oracle Database 19c",首次连接探测
  version: string | null;           // e.g. "19.0.0.0",首次连接探测
  permissionMode: 'safe' | 'readwrite' | 'full';  // ★ 移到 profile,默认 'readwrite'
  role: 'primary' | 'replica' | 'analytics';
  tags: string[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
  created_by: string;
  use_count: number;
}
```

`category`/`productName`/`version` 由对应 adapter 在首次 `use_profile` 时探测,失败时存 `unknown`/`null`/`null`。缓存于 profile,避免每次连接重复探测。

`type` 是路由唯一关键 (Oracle/Redis 走不同 adapter 读/写) — 严格 required。

### 3.3 删除 `connect_database` tool

从 MCP tool 列表移除。原因:
- 与 Profile 系统并存容易误用(直接传凭据却没存 profile)
- 凭据散落多处(`.mcp.json` env、Profile config)难管理

`save_profile` + `use_profile` 是唯一路径。

### 3.4 移除 `.mcp.json` 凭据 env

`.mcp.json` 的 `env` 不再读取:
- `DB_TYPE`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` / `DB_DATABASE`, `DB_SERVICE_NAME`, `DB_SID`, `DB_FILE_PATH`, `DB_AUTH_SOURCE`

保留的 env(都是路径/加密/行为开关,不是凭据):
- `DB_GLOBAL_DIR` — 全局目录覆盖
- `DB_PROFILES_DB_PATH` / `DB_HISTORY_DB_PATH` / `DB_TEMPLATES_DB_PATH` / `DB_PLAN_HISTORY_DB_PATH` — 各 DB 显式覆盖
- `DB_PROFILE_ENCRYPTION_KEY` / `DB_HISTORY_DB_KEY` / `DB_TEMPLATES_DB_KEY` — SQLCipher 加密
- `DB_PROFILES_MAX`, `DB_DEFAULT_PROFILE_ROLE`, `DB_READ_ROUTING` — 行为开关
- `DB_QUERY_ANALYZER_*`, `DB_METRICS_*` — 监控配置
- `MODE`, `LOG_LEVEL` — 运行模式
- `DB_LAZY_LOAD_ENABLED` — 行为开关

不识别的 env (如 `DB_HOST`) 静默忽略(不抛错),保留向后兼容旧的 `.mcp.json`,但功能失效。

---

## 4. 项目级激活: `.profile` 文件

### 4.1 格式

`<cwd>/.profile` — 单行,`profile=<name>`:
```
profile=bbz-cq-oracle
```

`.gitignore` 推荐加入 `.profile`(避免共享;但每个开发者有自己的 profile 名)。

### 4.2 生命周期

**创建**:
- `use_profile({name: 'X'})` 调用后,工具返回 hint:
  > "已在全局激活 profile `bbz-cq-oracle`。如需自动加载到此项目,带 `recordToProject: true` 再次调用。"
- `use_profile({name: 'X', recordToProject: true})` → 创建 / 更新 `<cwd>/.profile`
- 若 `.profile` 写入失败(权限/磁盘) → 仅 stderr 警告,不阻塞 `use_profile`

**读取**:
- MCP 启动时,读取 `<cwd>/.profile`;若 `profile=` 存在且对应全局 profile 存在 → 自动激活
- 启动 stdout/stderr 输出: `Auto-loaded profile 'bbz-cq-oracle' from .profile`

**未配置**:
- `.profile` 不存在 / `profile=` 缺失 / 全局无此 profile → stderr 提示:
  > `No profile activated. Use save_profile to create one, then use_profile to activate.`
  > `Tip: pass recordToProject: true to use_profile to bind this project to a profile.`
- **不阻塞** 任何工具调用 — 用户可手动 `use_profile`

**覆盖**:
- 已有 `.profile` → `use_profile({recordToProject: true, name: 'X'})` 直接覆盖
- 已有活跃 profile (active session) 切到不同 profile → 也覆盖 .profile

### 4.3 错误处理

`.profile` 格式错误(非 `key=value` 格式) → 忽略,stderr 警告,继续启动。
全局 profile 不存在 → 忽略 .profile,stderr 警告,继续启动。

---

## 5. API 改动

### 5.1 修改的 tool

**`save_profile`** — 必填 `permissionMode`,默认 `'readwrite'`。新增可选 `category` (默认自动派生)。
```ts
save_profile({
  name: 'bbz-cq-oracle',        // 严格正则
  type: 'oracle',               // REQUIRED (路由关键)
  config: { host, port, user, password, database, ... },
  permissionMode: 'readwrite',  // 新增 — 默认 'readwrite'
  category: 'rdbms',            // 可选,默认按 type 派生
  description: '...',
  tags: ['oracle', 'cq'],
  role: 'primary',
})
```

**`use_profile`** — 新增 `recordToProject: boolean` (默认 false)。
```ts
use_profile({ name: 'bbz-cq-oracle' })                     // 仅激活
use_profile({ name: 'bbz-cq-oracle', recordToProject: true })  // 激活 + 写 .profile
```

**`get_profile`** / **`list_profiles`** / **`disable_profile`** / **`enable_profile`** / **`delete_profile`** — 不变。

### 5.2 删除的 tool

**`connect_database`** — 完整移除,包括 schema、handler、dispatch case。
**`disconnect_database`** — 完整移除。统一用 `disconnect_profile`(功能相同,且与 profile 概念一致)。

### 5.3 新增内部行为

启动序列(`mcp-server.ts:initialize`):
1. 读 `DB_GLOBAL_DIR` (默认 `~/.universal-db-mcp`),`mkdir -p`
2. 加载 `profiles.db` (全局)
3. 检测 cwd 是否有 `.profile`,若有 → 找到对应 profile → `use_profile`
4. 加载各 profile-scoped DB (按当前 active profile)
5. 检测 cwd 是否有遗留的 `profiles.db` / `history.db` 等(迁移提示)
6. 启动完成

---

## 6. 加密

`DB_PROFILE_ENCRYPTION_KEY` 等 key env **同时**用于全局 DB。SQLCipher 在 `<profile-name>/history.db` 上的 key 与 `profiles.db` 一致 — 用户一个 key 保护全部。

(简化:不让用户为每个 DB 单独配 key。)

---

## 7. 迁移与向后兼容

### 7.1 现有 `.mcp.json` 凭据 env

静默忽略 — `.mcp.json` 旧配置不报错,但功能失效。首次启动 stderr 打一行:
```
⚠️ DB_HOST/DB_USER/DB_PASSWORD 等凭据 env 已废弃。请用 save_profile 管理。
```

### 7.2 现有 cwd-relative `profiles.db` 等

启动时检测 `cwd/profiles.db` / `cwd/history.db` / `cwd/templates.db` 等是否存在,若存在:
- 仅一次 stderr 提示(用 `~/.universal-db-mcp/config.json` 标记 `migration_hint_shown_at`)
- 不自动迁移
- `export_profiles` 已有,但 history/templates/plans 暂无导入工具(列出为后续 spec)

### 7.3 `connect_database` / `disconnect_database` tool 的移除

MCP tool 列表少两项。已使用这些 tool 的客户端会收到 "tool not found" 错误 — 用户需要迁移到 `save_profile` + `use_profile` + `disconnect_profile`。这是 breaking change,CHANGELOG 标注 **BREAKING**。

---

## 8. 测试

### 8.1 单元测试 (新)

- `config-loader`: 默认路径解析 = `~/.universal-db-mcp/...`;env 覆盖;cwd 相对 fallback 已删除
- `profile-store`: 名字正则校验;新建 profile 含 permissionMode 字段
- `path-resolver` (新): `.profile` 解析、格式错误处理
- adapter: `detectProductInfo()` 返回 `productName`/`version`(每个 adapter 一份 mock)

### 8.2 集成测试

- e2e:** 创建 `.profile`,启动 MCP,验证自动激活
- e2e:** save_profile → use_profile(recordToProject=true) → 检查 `.profile` 内容
- e2e:** cwd 有老 profiles.db → 启动 hint 一次,后续启动无 hint
- e2e:** Profile 自带 permissionMode,验证越权操作被阻止(无需传 permissionMode)

### 8.3 Windows EISDIR 复测

启动时 `.profile` 读取可能涉及 realpathSync — 沿用 v4.0.9 path-guard 修复。

---

## 9. 风险与回退

| 风险 | 缓解 |
|---|---|
| 用户工作流断裂(无 `connect_database`) | CHANGELOG 明确标注,README 强调 save_profile 流;CI 检查 |
| 全局 DB 文件膨胀(history 无限增长) | 保留现有 `DB_HISTORY_MAX_ROWS` / `DB_HISTORY_TTL_DAYS` |
| 密码泄露(全局明文 profiles.db) | 鼓励 `DB_PROFILE_ENCRYPTION_KEY` |
| `.profile` 误提交到 git | README 提示;`.gitignore` 模板建议 |

回退:每个改动点逐步提交,可独立 revert。配置文件 `.mcp.json` 旧的凭据 env 静默忽略(不报错),所以升级无破坏点。

---

## 10. 不在本次范围 (后续 spec)

- `history.db` / `templates.db` / `plan-history.db` 的导入导出工具(目前只有 `export_profiles` / `import_profiles`)
- Profile-scoped 资源限额(目前每个 profile 自己用,没限额)
- 多用户共享 `~/.universal-db-mcp/` 场景(目前假定单用户机器)
- Profile 改名(rename)工具

---

## 11. 实施拆分 (建议 PR 顺序)

1. **PR1**: Profile 模型 + 名字正则 + permissionMode 字段迁移 (DB schema 变更)
2. **PR2**: 全局路径解析 + `.universal-db-mcp/` 默认
3. **PR3**: 项目 `.profile` 自动激活 + use_profile recordToProject
4. **PR4**: 删除 `connect_database` / `disconnect_database` tool + 移除凭据 env (BREAKING)
5. **PR5**: 迁移提示 + 文档更新