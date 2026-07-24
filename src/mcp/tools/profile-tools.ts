/**
 * MCP profile tools (v2.18)
 *
 * 4 tools: save_profile / list_profiles / use_profile / get_global_schema
 */

import type { ProfileManager } from '../../core/profile-manager.js';
import type { ProfileInput } from '../../core/profile-manager.js';

export function buildSaveProfileHandler(pm: ProfileManager) {
  return async (args: ProfileInput) => pm.saveProfile(args, 'mcp');
}

export function buildListProfilesHandler(pm: ProfileManager) {
  return async (args: { role?: string; tag?: string; enabled?: boolean }) => ({ profiles: await pm.listProfiles(args) });
}

export function buildUseProfileHandler(pm: ProfileManager) {
  return async (args: { name: string }) => {
    const live = await pm.loadProfile(args.name);
    return { name: live.profile.name, type: live.profile.type, role: live.profile.role };
  };
}

export function buildGetGlobalSchemaHandler(pm: ProfileManager) {
  return async () => {
    const { buildGlobalSchemaView } = await import('../../core/global-schema-view.js');
    return buildGlobalSchemaView(pm);
  };
}

export const PROFILE_TOOL_DESCRIPTIONS = {
  save_profile: 'Save a named database profile (host/port/user/etc) to profiles.db.',
  list_profiles: 'List saved profiles. Filters: role, tag, enabled.',
  use_profile: 'Switch active connection to a saved profile. Loads if not connected.',
  get_global_schema: 'Get merged schema of all enabled profiles. Parallel fetch.',
};