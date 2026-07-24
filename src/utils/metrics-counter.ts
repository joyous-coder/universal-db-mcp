export type Labels = Record<string, string>;

function labelKey(labels: Labels): string {
  // Deterministic key from sorted label entries
  return Object.keys(labels).sort().map(k => `${k}=${labels[k]}`).join('|');
}

export class Counter {
  private values = new Map<string, number>();

  constructor(
    public readonly name: string,
    public readonly help: string,
  ) {}

  inc(labels: Labels, n = 1): void {
    const k = labelKey(labels);
    this.values.set(k, (this.values.get(k) ?? 0) + n);
  }

  get(labels: Labels): number {
    return this.values.get(labelKey(labels)) ?? 0;
  }

  /** Internal: iterate all series for export */
  *entries(): Iterable<{ labels: Labels; value: number }> {
    for (const [, v] of this.values) {
      // We reconstruct labels from key by storing separately; for now,
      // serialization happens at Registry level. This stub returns value only.
      yield { labels: {}, value: v };
    }
  }
}
