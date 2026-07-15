const express = require("express");
const router = express.Router();

const { db, FieldValue } = require("../firebase");
const { sendWelcomeEmail } = require("../services/emailService");


router.get("/plan/:uid", async (req, res) => {
    try {

        const uid = req.params.uid;
        const email = req.query.email;
        const name = req.query.name;

        console.log('[USER] Plan endpoint called with:', { uid, email, name });

        const userRef = db.collection("users").doc(uid);

        const userDoc = await userRef.get();

        if (!userDoc.exists) {

            const newUser = {
                plan: "free",
                credits: 7,
                role: "user", // Default role for new users
                createdAt: FieldValue.serverTimestamp(),
                email: email || null // Store email if provided
            };

            await userRef.set(newUser);
            console.log('[USER] New user created:', newUser);
        }

        // Send welcome email if email is provided (for testing)
        if (email) {
            console.log('[USER] Sending welcome email to:', email);
            sendWelcomeEmail(email, name || null).then(emailResult => {
                console.log('[USER] Welcome email result:', emailResult);
            }).catch(err => {
                console.error('[USER] Failed to send welcome email:', err);
            });
        }

        if (!userDoc.exists) {
            return res.json({
                success: true,
                plan: "free",
                credits: 7,
                role: "user"
            });
        }

        const data = userDoc.data();
        console.log('[USER] Existing user found:', { plan: data.plan, credits: data.credits });

        return res.json({
            success: true,
            plan: data.plan,
            credits: data.credits,
            role: data.role || "user"
        });

    } catch (err) {

        console.error('[USER] Error in plan endpoint:', err);

        res.status(500).json({
            success: false,
            error: err.message
        });

    }
});

module.exports = router;