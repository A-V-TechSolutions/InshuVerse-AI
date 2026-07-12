const express = require('express');
const { db, FieldValue } = require('../firebase');
const admin = require('firebase-admin');
const { sendWelcomeEmail, sendLoginEmail } = require('../services/emailService');

const router = express.Router();

router.post("/login", async (req, res) => {
  try {
    const { idToken } = req.body;

    const decoded = await admin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;
    const email = decoded.email;
    const name = decoded.name || "User";
    const photo = decoded.picture || "";

    const userRef = db.collection("users").doc(uid);
    const doc = await userRef.get();

    let isNewUser = false;

    if (!doc.exists) {
      isNewUser = true;
      await userRef.set({
        uid,
        email,
        name,
        photo,
        plan: "free",
        credits: 7,
        role: "user",
        createdAt: FieldValue.serverTimestamp(),
        lastLogin: FieldValue.serverTimestamp()
      });
      console.log('[AUTH] New user created:', { uid, email, name });
    } else {
      await userRef.update({
        lastLogin: FieldValue.serverTimestamp()
      });
      console.log('[AUTH] Existing user logged in:', { uid, email });
    }

    // Send email
    const loginTime = new Date().toLocaleString();
    const ipAddress = req.ip || req.connection.remoteAddress;
    const device = req.headers['user-agent'] || 'Unknown';

    if (isNewUser) {
      await sendWelcomeEmail(email, name);
    } else {
      await sendLoginEmail(email, name, loginTime, ipAddress, device);
    }

    res.json({
      success: true,
      newUser: isNewUser
    });
  } catch (err) {
    console.error('[AUTH] Error in login endpoint:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

module.exports = router;
