const express = require("express");
const router = express.Router();

const { db, FieldValue } = require("../firebase");
const { sendWelcomeEmail } = require("../services/emailService");

// Debug endpoint to test email sending
router.get("/test-email", async (req, res) => {
    try {
        const { email, name } = req.query;
        
        if (!email) {
            return res.status(400).json({
                success: false,
                error: "Email parameter is required"
            });
        }

        console.log('[DEBUG] Test email endpoint called with:', { email, name });
        
        const result = await sendWelcomeEmail(email, name || 'Test User');
        
        console.log('[DEBUG] Test email result:', result);
        
        return res.json({
            success: true,
            result: result
        });
    } catch (err) {
        console.error('[DEBUG] Test email error:', err);
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

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

            // Send welcome email if email is provided
            if (email) {
                console.log('[USER] Sending welcome email to:', email);
                const emailResult = await sendWelcomeEmail(email, name || null);
                console.log('[USER] Welcome email result:', emailResult);
            } else {
                console.log('[USER] No email provided, skipping welcome email');
            }

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