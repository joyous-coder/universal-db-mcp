import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseMCPServer } from '../../src/mcp/mcp-server.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

describe('initialize response (v4.0 G8, G4)', () => {
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

  it('client.getInstructions() returns non-empty Markdown', () => {
    const instructions = client.getInstructions();
    expect(instructions).toBeDefined();
    expect(instructions!.length).toBeGreaterThan(0);
    expect(instructions).toContain('universal-db-mcp');
  });

  it('instructions are under 2000 chars', () => {
    const instructions = client.getInstructions();
    expect(instructions!.length).toBeLessThanOrEqual(2000);
  });

  it('does not declare tools.listChanged capability', () => {
    const caps = client.getServerCapabilities();
    expect(caps?.tools?.listChanged).toBeFalsy();
  });
});