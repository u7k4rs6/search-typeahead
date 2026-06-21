import type { NextApiRequest, NextApiResponse } from 'next';
import { getSystem } from '@/lib/system';

// GET /api/cache/debug?prefix=<prefix>
// Ring-routes the prefix and reports which node owns it and whether the key is cached.
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const prefix = ((req.query.prefix as string) ?? '').toLowerCase().trim();
  if (!prefix) return res.status(400).json({ error: 'prefix required' });

  const { nodeId, status } = getSystem().cache.debug(prefix);
  return res.status(200).json({ node: nodeId, status });
}
