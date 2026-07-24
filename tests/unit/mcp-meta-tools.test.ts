import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../../src/mcp/tool-registry.js';

describe('ToolRegistry meta-tool support', () => {
  it('getFullSchema returns full schema for info-lazy tool', () => {
    const reg = new ToolRegistry({
      tools: {
        core: [
          {
            name: 'generate_sample_data',
            description: 'd',
            inputSchema: { type: 'object', properties: { tableName: { type: 'string' } } },
            infoLazy: true,
            fullInputSchema: { type: 'object', properties: { options: { type: 'object' } } },
            call: async () => ({ ok: true }),
          },
        ],
        groups: {},
      },
      lazyLoadEnabled: true,
      defaultActiveGroups: [],
    });
    const schema = reg.getFullSchema('generate_sample_data');
    expect(schema).toBeDefined();
    expect((schema as any).properties.options).toBeDefined();
  });

  it('getFullSchema returns null for non-info-lazy tool', () => {
    const reg = new ToolRegistry({
      tools: {
        core: [{ name: 'use_tool_group', description: 'd', inputSchema: {}, call: async () => ({}) }],
        groups: {},
      },
      lazyLoadEnabled: true,
      defaultActiveGroups: [],
    });
    expect(reg.getFullSchema('use_tool_group')).toBeNull();
  });

  it('activateGroup returns newlyAvailable with name + description', () => {
    const reg = new ToolRegistry({
      tools: {
        core: [{ name: 'connect_database', description: 'd', inputSchema: {}, call: async () => ({}) }],
        groups: {
          profiles: [
            { name: 'save_profile', description: 'save one [group: profiles]', inputSchema: {}, call: async () => ({}) },
            { name: 'list_profiles', description: 'list all [group: profiles]', inputSchema: {}, call: async () => ({}) },
          ],
        },
      },
      lazyLoadEnabled: true,
      defaultActiveGroups: [],
    });
    const r = reg.activateGroup('s1', 'profiles');
    expect(r.newlyAvailable.length).toBe(2);
    expect(r.newlyAvailable[0].name).toBe('save_profile');
    expect(r.activeGroups).toEqual(['profiles']);
  });

  it('activateGroup on already-active returns empty newlyAvailable', () => {
    const reg = new ToolRegistry({
      tools: {
        core: [],
        groups: { profiles: [{ name: 'save_profile', description: 'd', inputSchema: {}, call: async () => ({}) }] },
      },
      lazyLoadEnabled: true,
      defaultActiveGroups: [],
    });
    reg.activateGroup('s1', 'profiles');
    const r2 = reg.activateGroup('s1', 'profiles');
    expect(r2.alreadyActive).toBe(true);
    expect(r2.newlyAvailable.length).toBe(0);
  });

  it('getActiveGroups returns the set for a session', () => {
    const reg = new ToolRegistry({
      tools: {
        core: [],
        groups: {
          profiles: [{ name: 'p', description: 'd', inputSchema: {}, call: async () => ({}) }],
          'data-governance': [{ name: 'g', description: 'd', inputSchema: {}, call: async () => ({}) }],
        },
      },
      lazyLoadEnabled: true,
      defaultActiveGroups: [],
    });
    reg.activateGroup('s1', 'profiles');
    reg.activateGroup('s1', 'data-governance');
    expect(reg.getActiveGroups('s1').sort()).toEqual(['data-governance', 'profiles']);
  });

  it('validateArgs returns ok when required fields present', () => {
    const reg = new ToolRegistry({
      tools: {
        core: [{ name: 't', description: 'd', inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } }, call: async () => ({}) }],
        groups: {},
      },
      lazyLoadEnabled: true,
      defaultActiveGroups: [],
    });
    expect(reg.validateArgs('t', { name: 'x' })).toEqual({ ok: true });
  });

  it('validateArgs returns error + hint for info-lazy missing required', () => {
    const reg = new ToolRegistry({
      tools: {
        core: [
          {
            name: 'generate_sample_data',
            description: 'd',
            inputSchema: { type: 'object', required: ['tableName'], properties: { tableName: { type: 'string' } } },
            infoLazy: true,
            fullInputSchema: { type: 'object', required: ['tableName'], properties: { tableName: { type: 'string' } } },
            call: async () => ({ ok: true }),
          },
        ],
        groups: {},
      },
      lazyLoadEnabled: true,
      defaultActiveGroups: [],
    });
    const r = reg.validateArgs('generate_sample_data', {});
    expect(r.ok).toBe(false);
    expect(r.error).toContain('missing required: tableName');
    expect(r.hint).toContain('use_tool_schema');
  });
});