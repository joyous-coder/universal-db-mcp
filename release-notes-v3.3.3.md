# v3.3.3 — 修复 v3.3.2 InitializeRequest handler bug

## 问题

v3.3.2 引入了 Claude Code 客户端智能 lazy loading 默认,但实现用了 `setRequestHandler(InitializeRequestSchema, ...)` 覆盖 SDK 默认 handler,且返回 `{} as any`,**破坏了 SDK 默认的 InitializeResult 响应**。客户端无法正常初始化。

## 修复

- 改为显式委托到 SDK 内部 `_oninitialize`:`setRequestHandler(InitializeRequestSchema, async (req) => { ... capture clientInfo; return await (this.server as any)._oninitialize(req); })`
- 删除了之前 `oninitialized` 回调(`/getClientVersion` 总是返回 undefined,因为时序问题)

## 验证

`tmp/mcp-smoke.cjs` (新增) — 完整 stdio roundtrip:initialize → initialized → tools/list

```
[stderr] [mcp-server] detected Claude Code client (name="claude-code" version="2.1.215"). ...
[stdout] {"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{"listChanged":true}},"serverInfo":{"name":"universal-db-mcp","version":"1.0.0"}},"jsonrpc":"2.0","id":1}
[stdout] {"result":{"tools":[... 42 tool ...]},"jsonrpc":"2.0","id":2}
```

`initialize` 响应正确 + `tools/list` 返回全部 42 tool + Claude Code 检测日志出现。

## 用户影响

- **Claude Code 用户**:从 v3.3.2 升级到 v3.3.3 即可,重启 Claude Code 让MCP 重新初始化
- **其他客户端**:不受影响

## 兼容性

Patch release,只修 bug,行为不变(继续智能检测 Claude Code)。

`npm run test:unit`: **56 test files / 552 tests PASS**