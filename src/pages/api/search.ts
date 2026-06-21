import type { NextApiRequest, NextApiResponse } from 'next';
import { getSystem } from '@/lib/system';

// POST /api/search  body: { query: string }
// Normalizes the query, enqueues it in the write buffer, and returns immediately.
// The count update is asynchronous — no flush waits on this response.
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { query } = req.body ?? {};
  if (typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({ error: 'query field required' });
  }

  const normalized = query.toLowerCase().trim();
  getSystem().buffer.enqueue(normalized);

  return res.status(200).json({ message: 'Searched' });
}
