import { describe, it, expect } from 'vitest';
import {
  extractToolNames,
  extractEnvVars,
  extractAdapterNames,
  extractEndpointNames,
  extractFeatureNames,
  findDocReferences,
} from '../../scripts/audit-docs.js';

describe('audit-docs extractors', () => {
  it('extractToolNames returns all tool names from src/mcp/tools/*.ts', async () => {
    const names = await extractToolNames('./src/mcp/tools');
    expect(names.length).toBeGreaterThan(20);
    expect(names).toContain('connect_database');
    expect(names).toContain('save_profile');
    expect(names).toContain('use_tool_group');
  });

  it('extractEnvVars returns all DB_* env vars from config-loader.ts', async () => {
    const vars = await extractEnvVars('./src/utils/config-loader.ts');
    expect(vars.length).toBeGreaterThan(10);
    expect(vars).toContain('DB_TYPE');
    expect(vars).toContain('DB_LAZY_LOAD_ENABLED');
  });

  it('extractAdapterNames returns 17 adapters from src/adapters/*.ts', async () => {
    const names = await extractAdapterNames('./src/adapters');
    expect(names).toContain('mysql');
    expect(names).toContain('postgres');
    expect(names).toContain('oracle');
    expect(names.length).toBe(17);
  });

  it('extractEndpointNames returns HTTP routes from src/http/routes/*.ts', async () => {
    const names = await extractEndpointNames('./src/http/routes');
    expect(names.length).toBeGreaterThan(5);
  });

  it('extractFeatureNames returns `### 新增` headers from CHANGELOG.md', async () => {
    const names = await extractFeatureNames('./CHANGELOG.md');
    expect(names.length).toBeGreaterThan(5);
    expect(names).toContain('Tool Lazy-Loading');
  });

  it('findDocReferences returns true if name appears in any doc', async () => {
    expect(await findDocReferences('save_profile', './docs')).toBe(true);
    // Use a unique bogus name not in any docs
    expect(await findDocReferences('findDocReferences-bogus-12345xyz', './docs')).toBe(false);
  });
});