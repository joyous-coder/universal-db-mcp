export class RingBuffer<T> {
  private buf: (T | undefined)[];
  private head = 0;
  private filled = 0;

  constructor(public readonly capacity: number) {
    this.buf = new Array(Math.max(0, capacity));
  }

  push(item: T): void {
    if (this.capacity === 0) return;
    this.buf[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.filled < this.capacity) this.filled += 1;
  }

  toArray(): readonly T[] {
    const out: T[] = [];
    for (let i = 0; i < this.filled; i++) {
      const idx = (this.head - 1 - i + this.capacity) % this.capacity;
      const v = this.buf[idx];
      if (v !== undefined) out.push(v);
    }
    return out;
  }

  clear(): void {
    this.buf = new Array(this.capacity);
    this.head = 0;
    this.filled = 0;
  }

  get size(): number {
    return this.filled;
  }
}
