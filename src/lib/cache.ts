import { ConsistentHashRing } from './hashring';
import { Suggestion } from './trie';

interface CacheEntry {
  suggestions: Suggestion[];
  expiresAt: number;
}

// One logical in-process cache node (owns a portion of the key space).
export class CacheNode {
  readonly id: string;
  private store = new Map<string, CacheEntry>();
  private hits = 0;
  private misses = 0;

  constructor(id: string) {
    this.id = id;
  }

  get(key: string): Suggestion[] | null {
    const entry = this.store.get(key);
    if (!entry) { this.misses++; return null; }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.misses++;
      return null;
    }
    this.hits++;
    return entry.suggestions;
  }

  set(key: string, suggestions: Suggestion[], ttlMs: number): void {
    this.store.set(key, { suggestions, expiresAt: Date.now() + ttlMs });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  has(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) { this.store.delete(key); return false; }
    return true;
  }

  get keyCount(): number { return this.store.size; }
  get hitCount(): number { return this.hits; }
  get missCount(): number { return this.misses; }

  resetStats(): void { this.hits = 0; this.misses = 0; }
}

// Distributed cache: consistent-hash ring routes each prefix to exactly one CacheNode.
export class DistributedCache {
  readonly nodes: Map<string, CacheNode>;
  readonly ring: ConsistentHashRing;
  readonly ttlMs: number;
  private totalHits = 0;
  private totalMisses = 0;

  constructor(ring: ConsistentHashRing, ttlMs: number) {
    this.ring = ring;
    this.ttlMs = ttlMs;
    this.nodes = new Map();
    for (const id of ring.getNodes()) {
      this.nodes.set(id, new CacheNode(id));
    }
  }

  private getOwner(prefix: string): CacheNode {
    const nodeId = this.ring.getNode(prefix);
    return this.nodes.get(nodeId)!;
  }

  get(prefix: string): Suggestion[] | null {
    const result = this.getOwner(prefix).get(prefix);
    if (result) this.totalHits++; else this.totalMisses++;
    return result;
  }

  set(prefix: string, suggestions: Suggestion[]): void {
    this.getOwner(prefix).set(prefix, suggestions, this.ttlMs);
  }

  // Invalidate a specific prefix entry (called on batch flush for affected prefixes).
  invalidate(prefix: string): void {
    this.getOwner(prefix).delete(prefix);
  }

  // Used by GET /cache/debug
  debug(prefix: string): { nodeId: string; status: 'hit' | 'miss' } {
    const nodeId = this.ring.getNode(prefix);
    const node = this.nodes.get(nodeId)!;
    return { nodeId, status: node.has(prefix) ? 'hit' : 'miss' };
  }

  get hitRate(): number {
    const total = this.totalHits + this.totalMisses;
    return total === 0 ? 0 : this.totalHits / total;
  }

  get stats() {
    const perNode: Record<string, number> = {};
    for (const [id, node] of this.nodes) perNode[id] = node.keyCount;
    return {
      totalHits: this.totalHits,
      totalMisses: this.totalMisses,
      hitRate: Math.round(this.hitRate * 10000) / 100,
      vnodeDistribution: this.ring.getVnodeDistribution(),
      perNodeKeyCount: perNode,
    };
  }

  resetStats(): void {
    this.totalHits = 0;
    this.totalMisses = 0;
    for (const node of this.nodes.values()) node.resetStats();
  }
}
