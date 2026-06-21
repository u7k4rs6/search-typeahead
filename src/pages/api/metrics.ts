import type { NextApiRequest, NextApiResponse } from 'next';
import { getSystem } from '@/lib/system';

// GET /api/metrics
// Performance snapshot for the report: latency percentiles, cache hit rate,
// and write-reduction figures (total enqueued vs unique store writes).
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { metrics, cache, buffer, store, ring } = getSystem();

  return res.status(200).json({
    // Latency distribution over the last 10 k /suggest calls
    latency: {
      p50Ms: metrics.p50,
      p95Ms: metrics.p95,
      p99Ms: metrics.p99,
      meanMs: metrics.mean,
      samples: metrics.sampleCount,
    },
    // Cache hit rate and per-node key counts
    cache: {
      hitRate: Math.round(cache.hitRate * 10000) / 100, // percent, 2 dp
      totalHits: cache.stats.totalHits,
      totalMisses: cache.stats.totalMisses,
      perNodeKeyCount: cache.stats.perNodeKeyCount,
    },
    // Write-reduction: totalEnqueued (raw searches) vs totalFlushed (unique store writes)
    writeBuffer: buffer.stats,
    store: { queryCount: store.queryCount },
    ring: { vnodeDistribution: ring.getVnodeDistribution() },
  });
}
