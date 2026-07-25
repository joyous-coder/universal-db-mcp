# Fix: stdio MCP Server 进程优雅退出（已完成）

> 完成日期: 2026-03-17
> 关联 Issue: stdio MCP server does not exit cleanly when Codex CLI session closes

---

## 问题概述

当 `universal-db-mcp` 作为 stdio MCP server 被 Codex CLI 调用时，执行 `/exit` 后进程挂起，终端提示符不返回，必须手动 `Ctrl+C`。

## 根因

1. `src/mcp/mcp-index.ts` 只监听了 `SIGINT`/`SIGTERM`，未监听 `process.stdin` 的 `end`/`close` 事件
2. `src/mcp/mcp-server.ts` 的 `stop()` 方法未调用 `this.server.close()`，transport 层资源（stdin/stdout 监听器）未释放
3. 数据库连接池（keepAlive）保持活跃 handle，阻止 Node.js 事件循环退出

## 修改内容

### 文件 1: `src/mcp/mcp-server.ts`

**`stop()` 方法** — 新增 `this.server.close()` 调用：

```typescript
async stop(): Promise<void> {
  // 1. 关闭 MCP Server（释放 transport 层资源）
  try {
    await this.server.close();
  } catch (err) {
    console.error('关闭 MCP Server 时出错:', err instanceof Error ? err.message : String(err));
  }

  // 2. 清理 Schema 缓存
  if (this.databaseService) {
    this.databaseService.clearSchemaCache();
  }

  // 3. 断开数据库连接
  if (this.adapter) {
    await this.adapter.disconnect();
    console.error('👋 数据库连接已关闭');
  }
}
```

### 文件 2: `src/mcp/mcp-index.ts`

**shutdown 逻辑** — 统一 gracefulShutdown + stdin 监听 + 超时保护 + 重入防护：

```typescript
let shuttingDown = false;

async function gracefulShutdown(reason: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.error(`\n⏹️  正在关闭服务器 (${reason})...`);

  try {
    await Promise.race([
      server.stop(),
      new Promise<void>((resolve) => setTimeout(() => {
        console.error('⚠️  关闭超时，强制退出');
        resolve();
      }, 5000)),
    ]);
  } catch (err) {
    console.error('关闭过程中出错:', err instanceof Error ? err.message : String(err));
  } finally {
    process.exit(0);
  }
}

// 信号处理
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// stdin 关闭处理（核心修复）
process.stdin.resume();
process.stdin.on('end', () => gracefulShutdown('stdin-end'));
process.stdin.on('close', () => gracefulShutdown('stdin-close'));
```

## 影响范围

| 传输模式 | 影响 |
|----------|------|
| stdio | 直接修复：新增 stdin 监听 + 完善 stop() |
| SSE | 间接受益：cleanupSession() → stop() 现在正确调用 server.close() |
| Streamable HTTP | 间接受益：同上 |
| REST API | 无影响：有独立的 shutdown 逻辑 |

17 种数据库适配器零改动，问题在传输层和进程生命周期管理层，不在适配器层。

## 验证结果

- 编译通过：`npm run build` 无错误
- 单元测试：95 通过（1 个 CORS 测试为历史遗留问题，与本次修改无关）
- MCP 模式测试：2/2 通过
- 编译产物验证：`dist/mcp/mcp-index.js` 和 `dist/mcp/mcp-server.js` 中均包含预期的修改代码
