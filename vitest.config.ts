import { defineConfig } from 'vitest/config';
import * as fs from 'node:fs';
import * as path from 'node:path';

const sqliteNativeAvailable = (() => {
  // Skip sqlite tests when the better-sqlite3 native binding is missing or
  // built for a different Node ABI (e.g. Node 24 without rebuilt binary).
  const bindingsDir = path.join(process.cwd(), 'node_modules', 'better-sqlite3', 'build', 'Release');
  if (!fs.existsSync(bindingsDir)) {
    const altPaths = [
      'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
      'node_modules/better-sqlite3/build/Debug/better_sqlite3.node',
      'node_modules/better-sqlite3/Release/better_sqlite3.node',
    ];
    return altPaths.some(p => fs.existsSync(p));
  }
  return fs.readdirSync(bindingsDir).some(f => f.endsWith('.node'));
})();

const exclude = sqliteNativeAvailable ? [] : ['tests/unit/sqlite-adapter.test.ts'];

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
