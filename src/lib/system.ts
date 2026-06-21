import { PrimaryStore } from './store';
import { ConsistentHashRing } from './hashring';
import { DistributedCache } from './cache';
import { TrendingManager } from './trending';
import { WriteBuffer } from './writebuffer';
import { MetricsCollector } from './metrics';
import { generateDataset } from './dataset';

export interface TypeaheadSystem {
  store: PrimaryStore;
  cache: DistributedCache;
  trending: TrendingManager;
  buffer: WriteBuffer;
  metrics: MetricsCollector;
  ring: ConsistentHashRing;
  config: {
    nNodes: number;
    vnodes: number;
    cacheTtlMs: number;
    batchSize: number;
    flushIntervalMs: number;
    halfLifeMs: number;
  };
}

// Tuneable knobs — changing these changes the demo numbers.
const CONFIG = {
  nNodes: 5,
  vnodes: 150,
  cacheTtlMs: 30_000,     // 30 s
  batchSize: 50,           // size-trigger: flush when this many unique queries are buffered
  flushIntervalMs: 5_000,  // time-trigger: flush at least every 5 s
  halfLifeMs: 3_600_000,   // trending half-life: 1 hour
};

function buildSystem(): TypeaheadSystem {
  console.log('[System] Initializing…');
  const t0 = Date.now();

  // 1. Dataset → primary store (trie + count map)
  const store = new PrimaryStore();
  store.build(generateDataset());

  // 2. Consistent-hash ring over N logical in-process cache nodes
  const nodeIds = Array.from({ length: CONFIG.nNodes }, (_, i) => `node-${i}`);
  const ring = new ConsistentHashRing(nodeIds, CONFIG.vnodes);
  console.log('[System] Ring vnode distribution:', ring.getVnodeDistribution());

  // 3. Distributed cache (prefix → owning node, ring-routed)
  const cache = new DistributedCache(ring, CONFIG.cacheTtlMs);

  // 4. Trending manager (exponential-decay scores per query)
  const trending = new TrendingManager(CONFIG.halfLifeMs);

  // 5. Metrics collector (latency samples → percentiles)
  const metrics = new MetricsCollector();

  // 6. Write buffer: enqueues are synchronous, flushes are background
  const buffer = new WriteBuffer({
    batchSize: CONFIG.batchSize,
    flushIntervalMs: CONFIG.flushIntervalMs,
    onFlush(batch) {
      // Apply to store (trie + map), update decay scores, evict stale cache entries
      const updated = store.applyBatch(batch);
      for (const [query, delta] of batch) trending.update(query, delta);
      // Invalidate every prefix of every changed query
      for (const query of updated) {
        for (let i = 1; i <= query.length; i++) cache.invalidate(query.slice(0, i));
      }
      console.log(`[Flush] ${updated.length} queries → store. ${updated.reduce((s, q) => s + q.length, 0)} cache entries evicted.`);
    },
  });

  console.log(`[System] Ready in ${Date.now() - t0} ms — ${store.queryCount.toLocaleString()} queries indexed.`);
  return { store, cache, trending, buffer, metrics, ring, config: { ...CONFIG } };
}

// Persist the instance on globalThis so Next.js hot-reload does not re-ingest the dataset.
declare global {
  // eslint-disable-next-line no-var
  var __typeaheadSystem: TypeaheadSystem | undefined;
}

export function getSystem(): TypeaheadSystem {
  if (!global.__typeaheadSystem) global.__typeaheadSystem = buildSystem();
  return global.__typeaheadSystem;
}
