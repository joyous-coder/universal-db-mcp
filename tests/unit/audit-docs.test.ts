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
    // v4.2.0: connect_database / disconnect_database 已删除
    expect(names).not.toContain('connect_database');
    expect(names).not.toContain('disconnect_database');
    // v5.0.0: save_profile → create_profile(语义化为 INSERT-only)
    expect(names).toContain('create_profile');
    expect(names).toContain('use_profile');
    // v4.0: use_tool_group / use_tool_schema removed
    expect(names).not.toContain('use_tool_group');
    expect(names).not.toContain('use_tool_schema');
  });

  it('extractEnvVars returns all DB_* env vars from config-loader.ts', async () => {
    const vars = await extractEnvVars('./src/utils/config-loader.ts');
    expect(vars.length).toBeGreaterThan(10);
    // v4.2.0: 凭据类 env (DB_TYPE/DB_HOST/...) 已废弃,代码里只剩 array 列名
    // 和 comment — 不再有 process.env.DB_TYPE 等引用,所以这里不期待
    expect(vars).not.toContain('DB_TYPE');
    expect(vars).not.toContain('DB_HOST');
    // v4.0: DB_LAZY_LOAD_ENABLED removed (silently ignored)
    expect(vars).not.toContain('DB_LAZY_LOAD_ENABLED');
    expect(vars).not.toContain('DB_LAZY_DEFAULT_GROUP');
    expect(vars).not.toContain('DB_VISIBLE_GROUPS');
    expect(vars).not.toContain('DB_VISIBLE_TOOLS');
    // 仍然期望真实在用的 env (DB_GLOBAL_DIR 在 global-paths.ts,不在 config-loader.ts)
    expect(vars).toContain('DB_PROFILES_DB_PATH');
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
    // v4.0 CHANGELOG entry added in Phase 4 Task 19
    // (Skipping specific content check here; CHANGELOG will be updated then)
  });

  it('findDocReferences returns true if name appears in any doc', async () => {
    expect(await findDocReferences('create_profile', './docs')).toBe(true);
    // Use a unique bogus name not in any docs
    expect(await findDocReferences('findDocReferences-bogus-12345xyz', './docs')).toBe(false);
  });
});