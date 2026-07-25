/**
 * Shared cleanup helpers for integration tests (v3.3.0+)
 *
 * Solves Windows EBUSY issue where better-sqlite3 still holds the .db file
 * handle when afterAll tries to unlink. The working pattern is:
 *
 *   1. Close all stores (ProfileManager.closeAll, QueryAnalyzer.close, etc.)
 *   2. Wait a tick for OS to release the file handle
 *   3. Safe-unlink with retry
 *
 * Usage in tests:
 *
 *   import { closeAllStores, safeUnlink } from '../helpers/cleanup.js';
 *   afterAll(async () => {
 *     await closeAllStores(server);
 *     safeUnlink(dbPath);
 *   });
 */

import { existsSync } from 'node:fs';
import { unlink, stat } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * Best-effort close of all known store-bearing components reachable from the
 * server object. Tolerant — never throws.
 *
 * Covers: QueryAnalyzer (templates + history), ProfileManager (profiles),
 * AuditLog (history.db), PlanHistory (plan_history.db).
 */
export async function closeAllStores(server: any): Promise<void> {
  if (!server) return;
  const tasks: Array<Promise<unknown>> = [];

  // DatabaseService.setQueryAnalyzer-style stores (history + templates)
  // Be tolerant: integration tests that only exercise HTTP routes may not
  // have created a default session, so getService('default') throws.
  let ds: any = server.databaseService;
  try {
    ds = server.connectionManager?.getService?.('default') ?? server.databaseService;
  } catch {
    ds = server.databaseService;
  }
  if (ds?.queryAnalyzer && typeof ds.queryAnalyzer.close === 'function') {
    tasks.push(Promise.resolve(ds.queryAnalyzer.close()).catch(() => {}));
  }
  if (ds?.queryAnalyzer?.closeAll) {
    tasks.push(Promise.resolve(ds.queryAnalyzer.closeAll()).catch(() => {}));
  }

  // ProfileManager
  const pm = server.profileManager ?? ds?.profileManager;
  if (pm?.closeAll) {
    tasks.push(Promise.resolve(pm.closeAll()).catch(() => {}));
  } else if (typeof pm?.close === 'function') {
    tasks.push(Promise.resolve(pm.close()).catch(() => {}));
  }

  // Direct queryAnalyzer / profileManager fields on server (sometimes present)
  if (server.queryAnalyzer?.close) {
    tasks.push(Promise.resolve(server.queryAnalyzer.close()).catch(() => {}));
  }
  if (server.profileManager?.closeAll) {
    tasks.push(Promise.resolve(server.profileManager.closeAll()).catch(() => {}));
  }

  // AuditLog / PlanHistory — walk known paths if attached
  const auditLog = (server as any).auditLog;
  if (auditLog?.close) tasks.push(Promise.resolve(auditLog.close()).catch(() => {}));
  const planHistory = (server as any).planHistory;
  if (planHistory?.close) tasks.push(Promise.resolve(planHistory.close()).catch(() => {}));

  await Promise.allSettled(tasks);

  // Belt-and-suspenders: give Windows a moment to release file handles
  await sleep(50);
}

/**
 * Safe unlink with retry. Tolerant of "file not found". Retries on EBUSY
 * (Windows file still locked) up to 3 times with 100ms backoff.
 */
export async function safeUnlink(filePath: string, opts: { retries?: number; delayMs?: number } = {}): Promise<void> {
  const retries = opts.retries ?? 3;
  const delayMs = opts.delayMs ?? 100;
  for (let i = 0; i < retries; i++) {
    if (!existsSync(filePath)) return;
    try {
      await unlink(filePath);
      return;
    } catch (err: any) {
      const isBusy = err?.code === 'EBUSY' || err?.code === 'EPERM';
      if (!isBusy || i === retries - 1) {
        // ENOENT is fine; everything else on last retry we just swallow
        if (err?.code !== 'ENOENT') {
          // Quietly record — caller can probe with existsSync() if needed
        }
        return;
      }
      await sleep(delayMs);
    }
  }
}

/**
 * One-shot helper: close all stores then safe-unlink a list of paths.
 * Use in afterAll for the typical case.
 */
export async function cleanupTestArtifacts(server: any, paths: string[]): Promise<void> {
  await closeAllStores(server);
  for (const p of paths) await safeUnlink(p);
  // Best-effort: also clean WAL/SHM journal files if present
  for (const p of paths) {
    await safeUnlink(`${p}-wal`);
    await safeUnlink(`${p}-shm`);
    await safeUnlink(`${p}-journal`);
  }
}

// Re-export stat for callers that want to assert file deletion
export { stat };