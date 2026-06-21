export interface Suggestion {
  query: string;
  count: number;
}

interface TrieNode {
  children: Map<string, TrieNode>;
  isEnd: boolean;
  query: string;   // full query string, set when isEnd=true
  count: number;   // raw search count, set when isEnd=true
  topK: Suggestion[]; // cached top-10 completions for this prefix
}

export class Trie {
  private root: TrieNode = this.makeNode();

  private makeNode(): TrieNode {
    return { children: new Map(), isEnd: false, query: '', count: 0, topK: [] };
  }

  // Insert a query without refreshing topK (use during bulk build)
  private insertRaw(query: string, count: number): void {
    let node = this.root;
    for (const ch of query) {
      if (!node.children.has(ch)) {
        node.children.set(ch, this.makeNode());
      }
      node = node.children.get(ch)!;
    }
    node.isEnd = true;
    node.query = query;
    node.count = count;
  }

  // Post-order traversal to compute topK for every node.
  // Each node's topK = top-10 of: {self if isEnd} + {all children's topK lists}.
  // Children are refreshed before parents, so their topK is ready for merging.
  private computeTopKAll(node: TrieNode): void {
    for (const child of node.children.values()) {
      this.computeTopKAll(child);
    }
    this.refreshTopK(node);
  }

  private refreshTopK(node: TrieNode): void {
    const candidates: Suggestion[] = [];
    if (node.isEnd) {
      candidates.push({ query: node.query, count: node.count });
    }
    for (const child of node.children.values()) {
      for (const s of child.topK) {
        candidates.push(s);
      }
    }
    candidates.sort((a, b) => b.count - a.count);
    node.topK = candidates.slice(0, 10);
  }

  // Build the trie from a bulk list and compute all topK in one pass.
  build(entries: Array<{ query: string; count: number }>): void {
    for (const { query, count } of entries) {
      this.insertRaw(query, count);
    }
    this.computeTopKAll(this.root);
  }

  // Insert or update a single query and refresh topK along the path (bottom-up).
  upsert(query: string, deltaOrAbsolute: number, mode: 'delta' | 'absolute' = 'delta'): void {
    let node = this.root;
    const path: TrieNode[] = [node];
    for (const ch of query) {
      if (!node.children.has(ch)) {
        node.children.set(ch, this.makeNode());
      }
      node = node.children.get(ch)!;
      path.push(node);
    }
    if (mode === 'delta') {
      node.count += deltaOrAbsolute;
    } else {
      node.count = deltaOrAbsolute;
    }
    node.isEnd = true;
    node.query = query;
    // Refresh topK from leaf to root
    for (let i = path.length - 1; i >= 0; i--) {
      this.refreshTopK(path[i]);
    }
  }

  // Return top-k suggestions for a given prefix (O(prefix_length) lookup).
  getSuggestions(prefix: string, k = 10): Suggestion[] {
    let node = this.root;
    for (const ch of prefix) {
      if (!node.children.has(ch)) return [];
      node = node.children.get(ch)!;
    }
    return node.topK.slice(0, k);
  }

  getCount(query: string): number {
    let node = this.root;
    for (const ch of query) {
      if (!node.children.has(ch)) return 0;
      node = node.children.get(ch)!;
    }
    return node.isEnd ? node.count : 0;
  }

  // Number of unique queries indexed
  get size(): number {
    let count = 0;
    const traverse = (node: TrieNode) => {
      if (node.isEnd) count++;
      for (const child of node.children.values()) traverse(child);
    };
    traverse(this.root);
    return count;
  }
}
