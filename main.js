const { app, BrowserWindow, ipcMain, systemPreferences, shell, desktopCapturer, globalShortcut, Tray, Menu, nativeImage, session, dialog, clipboard, nativeTheme } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')

const OpenAI = require('openai')
const { GoogleGenerativeAI } = require('@google/generative-ai')
const { resolveModel, callWithFallback } = require('./src/services/model-registry')

// ── Modular architecture — new modules ────────────────────────────────────
// These replace the scattered inline logic that previously lived directly
// in this file. Existing code still works; new code uses these modules.
const { APP_STATE }             = require('./src/state/app-state')
const CH                        = require('./src/ipc/channels')
const _tiers                    = require('./src/auth/tiers')
const { registerHideModeHandlers,
        enableHideMode,
        loadHideModeFlag,
        detectAppTranslocation }           = require('./src/window/hide-mode')
const { registerHighlightShortcut,
        registerHighlightIpcHandler }      = require('./src/services/vision/highlight')
const ghostTyping                          = require('./src/services/ghost-typing')
// ──────────────────────────────────────────────────────────────────────────

// Services (modularized) — KeyPool + model-selection drive every call site,
// so the legacy *WithFallback / *WithParallelRacing variants are unreferenced.
const {
  transcribeWithModelSelection: transcribeWithModelSelectionSvc
} = require('./src/services/transcription')
const {
  getAnswerWithModelSelection: getAnswerWithModelSelectionSvc
} = require('./src/services/answer')
const {
  answerFromImageWithModelSelectionStream: answerFromImageWithModelSelectionStreamSvc
} = require('./src/services/screenshot')
const { auth, checkUserPlan, handleUserLogin, updateUserCredits, deductUserCredits, getPlanCredits, getGoogleAuthDetails, signInWithCredential, GoogleAuthProvider } = require('./firebase-config')
const {
  readUserProfile: readUserProfileSvc,
  writeUserProfile: writeUserProfileSvc,
  getUsageForUid: getUsageForUidSvc,
  setUsageForUid: setUsageForUidSvc,
  isRestrictedUser: isRestrictedUserSvc,
  FREE_PLAN_CREDITS,
  incrementUsageAndEnforce: incrementUsageAndEnforceSvc,
} = require('./src/services/usage')
const { resolveTextInputBilling } = require('./src/services/billing-mode')

	const http = require('http')
	const url = require('url')
	const tmp = require('tmp');
	// Optional dependency: ws (WebSocket) – used by the Deepgram proactive
	// streaming pipeline. In production builds if ws is not installed, the
	// proactive feature is silently disabled but the rest of the app works.
	let WebSocket = null;
	try {
	  WebSocket = require('ws');
	} catch (e) {
	  console.warn('[PROACTIVE] Optional dependency "ws" not found; live streaming disabled.');
	}

	// AES-256-GCM crypto vault for vendor + user API keys.
	const cryptoVault = require('./src/services/crypto-vault');
	// Deepgram WebSocket wrapper (proactive listening — primary for paid users,
	// fallback for free users).
	const deepgramStream = require('./src/services/deepgram-stream');
	// AssemblyAI Universal-Streaming wrapper (primary for free users, fallback
	// for paid users). Public surface mirrors deepgramStream so the proactive
	// IPC handler can swap providers without per-call branching.
	const assemblyAIStream = require('./src/services/assemblyai-stream');
	// Provider-aware key rotation with cooldown + quarantine.
	const { KeyPool } = require('./src/services/keypool');
	const keyPool = new KeyPool();

// Global variables
let mainWindow = null
let recording = null
let isRecording = false
let currentTranscript = ''
let answerDebounceTimer = null
let currentUser = null
let userResume = null; // Global variable to store user's resume
let userJobDescription = null; // Global variable to store job description
let userConfiguration = null; // Global variable to store multi-purpose configuration
// User-configurable API keys - loaded from user data or set by user
let userOpenAIKey = null; // Will be loaded from user data or set by user
let userGeminiKey = null; // Will be loaded from user data or set by user
// Lifetime-only: user-supplied Deepgram key. When unset on a lifetime plan,
// proactive listening (Manual / Fully Auto) is hidden in the renderer.
let userDeepgramKey = null;
// Lifetime-only: user-supplied AssemblyAI key. Either Deepgram or
// AssemblyAI is sufficient to unlock proactive listening for a lifetime
// user — the proactive-start handler picks whichever is available.
let userAssemblyAIKey = null;
console.log('[API] API keys will be loaded from user data');
let selectedAPI = 'openai'; // fixed to openai
let responseSize = 'small'; // default to small — concise answers by default
let currentPlanName = 'free';
let currentHasAccess = false; // if true, do not enforce limits
let currentIsLifetimePlan = false; // if true, user provides their own API keys
let currentIsUnlimitedPlan = false; // if true, unlimited access with default keys

let currentUserCredits = FREE_PLAN_CREDITS; // current user's available credits
let currentSubscription = {}; // current user's subscription data

// Default vendor keys – stored as AES-256-GCM ciphertext (see crypto-vault.js).
// Generated with `node scripts/_gen_encrypted_keys.js`. Decrypted at startup.
const DEFAULT_OPENAI_KEY_ENC      = "v1:vE4fAq+4K1/Dr4Lh:RO8RPcJPWzp5LcUY9BwydA==:0j1wmVo43/YI6bprUXT8gQD/eQwe3CoXoad5GmZ6PnOIs+tkQL807i0RRAtDbUXVAaIU/qE4bVyGpJj2Tlna972MYTCznJS/YQZM9/EEeK6u/qfz5W1+XqcoEIWcsy+ZSzMUrFNtWsnzrnWB4gEUaj84d7Jpg8kR03aPBkOekkiRBVm5nRRgM++xrNjb9XxOLgaHpsb7+YRjAcsel2GsjbknsIY=";
const PREMIUM_OPENAI_KEY_ENC      = "v1:bpiyEHEr1awb4eoW:16nkesHtT/qTQdab9t2w3A==:NGreRMELwzJ16AtebTNwZGoKXIHdC7CWPT7Icyt0ZYyPt9L5UQKY+M2BKKyha4ooWObZQWaUGT0d5egbsyCszbxATxe+6umbThHSvJuxRk/nu1MJy24aCOfA+a5EfEb4O4XIGESdfUdr6JehdDjqxLymPmaSDkT+zNkIA3JvFBqF0PRzZ+FBO2zuF3z01v/3V9mG/AvdRD2/GQcMTkLnSTEhHzo=";
const DEFAULT_GEMINI_KEY_ENC      = "v1:6pQhdWhqzxd5Qm0I:0vC7f9UZ5fPvpLPulJc6pA==:6LfYyJAVaJ4MqxQ/0QvEjcx38MOg6DWYO0JN5dwPWD7pKBNqpA+d";
const GEMINI_FALLBACK_FREE_KEY_ENC = "v1:FdEDa95R+m/EIKNV:g+20i5ys7XqJ4POUnoybOQ==:paFyRs4Ker6zlAuY/NLUgVl/VNkovSlqHZi12nA9vfR6xPfWRlwv";
const DEFAULT_DEEPGRAM_KEY_ENC    = "v1:sQ52aLW8Y3UU6iSe:5iiMcI6M1vu04E1S8TK8Nw==:Hi5TETe3nqdGsifTt5mySjH0aHkKAXGjCF3t6wNeWQSZapa7akzbPw==";
// Free-tier Deepgram key — separate Deepgram project so free traffic bills
// against its own budget and any throttling/quarantine cannot affect paid
// or lifetime users (see getDeepgramKey() routing).
const FREE_DEEPGRAM_KEY_ENC       = "v1:PUXPi3cbuRCtaInr:QRcjHMzNTSI2ZkHIpWqc2A==:K9fJgoWuAHEPa/S9sr2ZwsNXiny1pAMz4cUdiR3hD1rG4AyMUDAO/Q==";
// AssemblyAI Universal-Streaming v3 — phase 1 of the multi-provider
// transcription rollout. Free / Pro keys live on separate AssemblyAI
// projects so a free-tier quarantine cannot affect paid traffic (same
// project-isolation pattern as Deepgram).
const ASSEMBLYAI_FREE_KEY_ENC     = "v1:9hNP5asJLYsi0qUN:dqsR+eQaQfCy3T3fcjKw1w==:nnANQVpFH7HlZCDeKrBspK14KSAxqEV2yl5aNVm1z14=";
const ASSEMBLYAI_PRO_KEY_ENC      = "v1:MWDpFxcCqQItqEAd:si3Dfe27D9onjSQTVzlGjA==:OWdTmqdDiYvPYeeuxKLvaF07jV9nY3zQPoTZFGBsvV4=";
// Second free-tier Gemini key — registered alongside GEMINI_FALLBACK_FREE_KEY
// in the gemini/free bucket so a single quota burst cannot take the whole
// free Gemini pool offline.
const GEMINI_FALLBACK_FREE_KEY_2_ENC = "v1:NbMVCAovjMvb4Cqw:D6cpVZ52SA+N81ZqTP+AMA==:lLc9QLCG7gd1BvloVjOzUntMPtC71TZLdU94U51fEjxogGNQFz52";

const DEFAULT_OPENAI_KEY        = cryptoVault.decryptApp(DEFAULT_OPENAI_KEY_ENC);
const PREMIUM_OPENAI_KEY        = cryptoVault.decryptApp(PREMIUM_OPENAI_KEY_ENC);
const DEFAULT_GEMINI_KEY        = cryptoVault.decryptApp(DEFAULT_GEMINI_KEY_ENC);
// Treat DEFAULT_GEMINI_KEY as the current premium app key unless a separate premium is provided
const PREMIUM_GEMINI_KEY        = DEFAULT_GEMINI_KEY;
const GEMINI_FALLBACK_FREE_KEY  = cryptoVault.decryptApp(GEMINI_FALLBACK_FREE_KEY_ENC);
const GEMINI_FALLBACK_FREE_KEY_2 = cryptoVault.decryptApp(GEMINI_FALLBACK_FREE_KEY_2_ENC);
const DEFAULT_DEEPGRAM_KEY      = cryptoVault.decryptApp(DEFAULT_DEEPGRAM_KEY_ENC);
const FREE_DEEPGRAM_KEY         = cryptoVault.decryptApp(FREE_DEEPGRAM_KEY_ENC);
const ASSEMBLYAI_FREE_KEY       = cryptoVault.decryptApp(ASSEMBLYAI_FREE_KEY_ENC);
const ASSEMBLYAI_PRO_KEY        = cryptoVault.decryptApp(ASSEMBLYAI_PRO_KEY_ENC);
// Alias for clarity
const FREE_GEMINI_KEY = GEMINI_FALLBACK_FREE_KEY;

// Bridge the hardcoded keys into tiers.js so getOpenAIKey()/getGeminiKey()
// return the correct keys for every plan (they previously read process.env
// which is empty in development builds, causing all users to get blank keys).
_tiers.initKeys({
  defaultOpenAI: DEFAULT_OPENAI_KEY,
  premiumOpenAI: PREMIUM_OPENAI_KEY,
  premiumGemini: PREMIUM_GEMINI_KEY,
  freeGemini:    FREE_GEMINI_KEY,
});

// Register vendor-managed keys into the rotation pool. Lifetime user keys
// are registered separately on login / plan change / key save, scoped per
// user id so one lifetime user's failures cannot poison another's pool.
function _registerVendorKeys() {
  if (DEFAULT_OPENAI_KEY) keyPool.addKey({ provider: 'openai', org: 'org-a',  id: 'openai-default', value: DEFAULT_OPENAI_KEY });
  if (PREMIUM_OPENAI_KEY) keyPool.addKey({ provider: 'openai', org: 'org-b',  id: 'openai-premium', value: PREMIUM_OPENAI_KEY });
  if (DEFAULT_GEMINI_KEY) keyPool.addKey({ provider: 'gemini', org: 'premium', id: 'gemini-premium', value: DEFAULT_GEMINI_KEY });
  if (GEMINI_FALLBACK_FREE_KEY)   keyPool.addKey({ provider: 'gemini', org: 'free', id: 'gemini-free',   value: GEMINI_FALLBACK_FREE_KEY });
  if (GEMINI_FALLBACK_FREE_KEY_2) keyPool.addKey({ provider: 'gemini', org: 'free', id: 'gemini-free-2', value: GEMINI_FALLBACK_FREE_KEY_2 });
  // AssemblyAI Universal-Streaming pools — separate projects per tier so
  // free quarantines never poison paid traffic (see getAssemblyAIKey()).
  if (ASSEMBLYAI_FREE_KEY) keyPool.addKey({ provider: 'assemblyai', org: 'free', id: 'assemblyai-free', value: ASSEMBLYAI_FREE_KEY });
  if (ASSEMBLYAI_PRO_KEY)  keyPool.addKey({ provider: 'assemblyai', org: 'pro',  id: 'assemblyai-pro',  value: ASSEMBLYAI_PRO_KEY });
}
_registerVendorKeys();

function _lifetimeUserId() {
  return (currentUser && (currentUser.uid || currentUser.email)) || 'anon';
}

function _registerLifetimeUserKeys() {
  const userId = _lifetimeUserId();
  keyPool.removeLifetimeUser(userId);
  if (!currentIsLifetimePlan) return;
  if (userOpenAIKey) keyPool.addKey({ provider: 'openai', org: `lifetime:${userId}`, id: `openai-lifetime-${userId}`, value: userOpenAIKey });
  if (userGeminiKey) keyPool.addKey({ provider: 'gemini', org: `lifetime:${userId}`, id: `gemini-lifetime-${userId}`, value: userGeminiKey });
}

// ── Keypool acquisition wrapper ──────────────────────────────────────────
// Resolves the (openai, gemini) bucket pair for the current plan, hands
// healthy keys to `fn`, and reports the outcome back so cooldown/quarantine
// state advances. When the pool returns null (bucket empty or all keys in
// cooldown) we fall back to the legacy resolver — same key the app used
// before keypool existed — so behaviour never regresses.
function _bucketsForCurrentPlan() {
  if (currentIsLifetimePlan) {
    const userId = _lifetimeUserId();
    return {
      openai: { provider: 'openai', org: `lifetime:${userId}` },
      gemini: { provider: 'gemini', org: `lifetime:${userId}` },
    };
  }
  const plan = (currentPlanName || '').toLowerCase();
  const isPremium = currentIsUnlimitedPlan || (plan && plan !== 'free');
  return {
    openai: { provider: 'openai', org: isPremium ? 'org-b'   : 'org-a' },
    gemini: { provider: 'gemini', org: isPremium ? 'premium' : 'free'  },
  };
}

function _extractErrorStatus(err) {
  if (!err) return 0;
  if (typeof err.status === 'number') return err.status;
  if (typeof err.statusCode === 'number') return err.statusCode;
  if (err.response && typeof err.response.status === 'number') return err.response.status;
  const m = String(err.message || err).match(/\b(401|403|404|408|429|500|502|503|504)\b/);
  return m ? Number(m[1]) : 0;
}

// withKeyRotation(fn) — wraps a service call so the keypool can rotate
// credentials on auth/quota failures without changing service signatures.
// `fn` receives `{ userOpenAIKey, userGeminiKey }` and is expected to
// resolve with `{ provider }` when known so we can attribute success.
//
// Transient retry: when a request fails with 429, 5xx, timeout, or an
// unattributable error, the failed key is cooled down via reportResult and
// we make a second attempt. The pool's round-robin returns a different
// healthy key on the second acquire, so the user perceives one continuous
// request even when a key hits its quota mid-flight. Auth (401/403) and
// other deterministic 4xx errors propagate immediately — retrying with a
// rotated key would not change the outcome and would burn the second key.
const _KEYPOOL_RETRY_CODES = new Set([0, 408, 429, 500, 502, 503, 504]);
const _KEYPOOL_MAX_ATTEMPTS = 2;

async function _runKeyRotationOnce(fn) {
  const buckets = _bucketsForCurrentPlan();
  const pickedOpenAI = keyPool.acquireKey(buckets.openai);
  const pickedGemini = keyPool.acquireKey(buckets.gemini);
  const keys = {
    userOpenAIKey: pickedOpenAI ? pickedOpenAI.value : getOpenAIKey(),
    userGeminiKey: pickedGemini ? pickedGemini.value : getGeminiKey(),
  };
  try {
    const result = await fn(keys);
    const winner = result && (result.provider || (result.text && result.provider));
    if (pickedOpenAI && (!winner || String(winner).startsWith('openai'))) keyPool.reportResult(pickedOpenAI.id, { ok: true });
    if (pickedGemini && (!winner || String(winner).startsWith('gemini'))) keyPool.reportResult(pickedGemini.id, { ok: true });
    return { ok: true, result };
  } catch (err) {
    const code = _extractErrorStatus(err);
    if (pickedOpenAI) keyPool.reportResult(pickedOpenAI.id, { ok: false, errCode: code });
    if (pickedGemini) keyPool.reportResult(pickedGemini.id, { ok: false, errCode: code });
    return { ok: false, err, code };
  }
}

async function withKeyRotation(fn) {
  let lastErr;
  for (let attempt = 1; attempt <= _KEYPOOL_MAX_ATTEMPTS; attempt++) {
    const out = await _runKeyRotationOnce(fn);
    if (out.ok) return out.result;
    lastErr = out.err;
    if (!_KEYPOOL_RETRY_CODES.has(out.code)) break;
    if (attempt >= _KEYPOOL_MAX_ATTEMPTS) break;
    console.warn('[KEYPOOL] Transient error', out.code,
      '— retrying with rotated key. Original error:',
      out.err && out.err.message);
  }
  throw lastErr;
}

// Define path for user profile data
const userProfilePath = path.join(app.getPath('userData'), 'userProfile.json');

// Create a backup of window position and size for restoring

// Persisted Google OAuth tokens for silent auth
const TOKENS_PATH = path.join(app.getPath('userData'), 'google_oauth_tokens.json');

// Attempt silent sign-in using stored Google refresh_token
async function trySilentAuthWithRefreshToken() {
  try {
    if (!fs.existsSync(TOKENS_PATH)) return null;
    const raw = fs.readFileSync(TOKENS_PATH, 'utf8');
    const saved = JSON.parse(raw || '{}');
    const refresh = saved && saved.refresh_token;
    if (!refresh) return null;

    const { OAUTH_CLIENT_ID, CLIENT_SECRET } = getGoogleAuthDetails();
    const params = new URLSearchParams({
      client_id: OAUTH_CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refresh
    });

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });
    const tokens = await tokenResponse.json();
    if (!tokens || !tokens.access_token) return null;

    const credential = GoogleAuthProvider.credential(null, tokens.access_token);
    const result = await signInWithCredential(auth, credential);
    currentUser = result.user;
    console.log('[AUTH] Silent sign-in successful for', currentUser && currentUser.email);
    return currentUser;
  } catch (e) {
    console.warn('[AUTH] Silent sign-in failed:', e && e.message ? e.message : e);
    return null;
  }
}

let windowState = {
  width: 624,
  height: 600,
  x: null,
  y: null
};

// Hide Mode state lives in APP_STATE.isInScreenSharingMode (single source
// of truth). src/window/hide-mode.js owns reads/writes; main.js no longer
// keeps a duplicate local flag.
let authAlwaysOnTopSuspended = false;
// Prevent duplicate screenshot processing
let isProcessingScreenshot = false;

function applyPlatformAlwaysOnTop(enabled) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  if (!enabled) {
    mainWindow.setAlwaysOnTop(false);
    return;
  }

  if (process.platform === 'darwin') {
    mainWindow.setAlwaysOnTop(true, 'floating', 1);
  } else if (process.platform === 'win32') {
    mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  } else {
    mainWindow.setAlwaysOnTop(true);
  }
}

function syncAlwaysOnTop(reason) {
  try {
    applyPlatformAlwaysOnTop(!authAlwaysOnTopSuspended);
    console.log(`[WINDOW] Always-on-top ${authAlwaysOnTopSuspended ? 'disabled' : 'enabled'} (${reason || 'sync'})`);
  } catch (error) {
    console.warn('[WINDOW] Failed to sync always-on-top:', error && error.message ? error.message : error);
  }
}

function suspendAlwaysOnTopForAuth() {
  authAlwaysOnTopSuspended = true;
  syncAlwaysOnTop('auth-start');
}

function restoreAlwaysOnTopAfterAuth(reason) {
  authAlwaysOnTopSuspended = false;
  syncAlwaysOnTop(reason || 'auth-complete');
}

function applyPlanState(planCheck = {}) {
  currentPlanName = planCheck.planName || currentPlanName || 'free';
  currentHasAccess = !!planCheck.hasAccess;
  currentIsLifetimePlan = !!planCheck.isLifetimePlan;
  currentIsUnlimitedPlan = !!planCheck.isUnlimitedPlan;
  currentUserCredits = typeof planCheck.credits === 'number'
    ? planCheck.credits
    : ((currentPlanName || '').toLowerCase() === 'free' ? FREE_PLAN_CREDITS : currentUserCredits || 0);
  currentSubscription = planCheck.subscription || currentSubscription || {};

  // ── Sync to APP_STATE so src/auth/tiers.js can read the plan ─────────
  APP_STATE.currentPlan = planCheck;
  APP_STATE.currentUser = currentUser;
  // ─────────────────────────────────────────────────────────────────────
  // Re-register lifetime keys whenever plan state changes — handles
  // login, plan upgrade/downgrade, and the lifetime-only key buckets.
  try { _registerLifetimeUserKeys(); } catch (_) {}

  // C1: Broadcast credit / plan state to the renderer immediately so the
  // UI reflects the authoritative Firestore value without waiting for a
  // manual "Recheck". This also auto-dismisses the "Out of Credits" overlay
  // when a top-up is detected on the next check-auth / get-usage round-trip.
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('credits-updated', currentUserCredits);
      mainWindow.webContents.send('plan-updated', {
        planName:        currentPlanName,
        credits:         currentUserCredits,
        hasAccess:       currentHasAccess,
        isLifetimePlan:  currentIsLifetimePlan,
        isUnlimitedPlan: currentIsUnlimitedPlan,
      });
    }
  } catch (_) {}
}

function persistLastKnownPlanData() {
  try {
    const profile = fs.existsSync(userProfilePath)
      ? JSON.parse(fs.readFileSync(userProfilePath, 'utf8'))
      : {};
    profile.lastKnownCredits = currentUserCredits;
    profile.lastKnownPlan = currentPlanName;
    profile.lastCreditUpdate = new Date().toISOString();
    fs.writeFileSync(userProfilePath, JSON.stringify(profile, null, 2));
  } catch (e) {
    console.warn('[AUTH] Failed to update local storage with fresh credits:', e);
  }
}

function buildUsageContext() {
  return {
    userProfilePath,
    currentUser,
    currentHasAccess,
    currentPlanName,
    mainWindow,
    currentUserCredits,
    deductUserCredits
  };
}

async function applyUsageCharge(usage) {
  const result = await incrementUsageAndEnforceSvc(buildUsageContext(), usage);

  if (result && result.success && typeof result.remaining === 'number') {
    currentUserCredits = result.remaining;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('credits-updated', currentUserCredits);
    }
  }

  return result;
}

// Background Service Manager
class BackgroundServiceManager {
  constructor() {
    this.isBackgroundMode = false;
    this.tray = null;
    this.menuBarItem = null;
    this.originalActivationPolicy = 'regular';
    this.windowState = null;
  }

  async enterBackgroundMode() {
    if (this.isBackgroundMode) return;

    console.log('[BGS] Entering background mode...');
    this.isBackgroundMode = true;

    // Save window state
    if (mainWindow && !mainWindow.isDestroyed()) {
      this.windowState = {
        isVisible: mainWindow.isVisible(),
        bounds: mainWindow.getBounds(),
        isAlwaysOnTop: mainWindow.isAlwaysOnTop()
      };
    }

    if (process.platform === 'darwin') {
      await this.enterBackgroundModeMacOS();
    } else if (process.platform === 'win32') {
      await this.enterBackgroundModeWindows();
    }

    console.log('[BGS] Background mode activated');
  }

  async exitBackgroundMode() {
    if (!this.isBackgroundMode) return;

    console.log('[BGS] Exiting background mode...');
    this.isBackgroundMode = false;

    if (process.platform === 'darwin') {
      await this.exitBackgroundModeMacOS();
    } else if (process.platform === 'win32') {
      await this.exitBackgroundModeWindows();
    }

    // Restore window state
    if (mainWindow && !mainWindow.isDestroyed() && this.windowState) {
      if (this.windowState.bounds) {
        mainWindow.setBounds(this.windowState.bounds);
      }
      if (this.windowState.isAlwaysOnTop) {
        syncAlwaysOnTop('background-restore');
      }
      if (this.windowState.isVisible) {
        mainWindow.show();
        mainWindow.focus();
      }
    }

    console.log('[BGS] Background mode deactivated');
  }

  async enterBackgroundModeMacOS() {
    try {
      // Set activation policy to accessory (removes from dock and Cmd+Tab)
      app.setActivationPolicy('accessory');

      // Hide main window
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.hide();
      }

      // Create menu bar item
      this.createMenuBarItem();

    } catch (error) {
      console.error('[BGS] macOS background mode error:', error);
    }
  }

  async exitBackgroundModeMacOS() {
    try {
      // Restore activation policy to regular
      app.setActivationPolicy('regular');

      // Remove menu bar item
      if (this.menuBarItem) {
        this.menuBarItem.destroy();
        this.menuBarItem = null;
      }

      // Show dock
      if (app.dock) {
        app.dock.show();
      }

    } catch (error) {
      console.error('[BGS] macOS restore error:', error);
    }
  }

  async enterBackgroundModeWindows() {
    try {
      // Hide main window and skip taskbar
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.hide();
        mainWindow.setSkipTaskbar(true);
      }

      // Create system tray
      this.createSystemTray();

    } catch (error) {
      console.error('[BGS] Windows background mode error:', error);
    }
  }

  async exitBackgroundModeWindows() {
    try {
      // Restore taskbar visibility
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setSkipTaskbar(false);
      }

      // Remove system tray
      if (this.tray) {
        this.tray.destroy();
        this.tray = null;
      }

    } catch (error) {
      console.error('[BGS] Windows restore error:', error);
    }
  }

  createMenuBarItem() {
    if (process.platform !== 'darwin') return;

    try {
      // Create menu bar icon
      const iconPath = path.join(__dirname, 'assets/icons/icon.png');
      let icon;

      if (fs.existsSync(iconPath)) {
        icon = nativeImage.createFromPath(iconPath);
        icon = icon.resize({ width: 16, height: 16 });
      } else {
        // Fallback to template icon
        icon = nativeImage.createFromNamedImage('NSStatusAvailable');
      }

      this.menuBarItem = new Tray(icon);
      this.menuBarItem.setToolTip('InshuVerse AI - Click to restore');

      // Create context menu
      const contextMenu = Menu.buildFromTemplate([
        {
          label: 'Show InshuVerse AI',
          click: () => this.exitBackgroundMode()
        },
        {
          label: 'Take Screenshot',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('trigger-screenshot');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Quit InshuVerse AI',
          click: () => app.quit()
        }
      ]);

      this.menuBarItem.setContextMenu(contextMenu);

      // Single click to restore
      this.menuBarItem.on('click', () => {
        this.exitBackgroundMode();
      });

    } catch (error) {
      console.error('[BGS] Menu bar creation error:', error);
    }
  }

  createSystemTray() {
    if (process.platform !== 'win32') return;

    try {
      // Create system tray icon
      const iconPath = path.join(__dirname, 'assets/icons/icon.ico');
      let icon;

      if (fs.existsSync(iconPath)) {
        icon = nativeImage.createFromPath(iconPath);
      } else {
        // Fallback icon
        icon = nativeImage.createEmpty();
      }

      this.tray = new Tray(icon);
      this.tray.setToolTip('InshuVerse AI - Click to restore');

      // Create context menu
      const contextMenu = Menu.buildFromTemplate([
        {
          label: 'Show InshuVerse AI',
          click: () => this.exitBackgroundMode()
        },
        {
          label: 'Take Screenshot',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('trigger-screenshot');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Exit InshuVerse AI',
          click: () => app.quit()
        }
      ]);

      this.tray.setContextMenu(contextMenu);

      // Double click to restore (Windows convention)
      this.tray.on('double-click', () => {
        this.exitBackgroundMode();
      });

    } catch (error) {
      console.error('[BGS] System tray creation error:', error);
    }
  }

  destroy() {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
    if (this.menuBarItem) {
      this.menuBarItem.destroy();
      this.menuBarItem = null;
    }
  }
}

// Initialize background service manager
let backgroundService = new BackgroundServiceManager();

// Platform detection IPC handler
ipcMain.handle('get-platform', () => {
  return process.platform;
});

// ── Custom window controls (Windows Hide Mode) ────────────────────────────
// These IPC handlers back the #winControls buttons that replace the native
// title-bar controls when the frameless/transparent window is active on Win32.
ipcMain.on('win-minimize', () => {
  const win = mainWindow;
  if (win && !win.isDestroyed()) win.minimize();
});

ipcMain.on('win-maximize', () => {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  if (win.isMaximized()) {
    win.unmaximize();
  } else {
    win.maximize();
  }
});

ipcMain.on('win-close', () => {
  const win = mainWindow;
  if (win && !win.isDestroyed()) win.close();
});

// Broadcast maximize/restore state changes so the renderer can update the
// maximize button icon (□ ↔ ❐) without an extra round-trip IPC call.
// These listeners are attached once mainWindow is created (see createWindow).
function attachWinControlsStateListeners(win) {
  win.on('maximize',   () => { try { win.webContents.send('window-maximized',   true);  } catch (_) {} });
  win.on('unmaximize', () => { try { win.webContents.send('window-maximized',   false); } catch (_) {} });
  win.on('restore',    () => { try { win.webContents.send('window-maximized',   false); } catch (_) {} });
}
// ─────────────────────────────────────────────────────────────────────────────

// Background Service IPC handlers
ipcMain.handle('enter-background-mode', async () => {
  try {
    await backgroundService.enterBackgroundMode();
    return { success: true };
  } catch (error) {
    console.error('[BGS] Enter background mode failed:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('exit-background-mode', async () => {
  try {
    await backgroundService.exitBackgroundMode();
    return { success: true };
  } catch (error) {
    console.error('[BGS] Exit background mode failed:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('is-background-mode', () => {
  return backgroundService.isBackgroundMode;
});

ipcMain.handle('toggle-background-mode', async () => {
  try {
    if (backgroundService.isBackgroundMode) {
      await backgroundService.exitBackgroundMode();
    } else {
      await backgroundService.enterBackgroundMode();
    }
    return { success: true, isBackgroundMode: backgroundService.isBackgroundMode };
  } catch (error) {
    console.error('[BGS] Toggle background mode failed:', error);
    return { success: false, error: error.message };
  }
});

// Helper: stream a final answer to renderer as incremental parts, then finalize
async function streamAnswerToRenderer(text) {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    // Signal start of streaming to renderer
    mainWindow.webContents.send('answer-start');
    const chunks = [];
    const s = String(text || '');
    // Split into paragraphs or sentences to keep formatting sensible
    const byPara = s.split(/\n\n+/);
    for (const para of byPara) {
      if (!para.trim()) continue;
      chunks.push(para + '\n\n');
    }
    // Fallback if no paragraphs
    if (chunks.length === 0) chunks.push(s);
    for (const chunk of chunks) {
      mainWindow.webContents.send('answer-part', chunk);
      // Minimal delay — just enough for the renderer paint cycle to render each chunk
      const delay = chunk.includes('```') || chunk.includes('~~~') ? 20 : 10;
      await new Promise(r => setTimeout(r, delay));
    }
    // Send the full answer at the end to finalize
    mainWindow.webContents.send('answer', s);
  } catch (_) {}
}

// Initialize OpenAI client with simple configuration
// Remove the global openai instance

// Add this near the top with other platform-specific code
const isWindows = process.platform === 'win32';

// Update the createWindow function
function createWindow() {
  console.log('Creating main window...');
  // Configure window options - completely frameless/headerless on all platforms.
  // Both macOS and Windows use a transparent BrowserWindow so the renderer can
  // toggle between a dark glass UI (Normal Mode) and a fully see-through UI
  // (transparent-mode, activated together with Hide Mode) entirely in CSS.
  // The per-pixel-alpha edge artifacts seen on Windows in earlier builds were
  // caused by main-process calls to setOpacity / setBackgroundColor cycling
  // WS_EX_LAYERED on the HWND after creation; those calls are now gated
  // behind a `process.platform === 'darwin'` guard everywhere they exist
  // (see hide-mode.js and the set-transparency handler below), so the
  // Windows layered window stays in per-pixel alpha mode for its entire
  // lifetime and the regression cannot recur.
  const windowOptions = {
    width: 624,
    height: 600,
    alwaysOnTop: true,
    transparent: true,
    frame: false,
    skipTaskbar: false,
    icon: path.join(__dirname, isWindows ? 'assets/icons/icon.ico' : 'assets/icons/icon.png'),
    backgroundColor: '#00000000',
    resizable: true,

    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
      webSecurity: true,
      devTools: false,
      show: true
    }
  };

  // On Mac, use hiddenInset titleBarStyle for better integration
  if (process.platform === 'darwin') {
    windowOptions.titleBarStyle = 'hiddenInset';
  }

  // ── Windows: per-pixel-alpha frameless window ────────────────────────────
  // hasShadow:false suppresses the DWM-rendered drop shadow which would draw
  // a faint grey halo around the rounded container.
  // roundedCorners:false stops DWM from applying its own corner mask on top
  // of the CSS curves (would otherwise produce a double-bevel artifact).
  if (process.platform === 'win32') {
    windowOptions.hasShadow = false;
    windowOptions.roundedCorners = false;
  }

  // Create the window
  mainWindow = new BrowserWindow({
    ...windowOptions,
    ...(process.platform === 'darwin' ? { vibrancy: 'sidebar', visualEffectState: 'active' } : {})
  });

  // Attach maximize/restore event forwarders so the renderer's custom Win
  // control buttons can stay in sync with the real window state.
  attachWinControlsStateListeners(mainWindow);

  // Surface renderer crashes loudly. Without this, a native segfault (e.g.
  // a misbehaving native module loaded in the renderer) just produces a
  // black or closed window with no log line — making post-mortem debugging
  // impossible. We print the reason + exitCode, append a JSON record to
  // userData/renderer-crashes.log, and ASK the user whether to reload —
  // never reload silently. Auto-reload was previously interpreted as a
  // "navigation reset" because the post-reload renderer re-runs the
  // initial-auth flow and lands on the welcome / Start-Assistant screen,
  // erasing whatever state the user was in (e.g. a half-finished upload).
  try {
    mainWindow.webContents.on('render-process-gone', (_e, details) => {
      const record = {
        ts: new Date().toISOString(),
        reason: details && details.reason,
        exitCode: details && details.exitCode,
      };
      console.error('[CRASH] renderer gone:', JSON.stringify(record));
      try {
        const logPath = path.join(app.getPath('userData'), 'renderer-crashes.log');
        fs.appendFileSync(logPath, JSON.stringify(record) + '\n');
      } catch (_) {}
      // 'clean-exit' fires on normal teardown — don't prompt.
      if (!details || details.reason === 'clean-exit' || !mainWindow || mainWindow.isDestroyed()) {
        return;
      }
      try {
        const choice = dialog.showMessageBoxSync(mainWindow, {
          type: 'error',
          buttons: ['Reload', 'Close window'],
          defaultId: 0,
          cancelId: 1,
          title: 'Inshuverse AI Not Working',
          message: 'The Inshuverse AI window stopped responding.',
          detail: `Reason: ${record.reason || 'unknown'}\nExit code: ${record.exitCode ?? '–'}\n\nReloading will return you to the post-sign-in screen. Any in-progress indexing will be lost. A diagnostic line was written to renderer-crashes.log in the user data folder.`,
        });
        if (choice === 0 && !mainWindow.isDestroyed()) {
          mainWindow.webContents.reload();
        }
      } catch (e) {
        console.error('[CRASH] dialog failed, falling back to reload:', e && e.message);
        try { if (!mainWindow.isDestroyed()) mainWindow.webContents.reload(); } catch (_) {}
      }
    });
    mainWindow.webContents.on('unresponsive', () => {
      console.warn('[CRASH] renderer unresponsive');
    });
  } catch (_) {}

  // Pipe renderer console.{log,warn,error} into the main-process stdout so
  // diagnostics show up in `npm start`'s terminal even when devTools is
  // disabled (webPreferences.devTools = false). Only forward [RAG] / [CRASH]
  // / [PROFILE] lines and errors to keep noise low \u2014 anything else is
  // already being routed through dedicated [PREFIX] tags by callers.
  try {
    mainWindow.webContents.on('console-message', (...args) => {
      let level, message, line, source;
      if (args.length === 1 && args[0] && typeof args[0] === 'object') {
        // Electron 36+ event object: { level, message, lineNumber, sourceId }
        const ev = args[0];
        const lvl = ev.level;
        if (typeof lvl === 'number') level = lvl;
        else if (lvl === 'error') level = 3;
        else if (lvl === 'warning') level = 2;
        else if (lvl === 'info') level = 1;
        else level = 0;
        message = ev.message;
        line = ev.lineNumber;
        source = ev.sourceId;
      } else {
        // Legacy positional signature
        const [, lvl, msg, ln, src] = args;
        level = lvl; message = msg; line = ln; source = src;
      }
      const isError = level >= 2;
      const prefix = isError ? '[RENDERER:ERR]' : '[RENDERER]';
      try {
        const tail = isError && source ? `  (${source}:${line})` : '';
        console.log(`${prefix} ${message}${tail}`);
      } catch (_) {}
    });
  } catch (_) {}

  // ── CRITICAL: Set up display media request handler for system audio capture ──
  // Without this, getDisplayMedia() in the renderer cannot auto-grant screen+audio
  // access in Electron on Windows. This is the root cause of system audio not working.
  //
  // Audio-only path (Fully Automatic / Manual listening): when the renderer
  // requests `{ video: false, audio: true }` we grant ONLY `audio: 'loopback'`
  // and skip desktopCapturer entirely. This avoids exposing any specific
  // screen/window handle to the renderer, so the OS does not advertise the
  // capture as targeting a particular IDE/app window and keeps the system
  // "sharing screen" status as silent as the platform allows.
  try {
    mainWindow.webContents.session.setDisplayMediaRequestHandler((request, callback) => {
      const wantVideo = !!(request && request.videoRequested);
      const wantAudio = !!(request && request.audioRequested);
      console.log(`[AUDIO] Display media request: video=${wantVideo} audio=${wantAudio}`);

      if (wantAudio && !wantVideo) {
        // Silent audio-only loopback — no video source, no desktopCapturer.
        try {
          callback({ audio: 'loopback' });
        } catch (e) {
          console.error('[AUDIO] Audio-only loopback grant failed:', e);
          try { callback(); } catch (_) {}
        }
        return;
      }

      desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
        if (!sources || sources.length === 0) {
          console.error('[AUDIO] No screen sources found for display media');
          callback();
          return;
        }
        // Grant access to the first screen with system audio loopback
        // 'loopback' captures the system audio output (speaker audio) on Windows
        const grant = { video: sources[0] };
        if (wantAudio) grant.audio = 'loopback';
        callback(grant);
      }).catch((err) => {
        console.error('[AUDIO] Failed to get screen sources for display media:', err);
        callback();
      });
    });
    console.log('[AUDIO] Display media request handler registered successfully');
  } catch (err) {
    console.error('[AUDIO] Failed to set display media request handler:', err);
  }

  // Harden window against inspection and context menu
  const secureWindow = (win) => {
    try {
      if (!win || win.isDestroyed()) return;
      win.removeMenu();
      win.webContents.on('context-menu', (e) => e.preventDefault());
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('before-input-event', (event, input) => {
        const isMac = process.platform === 'darwin';
        const cmdOrCtrl = isMac ? input.meta : input.control;
        const key = (input.key || '').toUpperCase();
        if (
          key === 'F12' ||
          (cmdOrCtrl && input.shift && (key === 'I' || key === 'J' || key === 'C'))
        ) {
          event.preventDefault();
        }
      });
      win.webContents.on('devtools-opened', () => {
        try { win.webContents.closeDevTools(); } catch (_) {}
      });
    } catch (_) {}
  };

  secureWindow(mainWindow);
  app.on('browser-window-created', (_e, win) => secureWindow(win));

// Capture screen in main and summarize (ensure single handler)
ipcMain.removeAllListeners('screenshot-capture-and-summarize');
ipcMain.on('screenshot-capture-and-summarize', async (_event, payload) => {
  if (isProcessingScreenshot) {
    console.log('[SS] Ignoring duplicate screenshot request (already processing)');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('answer-status', 'Already analyzing screenshot...');
    }
    return;
  }
  isProcessingScreenshot = true;
  console.log('[SS] Received screenshot-capture-and-summarize request');
  try {
    // Lifetime plan: require the user's own API key before capturing
    if (currentIsLifetimePlan && !userOpenAIKey && !userGeminiKey) {
      console.warn('[SS] Lifetime user has no API key — aborting screenshot capture');
      if (mainWindow && !mainWindow.isDestroyed()) {
        const msg = 'Lifetime plan requires your own OpenAI or Gemini API key. Please add one in Settings → API Keys.';
        try { mainWindow.webContents.send('answer-part', msg); } catch (_) {}
        try { mainWindow.webContents.send('answer-done'); } catch (_) {}
        try { mainWindow.webContents.send('answer-status', 'API key required'); } catch (_) {}
      }
      return;
    }
    let macScreenStatus = null;
    const onMac = process.platform === 'darwin';
    if (onMac) {
      try {
        macScreenStatus = systemPreferences.getMediaAccessStatus('screen');
        console.log('[SS] macOS screen permission status:', macScreenStatus);
      } catch (e) {
        console.warn('[SS] Failed to read macOS screen permission status:', e);
      }
      // Do not early-return here; attempt capture and handle failure gracefully below.
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      // Unified status string — Task Updater listens for the camera emoji to
      // enter the screenshot-processing state. Keep a single canonical message
      // for both the capture and analysis phases so the indicator does not flicker.
      mainWindow.webContents.send('answer-status', '📸 Capturing and analyzing screen...');
    }
    if (!desktopCapturer || typeof desktopCapturer.getSources !== 'function') {
      console.error('[SS] desktopCapturer is not available in main process');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('answer', 'Screen capture is not supported in this environment.');
        mainWindow.webContents.send('answer-status', 'Screen capture unsupported');
      }
      return;
    }
    // Robust screen capture with progressive fallback.
    //
    // Why this is needed: desktopCapturer.getSources occasionally returns a
    // source whose .thumbnail is non-null but .isEmpty() is true. Root causes
    // observed on macOS:
    //   • Race between OS compositing the frame and Electron reading it.
    //   • The requested thumbnailSize is incompatible with the display's
    //     backing-scale factor (high-DPI Retina + ultrawide monitors).
    //   • Transient OS-level capture pipeline glitch right after a
    //     wake-from-sleep / display reconfiguration.
    //
    // Strategy:
    //   1. Try a sequence of progressively smaller thumbnail sizes.
    //   2. On each attempt, scan ALL returned sources (not just "entire
    //      screen") and accept the first one with a non-empty thumbnail.
    //   3. As a final fallback, request types:['window','screen'] so we
    //      can return *something* even if the OS won't render the whole
    //      desktop right now.
    //   4. Only surface the "permission" error if macScreenStatus actually
    //      says "denied"/"restricted"; otherwise surface a "try again"
    //      style technical-failure message so we don't mislead the user.
    const SS_SIZE_ATTEMPTS = [
      { width: 1280, height: 720 },
      { width: 1024, height: 576 },
      { width: 800,  height: 450 },
      { width: 480,  height: 270 },
    ];
    const SS_RETRY_DELAY_MS = 250;
    let src = null;
    let lastError = null;
    const pickThumbnail = (sources) => {
      if (!sources || sources.length === 0) return null;
      // Prefer "entire screen" / "screen 1" but accept any source whose
      // thumbnail is non-empty. This is the key change vs. the old code,
      // which gave up if the primary screen happened to be empty even
      // though a secondary screen had a valid frame.
      const preferred = sources.find(s => /entire screen|screen 1/i.test(s.name) && s.thumbnail && !s.thumbnail.isEmpty());
      if (preferred) return preferred;
      return sources.find(s => s.thumbnail && !s.thumbnail.isEmpty()) || null;
    };
    for (let attempt = 0; attempt < SS_SIZE_ATTEMPTS.length; attempt++) {
      const size = SS_SIZE_ATTEMPTS[attempt];
      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: size,
        });
        const picked = pickThumbnail(sources);
        if (picked) { src = picked; break; }
        console.warn(`[SS] Attempt ${attempt + 1}: ${sources?.length || 0} sources, none with valid thumbnail at ${size.width}x${size.height}`);
      } catch (e) {
        lastError = e;
        console.error(`[SS] getSources failed at ${size.width}x${size.height}:`, e);
      }
      await new Promise(r => setTimeout(r, SS_RETRY_DELAY_MS));
    }
    // Final fallback: widen the source types to include windows. The user
    // gets *some* image of their working area even if the full-screen
    // compositor refuses to surface a frame.
    if (!src) {
      try {
        const sources = await desktopCapturer.getSources({
          types: ['window', 'screen'],
          thumbnailSize: { width: 800, height: 450 },
        });
        const picked = pickThumbnail(sources);
        if (picked) {
          src = picked;
          console.log(`[SS] Final fallback succeeded with source: ${picked.name}`);
        }
      } catch (e) {
        lastError = e;
        console.error('[SS] Final-fallback getSources failed:', e);
      }
    }
    if (!src) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const macDenied = onMac && (macScreenStatus === 'denied' || macScreenStatus === 'restricted');
        const macGranted = (macScreenStatus === 'granted' || macScreenStatus === 'authorized');
        const appLabel = app.isPackaged ? app.getName() : 'Electron';
        let msg;
        if (macDenied) {
          msg = `Screen Recording permission is not granted. Open System Settings → Privacy & Security → Screen Recording, enable "${appLabel}", then quit and relaunch the app.`;
        } else if (lastError && !macGranted && onMac) {
          // No clear permission signal but capture failed — likely a perm issue masquerading as a technical error.
          msg = `Couldn't capture the screen. If you just installed the app, please enable "${appLabel}" under System Settings → Privacy & Security → Screen Recording and relaunch.`;
        } else {
          // Permission is granted but the OS isn't delivering a frame right now —
          // surface a clear "try again" message rather than misleading the user
          // into re-checking permissions that are already correct.
          msg = 'Screen capture failed momentarily. Please try the screenshot shortcut again in a second.';
        }
        mainWindow.webContents.send('answer', msg);
        mainWindow.webContents.send('answer-status', macDenied ? 'Permission needed' : 'Capture failed — try again');
      }
      console.warn('[SS] All capture attempts exhausted; no source with a valid thumbnail.');
      return;
    }
    // JPEG 80% quality: 60-80% smaller buffer than PNG with no perceptible quality loss for AI vision.
    // nativeImage.toJPEG() is built into Electron — no extra dependencies needed.
    const jpegBuffer = src.thumbnail.toJPEG(80);
    const base64Jpeg = Buffer.from(jpegBuffer).toString('base64');
    if (mainWindow && !mainWindow.isDestroyed()) {
      try { mainWindow.webContents.send('screenshot-preview', 'data:image/jpeg;base64,' + base64Jpeg); } catch(_) {}
      mainWindow.webContents.send('answer-status', '📸 Capturing and analyzing screen...');
    }
    // Build dynamic system prompt based on mode
    const mode = payload && payload.mode ? String(payload.mode) : 'online_tests';
    // Reduced token limits to optimise credit usage
    // coder / custom prompts need more room; default stays lean
    const maxTokens = (mode === 'coder' || mode === 'custom') ? 1500 : 600;
    let systemPrompt = (() => {
      // Custom mode: use user-provided prompt if available; otherwise fall back to defaults
      if (mode === 'custom') {
        const p = payload && typeof payload.customPrompt === 'string' ? payload.customPrompt.trim() : '';
        if (p) return p;
        // fall through to default if empty
      }
      if (mode === 'coder') {
        return [
          'Carefully understand what is shown in the screenshot. If it is a coding challenge (e.g., LeetCode/HackerRank), extract the full problem and requirements.',
          'Return a high-quality, detailed solution with clean, runnable code.',
          '',
          'Your job:',
          '- Identify the exact problem statement and constraints from the screenshot.',
          '- Provide the optimal approach and Big-O time/space.',
          '- Provide fully working code in the most likely language on screen; if unclear, prefer Python.',
          '- Include step-by-step reasoning, important edge cases, and brief dry-run example if helpful.',
          '',
          'Formatting:',
          '- Respond in Markdown.',
          '- Use a single fenced code block with language tag (e.g., ```python ... ```).',
          '- Be precise and thorough while keeping the narrative focused on solving the problem.',
        ].join('\n');
      }
      // Default: online tests / aptitude
      return [
        'Carefully understand what is shown in the screenshot and extract the actual question/task. Ignore any Inshuverse AI UI.',
        'Provide the correct answer clearly, and include a short explanation of how you derived it.',
        '',
        'Your job:',
        '- Identify the question(s) being asked.',
        '- State the final answer(s) clearly.',
        '- Add a brief explanation (2–4 lines).',
        '',
        'Formatting:',
        '- Respond in Markdown.',
        '- Use fenced code blocks with language tags for any code if needed.',
        '- Use bullet points and headings where helpful.',
        '- Do NOT emit placeholder tokens like INLINE0/INLINE1.',
      ].join('\n');
    })();

    // Minimal continuity: append only the most recent user question (not the
    // full 10-message × 1000-char dump that used to live here) so follow-up
    // questions like "explain the previous screenshot" still work.
    try {
      const hist = await mainWindow.webContents.executeJavaScript('window.conversationHistory || []');
      if (Array.isArray(hist) && hist.length) {
        const lastUser = [...hist].reverse().find(m => m && m.role === 'user' && typeof m.content === 'string' && m.content.trim());
        if (lastUser) {
          const snippet = String(lastUser.content).trim().slice(0, 400);
          systemPrompt = `${systemPrompt}\n\nUser's most recent question (for context only): ${snippet}`;
        }
      }
    } catch (_) {}

    // Image analysis — Gemini 2.5-flash-lite primary, OpenAI gpt-4o-mini fallback
    const send = (channel, payload) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      try { mainWindow.webContents.send(channel, payload); } catch (_) {}
    };
    // detail:'low' for aptitude/online-tests cuts image-input tokens ~9×
    // (85 vs 765). Coder mode keeps default detail for small-text code screenshots.
    const visionDetail = (mode === 'coder') ? undefined : 'low';
    // Resolve Gemini key — lifetime users must supply their own (no system fallback).
    // Non-lifetime users get the system fallback key when they have no key set.
    const { provider } = await withKeyRotation(({ userOpenAIKey, userGeminiKey }) => {
      const screenshotGeminiKey = currentIsLifetimePlan
        ? userGeminiKey
        : (userGeminiKey || GEMINI_FALLBACK_FREE_KEY);
      // Lifetime BYOK: prefer the provider that actually has a key so we don't
      // round-trip through Gemini just to fall back to OpenAI (or vice versa).
      // Non-lifetime users always have a vendor Gemini fallback, so 'gemini'
      // stays the right primary for them.
      const visionSelectedModel = currentIsLifetimePlan
        ? (screenshotGeminiKey ? 'gemini' : (userOpenAIKey ? 'openai' : 'gemini'))
        : 'gemini';
      return answerFromImageWithModelSelectionStreamSvc(base64Jpeg, {
        userOpenAIKey,                           // OpenAI fallback when Gemini is quota-exhausted
        userGeminiKey: screenshotGeminiKey,
        // Lifetime = BYOK only; never let the service reach for the free-tier key.
        geminiFallbackKey: currentIsLifetimePlan ? undefined : GEMINI_FALLBACK_FREE_KEY,
        selectedModel: visionSelectedModel,
        systemPrompt,
        maxTokens,
        visionDetail,
        send,
      });
    });
    // Screenshot feature costs 4 credits (image analysis is expensive)
    const usageArg = { model: provider, count: 4 };
    await applyUsageCharge(usageArg);
  } catch (e) {
    console.error('screenshot-capture-and-summarize error:', e);
    if (mainWindow && !mainWindow.isDestroyed()) {
	    const friendly = 'Sorry, image analysis is not available right now. Please try again in a few seconds.';
	    try { mainWindow.webContents.send('answer-part', friendly); } catch (_) {}
      try { mainWindow.webContents.send('answer-done'); } catch (_) {}
    }
  } finally { isProcessingScreenshot = false; }
});
// Handle screenshot summarization requests from renderer (ensure single handler)
ipcMain.removeAllListeners('screenshot-summary');
ipcMain.on('screenshot-summary', async (_event, base64Png) => {
  try {
    if (!base64Png || typeof base64Png !== 'string') {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('answer', 'No screenshot data received.');
      }
      return;
    }
    // Lifetime plan: require the user's own API key before running analysis
    if (currentIsLifetimePlan && !userOpenAIKey && !userGeminiKey) {
      console.warn('[SS] Lifetime user has no API key — aborting screenshot-summary');
      if (mainWindow && !mainWindow.isDestroyed()) {
        const msg = 'Lifetime plan requires your own OpenAI or Gemini API key. Please add one in Settings → API Keys.';
        try { mainWindow.webContents.send('answer-part', msg); } catch (_) {}
        try { mainWindow.webContents.send('answer-done'); } catch (_) {}
        try { mainWindow.webContents.send('answer-status', 'API key required'); } catch (_) {}
      }
      return;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('answer-status', '📸 Capturing and analyzing screen...');
    }
    // Direct image -> answer (Gemini-first, OpenAI fallback), STREAMING
    const send = (channel, payload) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      try { mainWindow.webContents.send(channel, payload); } catch (_) {}
    };
    let systemPrompt = `Analyze this screenshot and extract the actual question/task on the screen. If you see any Inshuverse AI tooling UI, ignore it. This might be an interview question or an aptitude test screenshot.\n\nYour job:\n- Identify the question(s) being asked.\n- Provide the final answer(s) succinctly.\n- Add a brief explanation (2-4 lines) showing how you derived it.\n\nFormatting:\n- Respond in Markdown.\n- Use fenced code blocks with language tags for any code, e.g. \u0060\u0060\u0060python ... \u0060\u0060\u0060.\n- Use bullet points and headings where helpful.\n- Do NOT emit placeholder tokens like INLINE0/INLINE1.\n\nImportant:\n- Do NOT mention screenshots or tools in your response.\n- Be decisive and concise.`;
    // Minimal continuity: only the most recent user question, not a full
    // 10-message dump — keeps follow-ups working without burning tokens.
    try {
      const hist = await mainWindow.webContents.executeJavaScript('window.conversationHistory || []');
      if (Array.isArray(hist) && hist.length) {
        const lastUser = [...hist].reverse().find(m => m && m.role === 'user' && typeof m.content === 'string' && m.content.trim());
        if (lastUser) {
          const snippet = String(lastUser.content).trim().slice(0, 400);
          systemPrompt = `${systemPrompt}\n\nUser's most recent question (for context only): ${snippet}`;
        }
      }
    } catch (_) {}

    // Image analysis — Gemini 2.5-flash-lite primary, OpenAI gpt-4o-mini fallback.
    // Lifetime users must supply their own keys — no system fallback.
    const { provider } = await withKeyRotation(({ userOpenAIKey, userGeminiKey }) => {
      const screenshotGeminiKey = currentIsLifetimePlan
        ? userGeminiKey
        : (userGeminiKey || GEMINI_FALLBACK_FREE_KEY);
      // Lifetime BYOK: route directly to the provider with a configured key.
      const visionSelectedModel = currentIsLifetimePlan
        ? (screenshotGeminiKey ? 'gemini' : (userOpenAIKey ? 'openai' : 'gemini'))
        : 'gemini';
      return answerFromImageWithModelSelectionStreamSvc(base64Png, {
        userOpenAIKey,                           // OpenAI fallback when Gemini is quota-exhausted
        userGeminiKey: screenshotGeminiKey,
        geminiFallbackKey: currentIsLifetimePlan ? undefined : GEMINI_FALLBACK_FREE_KEY,
        selectedModel: visionSelectedModel,
        systemPrompt,
        visionDetail: 'low',                     // aptitude/generic screenshots — ~9× fewer image input tokens
        send,
      });
    });
    // Screenshot feature costs 4 credits (image analysis is expensive)
    const usageArg = { model: provider, count: 4 };
    await applyUsageCharge(usageArg);
  } catch (error) {
    console.error('Screenshot summarize/answer error:', error);
    if (mainWindow && !mainWindow.isDestroyed()) {
	    const friendly = 'Sorry, image analysis is not available right now. Please try again in a few seconds.';
	    try { mainWindow.webContents.send('answer-part', friendly); } catch (_) {}
      try { mainWindow.webContents.send('answer-done'); } catch (_) {}
    }
  }
});
  console.log('Main window created with options:', windowOptions);

  // Load the HTML file
  mainWindow.loadFile('index.html');

  // After the page loads, apply production hardening and first-launch checks.
  mainWindow.webContents.on('did-finish-load', async () => {
    // ── H1: macOS App Translocation warning ──────────────────────────────
    // If the bundle is running from a Gatekeeper-assigned read-only
    // AppTranslocation path, setContentProtection(true) may silently fail.
    // We surface a one-time banner so the user knows to move the app to
    // /Applications. The banner is dismissed automatically on the next
    // launch from a non-translocated path.
    try {
      if (detectAppTranslocation()) {
        console.warn('[HIDE] App Translocation detected — Hide Mode may be unreliable until app is moved to /Applications.');
        mainWindow.webContents.send('app-translocation-warning', {
          execPath: process.execPath,
        });
      }
    } catch (_) {}

    // ── H4: Auto-restore Hide Mode from persisted state ──────────────────
    // If the user had Hide Mode enabled when the app last closed, re-enable
    // it now so protection is active from the very first frame. We wait
    // until did-finish-load so the renderer's toggle UI can receive the
    // screen-sharing-active IPC and sync its checked state.
    try {
      if (loadHideModeFlag()) {
        console.log('[HIDE] Restoring Hide Mode from persisted state…');
        enableHideMode();
        // Notify the renderer so the toggle checkbox reflects the state.
        mainWindow.webContents.send('hide-mode-restored', true);
      }
    } catch (restoreErr) {
      console.warn('[HIDE] Auto-restore failed:', restoreErr && restoreErr.message ? restoreErr.message : restoreErr);
    }

    // ── Production hardening ──────────────────────────────────────────────
    try {
      await mainWindow.webContents.executeJavaScript(`
        (function() {
          try {
            // Production hardening in renderer
            try {
              document.addEventListener('contextmenu', (e) => e.preventDefault(), true);
              window.addEventListener('keydown', (e) => {
                const isMac = navigator.platform.toUpperCase().includes('MAC');
                const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;
                const key = (e.key || '').toUpperCase();
                if (key === 'F12' || (cmdOrCtrl && e.shiftKey && (key === 'I' || key === 'J' || key === 'C'))) {
                  e.preventDefault();
                  e.stopPropagation();
                }
              }, true);
              const NO_DEBUG = true;
              if (NO_DEBUG) { console.log = () => {}; console.debug = () => {}; }
            } catch (_) {}
          } catch (e) {
            console.error('[INJECT] Failed to apply production hardening:', e);
          }
        })();
      `);
    } catch (e) {
      console.error('[INJECT] executeJavaScript failed:', e);
    }
  });

  // Set up window for screen exclusion compatibility
  if (process.platform === 'darwin') {
    mainWindow.once('ready-to-show', () => {
      console.log('Window ready-to-show on macOS');
      mainWindow.show();

      // Initialize with properties that make exclusion work better
      mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      mainWindow.setWindowButtonVisibility(true);

      // Move to front to establish window layering
      app.dock.show();
      mainWindow.moveTop();

      // Ensure always on top is set
      syncAlwaysOnTop('window-ready-macos');

      console.log('Window setup complete on macOS');
    });
  } else if (isWindows) {
    // Windows-specific setup
    console.log('Setting up Windows-specific window properties');
    mainWindow.setSkipTaskbar(false);
    app.setAppUserModelId('com.lazyjobseeker.angel');

    // Ensure always on top is set for Windows
    syncAlwaysOnTop('window-ready-windows');

    console.log('Windows window setup complete');
  }

  console.log('Main window created');

  // Hide Mode re-assertion listeners (focus/restore/show/blur/move) are
  // installed by registerHideModeHandlers() in src/window/hide-mode.js,
  // which reads the canonical APP_STATE.isInScreenSharingMode flag.

  mainWindow.on('closed', () => {
    // Reset app state when window closes
    try {
      // Clear any chat memory or temporary data
      console.log('Window closed - resetting app state');

      // You could add more cleanup here if needed
      // For now, the renderer process handles most of the reset
    } catch (error) {
      console.error('Error during window close cleanup:', error);
    }

    mainWindow = null;
  });
}

// Toggle window visibility (used by global shortcut)
function toggleWindowVisibility() {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      try { mainWindow.focus(); } catch (_) {}
      try { mainWindow.moveTop(); } catch (_) {}
    }
  } catch (e) {
    console.warn('toggleWindowVisibility failed:', e);
  }
}

// Register global shortcuts
function registerGlobalShortcuts() {
  try {
    // Unregister if previously registered
    try { globalShortcut.unregister('CommandOrControl+B'); } catch (_) {}
    try { globalShortcut.unregister('CommandOrControl+Shift+M'); } catch (_) {}
    try { globalShortcut.unregister('CommandOrControl+Shift+S'); } catch (_) {}
    try { globalShortcut.unregister('CommandOrControl+Shift+V'); } catch (_) {}

    const okB = globalShortcut.register('CommandOrControl+B', () => {
      toggleWindowVisibility();
    });
    if (!okB) console.warn('[GS] Failed to register CommandOrControl+B');

    // Universal mic toggle: Cmd/Ctrl + Shift + M
    const okM = globalShortcut.register('CommandOrControl+Shift+M', () => {
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('global-toggle-mic');
        }
      } catch (e) { console.warn('[GS] global mic toggle failed:', e); }
    });
    if (!okM) console.warn('[GS] Failed to register CommandOrControl+Shift+M');

    // Universal screenshot: Cmd/Ctrl + Shift + S
    const okS = globalShortcut.register('CommandOrControl+Shift+S', () => {
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('trigger-screenshot');
        }
      } catch (e) { console.warn('[GS] global screenshot failed:', e); }
    });
    if (!okS) console.warn('[GS] Failed to register CommandOrControl+Shift+S');

    // Ghost Typing: Cmd/Ctrl + Shift + V — only acts when the renderer has
    // toggled the feature ON (we don't want to hijack the shortcut globally
    // for users who never opted in). When already typing, the same combo
    // cancels the run.
    const okV = globalShortcut.register('CommandOrControl+Shift+V', () => {
      try { _handleGhostTypingShortcut(); }
      catch (e) { console.warn('[GS] ghost-typing shortcut failed:', e); }
    });
    if (!okV) console.warn('[GS] Failed to register CommandOrControl+Shift+V');
  } catch (e) {
    console.warn('[GS] registerGlobalShortcuts failed:', e);
  }
}

// ── Ghost Typing wiring ───────────────────────────────────────────────────
// Tracks whether the user has the feature toggled ON (set by the renderer
// from the Settings → General toggle). We register the shortcut globally so
// we can show a friendly "enable it first" status if the user hits the
// combo without enabling, instead of silently swallowing the keypress.
let _ghostTypingEnabled = false;
let _ghostTypingSpeed = ghostTyping.DEFAULT_SPEED;

function _gtSendStatus(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.send('ghost-typing:status', payload); } catch (_) {}
  }
}

ghostTyping.setStatusListener(_gtSendStatus);

async function _handleGhostTypingShortcut() {
  // Same-key cancel takes priority over a fresh run.
  if (ghostTyping.isTyping()) {
    ghostTyping.stop('shortcut');
    return;
  }
  if (!_ghostTypingEnabled) {
    _gtSendStatus({ state: 'disabled' });
    return;
  }
  const av = ghostTyping.isAvailable();
  if (!av.ok) {
    _gtSendStatus({ state: 'error', error: av.error });
    return;
  }
  const perm = ghostTyping.checkPermission();
  if (!perm.granted) {
    _gtSendStatus({ state: 'permission-required', platform: perm.platform });
    return;
  }
  let text = '';
  try { text = clipboard.readText('clipboard') || ''; } catch (_) {}
  if (!text.trim()) {
    _gtSendStatus({ state: 'empty-clipboard' });
    return;
  }
  await ghostTyping.start(text, { speed: _ghostTypingSpeed });
}

// IPC: renderer → main. Handlers are registered unconditionally so the
// renderer can probe availability/permission even before the user toggles
// the feature on.
try { ipcMain.removeHandler('ghost-typing:set-enabled'); } catch (_) {}
ipcMain.handle('ghost-typing:set-enabled', (_event, enabled) => {
  _ghostTypingEnabled = !!enabled;
  if (!_ghostTypingEnabled && ghostTyping.isTyping()) {
    ghostTyping.stop('disabled');
  }
  return { enabled: _ghostTypingEnabled };
});

try { ipcMain.removeHandler('ghost-typing:check-permission'); } catch (_) {}
ipcMain.handle('ghost-typing:check-permission', () => {
  const av = ghostTyping.isAvailable();
  const perm = ghostTyping.checkPermission();
  return { ...perm, available: av.ok, error: av.ok ? null : av.error };
});

try { ipcMain.removeHandler('ghost-typing:request-permission'); } catch (_) {}
ipcMain.handle('ghost-typing:request-permission', () => {
  return ghostTyping.requestPermission();
});

try { ipcMain.removeHandler('ghost-typing:stop'); } catch (_) {}
ipcMain.handle('ghost-typing:stop', () => {
  return { stopped: ghostTyping.stop('renderer') };
});

try { ipcMain.removeHandler('ghost-typing:set-speed'); } catch (_) {}
ipcMain.handle('ghost-typing:set-speed', (_event, speed) => {
  if (ghostTyping.SPEED_PROFILES[speed]) _ghostTypingSpeed = speed;
  return { speed: _ghostTypingSpeed };
});

// Expose macOS screen recording permission status to renderer
ipcMain.handle('check-screen-permission', async () => {
  try {
    if (process.platform === 'darwin') {
      // Possible statuses (vary by macOS/Electron): not-determined, granted, authorized, denied, restricted
      const status = systemPreferences.getMediaAccessStatus('screen');
      console.log('Screen recording permission status:', status, 'arch:', process.arch);
      return status === 'granted' || status === 'authorized';
    }
    // For non-macOS, assume permission is available
    return true;
  } catch (e) {
    console.error('check-screen-permission error:', e);
    return false;
  }
});

// Check microphone permission (macOS) and request if needed
ipcMain.handle('check-mic-permission', async () => {
  try {
    if (process.platform === 'darwin') {
      // Possible statuses: not-determined, granted, denied, restricted
      const status = systemPreferences.getMediaAccessStatus('microphone');
      console.log('Microphone permission status:', status);
      return status === 'granted';
    }
    // For non-macOS, assume permission is available
    return true;
  } catch (e) {
    console.error('check-mic-permission error:', e);
    return false;
  }
});

ipcMain.handle('ask-mic-permission', async () => {
  try {
    if (process.platform === 'darwin') {
      // This shows the OS prompt if status is not determined; returns boolean
      const granted = await systemPreferences.askForMediaAccess('microphone');
      console.log('ask-mic-permission result:', granted);
      return granted;
    }
    // Non-macOS: renderer getUserMedia will typically handle prompt
    return true;
  } catch (e) {
    console.error('ask-mic-permission error:', e);
    return false;
  }
});

// Enhanced desktop sources for audio capture
ipcMain.handle('get-desktop-sources', async (event, options = {}) => {
  try {
    const defaultOptions = {
      types: ['window', 'screen'],
      fetchWindowIcons: true,
      thumbnailSize: { width: 150, height: 150 }
    };

    const sources = await desktopCapturer.getSources({
      ...defaultOptions,
      ...options
    });

    return sources.map(source => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail ? source.thumbnail.toDataURL() : null,
      display_id: source.display_id,
      appIcon: source.appIcon ? source.appIcon.toDataURL() : null
    }));
  } catch (error) {
    console.error('Failed to get desktop sources:', error);
    throw error;
  }
});



// Transcription fallback moved to src/services/transcription.js

// Auto-updater (optional)
let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch (_) {
  console.warn('[UPD] electron-updater not installed; auto-update disabled');
}

// ── Persistent updater log ─────────────────────────────────────────────────
// End-user installations have no console; without a file log we cannot
// diagnose why a particular Mac/Windows machine stayed on an old version.
// Mirrors console output to userData/updater.log (best-effort, no rotation
// — the file is small text that a support engineer can ask the user to
// share). Also wired as autoUpdater.logger so electron-updater's internal
// HTTP / signature / yml-parse errors are captured too.
function _updaterLogPath() {
  try { return path.join(app.getPath('userData'), 'updater.log'); }
  catch (_) { return null; }
}
function _writeUpdaterLog(level, args) {
  try {
    const p = _updaterLogPath();
    if (!p) return;
    const ts = new Date().toISOString();
    const text = args.map((a) => {
      if (a instanceof Error)        return a.stack || a.message;
      if (typeof a === 'object')     { try { return JSON.stringify(a); } catch (_) { return String(a); } }
      return String(a);
    }).join(' ');
    fs.appendFileSync(p, `[${ts}] [${level}] ${text}\n`);
  } catch (_) { /* swallow — must not break the updater path */ }
}
const updLog = {
  info:  (...a) => { console.log('[UPD]',  ...a); _writeUpdaterLog('info',  a); },
  warn:  (...a) => { console.warn('[UPD]', ...a); _writeUpdaterLog('warn',  a); },
  error: (...a) => { console.error('[UPD]',...a); _writeUpdaterLog('error', a); },
  debug: (...a) => {                                _writeUpdaterLog('debug', a); },
};

// ── Retry / periodic re-check state ────────────────────────────────────────
// One transient network failure at app startup must not strand a client on
// an old version forever. Exponential backoff on 'error' + a 6h periodic
// re-check covers the common "flaky Wi-Fi at boot" + "long-running session"
// cases that were observed on the 6.0.1 → 6.0.2 rollout.
const _UPD_RETRY_BACKOFF_MS = [60_000, 5*60_000, 15*60_000, 30*60_000, 60*60_000];
const _UPD_PERIODIC_MS      = 6 * 60 * 60 * 1000;
let   _updErrCount   = 0;
let   _updRetryTimer = null;
let   _updPeriodicTimer = null;

function _scheduleUpdateRetry(reason) {
  if (_updRetryTimer) return;
  if (_updErrCount >= _UPD_RETRY_BACKOFF_MS.length) {
    updLog.warn('Max updater retries reached; will wait for next periodic recheck. Reason:', reason);
    return;
  }
  const delay = _UPD_RETRY_BACKOFF_MS[_updErrCount];
  updLog.info(`Scheduling updater retry in ${Math.round(delay/1000)}s (attempt ${_updErrCount + 1}/${_UPD_RETRY_BACKOFF_MS.length}). Reason:`, reason);
  _updRetryTimer = setTimeout(() => {
    _updRetryTimer = null;
    _updErrCount++;
    if (!autoUpdater) return;
    autoUpdater.checkForUpdates().catch((err) => updLog.error('Retry check failed:', err));
  }, delay);
}

function _startPeriodicUpdateCheck() {
  if (_updPeriodicTimer) return;
  _updPeriodicTimer = setInterval(() => {
    if (!autoUpdater) return;
    updLog.info('Periodic update recheck firing...');
    _updErrCount = 0;
    autoUpdater.checkForUpdates().catch((err) => updLog.error('Periodic check failed:', err));
  }, _UPD_PERIODIC_MS);
  if (_updPeriodicTimer.unref) _updPeriodicTimer.unref();
}

// IPC handlers used by Settings → Updates. Registered unconditionally so
// the renderer never sees "No handler registered for 'check-for-updates'"
// in dev / unpacked builds (where electron-updater itself is disabled).
// Each handler returns a soft { ok: false, devMode } payload instead of
// throwing when autoUpdater is unavailable, so the UI can surface a
// friendly message rather than a generic IPC failure.
function _registerUpdaterIpcHandlers() {
  try { ipcMain.removeHandler('check-for-updates'); } catch (_) {}
  ipcMain.handle('check-for-updates', async () => {
    if (!autoUpdater) return { ok: false, error: 'Auto-updater unavailable on this build.' };
    if (!app.isPackaged) return { ok: false, devMode: true, error: 'Updates are only available in installed builds.' };
    try {
      _updErrCount = 0;
      const r = await autoUpdater.checkForUpdates();
      return { ok: true, updateInfo: r && r.updateInfo };
    } catch (e) {
      updLog.error('Manual check failed:', e);
      return { ok: false, error: String(e) };
    }
  });

  try { ipcMain.removeHandler('download-update'); } catch (_) {}
  ipcMain.handle('download-update', async () => {
    if (!autoUpdater) return { ok: false, error: 'Auto-updater unavailable on this build.' };
    if (!app.isPackaged) return { ok: false, devMode: true, error: 'Updates are only available in installed builds.' };
    try { await autoUpdater.downloadUpdate(); return { ok: true }; }
    catch (e) {
      const msg = String(e && e.message || e);
      if (/already.*downloaded|in progress/i.test(msg)) return { ok: true, alreadyDownloaded: true };
      updLog.error('downloadUpdate failed:', e);
      return { ok: false, error: msg };
    }
  });

  try { ipcMain.removeHandler('quit-and-install'); } catch (_) {}
  ipcMain.handle('quit-and-install', async () => {
    if (!autoUpdater) return { ok: false, error: 'Auto-updater unavailable on this build.' };
    try { setImmediate(() => autoUpdater.quitAndInstall()); return { ok: true }; }
    catch (e) { return { ok: false, error: String(e) }; }
  });

  try { ipcMain.removeHandler('app-version'); } catch (_) {}
  ipcMain.handle('app-version', async () => {
    try { return { version: app.getVersion() }; }
    catch (e) { return { version: '', error: String(e) }; }
  });

  try { ipcMain.removeHandler('get-updater-log-path'); } catch (_) {}
  ipcMain.handle('get-updater-log-path', () => _updaterLogPath());
}

function initAutoUpdater() {
  // Register IPC handlers first — they need to be available even when
  // autoUpdater itself isn't (dev mode, unpacked builds, etc.) so the
  // Settings → Updates UI can surface a friendly message rather than a
  // raw "No handler registered" error.
  try { _registerUpdaterIpcHandlers(); } catch (e) { updLog.warn('Updater IPC registration failed:', e); }

  if (!autoUpdater) { updLog.info('autoUpdater not available'); return; }
  // electron-updater refuses to check on unpacked dev builds anyway and
  // logs a noisy warning; skip it cleanly so dev consoles stay quiet.
  if (!app.isPackaged) { updLog.info('Skipping auto-updater: app is not packaged (dev mode)'); return; }

  try {
    updLog.info('Initializing auto-updater. App version:', app.getVersion(), 'platform:', process.platform, process.arch);
    // Route electron-updater's internal logs through our file logger so we
    // capture HTTP errors, yml-parse failures, signature mismatches, etc.
    autoUpdater.logger = updLog;
    autoUpdater.autoDownload          = true;
    autoUpdater.autoInstallOnAppQuit  = true;

    autoUpdater.on('checking-for-update', () => updLog.info('Checking for update...'));

    autoUpdater.on('update-available', (info) => {
      updLog.info('Update available:', info && info.version);
      _updErrCount = 0;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-available', info);
    });

    autoUpdater.on('update-not-available', (info) => {
      updLog.info('Update not available. Current version:', info && info.version);
      _updErrCount = 0;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-not-available', info);
    });

    autoUpdater.on('error', (err) => {
      updLog.error('Update error:', err);
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-error', String(err));
      _scheduleUpdateRetry((err && err.message) || String(err));
    });

    autoUpdater.on('download-progress', (progress) => {
      // Log only every ~10% to keep updater.log readable on slow networks
      const pct = Math.round(progress.percent || 0);
      if (pct % 10 === 0) updLog.info('Download progress:', pct + '%');
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-download-progress', progress);
    });

    autoUpdater.on('update-downloaded', (info) => {
      updLog.info('Update downloaded:', info && info.version);
      _updErrCount = 0;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-downloaded', info);
    });

    // IPC handlers (check-for-updates, download-update, quit-and-install,
    // app-version, get-updater-log-path) are registered in
    // _registerUpdaterIpcHandlers() above so they're available even in dev
    // / unpacked builds where this packaged-only branch never runs.

    _startPeriodicUpdateCheck();
  } catch (e) {
    updLog.warn('initAutoUpdater failed:', e);
  }
}

//   - Show errors if Whisper fails

// Remove all code for loading/saving user profiles from disk
// ... existing code ...

// ── Single Instance Lock ───────────────────────────────────────────────────
// Prevents multiple Inshuverse windows from opening when the user double-clicks
// the app shortcut/icon repeatedly. Only ONE instance is ever allowed.
// If a second instance tries to start:
//   • It immediately quits.
//   • The already-running instance brings its window to the front.
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // This is the duplicate — quit right away, silently.
  app.quit();
} else {
  // We are the primary instance. If another instance fires up later,
  // focus our existing window instead of opening a new one.
  app.on('second-instance', (_event, _cmdLine, _cwd) => {
    if (mainWindow) {
      try {
        if (mainWindow.isMinimized()) mainWindow.restore();
        if (!mainWindow.isVisible()) mainWindow.show();
        mainWindow.focus();
        mainWindow.moveTop();
      } catch (e) {
        console.warn('[SINGLE-INSTANCE] Could not focus window:', e.message);
      }
    }
  });
}
// ──────────────────────────────────────────────────────────────────────────

// ── Pre-ready Chromium feature flags (must run BEFORE app.whenReady) ──────
// Disable Chromium's native window occlusion calculation on Windows.
// Transparent BrowserWindows are routinely misidentified as occluded
// (because the rectangle behind them shows non-window pixels through the
// per-pixel alpha), and Chromium then suppresses paints — producing stale
// frames around the rounded curves on focus/blur and Hide-Mode cycles.
// This flag is harmless to GPU compositing and keeps setContentProtection
// (which is GPU-mediated via DWM's WDA_EXCLUDEFROMCAPTURE) working
// correctly. Hardware acceleration is intentionally LEFT ENABLED here —
// disabling it makes Chromium use software rendering which writes through
// a code path that DWM does not reliably honor for capture exclusion on
// Win10/11, so Hide Mode would stop working.
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
}

// ── Hide Mode Safe Mode (must run BEFORE app.whenReady) ────────────────────
// Some GPU drivers (older Intel/NVIDIA on Windows with hardware overlay or
// DWM compositor quirks) bypass setContentProtection so the window leaks
// into screen-share buffers. Users on affected hardware can enable Safe
// Mode in Settings to disable Chromium hardware acceleration, forcing CPU
// compositing — on those specific drivers the OS-level capture exclusion
// then lands more reliably. On a healthy stack Safe Mode is a regression
// (CPU compositing actually makes capture-exclusion WORSE on most modern
// Windows builds), which is why this is opt-in and not the default.
try {
  const { loadSafeModeFlag } = require('./src/window/hide-mode');
  if (loadSafeModeFlag()) {
    app.disableHardwareAcceleration();
    console.log('[HIDE] Safe Mode active — hardware acceleration disabled');
  }
} catch (e) {
  console.warn('[HIDE] Safe Mode preflight failed:', e.message);
}

// ── macOS: force Dark appearance for the whole app (must run BEFORE the
// BrowserWindow is created so NSVisualEffectView picks up the appearance
// on first paint) ────────────────────────────────────────────────────────
// The BrowserWindow is created with `vibrancy: 'sidebar'`. The macOS
// NSVisualEffectMaterialSidebar material is *system-appearance-adaptive*:
// in Dark Mode it renders a dark grey/black blur; in Light Mode (or Auto
// + currently light) it renders a bright whitish-lavender blur that bleeds
// through the 82%-opaque `.container` background and produces the washed-
// out look reported on some Macs. Pinning themeSource to 'dark' tells AppKit
// to render every NSVisualEffectView in this app's process with the Dark
// appearance variant regardless of the user's System Settings, which is
// exactly what Spotify / Apple Music / Slack do for their consistent dark
// UI. Windows ignores this (the property is a no-op on non-macOS).
try {
  if (process.platform === 'darwin') {
    nativeTheme.themeSource = 'dark';
  }
} catch (e) {
  console.warn('[THEME] Failed to force dark appearance:', e.message);
}

app.whenReady().then(() => {
  // Load API keys from user data on startup
  loadUserAPIKeys();

  // On app start, show a modal (via IPC) to request the resume from the user
  // Store the resume in memory for the session only
  // Only allow the assistant/chat UI to work after the resume is provided
  // Remove any references to the Google Cloud credentials JSON file
  // Remove all IPC handlers related to sign-in, check-auth, sign-out, and user profile persistence
  // Remove all code that references or uses firebase-config.js
  // Load user configuration from disk on app start
  try {
    if (fs.existsSync(userProfilePath)) {
      const data = fs.readFileSync(userProfilePath, 'utf8');
      const profile = JSON.parse(data);

      // Load new configuration format if available
      if (profile.configuration) {
        userConfiguration = profile.configuration;
        console.log('User configuration loaded from disk:', userConfiguration.mode);
      }

      // Load legacy format for backward compatibility
      if (profile.resume) {
        userResume = profile.resume;
        console.log('User resume loaded from disk.');
      }
      if (profile.jobDescription) {
        userJobDescription = profile.jobDescription;
        console.log('User job description loaded from disk.');
      }

      // If no new configuration but has legacy data, create configuration
      if (!userConfiguration && userResume) {
        userConfiguration = {
          mode: 'interview',
          profile: userResume,
          jobDescription: userJobDescription
        };
        console.log('Created configuration from legacy profile data.');
      }

      // Send initial profile status to renderer if window exists
      if ((userConfiguration || userResume) && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('profile-status', true);
      }

      // Load persisted usage if present (no-op here; loaded on-demand)
    }
  } catch (error) {
    console.error('Failed to load user configuration:', error);
  }

  createWindow();

  // ── Sync APP_STATE.mainWindow so new modules (hide-mode, highlight) can
  //    reach the BrowserWindow without importing from this file directly.
  APP_STATE.mainWindow = mainWindow;

  // ── Register modular IPC handlers ──────────────────────────────────────
  // Hide Mode: uses ipcMain.handle so the renderer can await the result.
  // Replaces the old inline ipcMain.on handler in this file.
  try { registerHideModeHandlers(); } catch (e) { console.error('[INIT] hide-mode:', e.message); }

  // ── Instant Highlight Response (NEW FEATURE) ───────────────────────────
  // Global shortcut: Cmd+Shift+X (Mac) / Ctrl+Shift+X (Win/Linux)
  // User highlights text, copies it, presses the shortcut → Inshuverse explains.
  try { registerHighlightShortcut(); }      catch (e) { console.warn('[INIT] highlight shortcut:', e.message); }
  try { registerHighlightIpcHandler(); }    catch (e) { console.warn('[INIT] highlight IPC:', e.message); }
  // ──────────────────────────────────────────────────────────────────────

  // Register global shortcuts after window is created
  try { registerGlobalShortcuts(); } catch (_) {}
  // Initialize auto-updater after window is ready
  try {
    initAutoUpdater();
    // 5-second startup probe. Failures here trigger the exponential-backoff
    // retry inside the 'error' handler; a 6-hour periodic re-check is also
    // armed by initAutoUpdater() so transient network issues at boot never
    // permanently strand a client on an old version.
    if (autoUpdater && app.isPackaged) {
      setTimeout(() => {
        updLog.info('Starting automatic update check...');
        autoUpdater.checkForUpdates().catch((err) => updLog.error('Auto update check failed:', err));
      }, 5000);
    }
  } catch (err) {
    updLog.error('Auto-updater initialization failed:', err);
  }

})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// Clean up global shortcuts and background service on quit
app.on('will-quit', () => {
  try { globalShortcut.unregisterAll(); } catch (_) {}
  try { backgroundService.destroy(); } catch (_) {}
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error)
})

process.on('unhandledRejection', (error) => {
  console.error('Unhandled Rejection:', error)
})

// ---------------------------------------------
// Centralized credit deduction helper
// ---------------------------------------------
async function deductCreditsForUsage(context, usage) {
	void context;
	return applyUsageCharge(usage);
}

// ---------------------------------------------
// Credit-based usage tracking and enforcement for all plans except lifetime
// ---------------------------------------------
// Allow renderer to initialize usage counter with new credit-based system
ipcMain.handle('get-usage', async (_event, opts) => {
  try {
    if (!currentUser || !currentUser.uid) return { total: 0, openai: 0, gemini: 0, remaining: FREE_PLAN_CREDITS, restricted: false };


    // Optional forced plan refresh (used by "Check now")
    const force = opts && (opts.forceRecheck || opts.force);
    if (force && currentUser && currentUser.uid) {
      try {
        const planCheck = await checkUserPlan(currentUser.uid);
        applyPlanState(planCheck);
      } catch (e) {
        console.warn('[USAGE] Forced plan refresh failed:', e && e.message ? e.message : e);
      }
    }

    // For unlimited plans, return unlimited access (hide credits UI)
    if (currentIsUnlimitedPlan) {
      return {
        total: 0,
        openai: 0,
        gemini: 0,
        remaining: null, // Hide credits counter for unlimited
        restricted: false,
        isUnlimitedPlan: true
      };
    }

    // For lifetime plans, return unlimited access (hide credits UI)
    if (currentIsLifetimePlan) {
      return {
        total: 0,
        openai: 0,
        gemini: 0,
        remaining: null, // Hide credits counter for lifetime
        restricted: false,
        isLifetimePlan: true
      };
    }

    // Free and paid users both read from Firestore via checkUserPlan, so
    // remaining-credit state survives sign-out / reinstall / device change.
    // Previously the free branch read a local userProfile.json file, which
    // reset to "7 credits" the moment app data was cleared. The signup
    // grant of 7 credits is owned by firebase-config.js#checkUserPlan
    // (creates the Firestore doc on first sign-in) and is no longer
    // recomputed locally on every get-usage call.
    const planCheck = await checkUserPlan(currentUser.uid);
    applyPlanState(planCheck);
    const credits = typeof planCheck.credits === 'number' ? planCheck.credits : 0;
    if (currentPlanName === 'free') {
      const total = Math.max(0, FREE_PLAN_CREDITS - credits);
      return {
        total,
        openai: 0,
        gemini: 0,
        remaining: credits,
        credits,
        planName: 'free',
        restricted: isRestrictedUserSvc(currentHasAccess, currentPlanName),
      };
    }
    return {
      total: 0, // Not tracking total for paid plans
      openai: 0,
      gemini: 0,
      remaining: credits,
      restricted: isRestrictedUserSvc(currentHasAccess, currentPlanName),
      credits: credits,
      planName: currentPlanName
    };
  } catch (e) {
    console.error('get-usage failed:', e);
    return { total: 0, openai: 0, gemini: 0, remaining: currentUserCredits || FREE_PLAN_CREDITS, restricted: isRestrictedUserSvc(currentHasAccess, currentPlanName) };
  }
});

// Sign out: clear Firebase session and remove saved refresh token (ensure single registration)
try { ipcMain.removeHandler('sign-out'); } catch (_) {}
ipcMain.handle('sign-out', async () => {
  try {
    try { const { signOut } = require('firebase/auth'); await signOut(auth); } catch (e) {
      try { if (auth && typeof auth.signOut === 'function') await auth.signOut(); } catch(_) {}
    }
  } catch (_) {}
  currentUser = null;
  currentPlanName = 'free';
  currentHasAccess = false;
  currentIsLifetimePlan = false;
  currentIsUnlimitedPlan = false;
  currentUserCredits = FREE_PLAN_CREDITS;
  currentSubscription = {};
  restoreAlwaysOnTopAfterAuth('sign-out');
  try { if (fs.existsSync(TOKENS_PATH)) fs.unlinkSync(TOKENS_PATH); } catch (_) {}
  // Reset window visual state so the sign-in screen is never shown through
  // a transparent/hide-mode window after logout.
  //
  // IMPORTANT — Windows guard: setOpacity and setBackgroundColor must NEVER
  // be called on Windows after the BrowserWindow has been created. The
  // window is `transparent: true`, which uses per-pixel alpha via
  // UpdateLayeredWindow; setOpacity flips it to constant-alpha mode (one-
  // way, lifetime of the window) and setBackgroundColor cycles the
  // WS_EX_LAYERED extended style which can invalidate the alpha mode. The
  // visible symptom is a uniform white layer appearing around the rounded
  // container after any logout/login or Hide-Mode cycle. macOS uses Core
  // Animation layer opacity / NSVisualEffectView vibrancy, both compatible
  // with per-pixel alpha — those calls stay.
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      if (process.platform === 'darwin') {
        mainWindow.setOpacity(1.0);
        mainWindow.setBackgroundColor('#00000000');
        try { mainWindow.setVibrancy('sidebar'); } catch (_) {}
      }
      mainWindow.setContentProtection(false);
    } catch (_) {}
  }
  return { success: true };
});

// Handle sign-in request (robust dynamic loopback)
ipcMain.handle('sign-in', async () => {
  return new Promise(async (resolve, reject) => {
    let server;
    let serverClosed = false;
    let timeoutHandle = null;
    let REDIRECT_URI = null; // will be set after server starts
    let OAUTH_CLIENT_ID, CLIENT_SECRET, authUrl;
    let manualTimer = null; // short watchdog to show manual fallback
    let gotRedirect = false; // set true upon first redirect

    const cleanup = (label) => {
      if (!serverClosed && server) {
        try { server.close(() => console.log(`[AUTH] Local server closed (${label || 'cleanup'}).`)); } catch {}
        serverClosed = true;
      }
      if (timeoutHandle) { clearTimeout(timeoutHandle); timeoutHandle = null; }
      if (manualTimer) { clearTimeout(manualTimer); manualTimer = null; }
    };

    try {
      console.log('Starting sign-in process...');

      // Create local HTTP server first; bind to a random free port on IPv4 loopback
      server = http.createServer(async (req, res) => {
        try {
          const requestUrl = url.parse(req.url, true);
          if (requestUrl.pathname === '/' && requestUrl.query.code) {
            gotRedirect = true;
            if (manualTimer) { clearTimeout(manualTimer); manualTimer = null; }
            const code = requestUrl.query.code;
            console.log('Authorization code received:', code);

            // Exchange the code for tokens (must use the same redirect_uri)
            const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                code,
                client_id: OAUTH_CLIENT_ID,
                client_secret: CLIENT_SECRET,
                redirect_uri: REDIRECT_URI,
                grant_type: 'authorization_code',
              }),
            });

            const tokens = await tokenResponse.json();
            console.log('Tokens received:', { has_access_token: Boolean(tokens.access_token), has_refresh_token: Boolean(tokens.refresh_token) });

            // Persist refresh_token (if provided) to enable silent sign-in on next launch
            try {
              if (tokens.refresh_token) {
                fs.writeFileSync(TOKENS_PATH, JSON.stringify({ refresh_token: tokens.refresh_token }, null, 2));
                console.log('[AUTH] Saved refresh_token for silent sign-in');
              }
            } catch (e) {
              console.warn('[AUTH] Failed to save refresh_token:', e && e.message ? e.message : e);
            }

            if (tokens.access_token) {
              const credential = GoogleAuthProvider.credential(null, tokens.access_token);
              const result = await signInWithCredential(auth, credential);
              currentUser = result.user;
              console.log('Firebase sign-in successful:', currentUser.email);

              // Get ID token and call backend login endpoint
              const idToken = await currentUser.getIdToken();
              await handleUserLogin(idToken);

              // ALWAYS fetch fresh plan and credits data from the server/database
              console.log('[SIGN-IN] Fetching fresh plan and credits data from server for user:', currentUser.uid);
              const planCheck = await checkUserPlan(currentUser.uid);
              const hasAccess = planCheck.hasAccess;

              // Close the server and respond to the browser
              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end('<html><body><h1>Authentication successful!</h1><p>You can close this window.</p></body></html>');
              cleanup('success');
              restoreAlwaysOnTopAfterAuth('sign-in-success');

              // Update plan flags and credit info for new credit-based system
              applyPlanState(planCheck);

              console.log('[SIGN-IN] Fresh credits from server:', currentUserCredits, 'Plan:', currentPlanName);

              // Update local storage with fresh credits data
              persistLastKnownPlanData();
              console.log('[SIGN-IN] Updated local storage with fresh credits:', currentUserCredits);

              const finalResult = {
                success: true,
                hasAccess: hasAccess,
                user: { email: currentUser.email, uid: currentUser.uid },
                planName: planCheck.planName,
                isLifetimePlan: planCheck.isLifetimePlan,
                isUnlimitedPlan: !!planCheck.isUnlimitedPlan,
                credits: planCheck.credits,
                subscription: planCheck.subscription
              };
              console.log('IPC sign-in handler resolving with:', finalResult);
              try {
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('auth-complete', finalResult);
                }
              } catch (e) { console.warn('[AUTH] notify auth-complete failed:', e); }
              resolve(finalResult);
            } else {
              res.writeHead(400, { 'Content-Type': 'text/html' });
              res.end('<html><body><h1>Authentication failed!</h1><p>No access token received.</p></body></html>');
              cleanup('no-token');
              restoreAlwaysOnTopAfterAuth('sign-in-no-token');
              reject(new Error('Authentication failed: No access token received'));
            }
          } else {
            res.writeHead(404);
            res.end();
          }
        } catch (error) {
          console.error('Error in local server request handler:', error);
          try {
            res.writeHead(500, { 'Content-Type': 'text/html' });
            res.end(`<html><body><h1>Authentication Error!</h1><p>${error.message}</p></body></html>`);
          } catch {}
          cleanup('handler-error');
          restoreAlwaysOnTopAfterAuth('sign-in-handler-error');
          reject(error);
        }
      });

      server.on('error', (err) => {
        console.error('[AUTH] Local server error:', err);
        cleanup('server-error');
        restoreAlwaysOnTopAfterAuth('sign-in-server-error');
        reject(new Error('Failed to start local redirect server: ' + (err.code || err.message)));
      });

      // Listen on a random free port on 127.0.0.1 (IPv4)
      server.listen(0, '127.0.0.1', async () => {
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : null;
        REDIRECT_URI = `http://127.0.0.1:${port}`;
        console.log(`[AUTH] Local server listening on ${REDIRECT_URI}`);

        // Build auth URL using the actual redirect URI
        const details = getGoogleAuthDetails(REDIRECT_URI);
        authUrl = details.authUrl;
        OAUTH_CLIENT_ID = details.OAUTH_CLIENT_ID;
        CLIENT_SECRET = details.CLIENT_SECRET;

        // Send the auth URL to renderer immediately so it can show it in the copy link
        try {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('auth-url-ready', { authUrl });
            console.log('[AUTH] Sent auth URL to renderer:', authUrl);
          }
        } catch (e) {
          console.warn('[AUTH] Failed to send auth URL to renderer:', e);
        }

        try {
          suspendAlwaysOnTopForAuth();
          await shell.openExternal(authUrl);
          console.log('[AUTH] Opened Google sign-in in default browser');
          // Start watchdog: if no redirect in 8s, ask renderer to show manual fallback

          manualTimer = setTimeout(() => {
            if (!gotRedirect && mainWindow && !mainWindow.isDestroyed()) {
              try { mainWindow.webContents.send('auth-manual-needed', { authUrl }); } catch {}
            }
          }, 8000);
        } catch (err) {
          console.error('Failed to open external URL:', err);
          // Keep server alive to allow manual open
          // Provide manual fallback URL to renderer
          try {
            if (mainWindow && !mainWindow.isDestroyed()) {
              // Inform renderer that manual action is available immediately
              mainWindow.webContents.send('auth-manual-needed', { authUrl });
            }
          } catch {}
          resolve({ success: false, needsManual: true, authUrl });
          return;
        }
      });

      // Set a timeout for the authentication process
      timeoutHandle = setTimeout(() => {
        cleanup('timeout');
        restoreAlwaysOnTopAfterAuth('sign-in-timeout');
        reject(new Error('Authentication timed out'));
      }, 300000); // 5 minutes

    } catch (error) {
      console.error('Error occurred in handler for \'sign-in\':', error);
      cleanup('exception');
      restoreAlwaysOnTopAfterAuth('sign-in-exception');
      reject(error);
    }
  });
});

// Check authentication status (fall back to in-memory user)
ipcMain.handle('check-auth', async () => {
  try {
    // Prefer Firebase auth user, but fall back to previously signed-in user
    let user = auth.currentUser || currentUser;
    if (!user) {
      // Try silent sign-in using stored refresh token (no browser prompt)
      user = await trySilentAuthWithRefreshToken();
      if (!user) {
        return { isAuthenticated: false };
      }
    }
    currentUser = user;

    // ALWAYS fetch fresh plan and credits data from the server/database
    // This ensures we get the latest credits after user purchases more
    console.log('[AUTH] Fetching fresh plan and credits data from server for user:', currentUser.uid);
    let planCheck;
    try {
      planCheck = await checkUserPlan(currentUser.uid);
    } catch (fetchErr) {
      console.warn('[AUTH] checkUserPlan failed:', fetchErr && fetchErr.message ? fetchErr.message : fetchErr);
      planCheck = null;
    }

    // C4: Never overwrite a valid Pro/Lifetime plan with an error placeholder.
    // If checkUserPlan returned an error-sentinel or threw, preserve the last
    // good in-memory state so upgraded users don't regress to "free" due to
    // a transient Firestore failure.
    const isErrorPlan = !planCheck || planCheck.planName === 'error';
    const hasValidPlan = currentPlanName && currentPlanName !== 'free' && currentPlanName !== 'error';
    if (isErrorPlan && hasValidPlan) {
      console.warn('[AUTH] checkUserPlan returned error; preserving existing plan:', currentPlanName);
      planCheck = null; // skip applyPlanState — keep in-memory values as-is
    }

    // C5: Offline fallback — if we have no plan data at all (cold start with
    // Firestore unreachable), hydrate from the last-known cache in userProfile.json.
    if (isErrorPlan && !hasValidPlan) {
      try {
        if (fs.existsSync(userProfilePath)) {
          const cached = JSON.parse(fs.readFileSync(userProfilePath, 'utf8'));
          if (typeof cached.lastKnownCredits === 'number' && cached.lastKnownCredits > 0) {
            console.warn('[AUTH] Firestore offline — using cached credits:', cached.lastKnownCredits, 'plan:', cached.lastKnownPlan);
            currentUserCredits = cached.lastKnownCredits;
            currentPlanName    = cached.lastKnownPlan || 'free';
            currentHasAccess   = cached.lastKnownCredits > 0;
            planCheck = null; // already applied manually above
          }
        }
      } catch (cacheErr) {
        console.warn('[AUTH] Failed to read offline cache:', cacheErr.message);
      }
    }

    if (planCheck) {
      applyPlanState(planCheck);
      console.log('[AUTH] Fresh credits from server:', currentUserCredits, 'Plan:', currentPlanName);
      persistLastKnownPlanData();
      console.log('[AUTH] Updated local storage with fresh credits:', currentUserCredits);
    }

    return {
      isAuthenticated: true,
      user: {
        email: currentUser.email,
        uid: currentUser.uid
      },
      hasAccess:      planCheck ? planCheck.hasAccess      : currentHasAccess,
      planName:       planCheck ? planCheck.planName       : currentPlanName,
      isLifetimePlan: planCheck ? planCheck.isLifetimePlan : currentIsLifetimePlan,
      isUnlimitedPlan: planCheck ? !!planCheck.isUnlimitedPlan : currentIsUnlimitedPlan,
      credits:        planCheck ? planCheck.credits        : currentUserCredits,
      subscription:   planCheck ? planCheck.subscription   : currentSubscription,
    };
  } catch (error) {
    console.error('Error checking auth status:', error);
    return { isAuthenticated: false };
  }
});

// Add IPC handler to open gelp.html in a separate BrowserWindow.
ipcMain.handle('open-help', async () => {
  try {
    const helpWin = new BrowserWindow({
      width: 900,
      height: 700,
      title: 'How to use InshuVerse AI',
      backgroundColor: '#0b1220',
      show: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        devTools: false
      }
    });
    const path = require('path');
    await helpWin.loadFile(path.join(__dirname, 'gelp.html'));
    helpWin.setMenuBarVisibility(false);
    return true;
  } catch (e) {
    console.error('Failed to open help window:', e);
    return false;
  }
});

// Load API keys from user data on startup. Keys are stored encrypted at
// rest (AES-256-GCM, machine-bound) but legacy plaintext entries are still
// accepted and silently re-encrypted on the next save.
function loadUserAPIKeys() {
  try {
    if (fs.existsSync(userProfilePath)) {
      const userData = JSON.parse(fs.readFileSync(userProfilePath, 'utf8'));
      const oai = userData.openaiKey || null;
      const gem = userData.geminiKey || null;
      const dg  = userData.deepgramKey || null;
      const aai = userData.assemblyaiKey || null;
      userOpenAIKey     = oai ? cryptoVault.decryptUserOrPassthrough(oai) || null : null;
      userGeminiKey     = gem ? cryptoVault.decryptUserOrPassthrough(gem) || null : null;
      userDeepgramKey   = dg  ? cryptoVault.decryptUserOrPassthrough(dg)  || null : null;
      userAssemblyAIKey = aai ? cryptoVault.decryptUserOrPassthrough(aai) || null : null;
      console.log('[API] Loaded API keys from user data');
    }
  } catch (error) {
    console.warn('[API] Failed to load API keys:', error);
  }
  try { _registerLifetimeUserKeys(); } catch (_) {}
}

// ── API key getters — now delegated to src/auth/tiers.js ─────────────────
// tiers.js reads APP_STATE.currentPlan and APP_STATE.lifetimeUserKeys which
// are kept in sync by updateCurrentPlanData() and saveUserAPIKeys() below.
function _syncLifetimeKeysToState() {
  APP_STATE.lifetimeUserKeys = { openai: userOpenAIKey || '', gemini: userGeminiKey || '' };
}

function getOpenAIKey() {
  _syncLifetimeKeysToState();
  return _tiers.getOpenAIKey();
}

function getGeminiKey() {
  _syncLifetimeKeysToState();
  return _tiers.getGeminiKey();
}


// Save API keys to user data. Keys are encrypted at rest with a
// machine-bound AES-256-GCM key so a stolen profile JSON is unusable
// off-device.
function saveUserAPIKeys() {
  try {
    let userData = {};
    if (fs.existsSync(userProfilePath)) {
      userData = JSON.parse(fs.readFileSync(userProfilePath, 'utf8'));
    }
    userData.openaiKey     = userOpenAIKey     ? cryptoVault.encryptUser(userOpenAIKey)     : null;
    userData.geminiKey     = userGeminiKey     ? cryptoVault.encryptUser(userGeminiKey)     : null;
    userData.deepgramKey   = userDeepgramKey   ? cryptoVault.encryptUser(userDeepgramKey)   : null;
    userData.assemblyaiKey = userAssemblyAIKey ? cryptoVault.encryptUser(userAssemblyAIKey) : null;
    fs.writeFileSync(userProfilePath, JSON.stringify(userData, null, 2));
    console.log('[API] Saved API keys to user data');
  } catch (error) {
    console.error('[API] Failed to save API keys:', error);
  }
}

// Plan-aware Deepgram key resolver. Routing rules:
//   • lifetime  → user's BYOK key (never the vendor pool)
//   • free      → dedicated FREE_DEEPGRAM_KEY (separate Deepgram project so
//                 free-tier throttling cannot affect paid/lifetime traffic)
//   • paid/etc. → DEFAULT_DEEPGRAM_KEY (premium project)
// Note: Deepgram keys do NOT enter the KeyPool (which only manages openai /
// gemini buckets), so there is zero risk of the free key being quarantined
// by paid-user 401/429s — they're surfaced through entirely separate paths.
function getDeepgramKey() {
  if (currentIsLifetimePlan) return userDeepgramKey || '';
  const plan = (currentPlanName || '').toLowerCase();
  if (plan === 'free') return FREE_DEEPGRAM_KEY || DEFAULT_DEEPGRAM_KEY || '';
  return DEFAULT_DEEPGRAM_KEY || '';
}

// Plan-aware AssemblyAI key resolver. Mirrors getDeepgramKey() routing:
//   • lifetime  → user's BYOK key (never the vendor pool); empty when unset
//                 so the proactive handler falls through to Deepgram BYOK.
//   • free      → ASSEMBLYAI_FREE_KEY  (free AssemblyAI project)
//   • paid/etc. → ASSEMBLYAI_PRO_KEY   (paid AssemblyAI project)
// Routes through the keypool so a quarantined key drops out of rotation
// silently. The per-tier `assemblyai/<free|pro>` buckets isolate free
// failures from paid traffic the same way Deepgram does.
function getAssemblyAIKey() {
  if (currentIsLifetimePlan) return userAssemblyAIKey || '';
  const plan = (currentPlanName || '').toLowerCase();
  const org = (plan === 'free' || !plan) ? 'free' : 'pro';
  const picked = keyPool.acquireKey({ provider: 'assemblyai', org });
  if (picked) return picked.value;
  // Pool empty / all keys cooling down — fall back to the raw constant so
  // the proactive session still attempts a connection. Same defensive
  // pattern as withKeyRotation().
  return org === 'free' ? (ASSEMBLYAI_FREE_KEY || '') : (ASSEMBLYAI_PRO_KEY || '');
}

// Update IPC handlers to allow user API key management
ipcMain.on('set-openai-key', (event, key) => {
  userOpenAIKey = key && key.trim() ? key.trim() : null;
  saveUserAPIKeys();
  try { _registerLifetimeUserKeys(); } catch (_) {}
  console.log('[API] OpenAI key updated by user');
});

ipcMain.on('set-gemini-key', (event, key) => {
  userGeminiKey = key && key.trim() ? key.trim() : null;
  saveUserAPIKeys();
  try { _registerLifetimeUserKeys(); } catch (_) {}
  console.log('[API] Gemini key updated by user');
});

ipcMain.on('set-deepgram-key', (event, key) => {
  userDeepgramKey = key && key.trim() ? key.trim() : null;
  saveUserAPIKeys();
  console.log('[API] Deepgram key updated by user');
  // Notify the renderer so the proactive-mode dropdown can refresh its
  // visibility state (lifetime users gain Manual/Fully Auto on add).
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('deepgram-key-changed', { hasKey: !!userDeepgramKey });
  }
});

ipcMain.on('set-assemblyai-key', (event, key) => {
  userAssemblyAIKey = key && key.trim() ? key.trim() : null;
  saveUserAPIKeys();
  console.log('[API] AssemblyAI key updated by user');
  // Reuse the same renderer notification channel so the proactive-mode
  // dropdown re-evaluates streaming-key availability. The renderer reads
  // hasDeepgramKey || hasAssemblyAIKey from get-api-keys to decide.
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('deepgram-key-changed', {
      hasKey: !!userDeepgramKey || !!userAssemblyAIKey,
    });
  }
});


// Add IPC handler to get current API keys
ipcMain.handle('get-api-keys', () => {
  try {
    if (currentIsLifetimePlan) {
      return {
        openai: userOpenAIKey || null,
        gemini: userGeminiKey || null,
        deepgram: userDeepgramKey || null,
        assemblyai: userAssemblyAIKey || null,
        isLifetimePlan: true,
        hasDeepgramKey: !!userDeepgramKey,
        hasAssemblyAIKey: !!userAssemblyAIKey,
        // Either streaming provider unlocks proactive listening for
        // lifetime users — the renderer uses this single flag.
        hasStreamingKey: !!userDeepgramKey || !!userAssemblyAIKey
      };
    }
    // For non-lifetime plans, return appropriate default keys based on plan
    const plan = (currentPlanName || '').toLowerCase();
    const isPremium = currentIsUnlimitedPlan || (plan && plan !== 'free');
    return {
      openai: isPremium ? PREMIUM_OPENAI_KEY : DEFAULT_OPENAI_KEY,
      gemini: isPremium ? PREMIUM_GEMINI_KEY : FREE_GEMINI_KEY,
      deepgram: null,             // vendor-managed; renderer never sees it
      assemblyai: null,           // vendor-managed; renderer never sees it
      isLifetimePlan: false,
      hasDeepgramKey: !!DEFAULT_DEEPGRAM_KEY,
      hasAssemblyAIKey: !!ASSEMBLYAI_FREE_KEY || !!ASSEMBLYAI_PRO_KEY,
      hasStreamingKey: true
    };
  } catch (error) {
    return {
      openai: null,
      gemini: null,
      deepgram: null,
      assemblyai: null,
      isLifetimePlan: currentIsLifetimePlan,
      hasDeepgramKey: false,
      hasAssemblyAIKey: false,
      hasStreamingKey: false
    };
  }
});

// Add IPC handler to validate API keys
// Performs a real lightweight inference call so keys that authenticate but lack
// inference access (e.g. restricted/project-scoped keys) are rejected up-front.
ipcMain.handle('validate-api-key', async (event, { type, key }) => {
  const trimmed = typeof key === 'string' ? key.trim() : '';
  if (!trimmed) return { valid: false, error: 'Empty API key' };
  try {
    if (type === 'openai') {
      // 6s upper bound — the validate-key probe is a single 1-token completion,
      // healthy responses come back in 200–800 ms, and the renderer button
      // shows a spinner that should resolve quickly. SDK retries are disabled
      // (maxRetries: 0) so the user sees the result on the first round-trip.
      const openai = new OpenAI({ apiKey: trimmed, maxRetries: 0, timeout: 6000 });
      // 1-token chat completion on the cheapest model proves auth + inference.
      const resp = await openai.chat.completions.create({
        model: resolveModel('CHAT_FAST'),
        max_tokens: 1,
        temperature: 0,
        messages: [{ role: 'user', content: 'ok' }],
      });
      if (!resp || !resp.choices || !resp.choices.length) {
        return { valid: false, error: 'Empty response from OpenAI' };
      }
      return { valid: true };
    }
    if (type === 'gemini') {
      const genAI = new GoogleGenerativeAI(trimmed);
      const model = genAI.getGenerativeModel({
        model: resolveModel('GEMINI_FLASH_LITE'),
        generationConfig: { maxOutputTokens: 1, temperature: 0 },
      });
      // The Gemini SDK has no per-request timeout option, so race against a
      // 6 s rejection so a hung network does not strand the renderer's
      // spinner. Healthy probes resolve in ~300–700 ms.
      const probe = model.generateContent('ok');
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 6000));
      const r = await Promise.race([probe, timeout]);
      // If the call resolves without throwing, the key is valid.
      // Reading .response.text() just sanity-checks the shape.
      try { r?.response?.text?.(); } catch (_) {}
      return { valid: true };
    }
    if (type === 'deepgram') {
      // Project-list endpoint authenticates with just the key and is the
      // canonical "is this key live?" probe — no audio billed.
      const https = require('https');
      const result = await new Promise((resolve) => {
        const req = https.request({
          host: 'api.deepgram.com',
          path: '/v1/projects',
          method: 'GET',
          headers: { Authorization: `Token ${trimmed}` },
          timeout: 6000,
        }, (res) => {
          let body = '';
          res.on('data', (c) => { body += c; });
          res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        req.on('timeout', () => { req.destroy(new Error('timeout')); });
        req.on('error', (e) => resolve({ error: e }));
        req.end();
      });
      if (result.error) throw result.error;
      if (result.status === 200) return { valid: true };
      if (result.status === 401 || result.status === 403) return { valid: false, error: 'Invalid Deepgram API key' };
      return { valid: false, error: `Deepgram returned HTTP ${result.status}` };
    }
    if (type === 'assemblyai') {
      // GET /v2/transcript?limit=1 authenticates with just the key and is
      // the canonical "is this key live?" probe — no audio billed.
      // AssemblyAI uses a bare Authorization header (no Token/Bearer prefix).
      const https = require('https');
      const result = await new Promise((resolve) => {
        const req = https.request({
          host: 'api.assemblyai.com',
          path: '/v2/transcript?limit=1',
          method: 'GET',
          headers: { Authorization: trimmed },
          timeout: 6000,
        }, (res) => {
          let body = '';
          res.on('data', (c) => { body += c; });
          res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        req.on('timeout', () => { req.destroy(new Error('timeout')); });
        req.on('error', (e) => resolve({ error: e }));
        req.end();
      });
      if (result.error) throw result.error;
      if (result.status === 200) return { valid: true };
      if (result.status === 401 || result.status === 403) return { valid: false, error: 'Invalid AssemblyAI API key' };
      return { valid: false, error: `AssemblyAI returned HTTP ${result.status}` };
    }
    return { valid: false, error: `Unknown key type: ${type}` };
  } catch (error) {
    const raw = (error && error.message) || String(error);
    // Surface a user-friendly reason without leaking the full stack.
    let friendly = raw;
    if (/401|invalid_api_key|incorrect api key|unauthor/i.test(raw))      friendly = 'Invalid API key';
    else if (/403|permission|access denied/i.test(raw))                   friendly = 'Key lacks inference permission';
    else if (/429|quota|rate.?limit|RESOURCE_EXHAUSTED/i.test(raw))       friendly = 'Key is valid but quota/rate-limit is exhausted';
    else if (/timeout|ETIMEDOUT|ECONNRESET|ENOTFOUND/i.test(raw))         friendly = 'Network error — could not reach provider';
    // 429 means the key authenticates fine — treat as valid so users aren't blocked.
    if (/429|quota|rate.?limit|RESOURCE_EXHAUSTED/i.test(raw)) {
      return { valid: true, warning: friendly };
    }
    return { valid: false, error: friendly };
  }
});

// Handle API selection from frontend
ipcMain.on('set-selected-api', (event, api) => {
  // Force OpenAI regardless of UI input
  selectedAPI = 'openai';
  console.log('API selection forced to OpenAI');
});

// Handle response size selection from frontend
ipcMain.on('set-response-size', (event, size) => {
  responseSize = size;
  console.log(`[RESP-SIZE] Received from UI: ${responseSize}`);
});

// Handle model selection from frontend
let selectedModel = 'default'; // Default to smart fallback system
ipcMain.on('set-model-selection', (event, model) => {
  if (['default', 'openai', 'gemini'].includes(model)) {
    selectedModel = model;
    console.log(`[MODEL_SELECTION] Changed to: ${selectedModel}`);
  } else {
    console.warn(`[MODEL_SELECTION] Invalid model selection: ${model}, keeping current: ${selectedModel}`);
  }
});

// Handle interview language (Whisper transcription language) from frontend
let interviewLanguageCode = 'en'; // Default: English for Whisper
ipcMain.on('set-interview-language', (event, langCode) => {
  try {
    if (typeof langCode === 'string' && langCode.trim()) {
      interviewLanguageCode = langCode.trim().toLowerCase();
      console.log('[LANGUAGE] Interview language set to:', interviewLanguageCode);
    }
  } catch (e) {
    console.warn('[LANGUAGE] Failed to set interview language:', e.message || e);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// set-user-resume — now an ipcMain.handle so the renderer can await confirmation.
// Accepts both the old string format and the new multi-purpose object format.
// Returns { success: true } or { success: false, error: string }.
// ─────────────────────────────────────────────────────────────────────────────
// Remove any legacy ipcMain.on listener first (prevents duplicate-handler crash on hot-reload)
try { ipcMain.removeHandler('set-user-resume'); } catch (_) {}
ipcMain.handle('set-user-resume', async (_event, profileData) => {
  try {
    let parsed = profileData;

    // Normalise: if the renderer sent a JSON string, parse it
    if (typeof profileData === 'string') {
      try { parsed = JSON.parse(profileData); }
      catch { parsed = { mode: 'interview', profile: profileData, jobDescription: null }; }
    }

    // Guard: must be a non-null object after parsing
    if (!parsed || typeof parsed !== 'object') {
      parsed = { mode: 'interview', profile: String(profileData || ''), jobDescription: null };
    }

    // Ensure a mode is always present
    if (!parsed.mode) parsed.mode = 'interview';

    // Update in-memory state
    userConfiguration = parsed;
    if (parsed.mode === 'interview') {
      userResume        = parsed.profile       || null;
      userJobDescription = parsed.jobDescription || null;
    } else {
      // For non-interview modes, keep legacy fields null (they're unused)
      userResume        = null;
      userJobDescription = null;
    }

    console.log('[PROFILE] Configuration updated in memory:', {
      mode:             userConfiguration.mode,
      hasProfile:       !!(userConfiguration.profile || userResume),
      hasJobDescription: !!(userConfiguration.jobDescription || userJobDescription),
    });

    // Persist to disk — read-merge-write to preserve other fields (e.g. profileSkipped)
    let diskProfile = {};
    if (fs.existsSync(userProfilePath)) {
      try { diskProfile = JSON.parse(fs.readFileSync(userProfilePath, 'utf8')); } catch (_) {}
    }
    diskProfile.configuration   = userConfiguration;
    diskProfile.resume          = userResume;
    diskProfile.jobDescription  = userJobDescription;
    diskProfile.profileSkipped  = false; // real profile clears skip flag
    diskProfile.savedAt         = Date.now();

    fs.writeFileSync(userProfilePath, JSON.stringify(diskProfile, null, 2), 'utf8');
    console.log('[PROFILE] Configuration saved to disk successfully');

    // Notify renderer that profile is now active
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('profile-status', true);
    }

    return { success: true };
  } catch (error) {
    console.error('[PROFILE] Failed to save user configuration:', error);
    return { success: false, error: error.message };
  }
});

// Handle getting current profile data
ipcMain.handle('get-user-profile', async () => {
  try {
    let profileSkipped = false;
    try {
      if (fs.existsSync(userProfilePath)) {
        const raw = fs.readFileSync(userProfilePath, 'utf8');
        const saved = JSON.parse(raw);
        profileSkipped = !!saved.profileSkipped;
      }
    } catch (_) {}
    // hasConfiguration is true when any mode's configuration is saved —
    // userResume is only set for interview mode, so we must also check
    // userConfiguration to cover meeting / sales / chatgpt modes.
    const hasConfiguration = !!(userConfiguration && userConfiguration.mode);
    return {
      configuration: userConfiguration || null,
      resume: userResume || '',
      jobDescription: userJobDescription || '',
      profileSkipped,
      hasConfiguration
    };
  } catch (error) {
    console.error('Failed to get user profile:', error);
    return { configuration: null, resume: '', jobDescription: '', profileSkipped: false, hasConfiguration: false };
  }
});

// Handle "Save for Later" on profile setup – persist a skip flag locally
try { ipcMain.removeHandler('skip-profile-setup'); } catch (_) {}
ipcMain.handle('skip-profile-setup', async () => {
  try {
    let profile = {};
    if (fs.existsSync(userProfilePath)) {
      profile = JSON.parse(fs.readFileSync(userProfilePath, 'utf8'));
    }
    profile.profileSkipped = true;
    fs.writeFileSync(userProfilePath, JSON.stringify(profile, null, 2));
    console.log('[PROFILE] Profile setup saved for later (profileSkipped=true)');
    return { success: true };
  } catch (error) {
    console.error('[PROFILE] Failed to save skip flag:', error);
    return { success: false, error: error.message };
  }
});

// Add IPC handler for text summarization
ipcMain.handle('summarize-text', async (_event, payload) => {
  try {
    const text = (payload && typeof payload.text === 'string') ? payload.text : '';
    const limit = (payload && Number.isFinite(payload.limit)) ? Math.max(100, Math.min(2000, payload.limit)) : 1000;
    const s = String(text || '').trim();
    if (!s) return '';

    const openai = new OpenAI({ apiKey: getOpenAIKey(), maxRetries: 2, timeout: 45000 });

    const system = `You compress long user-provided text into a dense, information-preserving summary.
Constraints:
- HARD LIMIT: ${limit} characters max. Absolutely do not exceed.
- Preserve key facts: roles, skills, achievements, certs, education, dates, metrics, keywords, responsibilities.
- Keep names, titles, technologies, tools, noteworthy outcomes.
- Use plain English. No preambles. No bullets unless critical. No code fences. No quotes. No metadata.`;

    const user = `Summarize the following text to <= ${limit} characters while preserving all critical details:\n\n${s}`;

    let summary = '';
    try {
      const completion = await callWithFallback('CHAT_FAST', (modelId) =>
        openai.chat.completions.create({
          model: modelId,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ],
          temperature: 0.2,
          max_tokens: 512,
        }),
      );
      summary = (completion.choices?.[0]?.message?.content || '').trim();
    } catch (e) {
      // fallback attempt without system prompt
      const completion = await callWithFallback('CHAT_FAST', (modelId) =>
        openai.chat.completions.create({
          model: modelId,
          messages: [{ role: 'user', content: user }],
          temperature: 0.2,
          max_tokens: 512,
        }),
      );
      summary = (completion.choices?.[0]?.message?.content || '').trim();
    }

    if (!summary) return s.slice(0, limit);
    // Enforce hard character cap defensively
    if (summary.length > limit) summary = summary.slice(0, limit);
    return summary;
  } catch (error) {
    try { console.error('summarize-text failed:', error); } catch {}
    const text = (payload && typeof payload.text === 'string') ? payload.text : '';
    const limit = (payload && Number.isFinite(payload.limit)) ? Math.max(100, Math.min(2000, payload.limit)) : 1000;
    const s = String(text || '').trim();
    return s.slice(0, limit);
  }
});

// Lightweight translation handler (independent of answer system prompt)
ipcMain.handle('translate-text', async (_event, payload) => {
  try {
    const text = (payload && typeof payload.text === 'string') ? payload.text : '';
    const targetLang = (payload && typeof payload.targetLang === 'string') ? payload.targetLang : '';
    const s = String(text || '').trim();
    const lang = String(targetLang || '').trim();
    if (!s || !lang) return s;

    const openai = new OpenAI({ apiKey: getOpenAIKey(), maxRetries: 2, timeout: 25000 });
    const system = 'You are a precise translation engine. Translate the user text into the target language, preserving meaning, tone, and formatting. Do not add commentary or notes.';
    const user = `Target language: ${lang}\n\nText to translate:\n"""\n${s}\n"""`;

    const completion = await callWithFallback('CHAT_FAST', (modelId) =>
      openai.chat.completions.create({
        model: modelId,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        temperature: 0.1,
        max_tokens: Math.min(2000, Math.max(256, Math.ceil(s.length * 1.2)))
      }),
    );

    const result = (completion && completion.choices && completion.choices[0] && completion.choices[0].message && completion.choices[0].message.content) || '';
    const finalText = String(result || '').trim() || s;

    // Deduct 1 credit for translation step (paid/credit-based plans only)
    try {
      await applyUsageCharge({ model: 'openai', count: 1 });
    } catch (_) {}

    return finalText;
  } catch (error) {
    try { console.error('translate-text failed:', error); } catch {}
    return (payload && payload.text) ? payload.text : '';
  }
});

// OpenAI Whisper transcription moved to src/services/transcription.js

// Gemini transcription moved to src/services/transcription.js

// OpenAI answer generation moved to src/services/answer.js

// IPC handler to open external URLs (for Windows compatibility)
ipcMain.on('open-external-url', (_event, url) => {
  try {
    console.log('[MAIN] Opening external URL:', url);
    shell.openExternal(url);
  } catch (error) {
    console.error('[MAIN] Failed to open external URL:', error);
  }
});

// Audio leak telemetry — every getUserMedia / getDisplayMedia acquisition
// in BaseAudioService / MacOSAudioService / AudioManager increments the
// renderer-side window.__activeAudioStreams counter and sends the new
// total here. Logging it next to the audio_loopback_input_mac_impl errors
// makes a stuck stream immediately visible without using the macOS
// indicator as the canary. Channel is fire-and-forget; no reply.
ipcMain.on('audio-active-streams', (_event, payload) => {
  try {
    const count = (payload && typeof payload.count === 'number') ? payload.count : -1;
    const delta = (payload && payload.delta) || '?';
    const label = (payload && payload.label) || 'stream';
    console.log(`[AUDIO] active streams: ${count} (${delta} ${label})`);
  } catch (_) { /* ignore malformed payload */ }
});

// Nudge window by small offsets (for Ctrl/⌘ + Arrow keys)
ipcMain.handle('nudge-window', (_event, payload) => {
  try {
    const dx = Number(payload && payload.dx) || 0;
    const dy = Number(payload && payload.dy) || 0;
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    if (!win || (dx === 0 && dy === 0)) return;
    const [x, y] = win.getPosition();
    let nx = Math.round(x + dx);
    let ny = Math.round(y + dy);
    // Optionally clamp to non-negative screen coords
    if (Number.isFinite(nx) && Number.isFinite(ny)) win.setPosition(nx, ny);
  } catch (e) {
    try { console.warn('nudge-window failed:', e); } catch {}
  }
});


	// Gemini answer generation moved to src/services/answer.js

	// ── Proactive Listening (Deepgram live streaming) ─────────────────────
	// State for the active proactive session. Only one session may run at a
	// time. The renderer streams 16-kHz mono linear-16 PCM via
	// `proactive-audio-chunk`; we forward each chunk to the Deepgram socket
	// and relay transcripts back via `proactive-transcript-*` events.
	let proactiveSession = null;       // deepgram-stream session handle
	let proactiveBillingTimer = null;  // setInterval(6000) credit deductor — Full-Auto only
	let proactiveBillingSeconds = 0;   // local uptime counter (used only for billing receipts)
	// Manual mode bills 2 credits per voice commit (no meter); Full-Auto runs
	// the 6s meter and skips per-answer charges. Legacy 'dynamic' is accepted
	// as an alias for 'manual' for backward compatibility with stored prefs.
	let proactiveMode = 'manual';      // 'manual' | 'full-auto'
	// Open-handshake watchdog. The provider wrappers (deepgram-stream /
	// assemblyai-stream) will retry a stalled connection internally up to 3
	// times before declaring `terminal:true`, but each retry adds 0.5–2s of
	// delay before the user perceives any reaction. This watchdog short-
	// circuits that ladder when the *first* WS upgrade never fires `open`
	// (e.g. DNS hang, AAI region outage, captive portal) by promoting the
	// situation to a silent fallover within OPEN_WATCHDOG_MS. Module-scoped
	// so _stopProactiveSession() can defensively clear it on any teardown.
	let _proactiveOpenWatchdog = null;
	const OPEN_WATCHDOG_MS = 4000;

	function _stopProactiveBilling() {
	  if (proactiveBillingTimer) {
	    clearInterval(proactiveBillingTimer);
	    proactiveBillingTimer = null;
	  }
	}

	function _startProactiveBilling() {
	  _stopProactiveBilling();
	  proactiveBillingSeconds = 0;
	  // Billing Option B: 1 credit every 12 seconds (= 5 credits/min).
proactiveBillingTimer = setInterval(async () => {
    proactiveBillingSeconds += 12;
	    try {
	      const result = await applyUsageCharge({ model: 'deepgram', count: 1 });
	      // Force-terminate the streaming session whenever the deduction
	      // signals exhaustion. Three cases — all funnel through the same
	      // 'out-of-credits' reason so the renderer (proactive-stopped
	      // handler) shows the out-of-credits modal and stops capture:
	      //   1. result.exceeded            — explicit pre-flight failure.
	      //   2. result.success === false   — Firestore deduction failed
	      //                                    (typically zero balance);
	      //                                    keeping the session alive
	      //                                    here would let the mic /
	      //                                    system audio continue
	      //                                    capturing without billing.
	      //   3. remaining <= 0 on success  — last credit just consumed;
	      //                                    next tick would fail anyway,
	      //                                    so stop now and show the
	      //                                    modal immediately. Plan
	      //                                    parity: this branch fires
	      //                                    for both Free and Pro since
	      //                                    incrementUsageAndEnforce
	      //                                    routes both through the
	      //                                    same Firestore deduction.
	      const exhausted = !!(result && (
	        result.exceeded === true ||
	        result.success === false ||
	        (typeof result.remaining === 'number' && result.remaining <= 0)
	      ));
	      if (exhausted) {
	        _stopProactiveSession('out-of-credits');
	      }
	    } catch (e) {
	      console.warn('[PROACTIVE] Billing tick failed:', e && e.message);
	      // On any unhandled exception during billing, stop the session
	      // defensively rather than continue capturing audio without
	      // confirmed deduction. The user will see a clear out-of-credits
	      // dialog and can recheck after the transient failure clears.
	      _stopProactiveSession('out-of-credits');
	    }
	  }, 12000);
	}

	function _stopProactiveSession(reason) {
	  _stopProactiveBilling();
	  if (_proactiveOpenWatchdog) {
	    clearTimeout(_proactiveOpenWatchdog);
	    _proactiveOpenWatchdog = null;
	  }
	  if (proactiveSession) {
	    try { proactiveSession.stop(); } catch (_) {}
	    proactiveSession = null;
	  }
	  if (mainWindow && !mainWindow.isDestroyed()) {
	    mainWindow.webContents.send('proactive-stopped', { reason: reason || 'manual' });
	  }
	}

	ipcMain.handle('proactive-start', async (_event, opts) => {
	  try {
	    if (!WebSocket) {
	      return { success: false, error: 'WebSocket module unavailable' };
	    }
	    // Phase 1 multi-provider routing:
	    //   • Free users      → AssemblyAI primary, Deepgram fallback.
	    //   • Paid/Unlimited  → Deepgram primary,   AssemblyAI Pro fallback.
	    //   • Lifetime (BYOK) → Deepgram primary if user has a Deepgram key,
	    //                       else AssemblyAI primary. The other key (when
	    //                       both are set) becomes the silent fallback.
	    // Fallover is single-shot: on a *primary* terminal failure (auth, or
	    // 3 reconnects exhausted), the IPC handler silently swaps providers
	    // without surfacing the error to the renderer. A subsequent terminal
	    // failure on the fallback DOES surface as before so the user is told.
	    const dgKey  = getDeepgramKey();
	    const aaiKey = getAssemblyAIKey();
	    const isFreeUser = !currentIsLifetimePlan && (currentPlanName || '').toLowerCase() === 'free';
	    let primary, fallback;
	    if (currentIsLifetimePlan) {
	      // BYOK: prefer Deepgram (lower latency on average) when available,
	      // otherwise use AssemblyAI. The unused-but-present second key is
	      // the silent fallback for the same single-shot fallover behavior.
	      primary  = dgKey ? 'deepgram' : 'assemblyai';
	      fallback = primary === 'deepgram'
	        ? (aaiKey ? 'assemblyai' : null)
	        : (dgKey  ? 'deepgram'   : null);
	    } else {
	      primary  = (isFreeUser && aaiKey) ? 'assemblyai' : 'deepgram';
	      fallback = primary === 'assemblyai'
	        ? (dgKey  ? 'deepgram'   : null)
	        : (aaiKey ? 'assemblyai' : null);
	    }
	    const keyFor = (p) => (p === 'assemblyai' ? aaiKey : (p === 'deepgram' ? dgKey : ''));

	    if (!keyFor(primary)) {
	      // Primary unavailable. If we also have no fallback, bail cleanly so
	      // the renderer drops back to default mode.
	      if (!fallback || !keyFor(fallback)) {
	        return {
	          success: false,
	          error: currentIsLifetimePlan
	            ? 'Lifetime plan requires your own Deepgram or AssemblyAI API key for Manual / Fully Automatic modes. Add one under Settings → API Keys.'
	            : 'Missing transcription provider keys',
	          needsDeepgramKey: !!currentIsLifetimePlan,
	          needsStreamingKey: !!currentIsLifetimePlan
	        };
	      }
	    }
	    // Pre-flight credit check. Plan parity: Free and Pro both gate on a
	    // zero balance — `currentUserCredits` is sourced from the same
	    // Firestore-backed deduction path for both tiers (see
	    // src/services/usage.js). Unlimited / Lifetime users are never
	    // restricted (isRestrictedUserSvc returns false) so they bypass
	    // this gate naturally via currentHasAccess. The redundant
	    // `currentUserCredits <= 0` check defends against a stale
	    // currentHasAccess flag (e.g. between login and the first
	    // checkUserPlan refresh) so a user at zero credits can never
	    // start a session that would consume the mic/system-audio capture
	    // without producing billable output.
	    const isRestricted = isRestrictedUserSvc(currentHasAccess, currentPlanName);
	    const zeroCredits  = typeof currentUserCredits === 'number' && currentUserCredits <= 0;
	    if ((isRestricted && zeroCredits) || (!currentHasAccess && zeroCredits)) {
	      // Surface the same modal the renderer shows mid-session so the
	      // initial-start path is consistent with the mid-session
	      // billing-tick exhaust path.
	      if (mainWindow && !mainWindow.isDestroyed()) {
	        try { mainWindow.webContents.send('show-access-denied'); } catch (_) {}
	      }
	      return { success: false, error: 'Insufficient credits', exceeded: true };
	    }
	    if (proactiveSession) {
	      _stopProactiveSession('restart');
	    }
	    {
	      const requestedMode = opts && typeof opts.mode === 'string' ? opts.mode : 'manual';
	      // Accept legacy 'dynamic' value as an alias for 'manual'.
	      const normalized = (requestedMode === 'dynamic') ? 'manual' : requestedMode;
	      proactiveMode = (normalized === 'manual' || normalized === 'full-auto') ? normalized : 'manual';
	    }

	    // Per-handler-invocation closure state. A new proactive-start invocation
	    // creates fresh closures so a previous fallover does not affect later
	    // sessions.
	    let providerInUse = keyFor(primary) ? primary : fallback;
	    let fallbackTried = (providerInUse !== primary);

	    function _buildSessionConfig(providerName) {
	      const tag = providerName === 'assemblyai' ? 'AssemblyAI' : 'Deepgram';
	      return {
	        apiKey: keyFor(providerName),
	        // Honor the user's interview-language selection. Each wrapper maps
	        // unsupported codes internally (Deepgram → `multi`; AssemblyAI v3 is
	        // English-tuned but accepts any input).
	        languageCode: interviewLanguageCode,
	        onPartial: (text) => {
	          if (mainWindow && !mainWindow.isDestroyed()) {
	            mainWindow.webContents.send('proactive-transcript-part', { text, isFinal: false });
	          }
	        },
	        onFinal: (text) => {
	          if (mainWindow && !mainWindow.isDestroyed()) {
	            mainWindow.webContents.send('proactive-transcript-final', { text, isFinal: true });
	          }
	        },
	        onTurn: (text) => {
	          if (mainWindow && !mainWindow.isDestroyed()) {
	            mainWindow.webContents.send('proactive-turn', { text });
	          }
	        },
	        onError: (err, info) => {
	          const terminal     = !!(info && info.terminal);
	          const reconnecting = !!(info && info.reconnecting);
	          // Silent fallover: terminal failure on the primary, with a
	          // healthy fallback available and not yet attempted, swaps
	          // providers without surfacing a toast. The user experiences a
	          // brief gap in transcription (at most ~1s) and no error UI.
	          if (terminal && !fallbackTried && fallback && keyFor(fallback) && providerInUse === primary) {
	            fallbackTried = true;
	            console.warn('[PROACTIVE]', tag, 'terminal failure; silently falling over to',
	              fallback + '. Original error:', err && err.message);
	            try { if (proactiveSession) proactiveSession.stop(); } catch (_) {}
	            providerInUse = fallback;
	            try {
	              proactiveSession = _startProvider(fallback);
	            } catch (e) {
	              console.error('[PROACTIVE] Fallback provider failed to start:', e && e.message);
	              _stopProactiveSession('fallback-start-error');
	            }
	            return;
	          }
	          console.warn('[PROACTIVE]', tag, 'error' +
	            (terminal ? ' (terminal)' : reconnecting ? ' (reconnecting)' : ' (transient)') +
	            ':', err && err.message);
	          if (mainWindow && !mainWindow.isDestroyed()) {
	            mainWindow.webContents.send('proactive-error', {
	              message: (err && err.message) || String(err),
	              terminal,
	              reconnecting,
	              attempt: (info && info.attempt) || 0,
	            });
	          }
	          // On terminal failure (auth or reconnects exhausted) with no
	          // fallback path, tear the session down cleanly so the renderer
	          // drops back to default mode.
	          if (terminal) _stopProactiveSession(providerName + '-down');
	        },
	        onOpen: (info) => {
	          // First successful open clears the handshake watchdog. A
	          // mid-session reconnect also clears it (paranoia: the wrapper
	          // never re-arms it, but if a future change does, this keeps
	          // the timer monotonic).
	          if (_proactiveOpenWatchdog) {
	            clearTimeout(_proactiveOpenWatchdog);
	            _proactiveOpenWatchdog = null;
	          }
	          // When a reconnect succeeds, signal the renderer so the discreet
	          // "Reconnecting..." status can clear. First open is silent.
	          if (info && info.reconnected && mainWindow && !mainWindow.isDestroyed()) {
	            mainWindow.webContents.send('proactive-error', {
	              message: 'Reconnected',
	              terminal: false,
	              reconnecting: false,
	              reconnected: true,
	            });
	          }
	        },
	        onClose: () => {
	          // Surfaced separately via _stopProactiveSession when we initiate.
	        },
	      };
	    }

	    // Promote a stalled handshake to a silent fallover. Mirrors the
	    // onError(terminal:true) branch in _buildSessionConfig so a primary
	    // that never opens is indistinguishable from one that opened and
	    // then auth-failed, from the user's perspective.
	    function _onPrimaryStall(providerName) {
	      if (providerInUse !== providerName) return; // already swapped
	      if (!proactiveSession) return;               // already torn down
	      console.warn('[PROACTIVE]', providerName,
	        'WS handshake stalled >', OPEN_WATCHDOG_MS, 'ms; treating as terminal');
	      try { proactiveSession.stop(); } catch (_) {}
	      if (!fallbackTried && fallback && keyFor(fallback) && providerInUse === primary) {
	        fallbackTried = true;
	        providerInUse = fallback;
	        try {
	          proactiveSession = _startProvider(fallback);
	        } catch (e) {
	          console.error('[PROACTIVE] Fallback provider failed to start (post-stall):',
	            e && e.message);
	          _stopProactiveSession('fallback-start-error');
	        }
	        return;
	      }
	      // No fallback path or fallback already exhausted — surface and tear down.
	      if (mainWindow && !mainWindow.isDestroyed()) {
	        mainWindow.webContents.send('proactive-error', {
	          message: providerName + ' WebSocket handshake stalled',
	          terminal: true,
	        });
	      }
	      _stopProactiveSession(providerName + '-stalled');
	    }

	    function _startProvider(name) {
	      const wrapper = (name === 'assemblyai') ? assemblyAIStream : deepgramStream;
	      // Arm the open-handshake watchdog before invoking the wrapper.
	      // onOpen clears it on a successful upgrade; if it fires first we
	      // promote the stall to a fallover via _onPrimaryStall.
	      if (_proactiveOpenWatchdog) clearTimeout(_proactiveOpenWatchdog);
	      _proactiveOpenWatchdog = setTimeout(() => {
	        _proactiveOpenWatchdog = null;
	        _onPrimaryStall(name);
	      }, OPEN_WATCHDOG_MS);
	      return wrapper.start(_buildSessionConfig(name));
	    }

	    proactiveSession = _startProvider(providerInUse);

	    // Only Full-Auto runs the 6s meter. Manual mode bills per voice
	    // commit (2 credits) at the renderer's commit point — no meter.
	    if (proactiveMode === 'full-auto') {
	      _startProactiveBilling();
	    }
	    return { success: true, mode: proactiveMode, provider: providerInUse };
	  } catch (error) {
	    console.error('[PROACTIVE] Failed to start session:', error);
	    _stopProactiveSession('error');
	    return { success: false, error: error.message || String(error) };
	  }
	});

	ipcMain.on('proactive-audio-chunk', (_event, chunk) => {
	  try {
	    if (!proactiveSession) return;
	    const buffer = coerceIpcAudioPayloadToBuffer(chunk);
	    if (!buffer || !buffer.length) return;
	    proactiveSession.sendAudio(buffer);
	  } catch (error) {
	    console.warn('[PROACTIVE] Failed to forward audio chunk:', error && error.message);
	  }
	});

	ipcMain.handle('proactive-stop', async (_event, payload) => {
	  const reason = (payload && payload.reason) || 'manual';
	  _stopProactiveSession(reason);
	  return { success: true, seconds: proactiveBillingSeconds };
	});

	// Generate up to 5 dynamic suggestion chips. Used for two contexts:
	//   • live-transcript (Manual mode) — pass payload.transcript
	//   • post-answer follow-ups        — pass payload.answer (and
	//                                      optional payload.question)
	// Returns { success, chips: [{ label, query }] }. Folded into the
	// proactive 1-credit/6-s billing when active — no separate charge.
	ipcMain.handle('proactive-generate-chips', async (_event, payload) => {
	  try {
	    const transcript = (payload && typeof payload.transcript === 'string') ? payload.transcript.trim() : '';
	    const answer     = (payload && typeof payload.answer     === 'string') ? payload.answer.trim()     : '';
	    const question   = (payload && typeof payload.question   === 'string') ? payload.question.trim()   : '';
	    const ctxBlob = answer || transcript;
	    if (!ctxBlob || ctxBlob.length < 8) return { success: false, error: 'Empty context' };
	    const apiKey = getOpenAIKey();
	    if (!apiKey) return { success: false, error: 'No OpenAI key available' };
	    const openai = new OpenAI({ apiKey, maxRetries: 1, timeout: 8000 });
	    const sys = [
	      'You generate 4 to 5 short, clickable suggestion chips for a professional AI assistant operating during LIVE INTERVIEWS, business meetings, sales calls, and similar high-stakes conversations.',
	      'Prioritize high-value, context-aware actions the user (the interviewee / participant) would actually want next. Strong chip styles:',
	      '  • "Clarify [specific term]" — a precise clarifying question on something the speaker just said',
	      '  • "Summarize last point" — condense the previous speaker turn into 1–2 lines',
	      '  • "Follow-up on [topic]" — a sharper follow-up question grounded in the transcript',
	      '  • "Counter [claim]" — a respectful pushback or alternative on a stated position',
	      '  • "Flag conflict" — call out a contradiction or inconsistency between speaker turns / meeting notes',
	      '  • "Draft answer" — produce a tight, structured answer to the question being asked',
	      'Rules:',
	      '  • Labels MUST be 2–4 words, action-led, and reference the actual topic when possible (use specific nouns from the transcript, not generic words).',
	      '  • Queries MUST be a complete, self-contained prompt the AI can answer directly — include the topic, the speaker context, and the desired output format / length when useful.',
	      '  • Avoid generic chips ("Tell me more", "Show example") unless the context is genuinely sparse.',
	      '  • Never invent facts not present in the supplied context.',
	      'Reply with STRICT JSON ONLY of the form {"chips":[{"label":"<2-4 words>","query":"<full prompt to send>"}]}. No prose, no markdown fences.',
	    ].join('\n');
	    const userMsg = answer
	      ? ('Previous question: ' + (question || '(unknown)') + '\n\nAssistant answer:\n' + answer.slice(-3000) +
	         '\n\nGenerate professional follow-up chips that move the conversation forward (clarify, summarize, follow-up, counter, flag conflict, or draft answer).')
	      : ('Live meeting/interview transcript so far:\n' + transcript.slice(-1500) +
	         '\n\nGenerate professional suggestion chips tied to the most recent speaker turn (clarify, summarize last point, follow-up, counter, flag conflict, or draft answer).');
	    const completion = await callWithFallback('CHAT_FAST', (modelId) =>
	      openai.chat.completions.create({
	        model: modelId,
	        messages: [
	          { role: 'system', content: sys },
	          { role: 'user', content: userMsg },
	        ],
	        temperature: 0.4,
	        max_tokens: 320,
	      }),
	    );
	    const raw = completion && completion.choices && completion.choices[0] && completion.choices[0].message && completion.choices[0].message.content;
	    if (!raw) return { success: false, error: 'Empty response' };
	    const jsonStart = raw.indexOf('{');
	    const jsonEnd   = raw.lastIndexOf('}');
	    if (jsonStart < 0 || jsonEnd <= jsonStart) return { success: false, error: 'No JSON in response' };
	    let parsed;
	    try { parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)); }
	    catch (_) { return { success: false, error: 'Malformed JSON' }; }
	    const chips = Array.isArray(parsed && parsed.chips) ? parsed.chips : [];
	    const cleaned = chips
	      .map(c => ({
	        label: (c && typeof c.label === 'string') ? c.label.trim() : '',
	        query: (c && typeof c.query === 'string') ? c.query.trim() : '',
	      }))
	      .filter(c => c.label && c.query)
	      .slice(0, 5);
	    return { success: true, chips: cleaned };
	  } catch (error) {
	    console.warn('[PROACTIVE] Chip generation failed:', error && error.message);
	    return { success: false, error: (error && error.message) || String(error) };
	  }
	});

		// Helper: accept either base64 string OR binary (Uint8Array/ArrayBuffer/Buffer) over IPC.
		// Base64 can get huge and may be truncated for system-audio recordings on Windows.
		function coerceIpcAudioPayloadToBuffer(payload) {
		  if (!payload) return null;
		  try {
		    if (Buffer.isBuffer(payload)) return payload;
		    if (typeof payload === 'string') return Buffer.from(payload, 'base64');
		    if (payload instanceof ArrayBuffer) return Buffer.from(new Uint8Array(payload));
		    if (ArrayBuffer.isView(payload)) {
		      return Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
		    }
		    // In some serialization cases a Buffer arrives as { type: 'Buffer', data: [...] }
		    if (typeof payload === 'object' && payload.type === 'Buffer' && Array.isArray(payload.data)) {
		      return Buffer.from(payload.data);
		    }
		  } catch (_) {}
		  return null;
		}

		// Helper function to validate Inshuverse temp audio paths (used by both handlers below)
		function isSafeAngelTempAudioPath(filePath) {
			try {
				const resolved = path.resolve(String(filePath || ''));
				const tmpRoot = path.resolve(os.tmpdir());
				if (!resolved || !resolved.startsWith(tmpRoot + path.sep)) return false;
				const base = path.basename(resolved).toLowerCase();
				return base.startsWith('angel-audio-');
			} catch (_) {
				return false;
			}
		}

		// Optimized: direct invoke handler using OpenAI-first transcription with fast sequential fallback
		// This is for transcription-only (no answer generation) - deducts 1 credit
		ipcMain.handle('transcribe-audio-buffer', async (_event, audioPayload) => {
			console.log('[MAIN] Starting transcription-only with optimized OpenAI-first transcription (sequential fallback)...');

		  const audioBuffer = coerceIpcAudioPayloadToBuffer(audioPayload);
		  if (!audioBuffer) throw new Error('No audio data received');
			  if (audioBuffer.length < 50) throw new Error('No audio captured - audio too short');

	  try {
			const transcription = await withKeyRotation(({ userOpenAIKey, userGeminiKey }) =>
			  transcribeWithModelSelectionSvc(audioBuffer, {
			    userOpenAIKey,
			    userGeminiKey,
			    selectedModel,
			    interviewLanguageCode,
			  })
			);

	    if (!transcription || !transcription.trim()) {
	      throw new Error('Transcription returned empty - please try speaking more clearly');
	    }

	    console.log('[MAIN] Transcription successful, length:', transcription.length);
	    // Transcription-only costs 1 credit (no answer generation)
	    try {
		      await applyUsageCharge({ model: 'transcription', count: 1 });
	    } catch (_) {}

	    return transcription;

	  } catch (error) {
	    console.error('[MAIN] Transcription failed:', error.message);

	    // Enhanced error categorization
	    if (error.message.includes('timeout')) {
	      throw new Error('Transcription timed out - AI service is busy, please try again');
	    } else if (error.message.includes('API key')) {
	      throw new Error('API key issue - please check your API keys in Settings');
	    } else if (error.message.includes('quota') || error.message.includes('billing')) {
	      throw new Error('API quota exceeded - please check your billing or upgrade your plan');
	    } else if (error.message.includes('overloaded') || error.message.includes('503')) {
	      throw new Error('AI service temporarily overloaded - please try again in a moment');
	    }

	    throw error; // Re-throw original error if no specific handling
	  }
	});

	// Large-audio safe path: renderer writes temp file, main reads and transcribes.
	// This is for transcription-only (no answer generation) - deducts 1 credit
	ipcMain.handle('transcribe-audio-file', async (_event, args) => {
		const filePath = (typeof args === 'string') ? args : args?.path;
		const deleteAfter = (typeof args === 'object') ? (args?.deleteAfter !== false) : true;
		if (!filePath) throw new Error('No audio file path received');
		console.log('[MAIN] Transcribing audio from file:', filePath);

		let audioBuffer;
		try {
			const stat = await fs.promises.stat(filePath);
			if (!stat || stat.size < 50) throw new Error('No audio captured - audio file too short');
			audioBuffer = await fs.promises.readFile(filePath);
		} finally {
			// Best-effort cleanup (only for our own temp files)
			if (deleteAfter && isSafeAngelTempAudioPath(filePath)) {
				fs.promises.unlink(filePath).catch(() => {});
			}
		}

		if (!audioBuffer) throw new Error('No audio data received');
		if (audioBuffer.length < 50) throw new Error('No audio captured - audio too short');

		try {
			const transcription = await withKeyRotation(({ userOpenAIKey, userGeminiKey }) =>
				transcribeWithModelSelectionSvc(audioBuffer, {
					userOpenAIKey,
					userGeminiKey,
					selectedModel,
					interviewLanguageCode,
				})
			);

			if (!transcription || !transcription.trim()) {
				throw new Error('Transcription returned empty - please try speaking more clearly');
			}

			console.log('[MAIN] File transcription successful, length:', transcription.length);
			// Transcription-only costs 1 credit (no answer generation)
			try {
					await applyUsageCharge({ model: 'transcription', count: 1 });
			} catch (_) {}

			return transcription;
		} catch (error) {
			console.error('[MAIN] File transcription failed:', error.message);
			if (error.message.includes('timeout')) {
				throw new Error('Transcription timed out - AI service is busy, please try again');
			} else if (error.message.includes('API key')) {
				throw new Error('API key issue - please check your API keys in Settings');
			} else if (error.message.includes('quota') || error.message.includes('billing')) {
				throw new Error('API quota exceeded - please check your billing or upgrade your plan');
			} else if (error.message.includes('overloaded') || error.message.includes('503')) {
				throw new Error('AI service temporarily overloaded - please try again in a moment');
			}
			throw error;
		}
	});

// Event-based conversation history sync
let conversationHistoryReady = null;
ipcMain.handle('conversation-history-updated', async () => {
  console.log('[MAIN] Conversation history updated by renderer');
  if (conversationHistoryReady) {
    conversationHistoryReady();
    conversationHistoryReady = null;
  }
  return { success: true };
});

	// ── Helper: chunked transcript streaming ─────────────────────────────────
	// The HTTP transcription APIs (gpt-4o-mini-transcribe, gemini) return the
	// full transcript in a single response — they do not stream natively with
	// our current SDK pins. To still give the renderer a real-time "typing"
	// UX we chunk the finished text into ~10 word-boundary slices and emit
	// them as `transcript-part` events spaced ~10 ms apart, capping the total
	// visual streaming duration to roughly 100 ms regardless of transcript
	// length. The final `transcript` event is sent only after the last chunk,
	// so downstream answer generation sees the complete text (no race).
	// Tightened from 240 ms → 100 ms so the answer-generation handoff fires
	// sooner — the typing animation is still perceptible but no longer the
	// dominant component of perceived voice-to-answer latency in Normal Mode.
	async function streamTranscriptInChunks(text) {
	  if (!mainWindow || mainWindow.isDestroyed()) return;
	  const tokens = String(text).split(/(\s+)/).filter(t => t.length > 0);
	  if (tokens.length === 0) return;
	  const TARGET_CHUNKS = 10;
	  const TICK_MS = 10;
	  const chunkSize = Math.max(1, Math.ceil(tokens.length / TARGET_CHUNKS));
	  for (let i = 0; i < tokens.length; i += chunkSize) {
	    if (!mainWindow || mainWindow.isDestroyed()) return;
	    const chunk = tokens.slice(i, i + chunkSize).join('');
	    try { mainWindow.webContents.send('transcript-part', chunk); } catch (_) {}
	    if (i + chunkSize < tokens.length) {
	      await new Promise(r => setTimeout(r, TICK_MS));
	    }
	  }
	}

// Legacy `audio-data` IPC handler removed — the renderer now uses the split
// `transcribe-audio-buffer` / `transcribe-audio-file` pipeline (see
// src/services/transcription/) so this one-shot handler is unreachable.

// Handle text input from the user
ipcMain.on('text-input', async (event, textOrPayload, maybeOpts) => {
  // Back-compat: legacy callers pass a string; new callers pass
  // ({ text, history }) so the main process can skip the renderer
  // round-trip used to fetch window.conversationHistory. That round-trip
  // (executeJavaScript) adds 50–200 ms of dead time before streaming
  // begins, which is the main bottleneck users perceive on chip clicks.
  let text = '';
  let inlineHistory = null;
  // Billing flags forwarded from the renderer:
  //   skipBilling  — caller is already on a metered timer (Full-Auto: 1cr/6s).
  //   voiceCommit  — answer triggered by a Manual-mode voice commit (2 cr).
  // Resolution lives in src/services/billing-mode.js so it stays testable.
  let skipBilling = false;
  let voiceCommit = false;
  // RAG (Custom Mode only): renderer pre-computes top-K chunks against its
  // local IndexedDB knowledge base and forwards them here so we can inject
  // the excerpts into the system prompt before invoking the LLM.
  let ragContext = null;
  if (typeof textOrPayload === 'string') {
    text = textOrPayload;
    if (maybeOpts && Array.isArray(maybeOpts.history)) inlineHistory = maybeOpts.history;
    if (maybeOpts && maybeOpts.skipBilling === true) skipBilling = true;
    if (maybeOpts && maybeOpts.voiceCommit === true) voiceCommit = true;
    if (maybeOpts && Array.isArray(maybeOpts.ragContext)) ragContext = maybeOpts.ragContext;
  } else if (textOrPayload && typeof textOrPayload === 'object') {
    text = String(textOrPayload.text || '');
    if (Array.isArray(textOrPayload.history)) inlineHistory = textOrPayload.history;
    if (textOrPayload.skipBilling === true) skipBilling = true;
    if (textOrPayload.voiceCommit === true) voiceCommit = true;
    if (Array.isArray(textOrPayload.ragContext)) ragContext = textOrPayload.ragContext;
  }
  const billing = resolveTextInputBilling({ skipBilling, voiceCommit });
  console.log(`[TEXT-INPUT] Received text input: "${text}" (billing=${billing.reason}, count=${billing.count})`);

  // Emit a status update IMMEDIATELY — before any async work — so the UI
  // can show "Generating answer..." within the same tick as the click.
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.send('answer-status', '💭 Generating answer...'); } catch (_) {}
  }

  // Defensive: empty text would call the model with an empty prompt and
  // could hang or burn a credit on garbage. Release the spinner and bail.
  if (!text || !text.trim()) {
    console.warn('[TEXT-INPUT] Empty text received — aborting and releasing spinner.');
    if (mainWindow && !mainWindow.isDestroyed()) {
      try { mainWindow.webContents.send('answer-done'); } catch (_) {}
    }
    return;
  }

  // Resolve conversation history. Prefer the inline payload (fast); fall
  // back to the legacy executeJavaScript round-trip only when the renderer
  // didn't supply one (older code paths).
  let conversationHistory = inlineHistory || [];
  if (!inlineHistory) {
    try {
      conversationHistory = await mainWindow.webContents.executeJavaScript('window.conversationHistory || []');
      if (!Array.isArray(conversationHistory)) conversationHistory = [];
      console.log(`[TEXT-INPUT] Retrieved ${conversationHistory.length} conversation history messages (legacy path)`);
    } catch (e) {
      console.log('[TEXT-INPUT] Could not get conversation history:', e.message);
      conversationHistory = [];
    }
  }

  const sendStatus = (status) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('answer-status', status);
  };

  let _answerDoneSent = false;
  const safeSend = (channel, payload) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (channel === 'answer-done') _answerDoneSent = true;
    if (typeof payload === 'undefined') mainWindow.webContents.send(channel);
    else mainWindow.webContents.send(channel, payload);
  };

  try {
    const { answer: _ans, provider } = await withKeyRotation(({ userOpenAIKey, userGeminiKey }) =>
      getAnswerWithModelSelectionSvc(text, {
        userOpenAIKey,
        userGeminiKey,
        selectedModel,
        userResume,
        userJobDescription,
        userConfiguration,
        responseSize,
        conversationHistory,
        send: safeSend,
        ragContext,
        // Plan context — getAnswerWithFallback uses these to skip the OpenAI
        // attempt for Lifetime BYOK users who only configured a Gemini key,
        // eliminating the OpenAI-client timeout on a missing/invalid key.
        planName: currentPlanName,
        isLifetimePlan: currentIsLifetimePlan,
      })
    );

    // Safety-net non-streaming emit so renderer always gets a final value
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('answer', _ans || '');
    }

    // Apply billing per the resolver:
    //   chat          → 1 credit (typed input)
    //   voice-commit  → 2 credits (Manual-mode voice answer)
    //   metered       → 0 (Full-Auto's 6s meter covers it; per-answer skip)
    if (!billing.skip) {
      await deductCreditsForUsage({
        currentPlanName,
        mainWindow,
        currentUserCredits,
        deductUserCredits
      }, { model: provider, count: billing.count });
    }

  } catch (error) {
    console.error('[MAIN] Text answer generation failed:', error);
    if (mainWindow && !mainWindow.isDestroyed()) {
      let userMessage = '❌ Could not generate answer. ';
      if (error.message.includes('API key')) {
        userMessage += 'Please check your API keys in Settings.';
      } else if (error.message.includes('quota') || error.message.includes('billing')) {
        userMessage += 'API quota exceeded. Please check your billing.';
      } else if (error.message.includes('configuration') || error.message.includes('profile')) {
        userMessage += 'Please set up your profile in Settings → Profile tab.';
      } else {
        userMessage += 'Please try again.';
      }
      mainWindow.webContents.send('answer', userMessage);
      sendStatus('Answer generation failed');
    }
  } finally {
    // CRITICAL: always release the loading spinner
    if (!_answerDoneSent && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('answer-done');
    }
  }
});

// ── Hide Mode (Screen Sharing Protection) ──────────────────────────────────
// Owned by src/window/hide-mode.js (registered via registerHideModeHandlers
// during whenReady). The previous inline handler was dead code: the modular
// handler always overrode it, but its local-variable updates to
// isInScreenSharingMode were silently lost — breaking the focus/blur/move
// re-assertion that compensates for Windows dropping content protection.
// Single source of truth is now APP_STATE.isInScreenSharingMode.

// ── Transparency state notification (renderer → main) ──────────────────────
// The renderer sends this when the user toggles transparent/normal mode so
// the main process can react (e.g., adjust window repaint hints). Currently
// the OS-level transparency is always on; this is logged for diagnostics.
ipcMain.on('set-transparency', (_event, isTransparent) => {
  console.log(`[WINDOW] Transparency mode set to: ${isTransparent}`);
  if (!mainWindow) return;

  // Windows: this handler must be a no-op at the OS layer. The BrowserWindow
  // is `transparent: true` (per-pixel alpha via UpdateLayeredWindow) and the
  // see-through visual is driven entirely by CSS (`body.transparent-mode`)
  // in the renderer. Calling setBackgroundColor here would cycle the
  // WS_EX_LAYERED extended style on the HWND, which can flip the layered
  // window out of per-pixel-alpha mode and leave the entire window rect
  // rendering as a uniform opaque-white layer (the regression that produced
  // a white halo around the rounded container after every Hide-Mode toggle).
  // setOpacity has the same one-way effect. setVibrancy is a no-op on
  // Windows. So we simply log and return — the CSS class change already
  // applied in the renderer is all that's needed.
  if (process.platform === 'win32') return;

  if (isTransparent) {
    // Remove the macOS vibrancy effect — this is the OS-level frosted blur.
    // Without this, the window always shows a blurred/frosted compositing
    // even when CSS has backdrop-filter:none. Clear it for true see-through.
    try { mainWindow.setVibrancy(null); } catch (e) { /* older Electron */ }
    mainWindow.setBackgroundColor('#00000000');
  } else {
    // Restore the sidebar vibrancy effect when returning to normal mode
    try {
      if (process.platform === 'darwin') {
        mainWindow.setVibrancy('sidebar');
      }
    } catch (e) { /* ignore */ }
    mainWindow.setBackgroundColor('#00000000');
  }
});