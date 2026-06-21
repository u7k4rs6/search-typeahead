import type { NextApiRequest, NextApiResponse } from 'next';
import { getSystem } from '@/lib/system';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sys = getSystem();
  const prefix = ((req.query.prefix as string) ?? '').toLowerCase().trim();

  if (!prefix) {
    // Return full cache stats when no prefix is given
    return res.status(200).json({
      cacheStats: sys.cache.stats,
      ringVnodeDistribution: sys.ring.getVnodeDistribution(),
      bufferStats: sys.buffer.stats,
      metricsStats: {
        p50LatencyMs: sys.metrics.p50,
        p95LatencyMs: sys.metrics.p95,
        p99LatencyMs: sys.metrics.p99,
        meanLatencyMs: sys.metrics.mean,
        sampleCount: sys.metrics.sampleCount,
      },
    });
  }

  const { nodeId, status } = sys.cache.debug(prefix);

  return res.status(200).json({
    prefix,
    node: nodeId,
    status,
    message: status === 'hit'
      ? `Cache HIT on ${nodeId}`
      : `Cache MISS on ${nodeId} (will be populated on next /suggest call)`,
  });
}
