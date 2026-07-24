import { defineConfig } from 'vitest/config';
import { createRequire } from 'node:module';

// Detect whether ANY SQLite backend is available. node:sqlite is the preferred
// (Node 22.5+ built-in, no native deps). Use createRequire so we can test
// `node:sqlite` from CJS (vitest's ESM resolver doesn't recognize the `node:`
// scheme for built-in modules).
const require_ = createRequire(import.meta.url);

async function isAnySqliteAvailable(): Promise<boolean> {
  // 1) node:sqlite (Node 22.5+) via CJS require
  try {
    const mod = require_('node:sqlite') as any;
    if (mod && mod.DatabaseSync) return true;
  } catch {}
  // 2) better-sqlite3 (prebuilt binary required)
  try {
    const mod = await import('better-sqlite3');
    if (mod && (mod as any).default) return true;
  } catch {}
  return false;
}

const exclude: string[] = [];
const sqliteOk = await isAnySqliteAvailable();
if (!sqliteOk) {
  exclude.push('tests/unit/sqlite-adapter.test.ts');
}

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    exclude,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'tests/',
        '**/*.test.ts',
        '**/*.config.ts'
      ]
    },
    testTimeout: 10000,
    hookTimeout: 10000
  }
});
