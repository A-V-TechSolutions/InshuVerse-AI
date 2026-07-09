// Assembles the "RELEVANT KNOWLEDGE BASE CONTEXT" block injected into the
// system prompt for chatgpt (Custom Mode) when the user has uploaded
// reference documents and the live transcription has matching chunks.
//
// Hard-capped at MAX_CONTEXT_TOKENS so we don't blow up the per-call cost
// or trigger model context overflow when a user lowers the similarity
// threshold to a permissive value.

const MAX_CONTEXT_TOKENS = 1500;     // ≈ 6000 chars
const MAX_CONTEXT_CHARS = MAX_CONTEXT_TOKENS * 4;

// Modes that may have the user's local Knowledge Base injected into their
// system prompt. Single source of truth — both the renderer (decides
// whether to call retrieve()) and the main process (decides whether to
// append the block) read from here. Highlight + screenshot stay OFF
// because those paths have separate, isolated prompt builders.
const RAG_ELIGIBLE_MODES = Object.freeze(new Set(['chatgpt', 'interview', 'meeting']));

function isRagEligibleMode(mode) {
  return typeof mode === 'string' && RAG_ELIGIBLE_MODES.has(mode);
}

// hits: Array<{ text, source, score, chunkIndex? }>
// Returns a string ready to append to the system prompt, or '' if no usable
// hits. The caller decides whether to include the block.
function buildContextBlock(hits) {
  if (!Array.isArray(hits) || hits.length === 0) return '';
  const lines = [];
  let used = 0;
  let included = 0;
  for (const h of hits) {
    if (!h || !h.text) continue;
    const src = (h.source ? String(h.source) : 'document').trim();
    const idx = Number.isFinite(h.chunkIndex) ? `#${h.chunkIndex}` : '';
    const header = `[${src}${idx ? ' ' + idx : ''}]`;
    const body = String(h.text).trim();
    if (!body) continue;
    const block = `${header}\n${body}`;
    if (used + block.length > MAX_CONTEXT_CHARS && included > 0) break;
    lines.push(block);
    used += block.length + 2;
    included++;
    // Allow a single oversized first chunk through (truncated) so the user
    // always gets *something* relevant rather than an empty block.
    if (used > MAX_CONTEXT_CHARS) {
      lines[lines.length - 1] = lines[lines.length - 1].slice(0, MAX_CONTEXT_CHARS);
      break;
    }
  }
  if (lines.length === 0) return '';
  return [
    '',
    '---',
    '',
    'RELEVANT KNOWLEDGE BASE CONTEXT (verbatim excerpts from the user\'s uploaded reference documents — use these as the authoritative source when answering; cite the bracketed source name if relevant):',
    '',
    lines.join('\n\n'),
  ].join('\n');
}

// Append the context block to an existing system prompt. Idempotent — passing
// hits=[] returns the prompt unchanged, so callers don't have to pre-check.
function appendRagContext(systemPrompt, hits) {
  const block = buildContextBlock(hits);
  if (!block) return systemPrompt;
  return `${systemPrompt}${block}`;
}

module.exports = {
  buildContextBlock,
  appendRagContext,
  isRagEligibleMode,
  RAG_ELIGIBLE_MODES,
  MAX_CONTEXT_TOKENS,
  MAX_CONTEXT_CHARS,
};
