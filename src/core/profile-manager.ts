/**
 * Profile types + ProfileManager (v2.18)
 *
 * Multi-DB profile management: save/list/delete profiles, runtime live connections,
 * read/write routing, global schema view.
 *
 * Implementation broken into multiple tasks:
 * - Task 2: Profile types + ProfileStore (SQLite CRUD)
 * - Task 3: QueryRouter
 * - Task 4: ProfileManager facade + LiveProfile
 * - Task 5: GlobalSchemaView
 */

import type { DbConfig } from '../types/adapter.js';

export type ProfileRole = 'primary' | 'replica' | 'analytics';
export type ReadRouting = 'round-robin' | 'random' | 'least-loaded';

export interface Profile {
  id: string;
  name: string;
  description: string;
  type: string;
  config: DbConfig;
  role: ProfileRole;
  tags: string[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
  created_by: string;
  use_count: number;
}
export interface ProfileInput {
  name: string;
  description: string;
  type: string;
  config: DbConfig;
  role?: ProfileRole;
  tags?: string[];
  enabled?: boolean;
}