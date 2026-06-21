import { useState, useEffect, useRef, useCallback, KeyboardEvent } from 'react';
import Head from 'next/head';

// ── Types matching the API response shapes ────────────────────────────────────
interface Suggestion { query: string; count: number; }
interface DebugInfo   { source: string; node: string; latencyMs: number; }
interface TrendItem   { query: string; count: number; }
interface Metrics {
  latency:     { p50Ms: number; p95Ms: number; p99Ms: number; meanMs: number; samples: number };
  cache:       { hitRate: number; totalHits: number; totalMisses: number };
  writeBuffer: { pendingQueries: number; totalEnqueued: number; totalFlushed: number; flushCount: number };
}

const DEBOUNCE_MS = 150;

export default function Home() {
  // ── Search state ────────────────────────────────────────────────────────────
  const [query,       setQuery]       = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [highlighted, setHighlighted] = useState(-1);    // dropdown keyboard cursor
  const [dropOpen,    setDropOpen]    = useState(false);
  const [sugLoading,  setSugLoading]  = useState(false);
  const [sugError,    setSugError]    = useState<string | null>(null);
  const [lastDebug,   setLastDebug]   = useState<DebugInfo | null>(null);

  // ── Search-submission state ──────────────────────────────────────────────────
  const [searchMsg,   setSearchMsg]   = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  // ── Mode (only affects /api/suggest; trending is always enhanced) ───────────
  const [mode, setMode] = useState<'basic' | 'enhanced'>('basic');

  // ── Trending state ──────────────────────────────────────────────────────────
  const [trending,        setTrending]        = useState<TrendItem[]>([]);
  const [trendingLoading, setTrendingLoading] = useState(false);
  const [trendingError,   setTrendingError]   = useState<string | null>(null);

  // ── Metrics state ───────────────────────────────────────────────────────────
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  // ── Refs ────────────────────────────────────────────────────────────────────
  const inputRef   = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef   = useRef<AbortController | null>(null); // cancel in-flight suggest requests

  // ── Fetch suggestions ────────────────────────────────────────────────────────
  const fetchSuggestions = useCallback(async (q: string, m: string) => {
    // Cancel the previous in-flight request before starting a new one.
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    if (!q.trim()) { setSuggestions([]); setDropOpen(false); setSugLoading(false); return; }

    setSugLoading(true);
    setSugError(null);
    try {
      const res  = await fetch(
        `/api/suggest?q=${encodeURIComponent(q)}&mode=${m}`,
        { signal: abortRef.current.signal },
      );
      const data = await res.json();
      setSuggestions(data.suggestions ?? []);
      setLastDebug(data._debug ?? null);
      setDropOpen((data.suggestions ?? []).length > 0);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setSugError('Could not load suggestions');
    } finally {
      setSugLoading(false);
    }
  }, []);

  // Debounced wrapper — cancels the pending timeout on every keystroke.
  const scheduleSearch = useCallback((q: string, m: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(q, m), DEBOUNCE_MS);
  }, [fetchSuggestions]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQuery(v);
    setHighlighted(-1);
    scheduleSearch(v, mode);
  };

  // ── Submit a search ──────────────────────────────────────────────────────────
  const submitSearch = useCallback(async (q: string) => {
    const term = q.trim();
    if (!term) return;
    setDropOpen(false);
    setSuggestions([]);
    setSearchMsg(null);
    setSearchError(null);
    try {
      const res  = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: term }),
      });
      const data = await res.json();
      setSearchMsg(data.message ?? 'Searched');
      setTimeout(() => setSearchMsg(null), 3500);
      fetchTrending();
    } catch {
      setSearchError('Search failed — please try again');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Keyboard navigation ──────────────────────────────────────────────────────
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { setDropOpen(false); setHighlighted(-1); return; }
    if (!dropOpen || suggestions.length === 0) {
      if (e.key === 'Enter') submitSearch(query);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted(i => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted(i => Math.max(i - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlighted >= 0) {
        const sel = suggestions[highlighted].query;
        setQuery(sel);
        setDropOpen(false);
        setSuggestions([]);
        submitSearch(sel);
      } else {
        submitSearch(query);
      }
    }
  };

  const pickSuggestion = (s: Suggestion) => {
    setQuery(s.query);
    setDropOpen(false);
    setSuggestions([]);
    submitSearch(s.query);
    inputRef.current?.focus();
  };

  // ── Mode toggle (only affects /api/suggest ranking) ──────────────────────────
  const switchMode = (m: 'basic' | 'enhanced') => {
    setMode(m);
    if (query.trim()) scheduleSearch(query, m);
  };

  // ── Fetch trending (always enhanced/recency-aware) ───────────────────────────
  const fetchTrending = useCallback(async () => {
    setTrendingLoading(true);
    setTrendingError(null);
    try {
      const res  = await fetch('/api/trending?n=10');
      const data = await res.json();
      setTrending(data.trending ?? []);
    } catch {
      setTrendingError('Could not load trending');
    } finally {
      setTrendingLoading(false);
    }
  }, []);

  // ── Fetch metrics ────────────────────────────────────────────────────────────
  const fetchMetrics = useCallback(async () => {
    try {
      const res  = await fetch('/api/metrics');
      const data = await res.json();
      setMetrics(data);
    } catch { /* non-critical, silently skip */ }
  }, []);

  // ── On mount: load trending + metrics; poll metrics every 5 s ────────────────
  useEffect(() => {
    fetchTrending();
    fetchMetrics();
    const id = setInterval(fetchMetrics, 5_000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Close dropdown on outside click ──────────────────────────────────────────
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.search-wrap')) setDropOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <>
      <Head>
        <title>Search Typeahead</title>
      </Head>

      <div className="app">

        {/* Header */}
        <header className="header">
          <div>
            <h1>Search Typeahead</h1>
            <p>Trie · Consistent Hashing · Batch Writes · Trending</p>
          </div>
          {/* Mode affects only /api/suggest ranking */}
          <div className="mode-toggle" role="group" aria-label="Suggestion ranking mode">
            <button className={`mode-btn${mode === 'basic'    ? ' active' : ''}`} onClick={() => switchMode('basic')}>Basic</button>
            <button className={`mode-btn${mode === 'enhanced' ? ' active' : ''}`} onClick={() => switchMode('enhanced')}>Enhanced</button>
          </div>
        </header>

        {/* Search input + dropdown */}
        <div className="search-wrap">
          <div className="search-row">
            <input
              ref={inputRef}
              className="search-input"
              type="search"
              autoComplete="off"
              spellCheck={false}
              placeholder="Start typing… (↑↓ navigate, Enter select, Esc close)"
              aria-label="Search"
              aria-autocomplete="list"
              aria-expanded={dropOpen}
              value={query}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
            />
            <button
              className="search-btn"
              onClick={() => submitSearch(query)}
              disabled={!query.trim()}
            >
              Search
            </button>
          </div>

          {/* Suggestion dropdown */}
          {dropOpen && suggestions.length > 0 && (
            <ul className="dropdown" role="listbox">
              {suggestions.map((s, i) => (
                <li
                  key={s.query}
                  role="option"
                  aria-selected={i === highlighted}
                  className={`drop-item${i === highlighted ? ' hi' : ''}`}
                  onMouseDown={() => pickSuggestion(s)}
                  onMouseEnter={() => setHighlighted(i)}
                >
                  <span className="drop-query">{s.query}</span>
                  <span className="drop-count">{s.count.toLocaleString()}</span>
                </li>
              ))}
              {/* Cache hit/miss badge */}
              {lastDebug && (
                <li className="drop-meta" aria-hidden>
                  <span className={lastDebug.source === 'cache' ? 'badge-hit' : 'badge-miss'}>
                    {lastDebug.source === 'cache' ? '● cache hit' : '● trie miss'}
                  </span>
                  <span>{lastDebug.node}</span>
                  <span>{lastDebug.latencyMs} ms</span>
                </li>
              )}
            </ul>
          )}
        </div>

        {/* Status line */}
        <div className="status-line" aria-live="polite">
          {sugLoading  && <span className="pill pill-loading"><span className="spin" />Loading…</span>}
          {sugError    && <span className="pill pill-err">{sugError}</span>}
          {searchMsg   && <span className="pill pill-ok">{searchMsg}</span>}
          {searchError && <span className="pill pill-err">{searchError}</span>}
        </div>

        {/* Main grid: trending | debug + metrics */}
        <div className="grid">

          {/* Trending panel (always enhanced/recency-aware) */}
          <section className="card">
            <h2 className="card-title">Trending · Recency-Aware</h2>
            {trendingLoading && <p className="muted center"><span className="spin" /></p>}
            {trendingError   && <p className="muted center">{trendingError}</p>}
            {!trendingLoading && !trendingError && trending.length === 0 && (
              <p className="muted center">No trending yet — search something!</p>
            )}
            {!trendingLoading && trending.length > 0 && (
              <ol className="trend-list">
                {trending.map((t) => (
                  <li
                    key={t.query}
                    className="trend-item"
                    onClick={() => { setQuery(t.query); scheduleSearch(t.query, mode); inputRef.current?.focus(); }}
                  >
                    <span className="trend-query">{t.query}</span>
                    <span className="trend-count">{t.count.toLocaleString()}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {/* Cache debug + metrics */}
          <section className="card">
            <h2 className="card-title">Cache · Consistent Hash Ring</h2>
            <CacheDebug />
            {metrics && <MetricsPanel m={metrics} />}
          </section>

        </div>
      </div>
    </>
  );
}

// ── Sub-components (no business logic; only local UI state + one fetch each) ──

function CacheDebug() {
  const [prefix, setPrefix] = useState('');
  const [result, setResult] = useState<{ node: string; status: 'hit' | 'miss' } | null>(null);
  const [err,    setErr]    = useState<string | null>(null);

  const check = async () => {
    const p = prefix.trim().toLowerCase();
    if (!p) return;
    setErr(null);
    try {
      const res  = await fetch(`/api/cache/debug?prefix=${encodeURIComponent(p)}`);
      const data = await res.json();
      if (data.error) { setErr(data.error); setResult(null); } else setResult(data);
    } catch { setErr('Request failed'); }
  };

  return (
    <div className="debug-box">
      <div className="debug-row">
        <input
          className="debug-input"
          placeholder="prefix to inspect…"
          value={prefix}
          onChange={e => setPrefix(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') check(); }}
        />
        <button className="debug-btn" onClick={check}>Check</button>
      </div>
      {err    && <p className="muted">{err}</p>}
      {result && (
        <div className="debug-result">
          <span className={result.status === 'hit' ? 'badge-hit' : 'badge-miss'}>
            {result.status.toUpperCase()}
          </span>
          {' · '}
          <span className="muted">{result.node}</span>
        </div>
      )}
    </div>
  );
}

function MetricsPanel({ m }: { m: Metrics }) {
  const chips = [
    { label: 'p95 latency',    value: `${m.latency.p95Ms.toFixed(1)} ms` },
    { label: 'p50 latency',    value: `${m.latency.p50Ms.toFixed(1)} ms` },
    { label: 'cache hit rate', value: `${m.cache.hitRate} %` },
    { label: 'writes queued',  value: m.writeBuffer.totalEnqueued.toLocaleString() },
    { label: 'store writes',   value: m.writeBuffer.totalFlushed.toLocaleString() },
    { label: 'flush cycles',   value: m.writeBuffer.flushCount.toLocaleString() },
  ];
  return (
    <div className="metrics">
      {chips.map(c => (
        <div key={c.label} className="chip">
          <div className="chip-label">{c.label}</div>
          <div className="chip-value">{c.value}</div>
        </div>
      ))}
    </div>
  );
}
