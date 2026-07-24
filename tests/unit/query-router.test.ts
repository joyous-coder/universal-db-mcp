import { describe, it, expect } from 'vitest';
import { QueryRouter } from '../../src/core/query-router.js';

interface LiveLike { profile: { name: string; role: string }; adapter: unknown }

describe('QueryRouter', () => {
  const live = (name: string, role: string): LiveLike => ({ profile: { name, role }, adapter: {} });

  it('round-robin cycles through replicas in order', () => {
    const r = new QueryRouter('round-robin');
    const a = live('a', 'replica');
    const b = live('b', 'replica');
    const c = live('c', 'replica');
    expect(r.pickReadReplica([a, b, c])).toBe(a);
    expect(r.pickReadReplica([a, b, c])).toBe(b);
    expect(r.pickReadReplica([a, b, c])).toBe(c);
    expect(r.pickReadReplica([a, b, c])).toBe(a);
  });

  it('random returns one of the candidates (any of them)', () => {
    const r = new QueryRouter('random');
    const candidates = [live('a', 'replica'), live('b', 'replica')];
    const picked = r.pickReadReplica(candidates);
    expect(candidates).toContain(picked);
  });

  it('least-loaded returns first candidate (placeholder; v2.19+ will use metrics)', () => {
    const r = new QueryRouter('least-loaded');
    const a = live('a', 'replica');
    expect(r.pickReadReplica([a])).toBe(a);
  });

  it('returns single candidate unchanged', () => {
    const r = new QueryRouter('round-robin');
    const a = live('a', 'replica');
    expect(r.pickReadReplica([a])).toBe(a);
  });

  it('returns null for empty candidates', () => {
    const r = new QueryRouter('round-robin');
    expect(r.pickReadReplica([])).toBeNull();
  });
});