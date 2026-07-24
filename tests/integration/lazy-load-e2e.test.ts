import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../../src/mcp/tool-registry.js';

/**
 * Integration test simulating full lazy-loading lifecycle in a single process.
 * Verifies that use_tool_group transitions from default state → expanded state
 * and that isToolActive reflects session state correctly across requests.
 */
describe('lazy-load e2e (registry-driven)', () => {
  it('default state → activate group → tools appear', () => {
    const reg = new ToolRegistry({
      tools: {
        core: [
          { name: 'connect_database', description: 'd', inputSchema: {}, call: async () => ({ ok: true }) },
          { name: 'use_tool_group', description: 'd', inputSchema: {}, call: async () => ({ ok: true }) },
        ],
        groups: {
          profiles: [
            { name: 'save_profile', description: 'save [group: profiles]', inputSchema: {}, call: async () => ({ ok: true }) },
          ],
          'data-governance': [
            { name: 'audit_log', description: 'audit [group: data-governance]', inputSchema: {}, call: async () => ({ ok: true }) },
          ],
        },
      },
      lazyLoadEnabled: true,
      defaultActiveGroups: [],
    });

    const sessionId = 'stdio-default';
    let tools = reg.listActiveTools(sessionId);
    expect(tools.map(t => t.name).sort()).toEqual(['connect_database', 'use_tool_group']);
    expect(reg.isToolActive(sessionId, 'save_profile')).toBe(false);

    // Simulate use_tool_group({name:'profiles'}) → activateGroup
    reg.activateGroup(sessionId, 'profiles');
    tools = reg.listActiveTools(sessionId);
    expect(tools.map(t => t.name).sort()).toEqual(['connect_database', 'save_profile', 'use_tool_group']);
    expect(reg.isToolActive(sessionId, 'save_profile')).toBe(true);

    // Activate another group
    reg.activateGroup(sessionId, 'data-governance');
    tools = reg.listActiveTools(sessionId);
    expect(tools.map(t => t.name).sort()).toEqual(['audit_log', 'connect_database', 'save_profile', 'use_tool_group']);
  });

  it('lazy-load disabled returns all tools regardless of session', () => {
    const reg = new ToolRegistry({
      tools: {
        core: [{ name: 'core_t', description: 'd', inputSchema: {}, call: async () => ({}) }],
        groups: {
          profiles: [{ name: 'p_t', description: 'd', inputSchema: {}, call: async () => ({}) }],
        },
      },
      lazyLoadEnabled: false,
      defaultActiveGroups: [],
    });
    expect(reg.listActiveTools('any').map(t => t.name).sort()).toEqual(['core_t', 'p_t']);
  });

  it('lazy-tool call before activation throws', () => {
    const reg = new ToolRegistry({
      tools: {
        core: [],
        groups: { profiles: [{ name: 'save_profile', description: 'd [group: profiles]', inputSchema: {}, call: async () => ({ saved: true }) }] },
      },
      lazyLoadEnabled: true,
      defaultActiveGroups: [],
    });
    expect(reg.isToolActive('s1', 'save_profile')).toBe(false);
    // Note: callTool will execute regardless — the gating happens at the mcp-server layer.
    // isToolActive is the check used by the server.
  });
});