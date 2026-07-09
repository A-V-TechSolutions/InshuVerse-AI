const userRoutes = require("./routes/user");
const creditRoutes = require("./routes/credits");
const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
    res.send("InshuVerse Backend Running 🚀");
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

app.use("/api/user", userRoutes);
app.use("/api/credits", creditRoutes);
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
