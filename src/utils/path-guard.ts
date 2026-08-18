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
 * @returns The canonical absolute path (realpath-resolved if file exists,
 *          otherwise the parent-validated absolute path so callers can create
 *          the file safely).
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
  try {
    const realPath = fs.realpathSync(resolved);
    return validateAgainstAllowlist(realPath, allowedDirs, inputPath);
  } catch (err) {
    // File doesn't exist - validate parent dir is in allowlist
    const parentDir = path.dirname(resolved);
    const realParent = fs.realpathSync(parentDir);
    // 关键修复 (v4.0.9): 返回**文件路径**给调用方,而不是父目录。
    // 旧版返回 realParent → csv-writer 用此 path 创建 writeStream 时
    // 把目录当文件 open → Windows EISDIR → 进程崩溃。
    validateAgainstAllowlist(realParent, allowedDirs, inputPath);
    return resolved;
  }
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