# PRD: Search Typeahead System

## How to read this document

This PRD is written for viva defense, not just for building. Every non-trivial design choice follows the same pattern: **what we build, why it works, the alternative we rejected and why, and the trade-off we accept.** Section 11 of the assignment treats "cannot explain a design choice" as plagiarism even when the code runs, so the rationale below is the actual deliverable. The Viva Defense Quick Reference at the end condenses the likely questions into one-line answers. If you can reproduce the reasoning in sections 4 to 7 in your own words, you can defend the system.

---

## 1. Overview and goals

Build a search typeahead system that suggests popular queries as the user types, records submitted searches, and keeps suggestions fast and fresh under write pressure. The graded focus is backend data-system design: how query-count data is stored, how suggestions are served with low latency through a distributed cache, how that cache is partitioned with consistent hashing, and how write pressure is absorbed with batching.

Primary goals:
1. Sub-millisecond-to-low-millisecond prefix suggestions, measured at p95.
2. A distributed cache partitioned by self-implemented consistent hashing, with routing that is inspectable.
3. Recency-aware trending that does not permanently over-rank a query that spiked once.
4. Asynchronous batched writes that decouple write throughput from search rate.

Non-goals: authentication, multi-user accounts, persistence across restarts (the store is rebuilt from the dataset on boot), and production-grade durability. These are out of scope and stated as such so the viva does not drift into them.

---

## 2. Scope

**In scope:** dataset ingestion (100k+ queries with counts), suggestions API, dummy search API, query-count store, distributed cache with consistent hashing, trending (basic and recency-aware), batch writes, a React UI with the required interactions, and a performance report.

**Out of scope:** real network sharding across machines, persistent databases, user auth, ranking personalization, spelling correction. If asked in the viva, the honest answer is that these were deliberately excluded to keep the system runnable locally (a non-functional requirement) while still demonstrating the graded data-system mechanics.

---

## 3. System architecture

Three layers, with a clear read path and write path.

**Layers**
1. **Cache layer (distributed).** N logical cache nodes, each holding `prefix -> top-10 suggestions` with a TTL. A prefix key is owned by exactly one node, chosen by a consistent-hash ring. This is the only layer the suggestion read path touches first.
2. **Primary store (source of truth).** An in-memory query-count map (`query -> count`) plus a trie index for prefix lookup. Queried only on a cache miss.
3. **Write path.** Search submissions land in an in-memory buffer, get aggregated, and are flushed to the primary store in batches by a background worker.

**Read path (GET /suggest?q=prefix)**
1. Normalize the prefix (lowercase, trim).
2. Hash the prefix, walk the ring clockwise to find the owning cache node.
3. Check that node. **Hit:** return the cached top-10. **Miss:** query the trie for the node's top-10 completions, write them into the owning node with a TTL, return them.

**Write path (POST /search)**
1. Normalize the query, enqueue it in the write buffer, return `{ "message": "Searched" }` immediately. The response never blocks on a store write.
2. A background flusher drains the buffer on a size threshold or a time interval (whichever fires first), aggregates duplicate queries into single increments, and applies them to the primary store.
3. Affected prefix cache entries are invalidated so updated counts surface within one TTL window at most.

**Why three layers and not a single store:** the assignment explicitly requires a cache that sits in front of the primary store and is distributed by consistent hashing, separate from where counts are durably maintained. Folding cache and store into one structure would hide the routing the `GET /cache/debug` endpoint must expose, and would couple read latency to write contention. The trade-off is added complexity (cache invalidation, eventual consistency between buffer and store), which is acceptable because the eventual-consistency window is bounded by the flush interval plus the cache TTL and the assignment only requires updates to be reflected "eventually."

### 3.1 Recommended stack

Node with TypeScript for the backend (Express or Fastify) and React for the UI; a single full-stack Next.js app is an acceptable alternative. The N cache nodes are plain in-process objects, each owning its own map and TTL bookkeeping, placed on one consistent-hash ring.

**Why in-process cache nodes rather than multiple Redis instances:** logical in-process nodes keep the system runnable with one command (an explicit non-functional requirement), and they make the ring, the ownership decision, and the `/cache/debug` routing fully visible and trivial to instrument. **Alternative rejected:** Redis Cluster, because its sharding hides consistent hashing inside Redis, leaving the debug endpoint nothing to report and removing the exact logic being graded. **Trade-off:** in-process nodes do not exercise real network partitioning or cross-machine failure, but the graded artifact is the ownership and remapping logic, which they reproduce faithfully. If a network demonstration is wanted later, each logical node can be swapped for a separate Redis instance behind the same ring with no change to the routing code.

---

## 4. Data model and suggestion index

**Primary store:** a hash map `query -> count`. This is the source of truth for popularity.

**Prefix index:** a trie (prefix tree). Each node caches a precomputed list of its top-10 completions by count. To answer a prefix, walk the trie to the node for that prefix (O(p), p = prefix length) and read its cached top-10 (O(1)).

**Why a trie with cached top-k:** prefix lookup cost depends on prefix length, not on dataset size, which is what keeps p95 flat as the dataset grows past 100k. **Alternative rejected:** scanning all queries and filtering by prefix is O(n) per request and collapses under 100k+ rows. **Alternative rejected:** a sorted query list with binary search finds the prefix range in O(log n) but still requires sorting the matched range by count on every request; the trie pays that sort cost once at build time and amortizes it. **Trade-off accepted:** the trie uses more memory than a flat map, and each count update must refresh the cached top-10 along the affected path. This is acceptable because updates arrive batched (section 6), so top-k maintenance is amortized across a batch rather than paid per search.

**Handling edge cases (functional requirement 4.1):** empty or missing input returns an empty list, not an error; mixed-case input is normalized before lookup so "IPH" and "iph" hit the same node; a prefix with no completions returns an empty list and the UI renders an empty state. All four cases are handled at the normalization boundary so the lookup code stays simple.

---

## 5. Caching and consistent hashing

**Cache contents:** each logical node stores `prefix -> { suggestions, expiresAt }`. The suggestion read path checks the owning node first and only falls back to the trie on a miss, satisfying the "cache before primary store" requirement.

**Ownership via a consistent-hash ring with virtual nodes.** Each physical cache node is hashed to many points on a 32-bit ring (for example 150 virtual nodes per physical node). To find the owner of a prefix, hash the prefix and walk clockwise to the first virtual node; its physical node owns the key.

**Why consistent hashing rather than modulo (`hash(prefix) % N`):** with modulo, changing N (adding or removing a node) remaps almost every key at once, which would invalidate the entire cache in one step (a stampede against the primary store). Consistent hashing only remaps the keys in the arc between the changed node and its predecessor, roughly 1/N of keys. **Why virtual nodes:** hashing each physical node to a single ring point leaves large uneven gaps, so load is lopsided and a node change shifts one big contiguous arc; spreading each node across many virtual points evens out both the load distribution and the remapped fraction. **Trade-off accepted:** the ring costs more memory and a binary search per lookup (O(log V) over virtual nodes) versus modulo's O(1), which is negligible against the stampede it prevents. **Hash function:** a fast non-cryptographic 32-bit hash is sufficient because we need uniform distribution, not collision resistance; a cryptographic hash would add cost for no benefit here.

**TTL and invalidation:** every cache entry carries an expiry so stale suggestions do not live forever (required), and entries for a prefix are explicitly invalidated when a batch flush changes counts under that prefix. This bounds staleness to min(TTL, time-to-next-flush).

**GET /cache/debug?prefix=X** returns the owning node id and whether X is currently a hit or a miss on that node. This is the visibility that justifies implementing the ring ourselves rather than delegating to a cluster: the routing decision is ours to report.

---

## 6. Trending searches

The system serves suggestions in two selectable modes so the difference can be demonstrated with the same `GET /suggest` API (an explicit requirement). A mode flag selects between them.

**Basic mode (60% of marks).** Rank by all-time count, read straight from the trie's cached top-k. Historically popular queries appear first.

**Enhanced mode (20% of marks): recency-aware via exponential time decay.** Each query keeps a decayed score `S` and a last-update timestamp `t_last`. On a new search at `t_now`:

```
elapsed = t_now - t_last
S = S * exp(-lambda * elapsed) + 1
t_last = t_now
```

`lambda = ln(2) / half_life`. The half-life is the knob: with a one-hour half-life, a query's accumulated score loses half its weight every hour without new searches. For ranking, candidates are decayed to the current time before comparison so they are scored on the same clock.

The five explanations the assignment requires, answered directly:
1. **How recent searches are tracked:** per-query decayed score plus last-update timestamp, updated lazily on each search (no background sweep needed).
2. **How recency affects ranking:** enhanced mode ranks by the decayed score instead of the raw count, so recent activity lifts a query.
3. **How permanent over-ranking is avoided:** the decay term shrinks a past burst geometrically, so a query that spiked once falls out of trending within a few half-lives unless searches keep arriving. Raw count never decays, which is exactly why basic mode over-ranks stale spikes and enhanced mode does not.
4. **How the cache is updated when rankings change:** trending entries use a short TTL and are recomputed on expiry, so ranking shifts propagate within one TTL window.
5. **Trade-offs (freshness vs latency vs complexity):** a shorter half-life and shorter TTL make trending fresher but trigger more frequent recomputation and cache churn; a longer one is cheaper but laggier. Exponential decay adds timestamp tracking and decay math over plain counting, which is the complexity cost paid for freshness without storing full time-series history.

**Required demo artifact:** drive a query to spike then go quiet, and log both rankings. It stays near the top in basic mode indefinitely and decays out in enhanced mode; that side-by-side log is the evidence the rubric asks for.

---

## 7. Batch writes

**Mechanism.** `POST /search` enqueues the normalized query into an in-memory buffer and returns immediately. A background flusher drains the buffer when it reaches a configurable batch size or when a configurable interval elapses, whichever comes first. Before writing, duplicate queries in the buffer are aggregated into a single increment, so fifty searches for the same query become one `+50` write to the primary store.

**Why asynchronous and aggregated:** writing to the store synchronously on every search makes write QPS equal to search QPS and adds store latency to the search response. Buffering decouples write throughput from request rate, and aggregation collapses many writes into one, which is the write-reduction the performance report must quantify. **Trade-off accepted (the failure mode the assignment asks about):** queries buffered but not yet flushed are lost if the process crashes before a flush. This is a durability-versus-throughput choice. Two defensible positions: (a) accept the loss because popularity ranking is statistical and tolerates dropping a small recent window, or (b) append each batch to a write-ahead log before acking so a crash can replay it, trading some throughput for durability. The default is (a) for the demo; (b) is the named mitigation. Be ready to argue whichever you ship.

**Configuration:** batch size and flush interval are config values, not constants, so the report can show write counts at different settings.

---

## 8. API specification

| Endpoint | Request | Response | Internal flow |
|---|---|---|---|
| `GET /suggest?q=<prefix>` | prefix string | up to 10 suggestions, sorted by the active mode's score | normalize, ring-route to owning cache node, hit returns cached list, miss queries trie and populates the node with TTL |
| `POST /search` | `{ "query": "<text>" }` | `{ "message": "Searched" }` | normalize, enqueue to write buffer, return without waiting for flush |
| `GET /cache/debug?prefix=<prefix>` | prefix string | `{ "node": "<id>", "status": "hit" \| "miss" }` | ring-route the prefix, report owning node and current presence on it |

Suggestions never start a synchronous store write, and submissions never block on one; this separation is what the architecture exists to enforce.

---

## 9. Functional requirements

1. Typeahead returns at most 10 prefix-matching suggestions sorted by the active mode's score, and handles empty, missing, mixed-case, and no-match input gracefully.
2. The UI debounces keystrokes so not every character fires a backend call.
3. Search submission returns the dummy response and enqueues a count update; a new query is inserted with an initial count, an existing one is incremented; the update is eventually reflected in suggestions and trending.
4. The suggestion flow consults the distributed cache before the primary store.
5. Cache entries expire on a TTL and are invalidated when a flush changes their prefix.
6. Consistent hashing decides cache ownership, and ownership is inspectable via `/cache/debug`.
7. Trending is available in basic and enhanced modes behind the same suggestion API.
8. Search-count writes are buffered, aggregated, and flushed in batches.

---

## 10. UI requirements

A search input box; a suggestion dropdown that updates as the user types (debounced); submission on Enter or a search button; display of the dummy search response; a trending searches section; explicit loading and error states; basic keyboard navigation (arrow keys to move through suggestions, Enter to select); and a clean, usable layout. The UI calls only the three documented endpoints and holds no business logic, so the data-system behavior stays server-side where it is graded.

---

## 11. Non-functional requirements and metrics

The performance report must include:
1. **Latency:** suggestion-API latency distribution, p95 reported explicitly.
2. **Cache hit rate:** hits / (hits + misses) over a run.
3. **Write reduction:** store writes without batching versus with batching and aggregation, at one or more batch-size settings.
4. **Consistent-hashing behavior:** logs showing which node served which prefix and the key distribution across nodes, so the routing is demonstrable, not asserted.

Code is modular, readable, and documented; the system runs locally with a single setup path.

---

## 12. Milestones

1. Ingest the dataset and build the trie-backed suggestion API (basic mode).
2. Build the React search box and dropdown against the suggestion API.
3. Add `POST /search` with the buffered count-update path.
4. Add the N-node cache with the consistent-hash ring and `/cache/debug`.
5. Add enhanced trending (time decay) behind the mode flag.
6. Add batch flushing with aggregation and configurable size/interval.
7. Instrument metrics, run the report, record the demo.

This mirrors the assignment's suggested order so each milestone maps to a gradable slice.

---

## 13. Success criteria (rubric alignment)

| Component | Marks | Done when |
|---|---|---|
| Basic implementation | 60 | dataset ingested, search UI working, suggestions and search APIs live, query-count store correct, distributed cache routed by self-implemented consistent hashing |
| Trending searches | 20 | recency-aware ranking implemented with a clear scoring and decay rule, basic-vs-enhanced difference demonstrated with logs |
| Batch writes | 20 | buffering, aggregation, and flushing implemented, write reduction measured, crash failure trade-off articulated |

---

## 14. Risks and failure modes

1. **Lost buffered writes on crash.** Accepted by default; mitigated optionally with a write-ahead log. (Section 7.)
2. **Stale cache after a count change.** Bounded by TTL plus explicit invalidation on flush. (Section 5.)
3. **Uneven cache load.** Mitigated by virtual nodes on the ring. (Section 5.)
4. **Top-k drift after updates.** The cached top-10 is refreshed along the affected trie path on flush, amortized per batch. (Section 4.)

---

## 15. Viva defense quick reference

| Likely question | One-line answer |
|---|---|
| Why a trie for suggestions? | Prefix lookup is O(prefix length), independent of dataset size, with top-10 cached per node for O(1) reads. |
| Why not scan and filter? | O(n) per request, collapses past 100k rows. |
| Why consistent hashing not modulo? | Modulo remaps nearly all keys on a node change (a stampede); consistent hashing remaps only about 1/N. |
| Why virtual nodes? | They even out load distribution and shrink the remapped fraction on node changes. |
| Why a non-cryptographic hash? | We need uniform distribution, not collision resistance; crypto would add cost for no benefit. |
| How does the cache front the store? | Reads check the ring-owned node first and only fall back to the trie on a miss. |
| How is staleness bounded? | TTL on every entry plus explicit invalidation when a flush changes the prefix's counts. |
| How does enhanced trending avoid permanent over-ranking? | Exponential time decay shrinks past bursts geometrically; raw count never decays, which is why basic mode over-ranks and enhanced does not. |
| What is the recency formula? | S = S * exp(-lambda * elapsed) + 1 on each search, lambda = ln(2)/half_life. |
| Why batch writes? | They decouple write throughput from search rate, and aggregation collapses many writes into one. |
| What happens on crash before flush? | Unflushed buffered counts are lost; a durability-versus-throughput trade-off, optionally mitigated by a write-ahead log. |
| Why in-process cache nodes not Redis Cluster? | Cluster hides the consistent hashing the assignment grades and the debug endpoint must expose; in-process nodes keep it visible and runnable with one command. |
