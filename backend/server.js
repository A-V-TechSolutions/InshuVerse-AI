const userRoutes = require("./routes/user");
const creditRoutes = require("./routes/credits");
const express = require("express");
const cors = require("cors");
const { verifySmtpConnection } = require("./services/emailService");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
    res.send("InshuVerse Backend Running 🚀");
});

app.use("/api/user", userRoutes);
app.use("/api/credits", creditRoutes);

const PORT = process.env.PORT || 5000;

// Verify SMTP connection on startup
verifySmtpConnection().then(isConnected => {
    if (isConnected) {
        console.log('[SERVER] Email service initialized successfully');
    } else {
        console.warn('[SERVER] Email service initialization failed - emails will not be sent');
    }
}).catch(err => {
    console.error('[SERVER] Error initializing email service:', err);
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
