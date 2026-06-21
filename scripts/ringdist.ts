// scripts/ringdist.ts
// Builds the same consistent-hash ring as the app (5 nodes, 150 vnodes),
// routes every query in the full generated dataset, and reports key distribution.
// Server does NOT need to be running.
// Run: npm run ringdist

import { generateDataset } from '../src/lib/dataset.ts';

// ── Ring (mirrors src/lib/hashring.ts exactly) ────────────────────────────────
function fnv1a32(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  // MurmurHash3 fmix32 finalizer — fixes FNV-1a's weak avalanche on near-identical labels
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

interface RingEntry { position: number; nodeId: string; }

function buildRing(nodeIds: string[], vnodes: number): RingEntry[] {
  const ring: RingEntry[] = [];
  for (const id of nodeIds) {
    for (let v = 0; v < vnodes; v++) {
      ring.push({ position: fnv1a32(`${id}#vnode#${v}`), nodeId: id });
    }
  }
  ring.sort((a, b) => a.position - b.position);
  return ring;
}

function getNode(ring: RingEntry[], key: string): string {
  const pos = fnv1a32(key);
  let lo = 0, hi = ring.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ring[mid].position < pos) lo = mid + 1; else hi = mid;
  }
  if (ring[lo].position < pos) lo = 0;
  return ring[lo].nodeId;
}

// ── Config (must match src/lib/system.ts) ────────────────────────────────────
const NODE_IDS = ['node-0', 'node-1', 'node-2', 'node-3', 'node-4'];
const VNODES = 150;

// ── Build & route ─────────────────────────────────────────────────────────────
console.log(`Ring: ${NODE_IDS.length} nodes × ${VNODES} vnodes = ${NODE_IDS.length * VNODES} ring positions\n`);
const ring = buildRing(NODE_IDS, VNODES);

process.stdout.write('Generating dataset... ');
const dataset = generateDataset();  // prints its own count line
console.log(`Routing ${dataset.length.toLocaleString()} keys...`);

const counts: Record<string, number> = {};
for (const id of NODE_IDS) counts[id] = 0;
for (const { query } of dataset) counts[getNode(ring, query)]++;

// ── Stats ──────────────────────────────────────────────────────────────────────
const vals = Object.values(counts);
const total = vals.reduce((a, b) => a + b, 0);
const mean = total / vals.length;
const min = Math.min(...vals);
const max = Math.max(...vals);
const stddev = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
const imbalance = max / mean;

console.log('\n=== Ring key distribution (full dataset) ===\n');
for (const [node, count] of Object.entries(counts)) {
  const pct = ((count / total) * 100).toFixed(2);
  const bar = '█'.repeat(Math.round((count / max) * 40));
  console.log(`  ${node}: ${count.toLocaleString().padStart(7)}  (${pct}%)  ${bar}`);
}

console.log(`
  total   : ${total.toLocaleString()}
  mean    : ${mean.toFixed(0)}
  min     : ${min.toLocaleString()}
  max     : ${max.toLocaleString()}
  std dev : ${stddev.toFixed(0)}  (${((stddev / mean) * 100).toFixed(1)}% of mean)
  imbalance: ${imbalance.toFixed(4)}×  (max/mean; 1.0 = perfect, <1.05 is excellent)`);
