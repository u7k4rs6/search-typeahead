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
  mode: 'basic' | 'enhanced';
  setMode: (m: 'basic' | 'enhanced') => void;
  config: {
    nNodes: number;
    vnodes: number;
    cacheTtlMs: number;
    batchSize: number;
    flushIntervalMs: number;
    halfLifeMs: number;
  };
}

// Config knobs — change these to see effect on write-reduction and cache behavior.
const CONFIG = {
  nNodes: 5,
  vnodes: 150,
  cacheTtlMs: 30_000,    // 30 seconds
  batchSize: 50,
  flushIntervalMs: 5_000, // 5 seconds
  halfLifeMs: 3_600_000,  // 1 hour trending half-life
};

function buildSystem(): TypeaheadSystem {
  console.log('[System] Initializing...');
  const t0 = Date.now();

  // 1. Generate and ingest dataset
  const dataset = generateDataset();

  // 2. Build primary store
  const store = new PrimaryStore();
  store.build(dataset);

  // 3. Consistent-hash ring over N logical cache nodes
  const nodeIds = Array.from({ length: CONFIG.nNodes }, (_, i) => `node-${i}`);
  const ring = new ConsistentHashRing(nodeIds, CONFIG.vnodes);
  console.log('[System] Ring distribution:', ring.getVnodeDistribution());

  // 4. Distributed cache (in-process nodes, routed by the ring)
  const cache = new DistributedCache(ring, CONFIG.cacheTtlMs);

  // 5. Trending manager
  const trending = new TrendingManager(CONFIG.halfLifeMs);

  // 6. Metrics
  const metrics = new MetricsCollector();

  // 7. Write buffer with flush callback
  const buffer = new WriteBuffer({
    batchSize: CONFIG.batchSize,
    flushIntervalMs: CONFIG.flushIntervalMs,
    onFlush: (batch) => {
      // Apply count updates to the primary store
      const updated = store.applyBatch(batch);
      // Update trending scores
      for (const [query, delta] of batch) {
        trending.update(query, delta);
      }
      // Invalidate cache entries for every prefix of every updated query
      for (const query of updated) {
        for (let i = 1; i <= query.length; i++) {
          cache.invalidate(query.slice(0, i));
        }
      }
      console.log(
        `[Flush] ${updated.length} queries updated. Cache invalidated ${updated.reduce((s, q) => s + q.length, 0)} prefix entries.`
      );
    },
  });

  console.log(`[System] Ready in ${Date.now() - t0}ms. ${store.queryCount} queries indexed.`);

  let currentMode: 'basic' | 'enhanced' = 'basic';

  return {
    store,
    cache,
    trending,
    buffer,
    metrics,
    ring,
    get mode() { return currentMode; },
    setMode(m) { currentMode = m; },
    config: { ...CONFIG },
  };
}

// Singleton: persists across Next.js hot reloads in development via global.
declare global {
  // eslint-disable-next-line no-var
  var __typeaheadSystem: TypeaheadSystem | undefined;
}

export function getSystem(): TypeaheadSystem {
  if (!global.__typeaheadSystem) {
    global.__typeaheadSystem = buildSystem();
  }
  return global.__typeaheadSystem;
}
