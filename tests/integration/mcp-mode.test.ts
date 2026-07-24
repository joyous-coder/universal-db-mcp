/**
 * MCP Mode Integration Tests
 */

import { describe, it, expect } from 'vitest';
import { DatabaseMCPServer } from '../../src/mcp/mcp-server';
import { SQLiteAdapter } from '../../src/adapters/sqlite/index.js';
import type { DbConfig } from '../../src/types/adapter';

describe('MCP Mode Integration Tests', () => {
  describe('DatabaseMCPServer', () => {
    it('should create MCP server instance', () => {
      const config: DbConfig = {
        type: 'sqlite',
        filePath: ':memory:',
        allowWrite: false
      };

      const server = new DatabaseMCPServer(config);
      expect(server).toBeDefined();
    });

    it('should start in no-connection mode when no adapter is set (v2.14 zero-config)', async () => {
      // v2.14 引入了"零配置启动 / 无连接模式"：start() 在没 adapter 时不再 throw，
      // 而是 resolve 并进入"等待 AI 调用 connect_database"状态。
      const config: DbConfig = {
        type: 'sqlite',
        filePath: ':memory:',
        allowWrite: false
      };

      const server = new DatabaseMCPServer(config);

      await expect(server.start()).resolves.toBeUndefined();
      // 释放 stdio 监听器，避免进程挂起
      await server.stop();
    });
  });

  describe('SQLite adapter identifier safety', () => {
    it('rejects malicious table name in getTableInfo', async () => {
      const adapter = new SQLiteAdapter({ filePath: ':memory:', readonly: false });
      await adapter.connect();
      await expect((adapter as unknown as { getTableInfo: (n: string) => Promise<unknown> }).getTableInfo('users; DROP TABLE x')).rejects.toThrow(/invalid identifier/i);
    });
  });
});
