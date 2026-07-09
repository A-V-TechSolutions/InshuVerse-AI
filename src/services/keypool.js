'use strict';
/**
 * API Key Pool — Angel AI
 *
 * Provider-aware, organization-aware key rotation with a cooldown state
 * machine. Sits one layer above src/auth/tiers.js: tiers.js answers
 * "which tier of key should this user get?", keypool.js answers
 * "given that tier, which specific key out of N candidates do I hand out
 * for THIS request, and how do I react when it fails?"
 *
 * Pool buckets:
 *   - openai/org-a, openai/org-b       → org-aware OpenAI pools (system shared)
 *   - gemini/premium, gemini/free      → per-tier Gemini pools (system shared)
 *   - assemblyai/free, assemblyai/pro  → per-tier AssemblyAI streaming pools
 *                                        (free/pro use separate AssemblyAI
 *                                        projects so a free-tier quarantine
 *                                        cannot affect paid traffic — same
 *                                        isolation pattern as Deepgram)
 *   - openai/lifetime:<userId>         → isolated per-lifetime-user OpenAI keys
 *   - gemini/lifetime:<userId>         → isolated per-lifetime-user Gemini keys
 *
 * Lifetime isolation: bring-your-own-key users never touch system pools and
 * one lifetime user's failures never poison another lifetime user's pool.
 *
 * Cooldown ladder (per key):
 *   healthy → cooldown(short, 60s) → cooldown(long, 5m) → quarantined (1h)
 * 429 escalates the ladder; 5xx triggers short cooldown only; auth/invalid
 * (401/403) goes straight to quarantine; success resets to healthy.
 */

const SHORT_COOLDOWN_MS = 60 * 1000;        // 1 min
const LONG_COOLDOWN_MS  = 5 * 60 * 1000;    // 5 min
const QUARANTINE_MS     = 60 * 60 * 1000;   // 1 hour

function _now() { return Date.now(); }
function _bucketKey(provider, org) { return `${provider}/${org}`; }

class KeyPool {
  constructor() {
    /** @type {Map<string, Array<{id:string, value:string, state:string, until:number, fail:number, cursor:number}>>} */
    this._buckets = new Map();
    /** @type {Map<string, {bucket:string, idx:number}>} */
    this._index = new Map();
    this._rrCursor = new Map();
  }

  // ── Registration ──────────────────────────────────────────────────────────
  /**
   * Add a key to a bucket. Idempotent on (bucket,id).
   * @param {{provider:'openai'|'gemini'|'assemblyai', org:string, id:string, value:string}} spec
   */
  addKey({ provider, org, id, value }) {
    if (!provider || !org || !id || !value) return;
    const bucket = _bucketKey(provider, org);
    let arr = this._buckets.get(bucket);
    if (!arr) { arr = []; this._buckets.set(bucket, arr); }
    const existing = arr.findIndex(k => k.id === id);
    const entry = { id, value, state: 'healthy', until: 0, fail: 0 };
    if (existing >= 0) arr[existing] = entry;
    else               arr.push(entry);
    this._index.set(id, { bucket, idx: arr.length - 1 });
  }

  /**
   * Drop every key associated with a lifetime user — call on logout / plan
   * downgrade so stale credentials never get acquired by a later request.
   */
  removeLifetimeUser(userId) {
    if (!userId) return;
    for (const [bucket] of this._buckets) {
      if (bucket.endsWith(`/lifetime:${userId}`)) this._buckets.delete(bucket);
    }
    for (const [id, ref] of this._index) {
      if (!this._buckets.has(ref.bucket)) this._index.delete(id);
    }
  }

  // ── Acquisition ───────────────────────────────────────────────────────────
  /**
   * Pick the next healthy key from `provider/org`. Round-robin, skipping any
   * key whose cooldown has not yet elapsed. Returns `null` when the bucket
   * is empty or every key is in cooldown / quarantine.
   * @param {{provider:string, org:string}} spec
   * @returns {{id:string, value:string} | null}
   */
  acquireKey({ provider, org }) {
    const bucket = _bucketKey(provider, org);
    const arr = this._buckets.get(bucket);
    if (!arr || arr.length === 0) return null;
    const now = _now();
    // Promote any key whose cooldown has elapsed back to healthy.
    for (const k of arr) {
      if (k.state !== 'healthy' && k.until && now >= k.until) {
        k.state = 'healthy'; k.until = 0;
      }
    }
    const cursor = (this._rrCursor.get(bucket) || 0) % arr.length;
    for (let i = 0; i < arr.length; i++) {
      const idx = (cursor + i) % arr.length;
      const k = arr[idx];
      if (k.state === 'healthy') {
        this._rrCursor.set(bucket, idx + 1);
        return { id: k.id, value: k.value };
      }
    }
    return null;
  }

  // ── Reporting ─────────────────────────────────────────────────────────────
  /**
   * Update a key's health based on the request outcome.
   * @param {string} keyId
   * @param {{ok:boolean, errCode?:number|string}} result
   */
  reportResult(keyId, { ok, errCode } = {}) {
    const ref = this._index.get(keyId);
    if (!ref) return;
    const arr = this._buckets.get(ref.bucket);
    if (!arr) return;
    const k = arr.find(x => x.id === keyId);
    if (!k) return;
    if (ok) { k.state = 'healthy'; k.until = 0; k.fail = 0; return; }
    const code = Number(errCode) || 0;
    const now = _now();
    if (code === 401 || code === 403) {
      k.state = 'quarantined'; k.until = now + QUARANTINE_MS; k.fail += 1;
    } else if (code === 429) {
      k.fail += 1;
      if (k.fail >= 3)      { k.state = 'quarantined'; k.until = now + QUARANTINE_MS; }
      else if (k.fail === 2){ k.state = 'cooldown';    k.until = now + LONG_COOLDOWN_MS; }
      else                  { k.state = 'cooldown';    k.until = now + SHORT_COOLDOWN_MS; }
    } else if (code >= 500 && code < 600) {
      k.state = 'cooldown'; k.until = now + SHORT_COOLDOWN_MS; k.fail += 1;
    } else {
      // Unknown error — short cooldown so we can retry on a different key
      k.state = 'cooldown'; k.until = now + SHORT_COOLDOWN_MS;
    }
  }

  // ── Diagnostics ───────────────────────────────────────────────────────────
  snapshot() {
    const out = {};
    for (const [bucket, arr] of this._buckets) {
      out[bucket] = arr.map(k => ({ id: k.id, state: k.state, fail: k.fail, until: k.until }));
    }
    return out;
  }
}

module.exports = {
  KeyPool,
  SHORT_COOLDOWN_MS,
  LONG_COOLDOWN_MS,
  QUARANTINE_MS,
};
