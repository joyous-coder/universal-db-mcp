/**
 * Docs audit script (v3.3.0)
 *
 * Detects documentation gaps across 6 dimensions:
 *   1. MCP tools vs docs references
 *   2. CHANGELOG features vs feature docs
 *   3. Env vars vs docs
 *   4. HTTP endpoints vs docs
 *   5. Database adapters vs docs/02-databases
 *   6. Code examples vs docs (placeholder for future)
 *
 * Run: `node --experimental-strip-types scripts/audit-docs.ts`
 * Output: 6 JSON files in docs/09-reference/audit/
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Extract MCP tool names from src/mcp/tools/*.ts and src/mcp/tool-definitions.ts:
 *  matches TOOL_DESCRIPTIONS object keys, `name: 'xxx'` literals, `tool('xxx',` factory calls, and `case 'xxx':` switches
 */
export async function extractToolNames(srcDir: string): Promise<string[]> {
  // Look at both:
  //   - src/mcp/tools/*.ts (handler builders + descriptions)
  //   - src/mcp/tool-definitions.ts (registry wiring via tool() factory)
  const toolsDir = srcDir;
  const defsFile = join(srcDir, '..', 'tool-definitions.ts');
  const defsFile2 = join(srcDir, '..', 'mcp-server.ts');

  const names = new Set<string>();
  // TOOL_DESCRIPTIONS-style: `tool_name: 'description',`
  const descRe = /^\s*(\w+):\s*['"][^'"]+['"],?\s*$/gm;
  // `name: 'xxx'` object literals (e.g. generate_sample_data infoLazy)
  const nameLiteralRe = /\bname:\s*['"]([\w-]+)['"]/g;
  // `tool('xxx',` factory calls
  const toolCallRe = /tool\(\s*['"]([\w-]+)['"]/g;
  // `case 'xxx':` in switch statements
  const caseRe = /case\s+['"]([\w-]+)['"]\s*:/g;

  // Build list of files to scan
  const filesToScan: string[] = [];
  try {
    const dirEntries = await readdir(toolsDir);
    for (const e of dirEntries) {
      if (e.endsWith('.ts')) filesToScan.push(join(toolsDir, e));
    }
  } catch { /* dir not found */ }
  filesToScan.push(defsFile, defsFile2);

  for (const f of filesToScan) {
    let text: string;
    try {
      text = await readFile(f, 'utf-8');
    } catch {
      continue;
    }
    for (const m of text.matchAll(descRe)) {
      const key = m[1];
      if (!['enabled', 'description', 'default', 'type', 'name'].includes(key)) {
        names.add(key);
      }
    }
    for (const m of text.matchAll(nameLiteralRe)) names.add(m[1]);
    for (const m of text.matchAll(toolCallRe)) names.add(m[1]);
    for (const m of text.matchAll(caseRe)) names.add(m[1]);
  }
  return [...names];
}

/** Extract DB_* env var names from config-loader.ts process.env references */
export async function extractEnvVars(configLoaderPath: string): Promise<string[]> {
  const text = await readFile(configLoaderPath, 'utf-8');
  const names = new Set<string>();
  const re = /process\.env\.([A-Z_][A-Z0-9_]+)/g;
  for (const m of text.matchAll(re)) {
    if (m[1].startsWith('DB_')) names.add(m[1]);
  }
  return [...names];
}

/** Extract adapter names from src/adapters/*.ts filenames */
export async function extractAdapterNames(srcDir: string): Promise<string[]> {
  const files = (await readdir(srcDir)).filter(f => f.endsWith('.ts') || f.endsWith('.js'));
  return files.map(f => f.replace(/\.(ts|js)$/, ''));
}

/** Extract HTTP endpoint paths from `fastify.get|post|delete('...')` patterns */
export async function extractEndpointNames(srcDir: string): Promise<string[]> {
  const files = (await readdir(srcDir)).filter(f => f.endsWith('.ts'));
  const names = new Set<string>();
  const re = /fastify\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g;
  for (const f of files) {
    const text = await readFile(join(srcDir, f), 'utf-8');
    for (const m of text.matchAll(re)) names.add(m[2]);
  }
  return [...names];
}

/** Extract feature names from CHANGELOG.md `### 新增` headers */
export async function extractFeatureNames(changelogPath: string): Promise<string[]> {
  const text = await readFile(changelogPath, 'utf-8');
  const features: string[] = [];
  const re = /### 新增 \(([^)]+)\)/g;
  for (const m of text.matchAll(re)) features.push(m[1]);
  return features;
}

/** Check if name appears in any *.md file under docDir */
export async function findDocReferences(name: string, docDir: string): Promise<boolean> {
  async function walk(dir: string): Promise<boolean> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (await walk(p)) return true;
      } else if (e.name.endsWith('.md')) {
        const text = await readFile(p, 'utf-8');
        if (text.includes(name)) return true;
      }
    }
    return false;
  }
  return walk(docDir);
}