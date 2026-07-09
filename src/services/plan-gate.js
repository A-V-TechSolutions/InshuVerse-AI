'use strict';
// Pure plan-tier gating logic, extracted from index.html so it can be unit
// tested across the full Firestore plan-name matrix.
//
// Background: Firestore writes plan IDs as `<tier>` for the bare tier and
// `<tier>-monthly` / `<tier>-yearly` for billing-cadence variants. The
// renderer previously used strict-equality matching against the bare tier,
// which silently locked every paying subscriber on a -monthly / -yearly
// variant out of Fully Automatic mode. The gate is now a pure function of
// the (planName, isLifetimePlan) tuple — keep it that way so this module
// stays trivially testable and the bug can't regress.

// Tiers eligible for Fully Automatic mode by plan name. Includes the bare
// tier and any billing-cadence prefix (ultimate-monthly, magic-yearly, …).
const FULL_AUTO_TIERS = ['ultimate', 'magic'];

/**
 * Returns true when the supplied plan state grants access to the
 * "Fully Automatic" proactive-listening mode.
 *
 * @param {object} state
 * @param {string} [state.planName]         Firestore plan id (case-insensitive).
 * @param {boolean} [state.isLifetimePlan]  Lifetime override flag from backend.
 * @returns {boolean}
 */
function canUseFullAutoPlan(state) {
  try {
    const s = state || {};
    if (s.isLifetimePlan)  return true;
    // Defensive: only accept string planName. A missing planName means we
    // haven't loaded the plan yet — wait, don't grant. Non-string falsy
    // values (0, false) must NOT spoof Free access.
    if (typeof s.planName !== 'string') return false;
    const plan = s.planName.toLowerCase().trim();
    if (!plan) return false;
    // Phase 1 (AssemblyAI rollout): Free users get Full-Auto access for
    // testing, metered at 1 credit / 6s like every other tier. Their 15
    // initial credits are sufficient for a ~90s evaluation session.
    if (plan === 'free') return true;
    for (const tier of FULL_AUTO_TIERS) {
      if (plan === tier) return true;
      if (plan.startsWith(tier + '-')) return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}

module.exports = { canUseFullAutoPlan, FULL_AUTO_TIERS };
