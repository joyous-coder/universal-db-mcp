import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../../src/mcp/tool-registry.js';

describe('session isolation e2e', () => {
  it('two simultaneous sessions activate different groups without crosstalk', () => {
    const reg = new ToolRegistry({
      tools: {
        core: [{ name: 'use_tool_group', description: 'd', inputSchema: {}, call: async () => ({}) }],
        groups: {
          profiles: [{ name: 'save_profile', description: 'd [group: profiles]', inputSchema: {}, call: async () => ({}) }],
          'data-governance': [{ name: 'audit_log', description: 'd [group: data-governance]', inputSchema: {}, call: async () => ({}) }],
        },
      },
      lazyLoadEnabled: true,
      defaultActiveGroups: [],
    });

    // Session 1: activate profiles
    reg.activateGroup('session-A', 'profiles');
    // Session 2: activate data-governance
    reg.activateGroup('session-B', 'data-governance');

    // Session A sees save_profile, not audit_log
    expect(reg.isToolActive('session-A', 'save_profile')).toBe(true);
    expect(reg.isToolActive('session-A', 'audit_log')).toBe(false);
    expect(reg.getActiveGroups('session-A')).toEqual(['profiles']);

    // Session B sees audit_log, not save_profile
    expect(reg.isToolActive('session-B', 'audit_log')).toBe(true);
    expect(reg.isToolActive('session-B', 'save_profile')).toBe(false);
    expect(reg.getActiveGroups('session-B')).toEqual(['data-governance']);

    // Neither session activates the other
    const aList = reg.listActiveTools('session-A').map(t => t.name);
    expect(aList).toContain('save_profile');
    expect(aList).not.toContain('audit_log');
    const bList = reg.listActiveTools('session-B').map(t => t.name);
    expect(bList).toContain('audit_log');
    expect(bList).not.toContain('save_profile');
  });

  it('same session can activate multiple groups incrementally', () => {
    const reg = new ToolRegistry({
      tools: {
        core: [],
        groups: {
          profiles: [{ name: 'save_profile', description: 'd [group: profiles]', inputSchema: {}, call: async () => ({}) }],
          'data-governance': [{ name: 'audit_log', description: 'd [group: data-governance]', inputSchema: {}, call: async () => ({}) }],
          'index-advisor': [{ name: 'explain_with_advice', description: 'd [group: index-advisor]', inputSchema: {}, call: async () => ({}) }],
        },
      },
      lazyLoadEnabled: true,
      defaultActiveGroups: [],
    });
    reg.activateGroup('s1', 'profiles');
    expect(reg.isToolActive('s1', 'save_profile')).toBe(true);
    reg.activateGroup('s1', 'data-governance');
    expect(reg.isToolActive('s1', 'audit_log')).toBe(true);
    reg.activateGroup('s1', 'index-advisor');
    expect(reg.isToolActive('s1', 'explain_with_advice')).toBe(true);
    expect(reg.getActiveGroups('s1').sort()).toEqual(['data-governance', 'index-advisor', 'profiles']);
  });
});