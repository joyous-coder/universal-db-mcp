import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseMCPServer } from '../../src/mcp/mcp-server.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

describe('v4.0 G4: use_tool_group removed', () => {
  let server: DatabaseMCPServer;
  let client: Client;

  beforeAll(async () => {
    server = new DatabaseMCPServer(null);
    client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
    const [sT, cT] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(sT), client.connect(cT)]);
  });

  afterAll(async () => {
    await client.close();
  });

  it('use_tool_group is NOT in tools/list', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).not.toContain('use_tool_group');
  });

  it('calling use_tool_group returns isError response', async () => {
    // MCP SDK resolves with isError: true when server returns error content;
    // only protocol-level errors cause rejection.
    const result = await client.callTool({ name: 'use_tool_group', arguments: { name: 'query-experience' } });
    expect(result.isError).toBe(true);
  });
});