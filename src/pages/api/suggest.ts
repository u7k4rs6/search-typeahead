import type { NextApiRequest, NextApiResponse } from 'next';
import { getSystem } from '@/lib/system';

// GET /api/suggest?q=<prefix>&mode=basic|enhanced
// Returns up to 10 prefix completions ordered by the selected ranking mode.
// Read path: ring-routed cache node first; trie on miss, then repopulate the node.
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const sys = getSystem();
  const t0 = Date.now();

  // Normalize: lowercase + trim. Empty input is a valid no-op.
  const prefix = ((req.query.q as string) ?? '').toLowerCase().trim();
  const mode = (req.query.mode as string) === 'enhanced' ? 'enhanced' : 'basic';

  if (!prefix) {
    sys.metrics.recordLatency(Date.now() - t0);
    return res.status(200).json({ suggestions: [] });
  }

  // Cache-first: hash the prefix, find the owning node, check it.
  const cached = sys.cache.get(prefix);
  if (cached !== null) {
    sys.metrics.recordLatency(Date.now() - t0);
    return res.status(200).json({
      suggestions: cached,
      // debug extras (not part of the contract, used by the UI cache indicator)
      _debug: { source: 'cache', node: sys.ring.getNode(prefix), latencyMs: Date.now() - t0 },
    });
  }

  // Cache miss: query the trie (O(prefix length) walk + O(1) topK read).
  let suggestions = sys.store.getSuggestions(prefix, 10);

  // Enhanced mode: re-rank the 10 candidates by their current decayed score.
  if (mode === 'enhanced') suggestions = sys.trending.rerank(suggestions);

  // Populate the owning cache node with the TTL from config.
  sys.cache.set(prefix, suggestions);

  const latencyMs = Date.now() - t0;
  sys.metrics.recordLatency(latencyMs);

  return res.status(200).json({
    suggestions,
    _debug: { source: 'trie', node: sys.ring.getNode(prefix), latencyMs },
  });
}
