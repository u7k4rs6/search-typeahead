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

async function doSuggest(query: string): Promise<void> {
  // Use a realistic prefix (60% of the query length, min 2 chars).
  const len = Math.max(2, Math.ceil(query.length * 0.6));
  const prefix = query.slice(0, len);
  await fetch(`${BASE}/api/suggest?q=${encodeURIComponent(prefix)}&mode=basic`);
}

async function doSearch(query: string): Promise<void> {
  await fetch(`${BASE}/api/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
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

  // ── Final metrics snapshot ───────────────────────────────────────────────────
  const m = await fetch(`${BASE}/api/metrics`).then((r) => r.json() as any);

  console.log('=== /api/metrics snapshot ===');
  console.log(`  p50 latency:     ${m.latency.p50Ms} ms`);
  console.log(`  p95 latency:     ${m.latency.p95Ms} ms`);
  console.log(`  p99 latency:     ${m.latency.p99Ms} ms`);
  console.log(`  mean latency:    ${m.latency.meanMs} ms`);
  console.log(`  latency samples: ${m.latency.samples}`);
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
    const pct = ((saved / m.writeBuffer.totalEnqueued) * 100).toFixed(1);
    console.log(`  write reduction: ${pct}%  (${saved} duplicate writes avoided)`);
  }
  console.log('');
  console.log('  ring vnode distribution:');
  for (const [node, count] of Object.entries(m.ring.vnodeDistribution)) {
    console.log(`    ${node}: ${count} vnodes`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
