const express = require("express");
const router = express.Router();

const { db } = require("../firebase");

router.post("/debit", async (req, res) => {
    console.log("========== CREDIT API ==========");
    console.log("Request Body:", req.body);
    console.trace("Credit deduction called from:");
    console.log("===============================");
    try {

        const { uid, amount } = req.body;

        if (!uid || !amount) {
            return res.status(400).json({
                success: false,
                message: "uid and amount are required"
            });
        }

        const userRef = db.collection("users").doc(uid);

        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        const user = userDoc.data();

        const credits = Number(user.credits || 0);

        if (credits < amount) {
            return res.json({
                success: false,
                reason: "Insufficient credits",
                remainingCredits: credits
            });
        }

        const remainingCredits = credits - amount;

        await userRef.update({
            credits: remainingCredits
        });

        return res.json({
            success: true,
            previousCredits: credits,
            remainingCredits
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            success: false,
            message: err.message
        });

    }
});

module.exports = router;