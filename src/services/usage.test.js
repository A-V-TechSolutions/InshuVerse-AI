const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  FREE_PLAN_CREDITS,
  incrementUsageAndEnforce,
} = require('./usage');

function createProfilePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'angel-usage-')), 'userProfile.json');
}

function createMainWindow(events) {
  return {
    isDestroyed: () => false,
    webContents: {
      send: (channel, payload) => events.push({ channel, payload })
    }
  };
}

test('free plan routes deductions through Firestore, not the local file', async () => {
  // Regression: the free branch previously wrote to userProfile.json so
  // Firestore credits never decremented and a fresh install / new device
  // saw a 7-credit reset. Free users now share the paid Firestore path.
  const events = [];
  const calls = [];
  let remainingCredits = FREE_PLAN_CREDITS;
  const context = {
    userProfilePath: createProfilePath(),
    currentUser: { uid: 'free-user' },
    currentHasAccess: false,
    currentPlanName: 'free',
    mainWindow: createMainWindow(events),
    currentUserCredits: FREE_PLAN_CREDITS,
    deductUserCredits: async (_uid, count) => {
      calls.push(count);
      const previousCredits = remainingCredits;
      remainingCredits -= count;
      return { success: true, previousCredits, remainingCredits };
    },
  };

  const chat = await incrementUsageAndEnforce(context, { model: 'openai', count: 1 });
  const voice = await incrementUsageAndEnforce(context, { model: 'audio', count: 2 });
  const screenshot = await incrementUsageAndEnforce(context, { model: 'gemini', count: 4 });

  // Each charge must go through deductUserCredits with the exact amount.
  assert.deepEqual(calls, [1, 2, 4]);
  assert.equal(chat.deducted, 1);
  assert.equal(voice.deducted, 2);
  assert.equal(screenshot.deducted, 4);
  assert.equal(screenshot.remaining, FREE_PLAN_CREDITS - 7);
  assert.equal(screenshot.total, 7);

  const usageUpdate = events.filter((event) => event.channel === 'response-count-update').at(-1);
  assert.deepEqual(usageUpdate.payload, {
    total: 7,
    openai: 0,
    gemini: 4,
    remaining: FREE_PLAN_CREDITS - 7,
    credits: FREE_PLAN_CREDITS - 7,
    planName: 'free',
    restricted: true,
  });
});

test('free plan shows access denied when Firestore credits hit zero', async () => {
  const events = [];
  const context = {
    userProfilePath: createProfilePath(),
    currentUser: { uid: 'free-exhausted' },
    currentHasAccess: false,
    currentPlanName: 'free',
    mainWindow: createMainWindow(events),
    currentUserCredits: FREE_PLAN_CREDITS,
    deductUserCredits: async () => ({ success: true, previousCredits: FREE_PLAN_CREDITS, remainingCredits: 0 }),
  };

  const result = await incrementUsageAndEnforce(context, { model: 'openai', count: FREE_PLAN_CREDITS });

  assert.equal(result.remaining, 0);
  assert.ok(events.some((event) => event.channel === 'show-access-denied'));
});

test('free plan surfaces deduction failure as access-denied when server confirms zero balance', async () => {
  // Previously the free branch would happily increment the local file even
  // if Firestore was unreachable. The new C3 path must show access-denied
  // ONLY when the server explicitly returns remainingCredits:0 (confirmed
  // exhaustion). A network failure with remainingCredits:null is a transient
  // error and must NOT show the modal (tested by the C3 suite below).
  const events = [];
  const context = {
    userProfilePath: createProfilePath(),
    currentUser: { uid: 'free-firestore-down' },
    currentHasAccess: false,
    currentPlanName: 'free',
    mainWindow: createMainWindow(events),
    currentUserCredits: FREE_PLAN_CREDITS,
    // success:false + remainingCredits:0 = server confirmed zero (case c)
    deductUserCredits: async () => ({ success: false, remainingCredits: 0 }),
  };

  const result = await incrementUsageAndEnforce(context, { model: 'openai', count: 1 });

  assert.equal(result.success, false);
  // C3 now distinguishes "exhausted" (server confirmed zero) from "deduction-failed"
  assert.equal(result.reason, 'exhausted');
  assert.ok(events.some((event) => event.channel === 'show-access-denied'));
});

test('paid plan deducts the exact requested credit amounts', async () => {
  const calls = [];
  let remainingCredits = 20;
  const context = {
    userProfilePath: createProfilePath(),
    currentUser: { uid: 'paid-user' },
    currentHasAccess: false,
    currentPlanName: 'pro',
    mainWindow: createMainWindow([]),
    currentUserCredits: 20,
    deductUserCredits: async (_uid, count) => {
      calls.push(count);
      const previousCredits = remainingCredits;
      remainingCredits -= count;
      return { success: true, previousCredits, remainingCredits };
    }
  };

  const chat = await incrementUsageAndEnforce(context, { model: 'openai', count: 1 });
  const voice = await incrementUsageAndEnforce(context, { model: 'audio', count: 2 });
  const screenshot = await incrementUsageAndEnforce(context, { model: 'gemini', count: 4 });

  assert.deepEqual(calls, [1, 2, 4]);
  assert.equal(chat.remaining, 19);
  assert.equal(voice.remaining, 17);
  assert.equal(screenshot.remaining, 13);
});

test('lifetime plans skip deduction entirely', async () => {
  let called = false;
  const result = await incrementUsageAndEnforce({
    userProfilePath: createProfilePath(),
    currentUser: { uid: 'lifetime-user' },
    currentHasAccess: true,
    currentPlanName: 'lifetime',
    mainWindow: createMainWindow([]),
    currentUserCredits: null,
    deductUserCredits: async () => {
      called = true;
      return { success: true, previousCredits: null, remainingCredits: null };
    }
  }, { model: 'openai', count: 1 });

  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'unrestricted-plan');
  assert.equal(called, false);
});

// ── C3: Transient failure vs zero-balance exhaustion ─────────────────────────

test('C3: transient Cloud Function failure does NOT trigger show-access-denied', async () => {
  // When deductUserCredits returns success:false but remainingCredits is null
  // (network error / CF cold start), the modal must NOT appear.
  const events = [];
  const context = {
    userProfilePath: createProfilePath(),
    currentUser: { uid: 'transient-fail-user' },
    currentHasAccess: false,
    currentPlanName: 'pro',
    mainWindow: createMainWindow(events),
    currentUserCredits: 50,
    deductUserCredits: async () => ({ success: false, remainingCredits: null }),
  };

  const result = await incrementUsageAndEnforce(context, { model: 'openai', count: 1 });

  assert.equal(result.success, false);
  assert.equal(result.transient, true);
  assert.equal(result.reason, 'transient');
  // Must NOT fire access-denied
  assert.ok(!events.some((e) => e.channel === 'show-access-denied'),
    'show-access-denied must not fire on transient failure');
  // Must fire usage-warning instead
  assert.ok(events.some((e) => e.channel === 'usage-warning'),
    'usage-warning must fire on transient failure');
});

test('C3: transient failure for free plan also suppresses access-denied modal', async () => {
  const events = [];
  const context = {
    userProfilePath: createProfilePath(),
    currentUser: { uid: 'free-transient' },
    currentHasAccess: false,
    currentPlanName: 'free',
    mainWindow: createMainWindow(events),
    currentUserCredits: 10,
    deductUserCredits: async () => ({ success: false, remainingCredits: undefined }),
  };

  const result = await incrementUsageAndEnforce(context, { model: 'openai', count: 1 });

  assert.equal(result.transient, true);
  assert.ok(!events.some((e) => e.channel === 'show-access-denied'),
    'free-plan transient failure must not show access-denied');
});

test('C3: server-confirmed zero balance shows access-denied (exhausted path)', async () => {
  // deductUserCredits returns success:false AND remainingCredits:0 —
  // the server explicitly said the user has no credits.
  const events = [];
  const context = {
    userProfilePath: createProfilePath(),
    currentUser: { uid: 'confirmed-zero' },
    currentHasAccess: false,
    currentPlanName: 'pro',
    mainWindow: createMainWindow(events),
    currentUserCredits: 1,
    deductUserCredits: async () => ({ success: false, remainingCredits: 0 }),
  };

  const result = await incrementUsageAndEnforce(context, { model: 'openai', count: 1 });

  assert.equal(result.success, false);
  assert.equal(result.reason, 'exhausted');
  assert.equal(result.exceeded, true);
  assert.ok(events.some((e) => e.channel === 'show-access-denied'),
    'server-confirmed zero must fire show-access-denied');
});

test('C3: successful deduction reaching zero shows access-denied', async () => {
  // success:true, remaining:0 → user just ran out of credits via a successful call.
  const events = [];
  const context = {
    userProfilePath: createProfilePath(),
    currentUser: { uid: 'just-exhausted' },
    currentHasAccess: false,
    currentPlanName: 'pro',
    mainWindow: createMainWindow(events),
    currentUserCredits: 1,
    deductUserCredits: async () => ({ success: true, previousCredits: 1, remainingCredits: 0 }),
  };

  const result = await incrementUsageAndEnforce(context, { model: 'openai', count: 1 });

  assert.equal(result.success, true);
  assert.equal(result.remaining, 0);
  assert.equal(result.exceeded, true);
  assert.ok(events.some((e) => e.channel === 'show-access-denied'),
    'confirmed exhaustion via successful deduction must fire show-access-denied');
});

test('C3: successful deduction with positive remaining does not show access-denied', async () => {
  const events = [];
  const context = {
    userProfilePath: createProfilePath(),
    currentUser: { uid: 'still-has-credits' },
    currentHasAccess: false,
    currentPlanName: 'pro',
    mainWindow: createMainWindow(events),
    currentUserCredits: 10,
    deductUserCredits: async () => ({ success: true, previousCredits: 10, remainingCredits: 9 }),
  };

  const result = await incrementUsageAndEnforce(context, { model: 'openai', count: 1 });

  assert.equal(result.success, true);
  assert.equal(result.remaining, 9);
  assert.equal(result.exceeded, false);
  assert.ok(!events.some((e) => e.channel === 'show-access-denied'),
    'positive remaining must not fire show-access-denied');
});