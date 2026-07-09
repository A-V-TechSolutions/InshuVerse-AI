// Pure-JS BM25 lexical retrieval for the RAG pipeline. Replaces the previous
// transformers.js + onnxruntime-node embedder, which was triggering renderer
// crashes on Electron 36 due to native ABI mismatches in onnxruntime-node and
// sharp. BM25 covers the dominant case for knowledge-base lookups (resumes,
// notes, handbooks) where the user's query and the source document share
// keywords. No model download, no native bindings, no warmup latency — pure
// JavaScript that runs in any V8 context including the Electron renderer.
//
// Algorithm: Okapi BM25 with k1=1.5, b=0.75, English stopword filtering, and
// naive suffix stripping so "interview" matches "interviews"/"interviewing".
//
// All inputs are tokenised lazily on each call. For our hard cap of 4000
// chunks × ~500 tokens each, full-corpus scoring runs well under 50 ms in V8,
// so we don't bother with a persistent inverted index.

const STOPWORDS = new Set([
  'a','an','and','are','as','at','be','but','by','for','from','has','have',
  'he','her','his','i','in','is','it','its','of','on','or','our','she','that',
  'the','their','them','they','this','to','was','were','will','with','you',
  'your','we','us','do','does','did','can','could','would','should','may',
  'might','must','if','then','than','so','not','no','yes','what','when',
  'where','why','how','who','whom','which','these','those','there','here',
  'about','into','onto','out','up','down','off','over','under','again',
  'just','only','also','too','very','more','most','some','any','all','one',
  'am','being','been','having','had','him','me','my','myself','ours',
  'ourselves','yours','yourself','itself','themselves','same','such','own',
]);

const K1 = 1.5;
const B  = 0.75;

// Naive suffix stripping. Not a real Porter stemmer — just enough to collapse
// the most common English plurals/gerunds so retrieval still finds matches
// across simple morphological variants.
function _stem(t) {
  if (t.length <= 4) return t;
  if (t.endsWith('ies') && t.length > 4) return t.slice(0, -3) + 'y';
  if (t.endsWith('sses')) return t.slice(0, -2);
  if (t.endsWith('ing') && t.length > 5) return t.slice(0, -3);
  if (t.endsWith('ed') && t.length > 4) return t.slice(0, -2);
  if (t.endsWith('s') && !t.endsWith('ss') && !t.endsWith('us') && !t.endsWith('is')) return t.slice(0, -1);
  return t;
}

function tokenize(text) {
  if (!text || typeof text !== 'string') return [];
  const out = [];
  const lowered = text.toLowerCase();
  let token = '';
  for (let i = 0; i < lowered.length; i++) {
    const c = lowered.charCodeAt(i);
    const isLetter = c >= 97 && c <= 122;
    const isDigit  = c >= 48 && c <= 57;
    if (isLetter || isDigit) {
      token += lowered[i];
    } else if (token) {
      if (token.length >= 2 && !STOPWORDS.has(token)) out.push(_stem(token));
      token = '';
    }
  }
  if (token && token.length >= 2 && !STOPWORDS.has(token)) out.push(_stem(token));
  return out;
}

// rows:  Array<{ id?, text, ...meta }>
// query: string
// opts:  { k = 4, minScore = 0 }
// Returns Array<{ ...row, score }> sorted desc, length ≤ k, score > minScore.
function bm25Search(rows, query, opts) {
  const o = opts || {};
  const k = Number.isFinite(o.k) && o.k > 0 ? Math.floor(o.k) : 4;
  const minScore = Number.isFinite(o.minScore) ? o.minScore : 0;
  const qTokens = tokenize(query);
  if (!Array.isArray(rows) || rows.length === 0 || qTokens.length === 0) return [];

  const N = rows.length;
  const docTokens = new Array(N);
  const docLens   = new Array(N);
  let totalLen = 0;
  for (let i = 0; i < N; i++) {
    const t = tokenize(rows[i] && rows[i].text);
    docTokens[i] = t;
    docLens[i] = t.length;
    totalLen += t.length;
  }
  const avgdl = totalLen / Math.max(1, N);

  // Document frequency for each unique query term — single pass per term.
  const uniq = Array.from(new Set(qTokens));
  const idf = new Map();
  for (const t of uniq) {
    let n = 0;
    for (let i = 0; i < N; i++) {
      const dt = docTokens[i];
      // Linear scan is fine: chunks are small and uniq is small.
      for (let j = 0; j < dt.length; j++) { if (dt[j] === t) { n++; break; } }
    }
    idf.set(t, Math.log(((N - n + 0.5) / (n + 0.5)) + 1));
  }

  const scored = [];
  for (let i = 0; i < N; i++) {
    const tokens = docTokens[i];
    if (tokens.length === 0) continue;
    const tf = new Map();
    for (let j = 0; j < tokens.length; j++) {
      const t = tokens[j];
      tf.set(t, (tf.get(t) || 0) + 1);
    }
    let score = 0;
    for (const t of uniq) {
      const f = tf.get(t) || 0;
      if (f === 0) continue;
      const idfT = idf.get(t) || 0;
      const dl = docLens[i];
      const num = f * (K1 + 1);
      const den = f + K1 * (1 - B + B * (dl / Math.max(1, avgdl)));
      score += idfT * (num / den);
    }
    if (score > minScore) scored.push({ ...rows[i], score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

module.exports = { tokenize, bm25Search, STOPWORDS, K1, B };
