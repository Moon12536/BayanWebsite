const express = require("express");
const path = require("path");
const session = require("express-session");

const app = express();

const PORT = process.env.PORT || 3000;

const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;

const REDIRECT_URI =
    process.env.DISCORD_REDIRECT_URI ||
    "http://localhost:3000/auth/discord/callback";

app.use(express.json());

app.use(
    session({
        secret: process.env.SESSION_SECRET || "bayan-secret-change-me",
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: false,
            maxAge: 7 * 24 * 60 * 60 * 1000
        }
    })
);

// Serve files from the ROOT of the GitHub repository
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/dashboard", (req, res) => {
    if (!req.session.user) {
        return res.redirect("/");
    }

    res.sendFile(path.join(__dirname, "dashboard.html"));
});

app.get("/auth/discord", (req, res) => {
    if (!CLIENT_ID) {
        return res.status(500).send("DISCORD_CLIENT_ID is missing.");
    }

    const params = new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        response_type: "code",
        scope: "identify guilds"
    });

    res.redirect(
        `https://discord.com/oauth2/authorize?${params.toString()}`
    );
});

app.get("/auth/discord/callback", async (req, res) => {
    const code = req.query.code;

    if (!code) {
        return res.status(400).send("Authorization cancelled.");
    }

    try {
        const tokenResponse = await fetch(
            "https://discord.com/api/oauth2/token",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded"
                },
                body: new URLSearchParams({
                    client_id: CLIENT_ID,
                    client_secret: CLIENT_SECRET,
                    grant_type: "authorization_code",
                    code,
                    redirect_uri: REDIRECT_URI
                })
            }
        );

        const tokenData = await tokenResponse.json();

        if (!tokenResponse.ok) {
            console.error("Token error:", tokenData);
            return res.status(500).send("Discord login failed.");
        }

        const authHeader =
            `${tokenData.token_type} ${tokenData.access_token}`;

        const userResponse = await fetch(
            "https://discord.com/api/users/@me",
            {
                headers: {
                    Authorization: authHeader
                }
            }
        );

        const user = await userResponse.json();

        if (!userResponse.ok) {
            return res.status(500).send("Could not get Discord user.");
        }

        const guildResponse = await fetch(
            "https://discord.com/api/users/@me/guilds",
            {
                headers: {
                    Authorization: authHeader
                }
            }
        );

        const guilds = await guildResponse.json();

        req.session.user = user;
        req.session.guilds = Array.isArray(guilds) ? guilds : [];

        // Automatically go to dashboard after authorization
        res.redirect("/dashboard");
    } catch (error) {
        console.error(error);
        res.status(500).send("Internal server error.");
    }
});

app.get("/api/me", (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({
            loggedIn: false
        });
    }

    res.json({
        loggedIn: true,
        user: req.session.user,
        guilds: req.session.guilds || []
    });
});

app.get("/logout", (req, res) => {
    req.session.destroy(() => {
        res.redirect("/");
    });
});

app.get("/health", (req, res) => {
    res.json({
        status: "online",
        service: "Bayan Website"
    });
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Bayan Website running on port ${PORT}`);
});