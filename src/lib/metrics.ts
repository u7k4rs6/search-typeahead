// Lightweight metrics collector for the performance report.
export class MetricsCollector {
  private latencies: number[] = []; // suggestion API latencies in ms
  private windowSize = 10_000; // keep last 10k samples

  recordLatency(ms: number): void {
    this.latencies.push(ms);
    if (this.latencies.length > this.windowSize) {
      this.latencies.shift();
    }
  }

  percentile(p: number): number {
    if (this.latencies.length === 0) return 0;
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  }

  get p50(): number { return this.percentile(50); }
  get p95(): number { return this.percentile(95); }
  get p99(): number { return this.percentile(99); }
  get mean(): number {
    if (this.latencies.length === 0) return 0;
    return this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length;
  }
  get sampleCount(): number { return this.latencies.length; }
}
