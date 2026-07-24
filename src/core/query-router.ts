/**
 * QueryRouter (v2.18)
 *
 * Pick a read replica from candidates. Strategies: round-robin / random / least-loaded.
 * For v2.18, 'least-loaded' is a stub (returns first) — v2.19+ pulls from MetricsRegistry.
 */

export type ReadRouting = 'round-robin' | 'random' | 'least-loaded';

export class QueryRouter {
  private rrCounter = 0;

  constructor(public readonly routing: ReadRouting) {}

  pickReadReplica<T extends { profile: { role: string } }>(candidates: T[]): T | null {
    if (!candidates.length) return null;
    switch (this.routing) {
      case 'round-robin': {
        const pick = candidates[this.rrCounter % candidates.length];
        this.rrCounter += 1;
        return pick;
      }
      case 'random': {
        return candidates[Math.floor(Math.random() * candidates.length)];
      }
      case 'least-loaded': {
        // v2.19+ will pull from MetricsRegistry (db_pool_active); for v2.18 stub returns first
        return candidates[0];
      }
    }
  }
}