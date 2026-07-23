/**
 * Path Guard
 * Validates file paths against an allowlist to prevent path traversal attacks.
 * Used by execute_sql_file tool to ensure LLM can only read authorized directories.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface PathGuardOptions {
  /** Resolved allowed directories (realpath) */
  allowedDirs: string[];
  /** Current working directory for resolving relative paths */
  cwd: string;
}

/**
 * Resolve and validate a file path against allowlist.
 * Throws Error if path is invalid or outside allowed directories.
 *
 * @returns The canonical absolute path (realpath-resolved)
 */
export function resolveAndValidatePath(inputPath: string, allowedDirs: string[], cwd: string): string {
  if (!Array.isArray(allowedDirs) || allowedDirs.length === 0) {
    throw new Error(`Path not in allowlist: ${inputPath} (no allowed directories configured)`);
  }

  // 1. Resolve to absolute path
  let resolved: string;
  if (path.isAbsolute(inputPath)) {
    resolved = inputPath;
  } else {
    resolved = path.resolve(cwd, inputPath);
  }

  // 2. Resolve symlinks via realpath (also handles .. in path)
  let realPath: string;
  try {
    realPath = fs.realpathSync(resolved);
  } catch (err) {
    // File doesn't exist - check if parent dir is in allowlist
    const parentDir = path.dirname(resolved);
    try {
      const realParent = fs.realpathSync(parentDir);
      // Validate parent dir instead
      return validateAgainstAllowlist(realParent, allowedDirs, inputPath);
    } catch {
      throw new Error(`Path not in allowlist: ${inputPath} (cannot resolve)`);
    }
  }

  return validateAgainstAllowlist(realPath, allowedDirs, inputPath);
}

function validateAgainstAllowlist(realPath: string, allowedDirs: string[], originalInput: string): string {
  const realAllowedDirs = allowedDirs.map(dir => {
    try {
      return fs.realpathSync(dir);
    } catch {
      return dir; // fallback if dir doesn't exist
    }
  });

  for (const allowedDir of realAllowedDirs) {
    if (realPath === allowedDir) {
      return realPath;
    }
    if (realPath.startsWith(allowedDir + path.sep)) {
      return realPath;
    }
  }

  throw new Error(`Path not in allowlist: ${originalInput}`);
}