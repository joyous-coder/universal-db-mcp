import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseMCPServer } from '../../src/mcp/mcp-server.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

describe('v4.0 G2: generate_sample_data has full schema in tools/list', () => {
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

  it('generate_sample_data is in tools/list', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('generate_sample_data');
  });

  it('inputSchema contains full options.rules array (no infoLazy split)', async () => {
    const { tools } = await client.listTools();
    const genTool = tools.find((t) => t.name === 'generate_sample_data');
    expect(genTool).toBeDefined();
    // 完整 schema 必须包含 options.rules(原本 lazy 加载才有)
    const props = (genTool!.inputSchema as any).properties;
    expect(props).toHaveProperty('options');
    expect(props.options.properties).toHaveProperty('rules');
    expect(props.options.properties.rules.type).toBe('array');
  });
});