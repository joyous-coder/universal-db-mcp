/**
 * PlanDiff (v3.1)
 *
 * Structural comparison of two EXPLAIN plans:
 *  - added: op nodes present in B but not A
 *  - removed: op nodes present in A but not B
 *  - changed: same op path but cost/rows/index differs
 *  - costDelta: signed sum of cost changes (positive = slower, negative = faster)
 *
 * Plans are compared by their op-table signature (op + table + depth path),
 * treating index swaps and cost moves as "changed" rather than removed/added.
 */

import type { NormalizedPlan, NormalizedPlanNode } from './explain-parser.js';

export interface PlanDiffResult {
  identical: boolean;
  added: NormalizedPlanNode[];
  removed: NormalizedPlanNode[];
  changed: {
    key: string;
    from: NormalizedPlanNode;
    to: NormalizedPlanNode;
    costDelta: number;
    rowsDelta: number;
  }[];
  costDelta: number;
  rowsDelta: number;
}

type OpKey = string;

function makeKey(prefix: string, node: NormalizedPlanNode): OpKey {
  return `${prefix}|${node.op}|${node.table ?? ''}`;
}

function collectKeys(root: NormalizedPlanNode, prefix: string = ''): Map<OpKey, NormalizedPlanNode> {
  const out = new Map<OpKey, NormalizedPlanNode>();
  const visit = (n: NormalizedPlanNode, path: string) => {
    const k = makeKey(path, n);
    out.set(k, n);
    for (let i = 0; i < (n.children ?? []).length; i++) {
      visit(n.children![i], `${path}/${i}`);
    }
  };
  visit(root, prefix);
  return out;
}

export class PlanDiff {
  /** Compare two normalized plans. Order doesn't matter; structure does. */
  static compare(planA: NormalizedPlan, planB: NormalizedPlan): PlanDiffResult {
    const added: NormalizedPlanNode[] = [];
    const removed: NormalizedPlanNode[] = [];
    const changed: PlanDiffResult['changed'] = [];
    let costDelta = 0;
    let rowsDelta = 0;

    for (const rootA of planA.nodes) {
      const keysA = collectKeys(rootA, 'A');
      for (const rootB of planB.nodes) {
        const keysB = collectKeys(rootB, 'B');
        // Nodes in B not in A → added
        for (const [k, node] of keysB) {
          if (!keysA.has(k.replace(/^B\|/, 'A|'))) added.push(node);
        }
        // Nodes in A not in B → removed
        for (const [k, node] of keysA) {
          if (!keysB.has(k.replace(/^A\|/, 'B|'))) removed.push(node);
        }
        // Same key → compare cost/rows/index changes
        for (const [k, a] of keysA) {
          const bk = k.replace(/^A\|/, 'B|');
          const b = keysB.get(bk);
          if (!b) continue;
          const ac = a.cost ?? 0;
          const bc = b.cost ?? 0;
          const ar = a.rows ?? 0;
          const br = b.rows ?? 0;
          costDelta += bc - ac;
          rowsDelta += br - ar;
          if (Math.abs(bc - ac) > 0.01 || Math.abs(br - ar) > 0 || a.index !== b.index) {
            changed.push({ key: k, from: a, to: b, costDelta: bc - ac, rowsDelta: br - ar });
          }
        }
      }
    }
    const identical = added.length === 0 && removed.length === 0 && changed.length === 0 && costDelta === 0;
    return { identical, added, removed, changed, costDelta, rowsDelta };
  }
}
