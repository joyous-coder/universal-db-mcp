/**
 * MCP Mode Integration Tests
 */

import { describe, it, expect } from 'vitest';
import { DatabaseMCPServer } from '../../src/mcp/mcp-server';
import { SQLiteAdapter } from '../../src/adapters/sqlite.js';
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

    it('should require adapter before starting', async () => {
      const config: DbConfig = {
        type: 'sqlite',
        filePath: ':memory:',
        allowWrite: false
      };

      const server = new DatabaseMCPServer(config);

      await expect(server.start()).rejects.toThrow('必须先设置数据库适配器');
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
