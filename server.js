const express = require("express");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/health", (req, res) => {
    res.status(200).send("Bayan is online");
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Bayan Website running on port ${PORT}`);
});
