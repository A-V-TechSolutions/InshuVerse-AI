const express = require("express");
const { admin, db } = require("../firebase");

const router = express.Router();

// Login route - verify Firebase ID token and return user data
router.post("/login", async (req, res) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({ success: false, error: "ID token is required" });
    }

    // Verify the ID token using Firebase Admin SDK
    const decodedToken = await auth.verifyIdToken(idToken);
    const uid = decodedToken.uid;
    const email = decodedToken.email;

    // Check if user exists in Firestore
    const userDoc = await db.collection("users").doc(uid).get();

    if (!userDoc.exists) {
      // Create new user document
      await db.collection("users").doc(uid).set({
        email: email,
        name: decodedToken.name || email.split("@")[0],
        createdAt: new Date().toISOString(),
        plan: "free",
        credits: 7,
        role: "user"
      });
    }

    // Get user data
    const userData = userDoc.exists ? userDoc.data() : {
      email: email,
      name: decodedToken.name || email.split("@")[0],
      plan: "free",
      credits: 7,
      role: "user"
    };

    res.json({
      success: true,
      user: {
        email: userData.email,
        uid: uid,
        name: userData.name
      },
      plan: userData.plan,
      credits: userData.credits,
      role: userData.role || "user"
    });

  } catch (error) {
    console.error("Auth error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
