import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../../src/mcp/tool-registry.js';

describe('info-lazy e2e', () => {
  it('use_tool_schema returns full schema with examples', () => {
    const reg = new ToolRegistry({
      tools: {
        core: [
          {
            name: 'generate_sample_data',
            description: 'gen sample data',
            inputSchema: { type: 'object', properties: { tableName: { type: 'string' }, rowCount: { type: 'number', default: 10 } }, required: ['tableName'] },
            infoLazy: true,
            fullInputSchema: {
              type: 'object',
              properties: {
                tableName: { type: 'string' },
                rowCount: { type: 'number', default: 10 },
                options: {
                  type: 'object',
                  properties: {
                    rules: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          match: { type: 'object', properties: { columnName: { type: 'string' } } },
                          generate: {
                            type: 'object',
                            properties: { type: { type: 'string', enum: ['fixed', 'range', 'pattern', 'faker', 'choice', 'enum', 'sequence', 'regex', 'null', 'skip'] } },
                            required: ['type'],
                          },
                        },
                      },
                      examples: [
                        { match: { columnName: 'tenant_id' }, generate: { type: 'fixed', value: 'BBZ_PROVINCE_EG' } },
                        { match: { columnName: 'amount' }, generate: { type: 'range', min: 100, max: 10000 } },
                      ],
                    },
                  },
                },
              },
              required: ['tableName'],
            },
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
    const s = schema as any;
    expect(s.properties.options.properties.rules).toBeDefined();
    expect(s.properties.options.properties.rules.examples).toBeDefined();
    expect(s.properties.options.properties.rules.examples.length).toBeGreaterThan(0);
  });

  it('validateArgs with missing tableName returns error + hint pointing to use_tool_schema', () => {
    const reg = new ToolRegistry({
      tools: {
        core: [
          {
            name: 'generate_sample_data',
            description: 'd',
            inputSchema: { type: 'object', properties: { tableName: { type: 'string' } }, required: ['tableName'] },
            infoLazy: true,
            fullInputSchema: { type: 'object', properties: { tableName: { type: 'string' } }, required: ['tableName'] },
            call: async () => ({ ok: true }),
          },
        ],
        groups: {},
      },
      lazyLoadEnabled: true,
      defaultActiveGroups: [],
    });
    const v = reg.validateArgs('generate_sample_data', {});
    expect(v.ok).toBe(false);
    expect(v.hint).toContain('use_tool_schema');
  });
});