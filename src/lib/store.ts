import { Trie, Suggestion } from './trie';

// Primary store: source of truth for query counts.
// Backed by a hash map for O(1) count updates and a trie for O(prefix_length) prefix lookups.
export class PrimaryStore {
  private queryMap = new Map<string, number>(); // query -> raw count
  readonly trie = new Trie();

  build(entries: Array<{ query: string; count: number }>): void {
    for (const { query, count } of entries) {
      this.queryMap.set(query, count);
    }
    this.trie.build(entries);
    console.log(`[Store] Built with ${this.queryMap.size} queries`);
  }

  // Apply a batch of {query -> delta} increments.
  // Returns the set of queries actually updated (for cache invalidation).
  applyBatch(batch: Map<string, number>): string[] {
    const updated: string[] = [];
    for (const [query, delta] of batch) {
      const prev = this.queryMap.get(query) ?? 0;
      const next = prev + delta;
      this.queryMap.set(query, next);
      this.trie.upsert(query, next, 'absolute');
      updated.push(query);
    }
    return updated;
  }

  getSuggestions(prefix: string, k = 10): Suggestion[] {
    return this.trie.getSuggestions(prefix, k);
  }

  getCount(query: string): number {
    return this.queryMap.get(query) ?? 0;
  }

  get queryCount(): number { return this.queryMap.size; }
}
