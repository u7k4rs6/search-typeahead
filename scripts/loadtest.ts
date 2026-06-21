// scripts/loadtest.ts
// Assumes the server is already running at http://localhost:3000.
// Run: npm run loadtest
// Uses native Node fetch — no external dependencies.

const BASE = 'http://localhost:3000';
const TOTAL = 5_000;
const CONCURRENCY = 25;

// Skewed query pool. Hot queries repeat ~30× more than cold ones so aggregation
// in the write buffer becomes clearly visible in the final metrics.
const HOT = [
  'iphone', 'pizza', 'netflix', 'nike', 'google',
  'amazon', 'chatgpt', 'apple', 'samsung', 'youtube',
];
const WARM = [
  'laptop review', 'best headphones', 'python tutorial', 'react tutorial',
  'airpods pro', 'samsung galaxy', 'spotify premium', 'amazon prime',
  'taco bell menu', 'starbucks app', 'ps5', 'xbox series x',
  'doordash promo', 'ipad pro', 'macbook air',
];
const COLD: string[] = Array.from({ length: 80 }, (_, i) => `unique cold query ${i}`);

function pickQuery(): string {
  const r = Math.random();
  if (r < 0.60) return HOT[Math.floor(Math.random() * HOT.length)];
  if (r < 0.85) return WARM[Math.floor(Math.random() * WARM.length)];
  return COLD[Math.floor(Math.random() * COLD.length)];
}

function pct(arr: number[], p: number): number {
  const sorted = arr.slice().sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

// Per-operation counters and client-side latency samples.
let suggestCount = 0;
let searchCount = 0;
const clientLatencies: number[] = [];

async function doSuggest(query: string): Promise<void> {
  // Use a realistic prefix (60% of the query length, min 2 chars).
  const len = Math.max(2, Math.ceil(query.length * 0.6));
  const prefix = query.slice(0, len);
  const t0 = performance.now();
  await fetch(`${BASE}/api/suggest?q=${encodeURIComponent(prefix)}&mode=basic`);
  clientLatencies.push(performance.now() - t0);
  suggestCount++;
}

async function doSearch(query: string): Promise<void> {
  const t0 = performance.now();
  await fetch(`${BASE}/api/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  clientLatencies.push(performance.now() - t0);
  searchCount++;
}

async function request(i: number): Promise<void> {
  const q = pickQuery();
  // 75% suggest, 25% search — realistic read/write ratio for a typeahead system.
  if (Math.random() < 0.75) {
    await doSuggest(q);
  } else {
    await doSearch(q);
  }
}

async function main(): Promise<void> {
  console.log(`\nLoad test — ${TOTAL} requests  concurrency=${CONCURRENCY}  target=${BASE}\n`);
  const t0 = Date.now();
  let completed = 0;

  // Run in batches of CONCURRENCY to bound in-flight requests.
  for (let i = 0; i < TOTAL; i += CONCURRENCY) {
    const batch = Array.from(
      { length: Math.min(CONCURRENCY, TOTAL - i) },
      (_, j) => request(i + j),
    );
    await Promise.all(batch);
    completed += batch.length;
    if (completed % 500 === 0 || completed === TOTAL) {
      process.stdout.write(`  ${completed}/${TOTAL}\r`);
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
  console.log(`\nDone: ${TOTAL} requests in ${elapsed}s  (${(TOTAL / parseFloat(elapsed)).toFixed(0)} req/s)\n`);

  // ── Operation breakdown ──────────────────────────────────────────────────────
  console.log('=== operation breakdown ===');
  console.log(`  suggest (GET /api/suggest): ${suggestCount}`);
  console.log(`  search  (POST /api/search): ${searchCount}`);
  console.log(`  total                     : ${suggestCount + searchCount}`);
  console.log('');

  // ── Client-side latency (end-to-end round-trip including network + serialize) ──
  console.log('=== client-side latency (end-to-end round-trip) ===');
  console.log(`  p50: ${pct(clientLatencies, 50).toFixed(2)} ms`);
  console.log(`  p95: ${pct(clientLatencies, 95).toFixed(2)} ms`);
  console.log(`  p99: ${pct(clientLatencies, 99).toFixed(2)} ms`);
  console.log('');

  // ── Server-side metrics snapshot ─────────────────────────────────────────────
  const m = await fetch(`${BASE}/api/metrics`).then((r) => r.json() as any);

  console.log('=== server-side latency (suggest handler compute only) ===');
  console.log(`  p50: ${(+m.latency.p50Ms).toFixed(3)} ms`);
  console.log(`  p95: ${(+m.latency.p95Ms).toFixed(3)} ms`);
  console.log(`  p99: ${(+m.latency.p99Ms).toFixed(3)} ms`);
  console.log(`  mean: ${(+m.latency.meanMs).toFixed(3)} ms   samples: ${m.latency.samples}`);
  console.log('');
  console.log(`  cache hit rate:  ${m.cache.hitRate}%`);
  console.log(`  cache hits:      ${m.cache.totalHits}`);
  console.log(`  cache misses:    ${m.cache.totalMisses}`);
  console.log('');
  console.log(`  wb enqueued:     ${m.writeBuffer.totalEnqueued}   (raw /api/search calls)`);
  console.log(`  wb flushed:      ${m.writeBuffer.totalFlushed}    (unique queries written to store)`);
  console.log(`  wb flush cycles: ${m.writeBuffer.flushCount}`);
  if (m.writeBuffer.totalEnqueued > 0) {
    const saved = m.writeBuffer.totalEnqueued - m.writeBuffer.totalFlushed;
    const ratio = ((saved / m.writeBuffer.totalEnqueued) * 100).toFixed(1);
    console.log(`  write reduction: ${ratio}%  (${saved} duplicate writes avoided)`);
  }
  console.log('');
  console.log('  ring key distribution (cache keys per physical node):');
  for (const [node, count] of Object.entries(m.ring.keyDistribution)) {
    console.log(`    ${node}: ${count} keys`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
