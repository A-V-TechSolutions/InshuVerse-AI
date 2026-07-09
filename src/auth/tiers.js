'use strict';
/**
 * User Tier & API Key Routing — Angel AI
 *
 * Single module that owns all decisions about which API key to use and what
 * a user is allowed to do. Business logic lives here; main.js is not littered
 * with repeated `if (plan === 'lifetime')` branches.
 *
 * Tier hierarchy (ascending privilege):
 *   free       — 15 complimentary credits on first sign-in
 *                OpenAI  → system shared key (DEFAULT_OPENAI_KEY / process.env.OPENAI_API_KEY)
 *                Gemini  → system free-tier Gemini key (FREE_GEMINI_KEY)
 *   premium    — Pro / Ultimate / Magic plans; credits via web payment
 *                OpenAI  → system premium key (PREMIUM_OPENAI_KEY)
 *                Gemini  → system premium Gemini key (PREMIUM_GEMINI_KEY)
 *   lifetime   — Bypass credit system; user supplies their own API keys (stored in Firebase)
 *                OpenAI  → user's own key, falling back to PREMIUM_OPENAI_KEY
 *                Gemini  → user's own key, falling back to PREMIUM_GEMINI_KEY
 *
 * Gemini key is maintained consistently across all tiers — it is never shared
 * with the OpenAI routing logic and follows the same free/premium split.
 */

const { APP_STATE } = require('../state/app-state');

// ── Internal shared API keys (never sent to renderer) ─────────────────────
// Populated at startup via initKeys() called from main.js.
// Falls back to process.env so tests/CI can still inject values.
// defaultOpenAI is the "system shared key" used for Free-tier users
// (equivalent to process.env.OPENAI_API_KEY in a standard deployment).
let _k = {
  defaultOpenAI:  process.env.DEFAULT_OPENAI_KEY  || process.env.OPENAI_API_KEY || '',
  premiumOpenAI:  process.env.PREMIUM_OPENAI_KEY  || '',
  premiumGemini:  process.env.PREMIUM_GEMINI_KEY  || '',
  freeGemini:     process.env.FREE_GEMINI_KEY     || '',
};

/**
 * Called once from main.js right after the key constants are defined.
 * Bridges the gap between main.js hardcoded keys and this module.
 */
function initKeys({ defaultOpenAI, premiumOpenAI, premiumGemini, freeGemini } = {}) {
  if (defaultOpenAI) _k.defaultOpenAI = defaultOpenAI;
  if (premiumOpenAI) _k.premiumOpenAI = premiumOpenAI;
  if (premiumGemini) _k.premiumGemini = premiumGemini;
  if (freeGemini)    _k.freeGemini    = freeGemini;
}

// ── Plan name sets ─────────────────────────────────────────────────────────
const LIFETIME_PLANS = new Set([
  'lifetime', 'angel-lifetime', 'angel lifetime',
  'angel lifetime plans', 'lifetime-monthly', 'lifetime-yearly',
  'angel-lifetime-monthly', 'angel-lifetime-yearly',
]);
const PREMIUM_PLANS = new Set([
  'pro', 'pro-monthly', 'pro-yearly',
  'ultimate', 'ultimate-monthly', 'ultimate-yearly',
  'magic', 'magic-monthly', 'magic-yearly',
]);

// ── Tier classification ────────────────────────────────────────────────────
/**
 * @param {string} [planId='free']
 * @returns {'free'|'premium'|'lifetime'}
 */
function classifyPlan(planId = 'free') {
  const p = String(planId).toLowerCase().trim();
  if (LIFETIME_PLANS.has(p))  return 'lifetime';
  if (PREMIUM_PLANS.has(p))   return 'premium';
  return 'free';
}

// ── API key getters (read from APP_STATE) ──────────────────────────────────
/**
 * Returns the correct OpenAI key for the currently authenticated user.
 * Reads APP_STATE.currentPlan and APP_STATE.lifetimeUserKeys automatically.
 * @returns {string}
 */
function getOpenAIKey() {
  const plan = APP_STATE.currentPlan;
  if (!APP_STATE.currentUser || !plan) return _k.defaultOpenAI;

  const tier = classifyPlan(plan.planName);
  // Lifetime = bring-your-own-key. No system fallback — services must error
  // out with a clear "please set your API key" message when unset.
  if (tier === 'lifetime')  return APP_STATE.lifetimeUserKeys.openai || '';
  if (tier === 'premium')   return _k.premiumOpenAI;
  return _k.defaultOpenAI;
}

/**
 * Returns the correct Gemini key for the currently authenticated user.
 * @returns {string}
 */
function getGeminiKey() {
  const plan = APP_STATE.currentPlan;
  if (!APP_STATE.currentUser || !plan) return _k.freeGemini;

  const tier = classifyPlan(plan.planName);
  // Lifetime = bring-your-own-key. No system fallback.
  if (tier === 'lifetime')  return APP_STATE.lifetimeUserKeys.gemini || '';
  if (tier === 'premium')   return _k.premiumGemini;
  return _k.freeGemini;
}

/**
 * Credit cost per action type.
 * Lifetime users are exempt from credit checks.
 */
const CREDIT_COSTS = Object.freeze({
  text:       1,
  voice:      1,
  screenshot: 1,
  highlight:  1,
});

/**
 * Returns true if the user's plan exempts them from credit deductions.
 */
function isCreditExempt() {
  if (!APP_STATE.currentPlan) return false;
  const tier = classifyPlan(APP_STATE.currentPlan.planName);
  return tier === 'lifetime';
}

/**
 * Returns a human-readable summary of the current user's tier.
 * @returns {{ tier: string, canUseOwnKeys: boolean, creditExempt: boolean }}
 */
function getTierSummary() {
  const plan  = APP_STATE.currentPlan;
  const tier  = plan ? classifyPlan(plan.planName) : 'free';
  return {
    tier,
    canUseOwnKeys: tier === 'lifetime',
    creditExempt:  tier === 'lifetime',
    planName:      plan?.planName || 'free',
    credits:       plan?.credits  ?? 0,
  };
}

module.exports = {
  initKeys,
  classifyPlan,
  getOpenAIKey,
  getGeminiKey,
  getTierSummary,
  isCreditExempt,
  CREDIT_COSTS,
};
