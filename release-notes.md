## v5.0.2 摘要

2 个 v5.0.1 MongoDB 冒烟测试 bug 全部修复,源自 MongoDB shell-format + JSON template 测试。

## 改动

### Bug 修复(MongoDB)

| ID  | 工具/模块                          | 严重度 | 描述 |
| --- | ---------------------------------- | ------ | ---- |
| N17 | `MongoDBAdapter.parseQuery`        | P1     | `db.coll.insertMany([{...},{...}])` shell-format 解析正确(用整个数组,不再 fallback 到 `parsed[0]`) |
| N18 | `substituteParams` + `TemplateParam` | P1    | 新增 `type: 'json'` 占位符,`JSON.stringify(v)` 替换,MongoDB JSON template 占位符保留 JSON 结构 |

### 测试新增

- `tests/unit/mongodb-adapter.test.ts` — 7 个 case(insertMany / insert / find / findOne / updateOne / deleteOne shell-format + JSON-format)
- `tests/unit/sql-template.test.ts` — 2 个 case(`json` 类型 + string 值 + object 值)

## 测试

- 单元测试:**81 文件 / 663 测试 全 PASS**
- 集成测试(MongoDB via WSL2 docker):**42 tool 全 PASS**(SQLite 全部,MongoDB 全部 ✅ 或 ⚠️;**N17+N18 手动 MCP 验证通过**)

详细 bug 清单见 `docs/smoke-test-v5.0.0-sqlite-mongodb.md` §A。