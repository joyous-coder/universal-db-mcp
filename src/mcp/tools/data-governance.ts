/**
 * MCP data-governance tools (v3.x)
 *
 * Wired progressively: only SchemaDiff handlers land in Task 1; BackupWriter,
 * AuditLog, and PiiMasker handlers land in their respective tasks.
 *
 * Tasks 2/3/4 register additional handlers in mcp-server.ts under the same
 * governance group.
 */

import type { ProfileManager } from '../../core/profile-manager.js';
import { SchemaDiff } from '../../core/schema-diff.js';

export function buildCompareProfileSchemasHandler(pm: ProfileManager) {
  return async (args: { nameA: string; nameB: string }) => {
    return SchemaDiff.compareProfiles(pm, args.nameA, args.nameB);
  };
}

export const DATA_GOVERNANCE_TOOL_DESCRIPTIONS = {
  compare_profile_schemas: 'Compare schema between two profiles. Returns added/removed/modified tables.',
  export_backup: 'Export a profile as SQL dump (CREATE TABLE + INSERT). Schema-only option skips data.',
  audit_log: 'Query audit history by actor / severity / profile. Requires audit mode enabled.',
  get_pii_config: 'Read PII masking rules from pii.config.json (per profile, table, column).',
  set_pii_config: 'Add/update PII masking rules at runtime (no reload needed).',
};

