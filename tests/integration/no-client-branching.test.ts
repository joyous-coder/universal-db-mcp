import { describe, it, expect } from 'vitest';
import { DatabaseMCPServer } from '../../src/mcp/mcp-server.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

describe('v4.0 G3, G6: no client-conditional behavior', () => {
  it('Claude Code client gets full tool list', async () => {
    const server = new DatabaseMCPServer(null);
    const client = new Client(
      { name: 'claude-code-2.1.227', version: '2.1.227' },
      { capabilities: {} }
    );
    const [sT, cT] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(sT), client.connect(cT)]);

    try {
      const { tools } = await client.listTools();
      // Claude Code 应该和其他 client 一样看到所有 tool
      expect(tools.length).toBeGreaterThanOrEqual(41);
    } finally {
      await client.close();
    }
  });

  it('no console.warn for Claude Code client', async () => {
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: any[]) => warnings.push(args.join(' '));

    const server = new DatabaseMCPServer(null);
    const client = new Client({ name: 'claude-code-2.1.227', version: '2.1.227' }, { capabilities: {} });
    const [sT, cT] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(sT), client.connect(cT)]);

    try {
      await client.listTools();
      const ccWarnings = warnings.filter((w) => w.includes('Claude Code'));
      expect(ccWarnings).toEqual([]);
    } finally {
      console.warn = origWarn;
      await client.close();
    }
  });
});