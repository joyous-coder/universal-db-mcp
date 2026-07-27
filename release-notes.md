# v3.3.4 — 修复 DB_LAZY_DEFAULT_GROUP 隐式激活全部 group 的语义耦合

## 问题

v3.2.4 引入 Bug #8 修复时，为了绕开 Claude Code `listChanged` 通知不消费的回归，在 `config-loader.ts` 加了"未设 = 激活全部 4 个 group"的隐式行为。该 workaround 与 `DB_LAZY_LOAD_ENABLED` 语义耦合，两个本应正交的 env var 互相影响：

- `DB_LAZY_LOAD_ENABLED=true` + `DB_LAZY_DEFAULT_GROUP` unset → 自动激活全部 4 个 group（非 Claude Code 客户端实际看到 43 tool，懒加载失效）
- `DB_LAZY_DEFAULT_GROUP` 是否设置意外决定了"懒加载是真懒还是假懒"

## 修复

`src/utils/config-loader.ts:218-237` 删除三表达式 workaround，env var 解析简化为 `[...defaultGroups]`：

```diff
- const activeGroups: Array<typeof allGroups[number]> = defaultGroups.length === 0
-   ? (lazyDefaultGroups === undefined ? [...allGroups] : [])
-   : [...defaultGroups];
+ config.lazyLoad = {
+   enabled: ...,
+   defaultActiveGroups: [...defaultGroups],
+ };
```

两个 env var 现在完全独立。Claude Code 已通过 `shouldSkipLazyLoading()` 自动 bypass，不需要这个 workaround。

## 对用户影响

| 配置 | v3.3.3 行为 | v3.3.4 行为 |
|---|---|---|
| 未设 `DB_LAZY_LOAD_ENABLED` | 全 43 tool (v3.1 fallback) | 全 43 tool (v3.1 fallback) — **不变** |
| `DB_LAZY_LOAD_ENABLED=true` + `DB_LAZY_DEFAULT_GROUP` 未设 | **43 tool** (隐式全激活) | **14 tool** (2 meta + 12 stateful)，其余需 `use_tool_group` |
| `DB_LAZY_LOAD_ENABLED=true` + `DB_LAZY_DEFAULT_GROUP=query-experience` | 23 tool | 23 tool — **不变** |

## 兼容性

Patch release。`DB_LAZY_LOAD_ENABLED` 默认仍是 `false`（opt-in，与 v3.1 行为一致），所以**默认配置下完全无破坏性**。

仅在显式启用懒加载 + 未设 `DB_LAZY_DEFAULT_GROUP` 时，体感从"假懒加载（全可见）"变成"真懒加载（需 `use_tool_group`）"。这是**正确的语义**，也符合用户预期。

## 验证

- `npm run test:unit`: **56 test files / 554 tests PASS**（新增 2 个 case）
- `npm run build`: tsc 退出码 0

## 升级方式

```bash
npm update -g @joyous-coder/universal-db-mcp
# 或
npx -y @joyous-coder/universal-db-mcp@3.3.4 --type mysql --host ...
```

无破坏性变更，无需修改 `.mcp.json`。