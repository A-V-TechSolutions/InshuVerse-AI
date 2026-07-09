// Pure resolver for `text-input` IPC billing decisions.
//
// Two billing scopes can apply to a text-input event:
//
//   * skipBilling — caller is already covered by a metered timer (e.g.
//     proactive Full-Auto runs a 1cr / 6s meter that covers both the
//     listening AND the auto-answer; per-answer billing here would
//     double-charge).
//
//   * voiceCommit — answer was triggered by a voice/transcript commit
//     (Manual mode mic press). Voice answers cost 2 credits.
//
// Default (neither flag set) is a typed chat answer at 1 credit.
//
// skipBilling wins if both are set — the meter takes precedence so a
// runtime ordering bug can never double-charge an active meter.
function resolveTextInputBilling({ skipBilling = false, voiceCommit = false } = {}) {
  if (skipBilling) return { skip: true, count: 0, reason: 'metered' };
  if (voiceCommit) return { skip: false, count: 1, reason: 'voice-commit' };
  return { skip: false, count: 1, reason: 'chat' };
}

module.exports = { resolveTextInputBilling };
