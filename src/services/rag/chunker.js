// Splits raw extracted text into ~500-token chunks with a small overlap.
// Token estimation uses the well-known 1 token ≈ 4 chars heuristic; we
// don't ship a real BPE tokenizer in the renderer because (a) MiniLM has its
// own tokenizer that runs at embed time and (b) chunk-budget accuracy of
// ±15% is plenty for retrieval — the LLM reads whole chunks anyway.
//
// Splitting strategy:
//   1. Normalise whitespace and split on sentence boundaries (. ! ? + newline).
//   2. Greedy-pack sentences into a window until the running token count
//      reaches `targetTokens`.
//   3. Carry `overlapTokens` worth of trailing sentences into the next chunk
//      so a sentence straddling a boundary stays retrievable from either side.
//
// Pure function, no side effects, no I/O — fully unit-testable.

const CHARS_PER_TOKEN = 4;

function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function splitIntoSentences(text) {
  if (!text) return [];
  // Collapse runs of whitespace, preserve paragraph breaks as a single \n
  const norm = String(text)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!norm) return [];
  // Split on sentence-ending punctuation followed by whitespace, OR on
  // double newline (paragraph break). Keep the punctuation attached.
  const parts = norm.split(/(?<=[.!?])\s+|\n{2,}/);
  return parts.map(s => s.trim()).filter(Boolean);
}

function chunkText(text, opts) {
  const o = opts || {};
  const targetTokens = Number.isFinite(o.targetTokens) && o.targetTokens > 0 ? o.targetTokens : 500;
  const overlapTokens = Number.isFinite(o.overlapTokens) && o.overlapTokens >= 0 ? o.overlapTokens : 50;
  const minChunkTokens = Number.isFinite(o.minChunkTokens) && o.minChunkTokens > 0 ? o.minChunkTokens : 20;

  const sentences = splitIntoSentences(text);
  if (sentences.length === 0) return [];

  const chunks = [];
  let buf = [];
  let bufTokens = 0;

  const flush = () => {
    if (!buf.length) return;
    const joined = buf.join(' ').trim();
    if (joined && estimateTokens(joined) >= minChunkTokens) {
      chunks.push(joined);
    } else if (joined && chunks.length === 0) {
      // Always emit at least one chunk for very short documents
      chunks.push(joined);
    }
  };

  for (const s of sentences) {
    const sTokens = estimateTokens(s);

    // Sentence alone exceeds target — hard-split by character window
    if (sTokens > targetTokens) {
      flush();
      buf = [];
      bufTokens = 0;
      const charWindow = targetTokens * CHARS_PER_TOKEN;
      const overlapChars = overlapTokens * CHARS_PER_TOKEN;
      let i = 0;
      while (i < s.length) {
        const piece = s.slice(i, i + charWindow);
        chunks.push(piece);
        if (i + charWindow >= s.length) break;
        i += Math.max(1, charWindow - overlapChars);
      }
      continue;
    }

    if (bufTokens + sTokens > targetTokens && buf.length > 0) {
      flush();
      // Build overlap: take trailing sentences whose combined tokens ≈ overlap
      const carry = [];
      let carryTokens = 0;
      for (let k = buf.length - 1; k >= 0 && carryTokens < overlapTokens; k--) {
        carry.unshift(buf[k]);
        carryTokens += estimateTokens(buf[k]);
      }
      buf = carry;
      bufTokens = carryTokens;
    }

    buf.push(s);
    bufTokens += sTokens;
  }

  flush();
  return chunks;
}

// Cheap heuristic to detect "scanned PDF" or extraction failure. Real text
// is mostly printable ASCII/latin + whitespace. If the printable ratio is
// below 0.6 OR the alphabetic ratio below 0.3 we treat the file as non-text.
function looksLikeRealText(text) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (trimmed.length < 50) return false;
  let printable = 0;
  let alpha = 0;
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed.charCodeAt(i);
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126) || c >= 160) printable++;
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) alpha++;
  }
  const printableRatio = printable / trimmed.length;
  const alphaRatio = alpha / trimmed.length;
  return printableRatio >= 0.6 && alphaRatio >= 0.3;
}

module.exports = {
  chunkText,
  estimateTokens,
  splitIntoSentences,
  looksLikeRealText,
  CHARS_PER_TOKEN,
};
