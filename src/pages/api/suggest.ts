import type { NextApiRequest, NextApiResponse } from 'next';
import { getSystem } from '@/lib/system';

// GET /api/suggest?q=<prefix>&mode=basic|enhanced
// basic:    ring-routed cache first; trie on miss; repopulate cache.
// enhanced: always reads from trie (bypasses cache — no read, no write, no hit/miss impact)
//           using a top-100 candidate pool re-ranked by decayed score, returning top 10.
//           Isolation prevents a basic cache entry from poisoning enhanced ordering.
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const sys = getSystem();
  // performance.now() has sub-ms fractional resolution; Date.now() floors to 1 ms.
  const t0 = performance.now();

  const prefix = ((req.query.q as string) ?? '').toLowerCase().trim();
  const mode = (req.query.mode as string) === 'enhanced' ? 'enhanced' : 'basic';

  if (!prefix) {
    sys.metrics.recordLatency(performance.now() - t0);
    return res.status(200).json({ suggestions: [] });
  }

  // Enhanced: bypass cache entirely. Pull top-100 by all-time count, re-rank by
  // decayed score, return top 10. A 100-entry pool lets recently-surging queries
  // surface even if they sit outside the all-time top-10 for this prefix.
  // Latency is still recorded; hit/miss counters are NOT touched.
  if (mode === 'enhanced') {
    const candidates = sys.store.getSuggestions(prefix, 100);
    const suggestions = sys.trending.rerank(candidates).slice(0, 10);
    const latencyMs = performance.now() - t0;
    sys.metrics.recordLatency(latencyMs);
    return res.status(200).json({
      suggestions,
      _debug: { source: 'trie', node: sys.ring.getNode(prefix), latencyMs },
    });
  }

  // Basic: cache-first (ring-routed); trie on miss, then repopulate cache.
  const cached = sys.cache.get(prefix);
  if (cached !== null) {
    const latencyMs = performance.now() - t0;
    sys.metrics.recordLatency(latencyMs);
    return res.status(200).json({
      suggestions: cached,
      _debug: { source: 'cache', node: sys.ring.getNode(prefix), latencyMs },
    });
  }

  const suggestions = sys.store.getSuggestions(prefix, 10);
  sys.cache.set(prefix, suggestions);

  const latencyMs = performance.now() - t0;
  sys.metrics.recordLatency(latencyMs);

  return res.status(200).json({
    suggestions,
    _debug: { source: 'trie', node: sys.ring.getNode(prefix), latencyMs },
  });
}
