// FNV-1a 32-bit hash — fast, non-cryptographic, good uniform distribution.
function fnv1a32(str: string): number {
  let hash = 2166136261; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    // Math.imul gives 32-bit integer multiplication without BigInt overhead
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

interface RingEntry {
  position: number; // 0 .. 2^32-1
  nodeId: string;
}

export interface NodeDistribution {
  [nodeId: string]: number; // number of virtual node slots owned
}

export class ConsistentHashRing {
  private ring: RingEntry[] = [];
  private nodeIds: string[] = [];
  readonly vnodes: number;

  constructor(nodeIds: string[], vnodes = 150) {
    this.vnodes = vnodes;
    for (const id of nodeIds) {
      this.addNode(id);
    }
  }

  addNode(nodeId: string): void {
    if (this.nodeIds.includes(nodeId)) return;
    this.nodeIds.push(nodeId);
    for (let v = 0; v < this.vnodes; v++) {
      const pos = fnv1a32(`${nodeId}#vnode#${v}`);
      this.ring.push({ position: pos, nodeId });
    }
    this.ring.sort((a, b) => a.position - b.position);
  }

  removeNode(nodeId: string): void {
    this.nodeIds = this.nodeIds.filter((id) => id !== nodeId);
    this.ring = this.ring.filter((e) => e.nodeId !== nodeId);
  }

  // Find the cache node that owns `key` by walking clockwise on the ring.
  getNode(key: string): string {
    if (this.ring.length === 0) throw new Error('Ring is empty');
    const keyPos = fnv1a32(key);
    // Binary search for first entry with position >= keyPos
    let lo = 0;
    let hi = this.ring.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.ring[mid].position < keyPos) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    // If all positions are smaller than keyPos, wrap around to index 0
    if (this.ring[lo].position < keyPos) {
      lo = 0;
    }
    return this.ring[lo].nodeId;
  }

  getNodes(): string[] {
    return [...this.nodeIds];
  }

  // Returns how many virtual-node slots each physical node owns.
  getVnodeDistribution(): NodeDistribution {
    const dist: NodeDistribution = {};
    for (const id of this.nodeIds) dist[id] = 0;
    for (const entry of this.ring) dist[entry.nodeId]++;
    return dist;
  }

  // For debug: show which node owns a given set of keys.
  resolveKeys(keys: string[]): Record<string, string> {
    const result: Record<string, string> = {};
    for (const k of keys) result[k] = this.getNode(k);
    return result;
  }
}
