/**
 * PlanDiff unit tests (v3.1)
 */

import { describe, it, expect } from 'vitest';
import { PlanDiff } from '../../src/core/plan-diff.js';
import type { NormalizedPlan } from '../../src/core/explain-parser.js';

describe('PlanDiff (v3.1)', () => {
  it('identical when same plan compared to itself', () => {
    const plan: NormalizedPlan = {
      dbType: 'sqlite', structured: true,
      nodes: [{ op: 'SCAN', table: 'users', rows: 100 }],
      rawText: '',
    };
    const res = PlanDiff.compare(plan, plan);
    expect(res.identical).toBe(true);
    expect(res.added).toEqual([]);
    expect(res.removed).toEqual([]);
    expect(res.changed).toEqual([]);
    expect(res.costDelta).toBe(0);
  });

  it('reports removed when B drops a node', () => {
    const a: NormalizedPlan = { dbType: 'sqlite', structured: true, rawText: '', nodes: [
      { op: 'SCAN', table: 'users', rows: 100 },
      { op: 'SORT', table: 'users', rows: 100 },
    ] };
    const b: NormalizedPlan = { dbType: 'sqlite', structured: true, rawText: '', nodes: [
      { op: 'SCAN', table: 'users', rows: 100 },
    ] };
    const res = PlanDiff.compare(a, b);
    expect(res.removed.length).toBeGreaterThanOrEqual(1);
  });

  it('reports added when B introduces a node', () => {
    const a: NormalizedPlan = { dbType: 'sqlite', structured: true, rawText: '', nodes: [
      { op: 'SCAN', table: 'users', rows: 100 },
    ] };
    const b: NormalizedPlan = { dbType: 'sqlite', structured: true, rawText: '', nodes: [
      { op: 'SCAN', table: 'users', rows: 100 },
      { op: 'SORT', table: 'users', rows: 100 },
    ] };
    const res = PlanDiff.compare(a, b);
    expect(res.added.length).toBeGreaterThanOrEqual(1);
  });

  it('reports changed when index swaps on same op+table', () => {
    const a: NormalizedPlan = { dbType: 'sqlite', structured: true, rawText: '', nodes: [
      { op: 'SCAN', table: 'users', index: 'idx_a', rows: 100, cost: 1 },
    ] };
    const b: NormalizedPlan = { dbType: 'sqlite', structured: true, rawText: '', nodes: [
      { op: 'SCAN', table: 'users', index: 'idx_b', rows: 50, cost: 0.5 },
    ] };
    const res = PlanDiff.compare(a, b);
    expect(res.changed.length).toBe(1);
    expect(res.changed[0].key).toContain('SCAN|users');
    expect(res.costDelta).toBeCloseTo(-0.5);
    expect(res.rowsDelta).toBe(-50);
  });

  it('costDelta positive when B is slower', () => {
    const a: NormalizedPlan = { dbType: 'sqlite', structured: true, rawText: '', nodes: [
      { op: 'SCAN', table: 't', rows: 10, cost: 1 },
    ] };
    const b: NormalizedPlan = { dbType: 'sqlite', structured: true, rawText: '', nodes: [
      { op: 'SCAN', table: 't', rows: 100, cost: 5 },
    ] };
    const res = PlanDiff.compare(a, b);
    expect(res.costDelta).toBeGreaterThan(0);
    expect(res.identical).toBe(false);
  });
});
