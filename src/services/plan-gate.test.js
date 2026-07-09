'use strict';
// Run with: node --test src/services/plan-gate.test.js
//
// Locks in the full Firestore plan-id matrix that the Fully Automatic
// gate must accept or reject. Without this, the strict-equality regression
// (where every -monthly / -yearly subscriber was treated as a free user)
// can re-introduce itself the next time someone touches the gate logic.

const test   = require('node:test');
const assert = require('node:assert/strict');
const { canUseFullAutoPlan } = require('./plan-gate');

// ── ELIGIBLE: paid tiers and their billing-cadence variants ─────────────
test('Ultimate bare tier is eligible', () => {
  assert.equal(canUseFullAutoPlan({ planName: 'ultimate' }), true);
});

test('Ultimate billing-cadence variants are eligible', () => {
  assert.equal(canUseFullAutoPlan({ planName: 'ultimate-monthly' }), true);
  assert.equal(canUseFullAutoPlan({ planName: 'ultimate-yearly'  }), true);
});

test('Magic bare tier and variants are eligible', () => {
  assert.equal(canUseFullAutoPlan({ planName: 'magic' }),         true);
  assert.equal(canUseFullAutoPlan({ planName: 'magic-monthly' }), true);
  assert.equal(canUseFullAutoPlan({ planName: 'magic-yearly'  }), true);
});

test('Lifetime flag short-circuits regardless of plan name', () => {
  // Backend writes lifetime plan name in several shapes — the flag is
  // authoritative.
  assert.equal(canUseFullAutoPlan({ planName: 'lifetime',         isLifetimePlan: true }), true);
  assert.equal(canUseFullAutoPlan({ planName: 'lifetime-monthly', isLifetimePlan: true }), true);
  // Even a stale planName from cache must not block lifetime users.
  assert.equal(canUseFullAutoPlan({ planName: 'free',             isLifetimePlan: true }), true);
});

// ── ELIGIBLE: Free tier (phase 1 — AssemblyAI rollout) ──────────────────
// Free users get Full-Auto access so they can evaluate it with their 15
// initial credits at 1 credit / 6s. The defensive guards below still
// reject malformed/missing plan state — only an explicit `'free'` string
// (case-insensitive) grants access.
test('Free plan is eligible (phase 1: AssemblyAI rollout)', () => {
  assert.equal(canUseFullAutoPlan({ planName: 'free' }), true);
  assert.equal(canUseFullAutoPlan({ planName: 'FREE' }), true);
  assert.equal(canUseFullAutoPlan({ planName: 'Free' }), true);
  assert.equal(canUseFullAutoPlan({ planName: '  free  ' }), true);
});

test('Missing / null plan state stays rejected (plan not loaded yet)', () => {
  // Until the renderer has loaded the user's plan, the gate must not grant
  // access — otherwise a momentarily-unauthenticated state could bypass
  // billing. The renderer re-evaluates on `plan-state-updated`.
  assert.equal(canUseFullAutoPlan({}),                      false);
  assert.equal(canUseFullAutoPlan({ planName: undefined }), false);
  assert.equal(canUseFullAutoPlan({ planName: null }),      false);
  assert.equal(canUseFullAutoPlan(null),                    false);
  assert.equal(canUseFullAutoPlan(undefined),               false);
});

// ── INELIGIBLE: lower paid tiers must stay locked out ───────────────────
test('Pro plan is rejected (paying but not eligible)', () => {
  assert.equal(canUseFullAutoPlan({ planName: 'pro' }),         false);
  assert.equal(canUseFullAutoPlan({ planName: 'pro-monthly' }), false);
  assert.equal(canUseFullAutoPlan({ planName: 'pro-yearly'  }), false);
});

test('Adjacent tier names are rejected (no false-positive prefix matches)', () => {
  // Must not match 'ultimate' as a substring or different-tier strings.
  assert.equal(canUseFullAutoPlan({ planName: 'ultimat' }),        false);
  assert.equal(canUseFullAutoPlan({ planName: 'ultra' }),          false);
  assert.equal(canUseFullAutoPlan({ planName: 'magical' }),        false);
  assert.equal(canUseFullAutoPlan({ planName: 'pro-ultimate' }),   false);
  assert.equal(canUseFullAutoPlan({ planName: 'magic_monthly' }),  false); // underscore, not hyphen
});

// ── ROBUSTNESS: case folding, whitespace, weird input ───────────────────
test('Plan names are case-insensitive', () => {
  assert.equal(canUseFullAutoPlan({ planName: 'ULTIMATE' }),         true);
  assert.equal(canUseFullAutoPlan({ planName: 'Ultimate-Monthly' }), true);
  assert.equal(canUseFullAutoPlan({ planName: 'MAGIC-YEARLY' }),     true);
});

test('Surrounding whitespace is trimmed before lookup', () => {
  assert.equal(canUseFullAutoPlan({ planName: '  ultimate-monthly  ' }), true);
  assert.equal(canUseFullAutoPlan({ planName: '\tmagic\n' }),            true);
});

test('Empty / non-string plan names are rejected (defensive)', () => {
  assert.equal(canUseFullAutoPlan({ planName: '' }),    false);
  assert.equal(canUseFullAutoPlan({ planName: '   ' }), false);
  assert.equal(canUseFullAutoPlan({ planName: 0 }),     false);
  assert.equal(canUseFullAutoPlan({ planName: false }), false);
});

// ── REGRESSION ANCHOR ───────────────────────────────────────────────────
// This is the exact scenario from the user complaint that motivated the
// fix: a paying ultimate subscriber on the monthly cadence was being
// treated as a free user. If this assertion ever fails, the regression
// is back.
test('REGRESSION: ultimate-monthly subscriber must not be locked out', () => {
  assert.equal(
    canUseFullAutoPlan({
      planName: 'ultimate-monthly',
      isLifetimePlan: false,
    }),
    true,
    'Ultimate-monthly subscriber MUST be eligible for Fully Automatic'
  );
});

// Phase 1 (AssemblyAI rollout): Free users were granted Full-Auto access
// to evaluate the feature with their 15 initial credits. If this fails,
// the renderer's Full-Auto dropdown will be disabled for Free users again
// and the AssemblyAI-primary fallback path will never be exercised.
test('PHASE 1: free subscriber must be eligible for Full-Auto', () => {
  assert.equal(
    canUseFullAutoPlan({
      planName: 'free',
      isLifetimePlan: false,
    }),
    true,
    'Free subscriber MUST be eligible for Full-Auto in phase 1'
  );
});
