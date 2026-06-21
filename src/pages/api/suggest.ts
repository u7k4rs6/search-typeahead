import type { NextApiRequest, NextApiResponse } from 'next';
import { getSystem } from '@/lib/system';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sys = getSystem();
  const t0 = Date.now();

  const rawQ = (req.query.q as string) ?? '';
  const modeParam = req.query.mode as string | undefined;
  const mode = (modeParam === 'enhanced' ? 'enhanced' : modeParam === 'basic' ? 'basic' : sys.mode);

  // Normalize: lowercase + trim
  const prefix = rawQ.toLowerCase().trim();

  if (!prefix) {
    sys.metrics.recordLatency(Date.now() - t0);
    return res.status(200).json({ suggestions: [], prefix: '', mode, source: 'empty' });
  }

  // Step 1: check the owning cache node
  const cached = sys.cache.get(prefix);
  if (cached !== null) {
    const latency = Date.now() - t0;
    sys.metrics.recordLatency(latency);
    return res.status(200).json({
      suggestions: cached,
      prefix,
      mode,
      source: 'cache',
      latencyMs: latency,
      node: sys.ring.getNode(prefix),
    });
  }

  // Step 2: cache miss — query the trie
  let suggestions = sys.store.getSuggestions(prefix, 10);

  // Step 3: re-rank by decay score in enhanced mode
  if (mode === 'enhanced') {
    suggestions = sys.trending.rerank(suggestions);
  }

  // Step 4: populate the owning cache node with TTL
  sys.cache.set(prefix, suggestions);

  const latency = Date.now() - t0;
  sys.metrics.recordLatency(latency);

  return res.status(200).json({
    suggestions,
    prefix,
    mode,
    source: 'trie',
    latencyMs: latency,
    node: sys.ring.getNode(prefix),
  });
}
