export type Labels = Record<string, string>;

interface CounterEntry {
  labels: Labels;
  value: number;
}

export class Counter {
  private entries = new Map<string, CounterEntry>();

  constructor(
    public readonly name: string,
    public readonly help: string,
    private readonly isEnabled: () => boolean = () => true,
  ) {}

  inc(labels: Labels, n = 1): void {
    if (!this.isEnabled()) return;
    const k = this.key(labels);
    const existing = this.entries.get(k);
    if (existing) {
      existing.value += n;
      this.entries.delete(k);
      this.entries.set(k, existing);
    } else {
      if (this.entries.size >= 1000) {
        const oldest = this.entries.keys().next().value;
        if (oldest !== undefined) this.entries.delete(oldest);
      }
      this.entries.set(k, { labels: { ...labels }, value: n });
    }
  }

  get(labels: Labels): number {
    return this.entries.get(this.key(labels))?.value ?? 0;
  }

  series(): CounterEntry[] {
    return Array.from(this.entries.values());
  }

  private key(labels: Labels): string {
    return Object.keys(labels).sort().map(k => `${k}=${labels[k]}`).join('|');
  }
}
