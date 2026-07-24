import { describe, it, expect } from 'vitest';
import { ToolRegistry, type ToolDefinition, type ToolGroup } from '../../src/mcp/tool-registry.js';

function fakeTool(name: string, group: ToolGroup | null = null): ToolDefinition {
  return {
    name,
    description: `desc-${name}`,
    inputSchema: { type: 'object', properties: {} },
    group: group as any,
    call: async () => ({ ok: true }),
  };
}

describe('ToolRegistry', () => {
  it('listActiveTools returns core only when no group activated', () => {
    const reg = new ToolRegistry({
      tools: {
        core: [fakeTool('connect_database'), fakeTool('disconnect_database')],
        groups: {
          'query-experience': [fakeTool('explain_query', 'query-experience')],
          profiles: [fakeTool('save_profile', 'profiles')],
          'data-governance': [fakeTool('audit_log', 'data-governance')],
          'index-advisor': [fakeTool('explain_query_with_advice', 'index-advisor')],
        },
      },
      lazyLoadEnabled: true,
      defaultActiveGroups: [],
    });
    const list = reg.listActiveTools('s1');
    expect(list.map(t => t.name)).toEqual(['connect_database', 'disconnect_database']);
  });

  it('activateGroup adds tools from that group to subsequent listActiveTools', () => {
    const reg = new ToolRegistry({
      tools: {
        core: [fakeTool('connect_database')],
        groups: { 'data-governance': [fakeTool('audit_log', 'data-governance')] },
      },
      lazyLoadEnabled: true,
      defaultActiveGroups: [],
    });
    reg.activateGroup('s1', 'data-governance');
    const list = reg.listActiveTools('s1');
    expect(list.map(t => t.name).sort()).toEqual(['audit_log', 'connect_database']);
  });

  it('activateGroup is idempotent (alreadyActive=true on second call)', () => {
    const reg = new ToolRegistry({
      tools: {
        core: [fakeTool('connect_database')],
        groups: { profiles: [fakeTool('save_profile', 'profiles')] },
      },
      lazyLoadEnabled: true,
      defaultActiveGroups: [],
    });
    const r1 = reg.activateGroup('s1', 'profiles');
    const r2 = reg.activateGroup('s1', 'profiles');
    expect(r1.alreadyActive).toBe(false);
    expect(r2.alreadyActive).toBe(true);
  });

  it('different sessions have independent state', () => {
    const reg = new ToolRegistry({
      tools: {
        core: [fakeTool('connect_database')],
        groups: { profiles: [fakeTool('save_profile', 'profiles')] },
      },
      lazyLoadEnabled: true,
      defaultActiveGroups: [],
    });
    reg.activateGroup('s1', 'profiles');
    expect(reg.isToolActive('s1', 'save_profile')).toBe(true);
    expect(reg.isToolActive('s2', 'save_profile')).toBe(false);
  });

  it('defaultActiveGroups pre-activates groups at construction', () => {
    const reg = new ToolRegistry({
      tools: {
        core: [fakeTool('connect_database')],
        groups: { profiles: [fakeTool('save_profile', 'profiles')] },
      },
      lazyLoadEnabled: true,
      defaultActiveGroups: ['profiles'],
    });
    expect(reg.isToolActive('s1', 'save_profile')).toBe(true);
  });

  it('lazyLoadEnabled=false returns all tools', () => {
    const reg = new ToolRegistry({
      tools: {
        core: [fakeTool('connect_database')],
        groups: { profiles: [fakeTool('save_profile', 'profiles')] },
      },
      lazyLoadEnabled: false,
      defaultActiveGroups: [],
    });
    const list = reg.listActiveTools('s1');
    expect(list.map(t => t.name).sort()).toEqual(['connect_database', 'save_profile']);
  });

  it('isToolActive returns true for core tools regardless of session', () => {
    const reg = new ToolRegistry({
      tools: {
        core: [fakeTool('connect_database')],
        groups: { profiles: [fakeTool('save_profile', 'profiles')] },
      },
      lazyLoadEnabled: true,
      defaultActiveGroups: [],
    });
    expect(reg.isToolActive('any-session', 'connect_database')).toBe(true);
  });
});