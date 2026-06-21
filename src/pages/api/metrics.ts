import type { NextApiRequest, NextApiResponse } from 'next';
import { getSystem } from '@/lib/system';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sys = getSystem();

  return res.status(200).json({
    latency: {
      p50Ms: sys.metrics.p50,
      p95Ms: sys.metrics.p95,
      p99Ms: sys.metrics.p99,
      meanMs: sys.metrics.mean,
      samples: sys.metrics.sampleCount,
    },
    cache: sys.cache.stats,
    writeBuffer: sys.buffer.stats,
    store: {
      queryCount: sys.store.queryCount,
    },
    trending: {
      trackedQueries: sys.trending.trackedCount,
      topTrending: sys.trending.getTopTrending(10),
    },
    ring: {
      nodes: sys.ring.getNodes(),
      vnodeDistribution: sys.ring.getVnodeDistribution(),
    },
    mode: sys.mode,
    config: sys.config,
  });
}
