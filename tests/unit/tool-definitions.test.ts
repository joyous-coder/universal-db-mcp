import { describe, it, expect } from 'vitest';
import { buildToolDefinitions } from '../../src/mcp/tool-definitions.js';

describe('buildToolDefinitions', () => {
  it('returns the basic subset when no deps provided (2 meta + 1 info-lazy + 2 always-on data-governance = 5)', () => {
    const t = buildToolDefinitions({
      queryAnalyzer: null,
      profileManager: null,
      profileStore: null,
      config: null,
    });
    expect(t.meta.length).toBe(2);
    expect(t.infoLazy.length).toBe(1);
    // data-governance always has get_pii_config + set_pii_config (no deps needed)
    expect(t.groups['data-governance']?.length).toBe(2);
    // other groups are empty when deps missing
    expect(t.groups['query-experience']?.length ?? 0).toBe(0);
    expect(t.groups.profiles?.length ?? 0).toBe(0);
    expect(t.groups['index-advisor']?.length ?? 0).toBe(0);
  });

  it('returns 25 lazy tool definitions when all deps provided (stateful tools kept in fallback switch)', () => {
    const t = buildToolDefinitions({
      queryAnalyzer: {} as any,
      profileManager: {} as any,
      profileStore: {} as any,
      config: null,
      planHistory: {} as any,
    });
    // query-experience 7 (minus execute_template) + profiles 10 (minus use_profile)
    // + data-governance 5 + index-advisor 3 = 25
    const groupCount = Object.values(t.groups).reduce((a, g) => a + (g?.length ?? 0), 0);
    expect(groupCount).toBe(25);
    expect(t.meta.length).toBe(2);
    expect(t.infoLazy.length).toBe(1);
  });

  it('every lazy tool description contains [group: <name>]', () => {
    const t = buildToolDefinitions({
      queryAnalyzer: {} as any,
      profileManager: {} as any,
      profileStore: {} as any,
      config: null,
      planHistory: {} as any,
    });
    for (const [groupName, tools] of Object.entries(t.groups)) {
      for (const tool of tools ?? []) {
        expect(tool.description).toContain(`[group: ${groupName}]`);
      }
    }
  });

  it('infoLazy tools (generate_sample_data) have fullInputSchema', () => {
    const t = buildToolDefinitions({
      queryAnalyzer: null,
      profileManager: null,
      profileStore: null,
      config: null,
    });
    for (const tool of t.infoLazy) {
      expect(tool.infoLazy).toBe(true);
      expect(tool.fullInputSchema).toBeDefined();
    }
  });
});