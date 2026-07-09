// Pure-logic tests for the RAG pipeline. No IndexedDB, no native bindings —
// just chunker, lexical-search (BM25), and prompt-assembly. Run via:
//   node --test src/services/rag/rag-pure.test.js

const test = require('node:test');
const assert = require('node:assert');

const {
  chunkText, estimateTokens, splitIntoSentences, looksLikeRealText,
} = require('./chunker');
const {
  tokenize, bm25Search, STOPWORDS,
} = require('./lexical-search');
const {
  buildContextBlock, appendRagContext, MAX_CONTEXT_CHARS,
} = require('./prompt-assembly');

// ── chunker ──────────────────────────────────────────────────────────────

test('chunker: empty / nullish input returns []', () => {
  assert.deepStrictEqual(chunkText(''), []);
  assert.deepStrictEqual(chunkText(null), []);
  assert.deepStrictEqual(chunkText(undefined), []);
});

test('chunker: short text yields one chunk', () => {
  const out = chunkText('Hello world. This is a short doc.');
  assert.strictEqual(out.length, 1);
  assert.match(out[0], /short doc/);
});

test('chunker: long text splits into multiple chunks under target', () => {
  const sentence = 'This is a representative sentence of moderate length used to build a long document. ';
  const text = sentence.repeat(200); // ~200 sentences × ~22 tokens ≈ 4400 tokens
  const out = chunkText(text, { targetTokens: 500, overlapTokens: 50 });
  assert.ok(out.length >= 6, `expected ≥6 chunks, got ${out.length}`);
  for (const c of out) {
    assert.ok(estimateTokens(c) <= 600, `chunk too big: ${estimateTokens(c)} tokens`);
  }
});

test('chunker: overlap carries trailing sentences across chunk boundaries', () => {
  const sentences = Array.from({ length: 100 }, (_, i) => `Sentence number ${i} carries unique marker XYZ${i}.`);
  const text = sentences.join(' ');
  const out = chunkText(text, { targetTokens: 200, overlapTokens: 40 });
  assert.ok(out.length >= 3);
  // Contract: with overlapTokens > 0 the LAST marker of chunk N-1 must
  // appear somewhere in chunk N (carried forward by the overlap window).
  let verified = 0;
  for (let i = 1; i < out.length; i++) {
    const allMarkers = [...out[i - 1].matchAll(/XYZ(\d+)/g)].map(m => m[0]);
    if (allMarkers.length === 0) continue;
    const lastMarker = allMarkers[allMarkers.length - 1];
    assert.ok(out[i].includes(lastMarker),
      `overlap missing: last marker '${lastMarker}' of chunk ${i - 1} absent from chunk ${i}`);
    verified++;
  }
  assert.ok(verified >= 1, 'expected at least one verifiable boundary');
});

test('chunker: oversized single sentence is hard-split by char window', () => {
  const giant = 'word '.repeat(2000); // ~10000 chars, no sentence boundaries
  const out = chunkText(giant, { targetTokens: 500, overlapTokens: 50 });
  assert.ok(out.length >= 4);
  for (const c of out) assert.ok(c.length <= 500 * 4 + 5);
});

test('estimateTokens: empty → 0, scales with length', () => {
  assert.strictEqual(estimateTokens(''), 0);
  assert.strictEqual(estimateTokens('a'.repeat(4)), 1);
  assert.strictEqual(estimateTokens('a'.repeat(400)), 100);
});

test('splitIntoSentences: preserves punctuation, drops blanks', () => {
  const out = splitIntoSentences('Hello world! How are you?\n\nFine. Thanks.');
  assert.deepStrictEqual(out, ['Hello world!', 'How are you?', 'Fine.', 'Thanks.']);
});

test('looksLikeRealText: rejects garbage, accepts real text', () => {
  assert.strictEqual(looksLikeRealText(''), false);
  assert.strictEqual(looksLikeRealText('a'), false);
  assert.strictEqual(looksLikeRealText('\u0001\u0002\u0003'.repeat(100)), false);
  assert.strictEqual(looksLikeRealText('The quick brown fox jumps over the lazy dog. '.repeat(5)), true);
});

// ── lexical-search (BM25) ────────────────────────────────────────────────

test('tokenize: lowercases, drops punctuation, drops stopwords, stems plurals', () => {
  const out = tokenize('The Engineers are interviewing candidates!');
  // 'the','are' → stopwords. 'engineers' → 'engineer', 'interviewing' → 'interview',
  // 'candidates' → 'candidate'.
  assert.ok(out.includes('engineer'));
  assert.ok(out.includes('interview'));
  assert.ok(out.includes('candidate'));
  assert.ok(!out.includes('the'));
  assert.ok(!out.includes('are'));
});

test('tokenize: empty / nullish / non-string → []', () => {
  assert.deepStrictEqual(tokenize(''), []);
  assert.deepStrictEqual(tokenize(null), []);
  assert.deepStrictEqual(tokenize(undefined), []);
  assert.deepStrictEqual(tokenize(42), []);
});

test('STOPWORDS: contains common English filler', () => {
  assert.ok(STOPWORDS.has('the'));
  assert.ok(STOPWORDS.has('and'));
  assert.ok(STOPWORDS.has('with'));
});

test('bm25Search: ranks the most relevant chunk first', () => {
  const rows = [
    { id: 'a', text: 'Coffee beans are roasted in Ethiopia and Colombia.' },
    { id: 'b', text: 'Tea production is dominated by China and India.' },
    { id: 'c', text: 'Coffee shops have multiplied across European cities.' },
  ];
  const out = bm25Search(rows, 'where are coffee beans grown', { k: 3 });
  assert.ok(out.length >= 1);
  assert.strictEqual(out[0].id, 'a', 'beans-and-coffee chunk should win');
  for (let i = 1; i < out.length; i++) {
    assert.ok(out[i - 1].score >= out[i].score, 'results sorted desc');
  }
});

test('bm25Search: respects k cap', () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({
    id: String(i),
    text: `Document number ${i} mentions interview practice tips.`,
  }));
  const out = bm25Search(rows, 'interview tips', { k: 4 });
  assert.strictEqual(out.length, 4);
});

test('bm25Search: empty corpus / empty query → []', () => {
  assert.deepStrictEqual(bm25Search([], 'anything'), []);
  assert.deepStrictEqual(bm25Search([{ id: 'a', text: 'hello world' }], ''), []);
  assert.deepStrictEqual(bm25Search([{ id: 'a', text: 'hello world' }], '   '), []);
});

test('bm25Search: query of all stopwords → []', () => {
  const rows = [{ id: 'a', text: 'The quick brown fox.' }];
  const out = bm25Search(rows, 'the and of', { k: 4 });
  assert.deepStrictEqual(out, []);
});

test('bm25Search: chunk with zero query-term overlap is dropped', () => {
  const rows = [
    { id: 'hit',  text: 'Resume writing tips for software engineers.' },
    { id: 'miss', text: 'Cooking recipes from southern Italy.' },
  ];
  const out = bm25Search(rows, 'resume engineer', { k: 4 });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].id, 'hit');
});

test('bm25Search: preserves source metadata on hits', () => {
  const rows = [
    { id: 'a', text: 'Alpha beta gamma.', source: 'doc1.pdf', chunkIndex: 3 },
  ];
  const out = bm25Search(rows, 'alpha', { k: 1 });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].source, 'doc1.pdf');
  assert.strictEqual(out[0].chunkIndex, 3);
  assert.ok(Number.isFinite(out[0].score) && out[0].score > 0);
});

// ── prompt-assembly ──────────────────────────────────────────────────────

test('buildContextBlock: empty hits → ""', () => {
  assert.strictEqual(buildContextBlock([]), '');
  assert.strictEqual(buildContextBlock(null), '');
  assert.strictEqual(buildContextBlock([{ text: '' }]), '');
});

test('buildContextBlock: includes header + body for each hit', () => {
  const out = buildContextBlock([
    { text: 'Para A', source: 'handbook.pdf', chunkIndex: 0 },
    { text: 'Para B', source: 'notes.docx', chunkIndex: 7 },
  ]);
  assert.match(out, /RELEVANT KNOWLEDGE BASE CONTEXT/);
  assert.match(out, /\[handbook\.pdf #0\]/);
  assert.match(out, /Para A/);
  assert.match(out, /\[notes\.docx #7\]/);
  assert.match(out, /Para B/);
});

test('buildContextBlock: respects MAX_CONTEXT_CHARS budget', () => {
  const big = 'x'.repeat(MAX_CONTEXT_CHARS);
  const out = buildContextBlock([
    { text: big, source: 'a' },
    { text: big, source: 'b' },
    { text: big, source: 'c' },
  ]);
  // Should include first chunk (truncated) and stop — never exceed ~1.2× budget after header
  assert.ok(out.length <= MAX_CONTEXT_CHARS + 500);
  assert.match(out, /\[a\]/);
  assert.ok(!out.includes('[b]'));
});

test('appendRagContext: idempotent on empty hits', () => {
  const sys = 'You are a helpful assistant.';
  assert.strictEqual(appendRagContext(sys, []), sys);
  assert.strictEqual(appendRagContext(sys, null), sys);
});

test('appendRagContext: appends block exactly once', () => {
  const sys = 'You are a helpful assistant.';
  const out = appendRagContext(sys, [{ text: 'fact one', source: 'doc1' }]);
  assert.ok(out.startsWith(sys));
  assert.ok(out.includes('RELEVANT KNOWLEDGE BASE CONTEXT'));
  assert.ok(out.includes('fact one'));
  // Only one occurrence of the header
  const occurrences = (out.match(/RELEVANT KNOWLEDGE BASE CONTEXT/g) || []).length;
  assert.strictEqual(occurrences, 1);
});
