/**
 * DCF Companion - Hybrid Search (Phase 4.1)
 *
 * Combines keyword scoring and lightweight local semantic similarity into
 * a single ranked result list, per plan:
 *   hybrid_score = keywordScore * 0.6 + semanticSimilarity * 0.4
 *
 * Zero runtime npm dependencies (project principle):
 *   - Keyword: BM25-style term-frequency scoring in plain JS (SQLite FTS5
 *     can replace this scorer transparently when the events table gains an
 *     FTS index; the fusion logic stays identical).
 *   - Semantic: character-bigram cosine similarity — a local, offline
 *     approximation robust for Chinese/English mixed text. A real
 *     embedding model can be swapped in behind embed() later.
 *
 * SearchResult {
 *   hits: Array<{ eventId, snippet, matchType: 'keyword'|'semantic'|'hybrid', relevanceScore }>;
 *   semanticQuery?: string;
 * }
 */

'use strict';

/** BM25 parameters (standard defaults). */
const BM25_K1 = 1.5;
const BM25_B = 0.75;

/**
 * Tokenize into lowercase word tokens (unicode letters/digits).
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  return String(text || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/**
 * Character bigram set for semantic-ish similarity (works for CJK where
 * word tokenization is unreliable without a segmenter).
 * @param {string} text
 * @returns {Set<string>}
 */
function bigrams(text) {
  const s = String(text || '').toLowerCase().replace(/\s+/g, '');
  const set = new Set();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

/**
 * Cosine similarity between two bigram sets (binary vectors).
 * @param {Set<string>} a
 * @param {Set<string>} b
 * @returns {number} [0, 1]
 */
function cosineSimilarity(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const g of a) if (b.has(g)) inter++;
  return inter / Math.sqrt(a.size * b.size);
}

/**
 * BM25 keyword score of one document against query terms.
 * @param {string[]} queryTerms
 * @param {string[]} docTerms
 * @param {number} avgDocLen
 * @param {Map<string, number>} docFreq - term -> number of docs containing it
 * @param {number} totalDocs
 * @returns {number}
 */
function bm25Score(queryTerms, docTerms, avgDocLen, docFreq, totalDocs) {
  const tf = new Map();
  for (const t of docTerms) tf.set(t, (tf.get(t) || 0) + 1);
  let score = 0;
  for (const q of queryTerms) {
    const f = tf.get(q) || 0;
    if (!f) continue;
    const df = docFreq.get(q) || 1;
    const idf = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5));
    score += idf * (f * (BM25_K1 + 1)) /
      (f + BM25_K1 * (1 - BM25_B + BM25_B * docTerms.length / (avgDocLen || 1)));
  }
  return score;
}

/**
 * Build a short snippet around the first query-term occurrence.
 * @param {string} text
 * @param {string[]} queryTerms
 * @param {number} radius
 * @returns {string}
 */
function makeSnippet(text, queryTerms, radius = 60) {
  const lower = String(text || '').toLowerCase();
  let idx = -1;
  for (const q of queryTerms) {
    const i = lower.indexOf(q);
    if (i >= 0 && (idx < 0 || i < idx)) idx = i;
  }
  if (idx < 0) return String(text || '').slice(0, radius * 2);
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + radius);
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

/**
 * Hybrid search over an in-memory event list.
 *
 * @param {string} query - User query.
 * @param {Array<{id:string, text:string, ts?:number}>} events - Corpus.
 * @param {Object} [options]
 * @param {number} [options.limit=20]
 * @param {number} [options.keywordWeight=0.6]
 * @param {number} [options.semanticWeight=0.4]
 * @returns {{hits:Array, semanticQuery:string}}
 */
function hybridSearch(query, events, options = {}) {
  const limit = options.limit || 20;
  const kw = options.keywordWeight != null ? options.keywordWeight : 0.6;
  const sw = options.semanticWeight != null ? options.semanticWeight : 0.4;

  const queryTerms = tokenize(query);
  const queryGrams = bigrams(query);

  // Corpus statistics for BM25.
  const docsTerms = events.map((ev) => tokenize(ev.text));
  const totalDocs = events.length || 1;
  const avgDocLen = docsTerms.reduce((acc, d) => acc + d.length, 0) / totalDocs;
  const docFreq = new Map();
  for (const terms of docsTerms) {
    for (const t of new Set(terms)) docFreq.set(t, (docFreq.get(t) || 0) + 1);
  }

  // Score every document on both axes.
  const scored = events.map((ev, i) => {
    const keyword = bm25Score(queryTerms, docsTerms[i], avgDocLen, docFreq, totalDocs);
    const semantic = cosineSimilarity(queryGrams, bigrams(ev.text));
    return { ev, keyword, semantic };
  });

  // Normalize keyword scores to [0,1] before fusion.
  const maxKeyword = Math.max(...scored.map((s) => s.keyword), 1e-9);

  const hits = scored
    .map((s) => {
      const kNorm = s.keyword / maxKeyword;
      const relevanceScore = kNorm * kw + s.semantic * sw;
      let matchType = 'hybrid';
      if (kNorm > 0 && s.semantic < 0.05) matchType = 'keyword';
      else if (kNorm === 0 && s.semantic > 0) matchType = 'semantic';
      return {
        eventId: s.ev.id,
        snippet: makeSnippet(s.ev.text, queryTerms),
        matchType,
        relevanceScore: Number(relevanceScore.toFixed(4))
      };
    })
    .filter((h) => h.relevanceScore > 0.01)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, limit);

  return { hits, semanticQuery: query };
}

module.exports = {
  tokenize,
  bigrams,
  cosineSimilarity,
  bm25Score,
  makeSnippet,
  hybridSearch
};
