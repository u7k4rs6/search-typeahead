import type { NextApiRequest, NextApiResponse } from 'next';
import { getSystem } from '@/lib/system';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { query } = req.body ?? {};
  if (typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({ error: 'query field required' });
  }

  const normalized = query.toLowerCase().trim();
  const sys = getSystem();

  // Enqueue to write buffer — returns immediately, write is async.
  sys.buffer.enqueue(normalized);

  return res.status(200).json({ message: 'Searched', query: normalized });
}
