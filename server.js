require("dotenv").config();

const express = require("express");
const session = require("express-session");
const path = require("node:path");

const app = express();

const PORT = Number(process.env.PORT || 3000);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
    session({
        secret: process.env.SESSION_SECRET || "bayan-secret-change-me",
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
            maxAge: 1000 * 60 * 60 * 24 * 7
        }
    })
);

// Serve website files
app.use(express.static(path.join(__dirname, "public")));

// Homepage
app.get("/", (req, res) => {
    res.sendFile(
        path.join(__dirname, "public", "index.html")
    );
});

// Dashboard
app.get("/dashboard", (req, res) => {
    res.sendFile(
        path.join(__dirname, "public", "dashboard.html")
    );
});

// Owner panel
app.get("/owner", (req, res) => {
    res.sendFile(
        path.join(__dirname, "public", "owner.html")
    );
});

// Health check
app.get("/health", (req, res) => {
    res.json({
        status: "online",
        name: "Bayan Website"
    });
});

// Discord login
app.get("/login", (req, res) => {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        return res.status(500).send(
            "Discord OAuth is not configured."
        );
    }

    const redirectUri =
        process.env.DISCORD_REDIRECT_URI ||
        `http://localhost:${PORT}/auth/discord/callback`;

    const params = new URLSearchParams({
        client_id: clientId,
        response_type: "code",
        scope: "identify guilds",
        redirect_uri: redirectUri
    });

    res.redirect(
        `https://discord.com/oauth2/authorize?${params}`
    );
});

// Discord OAuth callback
app.get("/auth/discord/callback", async (req, res) => {
    const code = req.query.code;

    if (!code) {
        return res.redirect("/?login=cancelled");
    }

    try {
        const redirectUri =
            process.env.DISCORD_REDIRECT_URI ||
            `http://localhost:${PORT}/auth/discord/callback`;

        const tokenResponse = await fetch(
            "https://discord.com/api/oauth2/token",
            {
                method: "POST",
                headers: {
                    "Content-Type":
                        "application/x-www-form-urlencoded"
                },
                body: new URLSearchParams({
                    client_id:
                        process.env.DISCORD_CLIENT_ID,

                    client_secret:
                        process.env.DISCORD_CLIENT_SECRET,

                    grant_type:
                        "authorization_code",

                    code,
                    redirect_uri: redirectUri
                })
            }
        );

        if (!tokenResponse.ok) {
            throw new Error(
                `Discord token request failed: ${tokenResponse.status}`
            );
        }

        const tokenData =
            await tokenResponse.json();

        const userResponse = await fetch(
            "https://discord.com/api/users/@me",
            {
                headers: {
                    Authorization:
                        `Bearer ${tokenData.access_token}`
                }
            }
        );

        if (!userResponse.ok) {
            throw new Error(
                "Failed to get Discord user."
            );
        }

        const user =
            await userResponse.json();

        const guildResponse = await fetch(
            "https://discord.com/api/users/@me/guilds",
            {
                headers: {
                    Authorization:
                        `Bearer ${tokenData.access_token}`
                }
            }
        );

        const guilds =
            guildResponse.ok
                ? await guildResponse.json()
                : [];

        req.session.user = {
            id: user.id,
            username: user.username,
            globalName: user.global_name,
            avatar: user.avatar,

            guilds: guilds.filter(guild => {
                const permissions =
                    BigInt(guild.permissions || "0");

                const ADMINISTRATOR = 1n << 3n;
                const MANAGE_GUILD = 1n << 5n;

                return (
                    (permissions &
                        ADMINISTRATOR) !== 0n ||
                    (permissions &
                        MANAGE_GUILD) !== 0n
                );
            })
        };

        res.redirect("/dashboard.html");

    } catch (error) {
        console.error(
            "Discord login error:",
            error
        );

        res.status(500).send(
            "Discord login failed."
        );
    }
});

// Logout
app.get("/logout", (req, res) => {
    req.session.destroy(() => {
        res.redirect("/");
    });
});

// Website configuration
app.get("/api/config", (req, res) => {
    res.json({
        loggedIn: Boolean(req.session.user),

        user:
            req.session.user || null,

        botInvite:
            process.env.DISCORD_BOT_INVITE || "#",

        isOwner:
            Boolean(
                req.session.user &&
                req.session.user.id ===
                    process.env.BAYAN_OWNER_ID
            )
    });
});

// Temporary settings storage
const serverSettings = new Map();

function defaultSettings() {
    return {
        moderation: true,
        autoMod: true,
        antiSpam: true,
        antiLinks: false,
        welcome: false,
        welcomeChannel: "",
        tickets: true,
        ticketRole: "",
        logs: true,
        notifications: true
    };
}

// Get settings
app.get(
    "/api/settings/:guildId",
    (req, res) => {
        const guildId =
            req.params.guildId;

        if (!serverSettings.has(guildId)) {
            serverSettings.set(
                guildId,
                defaultSettings()
            );
        }

        res.json(
            serverSettings.get(guildId)
        );
    }
);

// Save settings
app.post(
    "/api/settings/:guildId",
    (req, res) => {
        const guildId =
            req.params.guildId;

        const current =
            serverSettings.get(guildId) ||
            defaultSettings();

        const updated = {
            ...current,
            ...req.body
        };

        serverSettings.set(
            guildId,
            updated
        );

        res.json({
            success: true,
            settings: updated
        });
    }
);

// Premium storage
const premiumServers = new Map();

// Owner protection
function requireOwner(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({
            error: "Not logged in"
        });
    }

    if (
        req.session.user.id !==
        process.env.BAYAN_OWNER_ID
    ) {
        return res.status(403).json({
            error: "Owner access required"
        });
    }

    next();
}

// Get premium servers
app.get(
    "/api/owner/premium",
    requireOwner,
    (req, res) => {
        const result = [];

        for (
            const [guildId, data]
            of premiumServers
        ) {
            result.push({
                guildId,
                ...data
            });
        }

        res.json(result);
    }
);

// Grant premium
app.post(
    "/api/owner/premium/grant",
    requireOwner,
    (req, res) => {
        const {
            guildId,
            guildName,
            duration
        } = req.body;

        if (!guildId) {
            return res.status(400).json({
                error: "Guild ID is required"
            });
        }

        let expiresAt = null;

        if (duration !== "lifetime") {
            const days = Number(duration);

            if (
                !Number.isFinite(days) ||
                days <= 0
            ) {
                return res.status(400).json({
                    error: "Invalid duration"
                });
            }

            expiresAt =
                Date.now() +
                days *
                    24 *
                    60 *
                    60 *
                    1000;
        }

        premiumServers.set(
            guildId,
            {
                guildName:
                    guildName ||
                    "Unknown Server",

                plan: "Premium",

                grantedBy:
                    req.session.user.id,

                grantedAt:
                    Date.now(),

                expiresAt
            }
        );

        res.json({
            success: true
        });
    }
);

// Remove premium
app.post(
    "/api/owner/premium/remove",
    requireOwner,
    (req, res) => {
        const {
            guildId
        } = req.body;

        premiumServers.delete(
            guildId
        );

        res.json({
            success: true
        });
    }
);

// Check premium
app.get(
    "/api/premium/:guildId",
    (req, res) => {
        const data =
            premiumServers.get(
                req.params.guildId
            );

        if (!data) {
            return res.json({
                active: false
            });
        }

        if (
            data.expiresAt &&
            Date.now() >=
                data.expiresAt
        ) {
            premiumServers.delete(
                req.params.guildId
            );

            return res.json({
                active: false
            });
        }

        res.json({
            active: true,
            ...data
        });
    }
);

// Start server
app.listen(
    PORT,
    "0.0.0.0",
    () => {
        console.log(
            "=============================="
        );

        console.log(
            "       BAYAN WEBSITE"
        );

        console.log(
            "=============================="
        );

        console.log(
            `Server running on port ${PORT}`
        );

        console.log(
            "=============================="
        );
    }
);