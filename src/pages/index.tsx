import { useState, useEffect, useRef, useCallback, KeyboardEvent } from 'react';
import Head from 'next/head';

interface Suggestion { query: string; count: number; }
interface SuggestResponse {
  suggestions: Suggestion[];
  source: 'cache' | 'trie' | 'empty';
  node?: string;
  latencyMs?: number;
  mode: string;
}
interface TrendingItem { query: string; count: number; score: number | null; }
interface DebugResult { prefix: string; node: string; status: 'hit' | 'miss'; message: string; }
interface MetricsData {
  latency: { p50Ms: number; p95Ms: number; meanMs: number; samples: number };
  cache: { hitRate: number; totalHits: number; totalMisses: number };
  writeBuffer: { pendingQueries: number; totalEnqueued: number; flushCount: number };
}

const DEBOUNCE_MS = 250;

export default function Home() {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchMsg, setSearchMsg] = useState<string | null>(null);
  const [lastSource, setLastSource] = useState<{ src: string; node: string; ms?: number } | null>(null);
  const [mode, setMode] = useState<'basic' | 'enhanced'>('basic');
  const [trending, setTrending] = useState<TrendingItem[]>([]);
  const [trendingLoading, setTrendingLoading] = useState(false);
  const [debugPrefix, setDebugPrefix] = useState('');
  const [debugResult, setDebugResult] = useState<DebugResult | null>(null);
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Fetch suggestions (debounced) ─────────────────────────────────────────
  const fetchSuggestions = useCallback(
    async (q: string, activeMode: string) => {
      if (!q.trim()) { setSuggestions([]); setDropdownOpen(false); return; }
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/suggest?q=${encodeURIComponent(q)}&mode=${activeMode}`);
        const data: SuggestResponse = await res.json();
        setSuggestions(data.suggestions);
        setLastSource({ src: data.source, node: data.node ?? '', ms: data.latencyMs });
        setDropdownOpen(data.suggestions.length > 0);
      } catch {
        setError('Suggestion fetch failed');
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const scheduleSearch = useCallback(
    (q: string, m: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => fetchSuggestions(q, m), DEBOUNCE_MS);
    },
    [fetchSuggestions]
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    setSelectedIdx(-1);
    scheduleSearch(val, mode);
  };

  // ── Submit search ─────────────────────────────────────────────────────────
  const submitSearch = useCallback(async (q: string) => {
    const term = q.trim();
    if (!term) return;
    setDropdownOpen(false);
    setSuggestions([]);
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: term }),
      });
      const data = await res.json();
      setSearchMsg(`Searched for "${data.query}" — ${data.message}`);
      setTimeout(() => setSearchMsg(null), 4000);
      // Refresh trending after submitting
      fetchTrending(mode);
    } catch {
      setSearchMsg('Search failed');
    }
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Keyboard nav ──────────────────────────────────────────────────────────
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!dropdownOpen || suggestions.length === 0) {
      if (e.key === 'Enter') submitSearch(query);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIdx >= 0) {
        const sel = suggestions[selectedIdx].query;
        setQuery(sel);
        setDropdownOpen(false);
        setSuggestions([]);
        submitSearch(sel);
      } else {
        submitSearch(query);
      }
    } else if (e.key === 'Escape') {
      setDropdownOpen(false);
      setSelectedIdx(-1);
    }
  };

  const selectSuggestion = (s: Suggestion) => {
    setQuery(s.query);
    setDropdownOpen(false);
    setSuggestions([]);
    submitSearch(s.query);
    inputRef.current?.focus();
  };

  // ── Mode toggle ───────────────────────────────────────────────────────────
  const switchMode = async (m: 'basic' | 'enhanced') => {
    setMode(m);
    await fetch('/api/trending', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: m }),
    });
    fetchTrending(m);
    if (query.trim()) scheduleSearch(query, m);
  };

  // ── Fetch trending ────────────────────────────────────────────────────────
  const fetchTrending = useCallback(async (m: string) => {
    setTrendingLoading(true);
    try {
      const res = await fetch(`/api/trending?mode=${m}`);
      const data = await res.json();
      setTrending(data.trending ?? []);
    } catch { /* ignore */ }
    finally { setTrendingLoading(false); }
  }, []);

  // ── Fetch cache debug ─────────────────────────────────────────────────────
  const fetchDebug = async () => {
    if (!debugPrefix.trim()) return;
    try {
      const res = await fetch(`/api/cache/debug?prefix=${encodeURIComponent(debugPrefix.trim().toLowerCase())}`);
      const data = await res.json();
      setDebugResult(data);
    } catch { /* ignore */ }
  };

  // ── Fetch metrics ─────────────────────────────────────────────────────────
  const fetchMetrics = useCallback(async () => {
    try {
      const res = await fetch('/api/metrics');
      const data = await res.json();
      setMetrics(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchTrending(mode);
    fetchMetrics();
    const interval = setInterval(() => { fetchMetrics(); }, 5000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Click outside to close dropdown ──────────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.search-wrapper')) setDropdownOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <>
      <Head>
        <title>Search Typeahead System</title>
        <meta name="description" content="Distributed search typeahead with consistent hashing" />
      </Head>

      <div className="app">
        {/* ── Header ── */}
        <div className="header">
          <div>
            <h1>Search Typeahead System</h1>
            <p>Trie · Consistent Hashing · Batch Writes · Trending</p>
          </div>
          <div className="mode-toggle">
            <button className={`mode-btn${mode === 'basic' ? ' active' : ''}`} onClick={() => switchMode('basic')}>
              Basic
            </button>
            <button className={`mode-btn${mode === 'enhanced' ? ' active' : ''}`} onClick={() => switchMode('enhanced')}>
              Enhanced
            </button>
          </div>
        </div>

        {/* ── Search bar ── */}
        <div className="search-wrapper">
          <div className="search-input-row">
            <input
              ref={inputRef}
              className="search-input"
              type="text"
              placeholder="Type to search… (↑↓ to navigate, Enter to select)"
              value={query}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              autoComplete="off"
              spellCheck={false}
            />
            <button className="search-btn" onClick={() => submitSearch(query)} disabled={!query.trim()}>
              Search
            </button>
          </div>

          {/* Dropdown */}
          {dropdownOpen && suggestions.length > 0 && (
            <div className="dropdown">
              {suggestions.map((s, i) => (
                <div
                  key={s.query}
                  className={`dropdown-item${i === selectedIdx ? ' selected' : ''}`}
                  onMouseDown={() => selectSuggestion(s)}
                  onMouseEnter={() => setSelectedIdx(i)}
                >
                  <span className="query">{s.query}</span>
                  <span className="count">{s.count.toLocaleString()} searches</span>
                </div>
              ))}
              {lastSource && (
                <div className="dropdown-source">
                  <span className={lastSource.src === 'cache' ? 'source-hit' : 'source-miss'}>
                    {lastSource.src === 'cache' ? '● cache hit' : '● trie miss'}
                  </span>
                  {lastSource.node && <span>{lastSource.node}</span>}
                  {lastSource.ms !== undefined && <span>{lastSource.ms}ms</span>}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Status row */}
        <div className="status-row">
          {isLoading && (
            <span className="status-msg loading"><span className="spinner" /> Fetching suggestions…</span>
          )}
          {error && <span className="status-msg error">{error}</span>}
          {searchMsg && <span className="status-msg success">{searchMsg}</span>}
        </div>

        {/* ── Main grid ── */}
        <div className="main-grid">
          {/* Trending */}
          <div className="card">
            <h3>Trending Searches · {mode === 'enhanced' ? 'Enhanced (decay)' : 'Basic (all-time)'}</h3>
            {trendingLoading ? (
              <p className="empty-msg"><span className="spinner" /></p>
            ) : trending.length === 0 ? (
              <p className="empty-msg">No trending data yet — search something!</p>
            ) : (
              <ul className="trending-list">
                {trending.map((t, i) => (
                  <li
                    key={t.query}
                    className="trending-item"
                    onClick={() => { setQuery(t.query); scheduleSearch(t.query, mode); inputRef.current?.focus(); }}
                  >
                    <span className="trending-rank">#{i + 1}</span>
                    <span className="trending-query">{t.query}</span>
                    <span className="trending-score">
                      {t.score !== null
                        ? `score ${t.score.toFixed(2)}`
                        : `${t.count.toLocaleString()}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Cache debug */}
          <div className="card">
            <h3>Cache Debug · Consistent Hash Ring</h3>
            <div className="debug-form">
              <input
                className="debug-input"
                placeholder="prefix to inspect…"
                value={debugPrefix}
                onChange={(e) => setDebugPrefix(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') fetchDebug(); }}
              />
              <button className="debug-btn" onClick={fetchDebug}>Check</button>
            </div>
            {debugResult && (
              <div className="debug-result">
                <span className={debugResult.status}>{debugResult.status.toUpperCase()}</span>
                {' · '}
                <span>prefix: &quot;{debugResult.prefix}&quot;</span>
                <div className="debug-node">Owned by: {debugResult.node}</div>
              </div>
            )}
            {metrics && (
              <div style={{ marginTop: '0.75rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                <div>Hit rate: <strong style={{ color: 'var(--green)' }}>{metrics.cache.hitRate}%</strong></div>
                <div>Hits: {metrics.cache.totalHits} · Misses: {metrics.cache.totalMisses}</div>
              </div>
            )}
          </div>
        </div>

        {/* Metrics strip */}
        {metrics && (
          <div className="metrics-strip">
            <div className="metric-chip">
              <div className="label">p95 latency</div>
              <div className="value">{metrics.latency.p95Ms.toFixed(2)}ms</div>
            </div>
            <div className="metric-chip">
              <div className="label">p50 latency</div>
              <div className="value">{metrics.latency.p50Ms.toFixed(2)}ms</div>
            </div>
            <div className="metric-chip">
              <div className="label">cache hit rate</div>
              <div className="value">{metrics.cache.hitRate}%</div>
            </div>
            <div className="metric-chip">
              <div className="label">writes enqueued</div>
              <div className="value">{metrics.writeBuffer.totalEnqueued}</div>
            </div>
            <div className="metric-chip">
              <div className="label">flush cycles</div>
              <div className="value">{metrics.writeBuffer.flushCount}</div>
            </div>
            <div className="metric-chip">
              <div className="label">pending in buffer</div>
              <div className="value">{metrics.writeBuffer.pendingQueries}</div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
