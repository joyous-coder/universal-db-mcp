/**
 * MCP data-governance tools (v3.x)
 *
 * 5 tools (v3.0 design):
 *  - compare_profile_schemas: SchemaDiff between two profiles
 *  - export_backup: BackupWriter.dump (SQL dump + schema-only)
 *  - audit_log: AuditLog.query (actor / severity / profile)
 *  - get_pii_config: read pii.config.json
 *  - set_pii_config: runtime PII rule update
 *
 * v3.2: handlers wired into ToolRegistry under 'data-governance' lazy group.
 */

import type { QueryAnalyzer } from '../../core/query-analyzer.js';
import type { ProfileManager } from '../../core/profile-manager.js';
import { SchemaDiff } from '../../core/schema-diff.js';

export function buildCompareProfileSchemasHandler(pm: ProfileManager) {
  return async (args: { nameA: string; nameB: string }) => {
    return SchemaDiff.compareProfiles(pm, args.nameA, args.nameB);
  };
}

export function buildExportBackupHandler(pm: ProfileManager) {
  return async (args: {
    profileName: string;
    schemaOnly?: boolean;
    tables?: string[];
    outputPath?: string;
  }) => {
    const { BackupWriter } = await import('../../core/backup-writer.js');
    return BackupWriter.dump(pm, args.profileName, {
      schemaOnly: args.schemaOnly,
      tables: args.tables,
    });
  };
}

export function buildAuditLogHandler(qa: QueryAnalyzer) {
  return async (args: {
    actor?: string;
    severity?: 'read' | 'write' | 'ddl';
    profileName?: string | null;
    since?: string;
    until?: string;
    limit?: number;
  }) => {
    const { AuditLog } = await import('../../core/audit-log.js');
    return AuditLog.query(qa, args);
  };
}

export function buildGetPiiConfigHandler() {
  return async () => {
    const { PiiMasker } = await import('../../core/pii-masker.js');
    return PiiMasker.getConfig();
  };
}

export function buildSetPiiConfigHandler() {
  return async (args: {
    profileName: string;
    rules: {
      table: string;
      column: string;
      strategy: 'mask' | 'mask_last4' | 'hash' | 'redact' | 'passthrough';
    }[];
  }) => {
    const { PiiMasker } = await import('../../core/pii-masker.js');
    PiiMasker.setProfileConfig(args.profileName, args.rules, true);
    return { success: true, profileName: args.profileName, ruleCount: args.rules.length };
  };
}

export const DATA_GOVERNANCE_TOOL_DESCRIPTIONS = {
  compare_profile_schemas: '对比两个 profile 的 schema 差异 (added/removed/modified)。[group: data-governance]',
  export_backup: '导出 profile 为 SQL dump (CREATE TABLE + INSERT)。[group: data-governance]',
  audit_log: '查询 SQL 审计日志 (actor/severity/profile 过滤)。[group: data-governance]',
  get_pii_config: '读取 PII 脱敏配置 (pii.config.json)。[group: data-governance]',
  set_pii_config: '运行时更新 PII 脱敏规则 (无需重启)。[group: data-governance]',
};