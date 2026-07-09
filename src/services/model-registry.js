'use strict';
/**
 * Model Registry — single source of truth for every LLM / transcription /
 * vision model ID used by the app, plus a per-model deprecation fallback chain.
 *
 * Why this exists:
 *   - Hard-coded model strings ("gpt-4o-mini") were sprinkled across main.js,
 *     answer.js, transcription.js, screenshot.js and highlight.js. When OpenAI
 *     or Google deprecates a model the app would 404 with no recovery.
 *   - Centralising IDs makes pricing/perf swaps a one-line change.
 *   - The `callWithFallback` helper retries the same request against the next
 *     model in the chain when a 404 / "model_not_found" / "deprecated" error
 *     is detected, so end-users never see a blank answer because the upstream
 *     vendor sunset a model without warning.
 *
 * Pure module — no Electron, no SDK imports. Safe to require from main and
 * renderer code paths and from tests.
 */

// ── Model freshness (updated May 2026) ────────────────────────────────────
// OpenAI:  gpt-4o-mini, gpt-4o, gpt-4.1-mini, gpt-4.1-nano — still in API.
//          gpt-3.5-turbo is a legacy fallback replaced with gpt-4.1-nano
//          for lower cost + better quality. ChatGPT retirements (gpt-4o,
//          gpt-4.1, etc.) do NOT affect the API.
// Gemini:  gemini-1.5-flash(-001/-002) retired May 2025 — REMOVED from chains.
//          gemini-2.0-flash-001 retires June 1 2026 — skipped.
//          gemini-2.5-flash-lite (GA July 2025, not before Oct 2026) — primary.
//          gemini-2.5-flash      (GA June 2025, not before Oct 2026) — fallback.
// Deepgram: nova-3 released Feb 2025; 54% WER improvement over nova-2; same
//           latency; recommended for English streaming. nova-2 kept for
//           non-English languages not yet covered by nova-3.
const MODELS = Object.freeze({
  // ── OpenAI chat ────────────────────────────────────────────────────────
  CHAT_FAST:        { id: 'gpt-4o-mini',    provider: 'openai', fallbacks: ['gpt-4.1-mini', 'gpt-4.1-nano'] },
  CHAT_QUALITY:     { id: 'gpt-4o',         provider: 'openai', fallbacks: ['gpt-4o-mini', 'gpt-4.1-mini'] },
  CHAT_NANO:        { id: 'gpt-4.1-nano',   provider: 'openai', fallbacks: ['gpt-4o-mini'] },

  // ── Gemini chat / vision ───────────────────────────────────────────────
  // Primary: gemini-2.5-flash-lite — lowest-latency 2.5 family model (GA).
  // Fallback: gemini-2.5-flash — heavier but still 2.5 generation (GA, safe
  //   until at least Oct 2026). gemini-1.5-flash was removed: retired May 2025.
  GEMINI_CHAT:      { id: 'gemini-2.5-flash-lite', provider: 'gemini', fallbacks: ['gemini-2.5-flash'] },
  GEMINI_FLASH_LITE:{ id: 'gemini-2.5-flash-lite', provider: 'gemini', fallbacks: ['gemini-2.5-flash'] },
  GEMINI_VISION:    { id: 'gemini-2.5-flash-lite', provider: 'gemini', fallbacks: ['gemini-2.5-flash'] },

  // ── OpenAI transcription ───────────────────────────────────────────────
  TRANSCRIBE_FAST:    { id: 'gpt-4o-mini-transcribe', provider: 'openai', fallbacks: ['whisper-1'] },
  TRANSCRIBE_QUALITY: { id: 'gpt-4o-transcribe',      provider: 'openai', fallbacks: ['whisper-1'] },
});

/**
 * Resolve a model key to its current ID, honouring an explicit override.
 * Returns the id string. Throws if the key is unknown.
 */
function resolveModel(key, override) {
  if (typeof override === 'string' && override.trim()) return override.trim();
  const entry = MODELS[key];
  if (!entry) throw new Error(`[model-registry] Unknown model key: ${key}`);
  return entry.id;
}

/**
 * Build the ordered chain [primary, ...fallbacks] for a model key.
 * If `override` is supplied it becomes the primary and the registry chain
 * is appended (de-duplicated).
 */
function modelChain(key, override) {
  const entry = MODELS[key];
  if (!entry) throw new Error(`[model-registry] Unknown model key: ${key}`);
  const chain = [entry.id, ...(entry.fallbacks || [])];
  if (typeof override === 'string' && override.trim()) {
    const o = override.trim();
    return [o, ...chain.filter(id => id !== o)];
  }
  return chain;
}

/**
 * Return the next model ID after `currentId` in the chain, or null.
 */
function nextFallback(key, currentId) {
  const chain = modelChain(key);
  const idx = chain.indexOf(currentId);
  if (idx < 0 || idx >= chain.length - 1) return null;
  return chain[idx + 1];
}

/**
 * Heuristic detector for "this model is gone" errors across OpenAI + Gemini.
 * Matches:
 *   - HTTP 404
 *   - "model_not_found" (OpenAI error code)
 *   - "deprecated" / "has been deprecated"
 *   - "is not found for API version" (Gemini)
 *   - "not supported for generateContent" (Gemini)
 *   - "does not exist" / "unknown model"
 */
function isDeprecationError(err) {
  if (!err) return false;
  const status = err.status || err.statusCode || (err.response && err.response.status);
  if (status === 404) return true;
  const msg  = String(err.message || err.error?.message || err || '').toLowerCase();
  const code = String(err.code || err.error?.code || '').toLowerCase();
  if (code === 'model_not_found' || code === 'invalid_model') return true;
  return /\bmodel[_ -]?not[_ -]?found\b/.test(msg)
      || /\bdeprecated\b/.test(msg)
      || /\bnot found for api version\b/.test(msg)
      || /\bnot supported for generatecontent\b/.test(msg)
      || /\bunknown model\b/.test(msg)
      || /\bdoes not exist\b/.test(msg)
      || /\bmodel .* (?:is|has been) (?:retired|sunset|removed)\b/.test(msg);
}

/**
 * Run an async function `fn(modelId)` and, if it throws a deprecation error,
 * retry against each fallback model in the chain. Non-deprecation errors
 * propagate immediately so we don't paper over auth / quota / network bugs.
 *
 * Options:
 *   - override:  caller-supplied primary ID (wins over registry)
 *   - onSwitch:  optional callback ({ from, to, error }) fired when the
 *                helper rotates to a fallback. Used by main.js to surface a
 *                deprecation toast in the renderer.
 */
async function callWithFallback(key, fn, { override, onSwitch } = {}) {
  const chain = modelChain(key, override);
  let lastError;
  for (let i = 0; i < chain.length; i++) {
    const modelId = chain[i];
    try {
      return await fn(modelId);
    } catch (err) {
      lastError = err;
      if (!isDeprecationError(err) || i === chain.length - 1) throw err;
      const next = chain[i + 1];
      if (typeof onSwitch === 'function') {
        try { onSwitch({ key, from: modelId, to: next, error: err }); } catch (_) {}
      }
      console.warn(`[model-registry] ${key}: "${modelId}" deprecated/missing → falling back to "${next}"`);
    }
  }
  throw lastError;
}

module.exports = {
  MODELS,
  resolveModel,
  modelChain,
  nextFallback,
  isDeprecationError,
  callWithFallback,
};
