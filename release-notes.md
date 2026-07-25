# v3.2.3 — Patch: e2e-driven 4 bug fixes

> Released 2026-07-25
> patch release, no breaking changes, fully backwards-compatible with v3.2.1/v3.2.2

## 测试驱动开发成果

通过 Claude Code 本会话对 stdio MCP server 做端到端测试,捕获 4 个关键 bug 并全部修复:

## 修复

### Bug 1: `PERMISSION_PRESETS.full` 缺 `script` + `batch`

```typescript
// 旧(只包含 read/write/delete/ddl)
full: ['read', 'insert', 'update', 'delete', 'ddl']

// 新(包含 multi-statement + batch)
full: ['read', 'insert', 'update', 'delete', 'ddl', 'script', 'batch']
```

**影响**: `permissionMode:'full'` 下 `execute_script` / `execute_batch` / `generate_sample_data` 全部不可见
**修复**: 加 `script` + `batch` 到 full preset
**测试**: `tests/unit/script-permission.test.ts` 已更新断言

### Bug 2: `execute_query` 参数名 `query` 不一致

`execute_query` / `execute_script` 用 `query`,`execute_batch` 用 `sql`。AI 和用户自然传 `sql`,触发 `args.query.substring` undefined 异常。

**修复**: 三处 schema + handler 统一为 `sql`(commit `76f70c2`)

### Bug 3: MCP server 在 stdin close 时自杀(`153499d`)

`src/mcp/mcp-index.ts:73-74` 监听了 `stdin.on('end')` + `stdin.on('close')`,Claude Code 客户端间歇关闭 stdin 读端(server 误以为客户端走了),server 自杀,后续 tool call 返回 `No such tool available`。

**修复**: 移除 stdin end/close handler,只保留 SIGINT/SIGTERM

## 配套改进

- **Windows 测试 EBUSY 修复**: `tests/helpers/cleanup.ts` 共享 helper
- **`publish.yml` CI 加固**: npm test 步骤 + CHANGELOG 版本校验(v3.2.2 已加)
- **`.mcp.json` 注册**: 项目 scope MCP server,Claude Code 即可发现 tool
- **e2e 测试架构沉淀**: `tests/e2e/stdio/` + `docs/superpowers/specs/2026-07-25-*-design.md`(后续 release 落实)

## 验证

- `npm test`: **533/533 passed**(66 test files)
- `npm run build`: exit 0
- Manual smoke: sqlite +postgres L1 e2e via Claude Code native tool,4 tool 调用验证修复生效

## 升级

```bash
npm install -g @joyous-coder/universal-db-mcp@latest
# 或从 v3.2.2 升级无任何 migration 需求
```
