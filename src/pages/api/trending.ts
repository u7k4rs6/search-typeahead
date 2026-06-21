import type { NextApiRequest, NextApiResponse } from 'next';
import { getSystem } from '@/lib/system';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const sys = getSystem();
    const modeParam = req.query.mode as string | undefined;
    const mode = modeParam === 'enhanced' ? 'enhanced' : modeParam === 'basic' ? 'basic' : sys.mode;

    if (mode === 'enhanced') {
      const top = sys.trending.getTopTrending(10);
      return res.status(200).json({
        mode,
        trending: top.map((t) => ({
          query: t.query,
          score: Math.round(t.score * 100) / 100,
          count: t.rawCount,
        })),
      });
    } else {
      // Basic mode: use all-time top suggestions for empty prefix
      const top = sys.store.getSuggestions('', 10);
      return res.status(200).json({
        mode,
        trending: top.map((t) => ({ query: t.query, count: t.count, score: null })),
      });
    }
  }

  if (req.method === 'POST') {
    // Allow changing the active mode
    const { mode } = req.body ?? {};
    if (mode !== 'basic' && mode !== 'enhanced') {
      return res.status(400).json({ error: 'mode must be "basic" or "enhanced"' });
    }
    getSystem().setMode(mode);
    return res.status(200).json({ mode });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
