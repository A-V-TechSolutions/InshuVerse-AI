const fs = require('fs');

const FREE_PLAN_CREDITS = 7;

function readUserProfile(userProfilePath) {
  try {
    if (fs.existsSync(userProfilePath)) {
      const data = fs.readFileSync(userProfilePath, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('Failed to read user profile file:', e);
  }
  return {};
}

function writeUserProfile(userProfilePath, obj) {
  try {
    fs.writeFileSync(userProfilePath, JSON.stringify(obj, null, 2));
  } catch (e) {
    console.error('Failed to write user profile file:', e);
  }
}

function getUsageForUid(userProfilePath, uid) {
  const profile = readUserProfile(userProfilePath);
  if (!profile.usage) profile.usage = {};
  if (!profile.usage[uid]) {
    profile.usage[uid] = { total: 0, openai: 0, gemini: 0 };
    writeUserProfile(userProfilePath, profile);
  }
  return profile.usage[uid];
}

function setUsageForUid(userProfilePath, uid, usage) {
  const profile = readUserProfile(userProfilePath);
  if (!profile.usage) profile.usage = {};
  profile.usage[uid] = usage;
  writeUserProfile(userProfilePath, profile);
}

function isRestrictedUser(currentHasAccess, currentPlanName) {
  // Lifetime plans bring-your-own-key and are never restricted by credits.
  const unrestrictedPlans = new Set([
    'lifetime', 'angel-lifetime', 'lifetime-monthly', 'lifetime-yearly',
    'angel-lifetime-monthly', 'angel-lifetime-yearly'
  ]);
  if (currentPlanName && unrestrictedPlans.has((currentPlanName || '').toLowerCase())) {
    return false; // Unrestricted access
  }

  // All other plans (including paid plans) are credit-based and restricted
  return true; // Non-unrestricted users are subject to credit restrictions
}

function sendUsageUpdate(mainWindow, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('response-count-update', payload);
  }
}

function sendAccessDenied(mainWindow) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('show-access-denied');
  }
}

// New credit-based usage enforcement function
async function incrementUsageAndEnforce({ userProfilePath, currentUser, currentHasAccess, currentPlanName, mainWindow, currentUserCredits, deductUserCredits }, modelOrOptions) {
  try {
    if (!currentUser || !currentUser.uid) {
      return { skipped: true, reason: 'no-user' };
    }
    if (!isRestrictedUser(currentHasAccess, currentPlanName)) {
      return { skipped: true, reason: 'unrestricted-plan' };
    }

    // Back-compat: if caller passed a string, treat it as model with count=1
    let model = 'openai';
    let count = 1;
    if (typeof modelOrOptions === 'string') {
      model = modelOrOptions || 'openai';
    } else if (modelOrOptions && typeof modelOrOptions === 'object') {
      model = modelOrOptions.model || 'openai';
      count = Number(modelOrOptions.count || 1);
      if (!Number.isFinite(count) || count < 1) count = 1;
    }

    const uid = currentUser.uid;

    // C3: Unified deduction path for free and paid plans. Both call the
    // same Firestore-backed Cloud Function (deductUserCredits). We distinguish
    // three outcomes:
    //
    //  (a) success:true, remaining >= 0  → authoritative balance; send UI update.
    //      remaining === 0 means confirmed exhaustion → show access-denied modal.
    //  (b) success:false, remainingCredits > 0 or remainingCredits is null
    //      → transient network / Cloud Function failure. The user likely still
    //      has credits. Do NOT show the modal; return {transient:true} so the
    //      caller can show a soft warning (toast) instead.
    //  (c) success:false, remainingCredits === 0 (server confirmed zero)
    //      → genuine exhaustion during a CF error path. Show access-denied.
    //
    // This prevents the "Out of Credits" modal from appearing for users who
    // have a positive balance but suffer a momentary Firestore outage.

    if (typeof deductUserCredits !== 'function') {
      return { success: false, reason: 'missing-deduct-function', remaining: currentUserCredits || 0 };
    }

    const result = await deductUserCredits(uid, count);

    // ── (a) Successful deduction ─────────────────────────────────────────
    if (result && result.success) {
      const remaining      = typeof result.remainingCredits === 'number' ? result.remainingCredits : 0;
      const previousCredits = typeof result.previousCredits === 'number'
        ? result.previousCredits
        : (typeof currentUserCredits === 'number' ? currentUserCredits : null);
      const planCreditsBase = currentPlanName === 'free' ? FREE_PLAN_CREDITS : (previousCredits || 0);
      const total = typeof previousCredits === 'number'
        ? Math.max(0, planCreditsBase - remaining)
        : count;

      sendUsageUpdate(mainWindow, {
        total,
        openai: model === 'gemini' ? 0 : count,
        gemini: model === 'gemini' ? count : 0,
        remaining,
        credits: remaining,
        planName: currentPlanName,
        restricted: true,
      });

      // Confirmed zero balance — show the access-denied modal.
      if (remaining <= 0) {
        console.warn('[CREDITS] Balance confirmed at zero for', uid, '— showing access-denied.');
        sendAccessDenied(mainWindow);
      }

      return {
        success:       true,
        planName:      currentPlanName,
        deducted:      count,
        previousCredits,
        remaining,
        total,
        exceeded:      remaining <= 0,
      };
    }

    // ── (b)/(c) Deduction failed ─────────────────────────────────────────
    // Distinguish transient failures from server-confirmed exhaustion.
    // `result.remainingCredits === 0` when the server has verified the
    // balance is zero (true exhaustion). Any other value (including null /
    // undefined) means the Cloud Function itself failed transiently.
    const serverConfirmedZero = result && typeof result.remainingCredits === 'number' && result.remainingCredits === 0;

    if (serverConfirmedZero) {
      // (c) Genuine exhaustion surfaced through the error path.
      console.warn('[CREDITS] Server confirmed zero balance for', uid);
      sendAccessDenied(mainWindow);
      return { success: false, reason: 'exhausted', remaining: 0, exceeded: true };
    }

    // (b) Transient failure — network outage, Cloud Function cold start, etc.
    // Soft-fail: emit a usage-warning event so a toast can appear, but do NOT
    // block the user with the access-denied modal.
    console.warn('[CREDITS] Transient deduction failure for', uid, '— not showing access-denied modal.');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('usage-warning', {
        reason: 'transient-failure',
        message: 'Could not verify credits — check your connection.',
      });
    }
    return { success: false, reason: 'transient', transient: true, remaining: currentUserCredits || 0 };
  } catch (e) {
    console.error('Failed to increment usage:', e);
    return { success: false, reason: 'exception', error: e.message };
  }
}

module.exports = {
  FREE_PLAN_CREDITS,
  readUserProfile,
  writeUserProfile,
  getUsageForUid,
  setUsageForUid,
  isRestrictedUser,
  incrementUsageAndEnforce,
};
