import { Suggestion } from './trie';

interface TrendingEntry {
  score: number;       // exponentially decayed score
  lastUpdated: number; // ms timestamp
  rawCount: number;    // mirroring store count, for basic-mode sort
}

// Manages per-query exponential-decay trending scores.
// Formula (on each search): S = S * exp(-lambda * elapsed) + 1
// lambda = ln(2) / half_life  →  score halves every `halfLifeMs` ms of inactivity.
export class TrendingManager {
  private scores = new Map<string, TrendingEntry>();
  private readonly lambda: number;

  constructor(halfLifeMs = 3_600_000) { // default 1 hour
    this.lambda = Math.LN2 / halfLifeMs;
  }

  // Called when a query is searched (delta = how many times in this batch).
  update(query: string, delta = 1): void {
    const now = Date.now();
    const entry = this.scores.get(query);
    if (!entry) {
      this.scores.set(query, { score: delta, lastUpdated: now, rawCount: delta });
    } else {
      const elapsed = now - entry.lastUpdated;
      const decayed = entry.score * Math.exp(-this.lambda * elapsed);
      entry.score = decayed + delta;
      entry.lastUpdated = now;
      entry.rawCount += delta;
    }
  }

  // Get the current decayed score for a query (decayed to now without updating).
  getScore(query: string): number {
    const entry = this.scores.get(query);
    if (!entry) return 0;
    const elapsed = Date.now() - entry.lastUpdated;
    return entry.score * Math.exp(-this.lambda * elapsed);
  }

  // Re-rank a list of basic suggestions by their decayed score.
  // Queries with no trending entry keep their basic order at the bottom.
  rerank(suggestions: Suggestion[]): Suggestion[] {
    const scored = suggestions.map((s) => ({
      ...s,
      trendScore: this.getScore(s.query),
    }));
    scored.sort((a, b) => b.trendScore - a.trendScore || b.count - a.count);
    return scored.map(({ query, count }) => ({ query, count }));
  }

  // Top-K trending queries globally (for the trending section in the UI).
  getTopTrending(k = 10): Array<{ query: string; score: number; rawCount: number }> {
    const now = Date.now();
    const results: Array<{ query: string; score: number; rawCount: number }> = [];
    for (const [query, entry] of this.scores) {
      const elapsed = now - entry.lastUpdated;
      const score = entry.score * Math.exp(-this.lambda * elapsed);
      if (score > 0.01) { // prune effectively-zero scores
        results.push({ query, score, rawCount: entry.rawCount });
      }
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, k);
  }

  get trackedCount(): number { return this.scores.size; }
}
