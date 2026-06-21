import type { NextApiRequest, NextApiResponse } from 'next';
import { getSystem } from '@/lib/system';

// GET /api/trending?n=10
// Returns the top-n queries ranked by their current exponentially-decayed score.
// This is always the recency-aware (enhanced) ranking — call /api/suggest for basic.
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const n = Math.min(50, Math.max(1, parseInt((req.query.n as string) ?? '10', 10) || 10));
  const top = getSystem().trending.getTopTrending(n);

  return res.status(200).json({
    trending: top.map((t) => ({ query: t.query, count: t.rawCount })),
  });
}
