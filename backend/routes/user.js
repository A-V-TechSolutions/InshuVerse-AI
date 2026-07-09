const express = require("express");
const router = express.Router();

const { db, FieldValue } = require("../firebase");

router.get("/plan/:uid", async (req, res) => {
    try {

        const uid = req.params.uid;

        const userRef = db.collection("users").doc(uid);

        const userDoc = await userRef.get();

        if (!userDoc.exists) {

            const newUser = {
                plan: "free",
                credits: 7,
                createdAt: FieldValue.serverTimestamp()
            };

            await userRef.set(newUser);

            return res.json({
                success: true,
                plan: "free",
                credits: 7
            });
        }

        const data = userDoc.data();

        return res.json({
            success: true,
            plan: data.plan,
            credits: data.credits
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            success: false,
            error: err.message
        });

    }
});

module.exports = router;