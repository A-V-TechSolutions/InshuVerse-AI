// Import the functions you need from the SDKs you need
const axios = require("axios");
const { initializeApp } = require('firebase/app');
const {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  signInWithCredential,
  GoogleAuthProvider
} = require('firebase/auth');
const { getFirestore } = require('firebase/firestore');

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCw0pztxhINKDaY1LY4w-MxGnKqL0kpeTg",
  authDomain: "inshuverse-ai.firebaseapp.com",
  projectId: "inshuverse-ai",
  storageBucket: "inshuverse-ai.firebasestorage.app",
  messagingSenderId: "239383899102",
  appId: "1:239383899102:web:3806b956be1caf72608b4f",
  measurementId: "G-YSWGRHXSHY"
};

// Initialize Firebase
const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);

// Enable Firebase Auth persistence
setPersistence(auth, browserLocalPersistence)
  .catch((error) => {
    console.error('Error enabling auth persistence:', error);
  });

const db = getFirestore(firebaseApp);
const provider = new GoogleAuthProvider();
// Backend API URL
const API_URL = "http://localhost:5000";

// All credit / plan mutations flow through Cloud Functions (see
// functions/index.js). The Admin SDK there bypasses firestore.rules, which
// in turn deny every client-side write to users/{uid} — closing the
// "open browser console, set credits to 999" attack class entirely.



// Keep a default for legacy callers, but main process should pass a dynamic 127.0.0.1:<port>
const DEFAULT_REDIRECT_URI = 'http://127.0.0.1';

// Function to prepare Google sign-in URL and details for main process
function getGoogleAuthDetails(redirectUri) {
  const REDIRECT_URI = redirectUri || DEFAULT_REDIRECT_URI;
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${OAUTH_CLIENT_ID}&` +
    `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
    `response_type=code&` +
    `scope=${encodeURIComponent('https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile openid')}&` +
    `prompt=select_account&` +
    `access_type=offline`;

  return {
    authUrl,
    OAUTH_CLIENT_ID,
    CLIENT_SECRET,
    REDIRECT_URI,
  };
}

// Function to get plan-based credit allocation
function getPlanCredits(planId) {
  const planCredits = {
    // Pro plans: 600 credits
    'pro': 600, 'pro-monthly': 600, 'pro-yearly': 600,
    // Ultimate plans: 1500 credits
    'ultimate': 1500, 'ultimate-monthly': 1500, 'ultimate-yearly': 1500,
    // Magic plans: 4000 credits
    'magic': 4000, 'magic-monthly': 4000, 'magic-yearly': 4000,
    // Free plan: 15 trial credits
    'free': 7
  };
  return planCredits[planId] || 7; // Default to 15 trial credits for unknown plans
}

// Plan-id classification — kept client-side only so the read-fast path in
// checkUserPlan() can decide the lifetime branch without a round trip.
// The same set is duplicated server-side in functions/lib/plan.js; when
// adding a new plan id, update BOTH.
const _LIFETIME_PLAN_IDS = new Set([
  'lifetime', 'angel-lifetime', 'angel lifetime', 'angel lifetime plans',
  'lifetime-monthly', 'lifetime-yearly',
  'angel-lifetime-monthly', 'angel-lifetime-yearly'
]);

// Function to check user's plan and credits (credit-based system for all plans except lifetime)
//
// Read path: a single getDoc — fast, cheap, allowed by firestore.rules.
// Write path (doc creation, credit initialization): delegated to the
// getOrInitUserPlan Cloud Function, which is the only writer permitted by
// the rules. This means a tampered client cannot create itself a doc with
// planId='lifetime' — the server overrides any client-supplied values.
async function checkUserPlan(userId) {
  try {

    const response = await axios.get(
      `${API_URL}/api/user/plan/${userId}`
    );

    // 👇 ADD THESE TWO LINES HERE
    console.log("========== BACKEND RESPONSE ==========");
    console.log(response.data);

    const data = response.data;

    return {
      hasAccess: data.credits > 0,
      planName: data.plan,
      isLifetimePlan: false,
      isUnlimitedPlan: false,
      credits: data.credits,
      subscription: {
        planId: data.plan,
        credits: data.credits
      }
    };

  } catch (error) {

    console.error("========== BACKEND ERROR ==========");
    console.error(error);

    if (error.response) {
      console.error("STATUS:", error.response.status);
      console.error("DATA:", error.response.data);
    }

    if (error.request) {
      console.error("NO RESPONSE FROM BACKEND");
    }

    console.error("===================================");

    return {
      hasAccess: false,
      planName: "error",
      isLifetimePlan: false,
      isUnlimitedPlan: false,
      credits: 0,
      subscription: {}
    };

  }
}
// Deprecated. Clients can no longer set credits to an arbitrary value —
// firestore.rules denies the write and the Cloud Function intentionally
// exposes only the debit operation. Kept as a stub because main.js still
// destructures the export; calling it logs a warning and is a no-op.
async function updateUserCredits(userId, newCredits) {
  console.warn('[CREDITS] updateUserCredits() is deprecated and now a no-op. uid=%s requested=%s', userId, newCredits);
  return false;
}

// Atomic credit debit — thin wrapper over the debitCredits Cloud Function.
// The signature `(userId, creditsToDeduct) → { success, previousCredits,
// remainingCredits }` is preserved for src/services/usage.js and its tests
// so no caller needs to change. Note that `userId` is ignored: the server
// derives the uid from the auth token, which is the whole point of the
// migration — a tampered client cannot debit a different user's account.
async function deductUserCredits(userId, creditsToDeduct) {

  try {

    const response = await axios.post(
  `${API_URL}/api/credits/debit`,
      {
        uid: userId,
        amount: creditsToDeduct
      }
    );

    return response.data;

  } catch (error) {

    console.error("[BACKEND]", error.message);

    return {
      success: false,
      remainingCredits: 0
    };

  }

}

module.exports = {
  getGoogleAuthDetails,
  checkUserPlan,
  updateUserCredits,
  deductUserCredits,
  getPlanCredits,
  auth,
  signInWithCredential,
  GoogleAuthProvider,
  db
};