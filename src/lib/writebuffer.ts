export type FlushCallback = (batch: Map<string, number>) => void;

interface WriteBufferConfig {
  batchSize: number;      // flush when buffer reaches this many unique queries
  flushIntervalMs: number; // flush every this many ms regardless of size
  onFlush: FlushCallback;
}

// In-memory write buffer: POST /search enqueues here and returns immediately.
// A background flusher drains the buffer on size threshold OR time interval.
// Duplicate queries within a batch are aggregated: 50 searches for "pizza" → one +50 write.
export class WriteBuffer {
  private buffer = new Map<string, number>(); // query -> aggregated count delta
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly config: WriteBufferConfig;
  private totalEnqueued = 0;
  private totalFlushed = 0;
  private flushCount = 0;

  constructor(config: WriteBufferConfig) {
    this.config = config;
    this.scheduleTimer();
  }

  enqueue(query: string): void {
    this.buffer.set(query, (this.buffer.get(query) ?? 0) + 1);
    this.totalEnqueued++;
    if (this.buffer.size >= this.config.batchSize) {
      this.flush();
    }
  }

  flush(): void {
    if (this.buffer.size === 0) return;
    const batch = new Map(this.buffer);
    this.buffer.clear();
    this.totalFlushed += batch.size;
    this.flushCount++;
    console.log(
      `[WriteBuffer] Flush #${this.flushCount}: ${batch.size} unique queries ` +
        `(${[...batch.values()].reduce((a, b) => a + b, 0)} total searches)`
    );
    this.config.onFlush(batch);
    this.rescheduleTimer();
  }

  private scheduleTimer(): void {
    this.timer = setTimeout(() => this.flush(), this.config.flushIntervalMs);
    // Allow Node process to exit even if timer is pending
    if (this.timer.unref) this.timer.unref();
  }

  private rescheduleTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.scheduleTimer();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.flush(); // final flush on shutdown
  }

  get pendingCount(): number { return this.buffer.size; }
  get stats() {
    return {
      pendingQueries: this.buffer.size,
      pendingTotal: [...this.buffer.values()].reduce((a, b) => a + b, 0),
      totalEnqueued: this.totalEnqueued,
      totalFlushed: this.totalFlushed,
      flushCount: this.flushCount,
    };
  }
}
