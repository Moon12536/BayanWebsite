const express = require("express");
const session = require("express-session");
const dotenv = require("dotenv");
const path = require("node:path");
const crypto = require("node:crypto");

const {
    simulateCheckout,
    getPremiumStatus
} = require("./database/premium");

dotenv.config();

const app = express();

const PORT = Number(process.env.PORT) || 3000;
const HOST = "0.0.0.0";
const WEBSITE_DIR = __dirname;

// ==========================================
// ENVIRONMENT
// ==========================================

const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;

const REDIRECT_URI =
    process.env.DISCORD_REDIRECT_URI ||
    "http://localhost:3000/auth/discord/callback";

const OWNER_ID = process.env.BAYAN_OWNER_ID;

const SESSION_SECRET =
    process.env.SESSION_SECRET ||
    crypto.randomBytes(32).toString("hex");

const BOT_INVITE =
    process.env.DISCORD_BOT_INVITE || "";

// ==========================================
// DISCORD API
// ==========================================

const DISCORD_API =
    "https://discord.com/api/v10";

// ==========================================
// APP SETTINGS
// ==========================================

app.disable("x-powered-by");

if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
}

// ==========================================
// MIDDLEWARE
// ==========================================

app.use(express.json({
    limit: "100kb"
}));

app.use(express.urlencoded({
    extended: true,
    limit: "100kb"
}));

// ==========================================
// SECURITY HEADERS
// ==========================================

app.use((req, res, next) => {
    res.setHeader(
        "X-Content-Type-Options",
        "nosniff"
    );

    res.setHeader(
        "X-Frame-Options",
        "SAMEORIGIN"
    );

    res.setHeader(
        "Referrer-Policy",
        "strict-origin-when-cross-origin"
    );

    res.setHeader(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=()"
    );

    next();
});

// ==========================================
// SIMPLE RATE LIMITER
// ==========================================

const rateLimits = new Map();

function rateLimit({
    windowMs = 60_000,
    max = 60
} = {}) {
    return (req, res, next) => {

        const ip =
            req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
            req.socket.remoteAddress ||
            "unknown";

        const key =
            `${ip}:${req.path}`;

        const now = Date.now();

        let record =
            rateLimits.get(key);

        if (!record || now > record.resetAt) {
            record = {
                count: 0,
                resetAt: now + windowMs
            };
        }

        record.count++;

        rateLimits.set(key, record);

        if (record.count > max) {
            return res.status(429).json({
                success: false,
                error: "Too many requests. Please try again later."
            });
        }

        next();
    };
}

app.use(
    "/api",
    rateLimit({
        windowMs: 60_000,
        max: 120
    })
);

// Cleanup rate limiter occasionally
setInterval(() => {

    const now = Date.now();

    for (const [key, value] of rateLimits.entries()) {
        if (now > value.resetAt) {
            rateLimits.delete(key);
        }
    }

}, 5 * 60 * 1000).unref();

// ==========================================
// SESSION
// ==========================================

app.use(
    session({
        name: "bayan.sid",

        secret: SESSION_SECRET,

        resave: false,

        saveUninitialized: false,

        cookie: {
            httpOnly: true,

            secure:
                process.env.NODE_ENV === "production",

            sameSite: "lax",

            maxAge:
                7 * 24 * 60 * 60 * 1000
        }
    })
);

// ==========================================
// STATIC WEBSITE
// ==========================================

app.use(
    express.static(WEBSITE_DIR, {
        index: false
    })
);

// ==========================================
// HELPERS
// ==========================================

function isLoggedIn(req) {
    return Boolean(req.session?.user);
}

function isOwner(req) {
    return Boolean(
        OWNER_ID &&
        req.session?.user?.id === OWNER_ID
    );
}

function requireLogin(req, res, next) {
    if (!isLoggedIn(req)) {
        return res.status(401).json({
            success: false,
            error: "You must log in with Discord first."
        });
    }

    next();
}

function requireOwner(req, res, next) {
    if (!isOwner(req)) {
        return res.status(403).json({
            success: false,
            error: "Owner access required."
        });
    }

    next();
}

function sendPage(res, filename) {
    return res.sendFile(
        path.join(WEBSITE_DIR, filename)
    );
}

function discordPermissionsAllowManagement(guild) {

    const permissions =
        BigInt(guild.permissions || "0");

    const ADMINISTRATOR = 1n << 3n;

    const MANAGE_GUILD = 1n << 5n;

    return (
        (permissions & ADMINISTRATOR) !== 0n ||
        (permissions & MANAGE_GUILD) !== 0n
    );
}

function userCanManageGuild(req, guildId) {

    if (!req.session?.managedGuilds) {
        return false;
    }

    return req.session.managedGuilds.some(
        guild => guild.id === guildId
    );
}

async function discordRequest(
    endpoint,
    accessToken,
    options = {}
) {
    const response = await fetch(
        `${DISCORD_API}${endpoint}`,
        {
            ...options,

            headers: {
                Authorization:
                    `Bearer ${accessToken}`,

                "Content-Type":
                    "application/json",

                ...(options.headers || {})
            }
        }
    );

    const text =
        await response.text();

    let data;

    try {
        data =
            text ? JSON.parse(text) : {};
    } catch {
        data = {
            raw: text
        };
    }

    if (!response.ok) {
        const error =
            new Error(
                `Discord API returned ${response.status}`
            );

        error.status =
            response.status;

        error.data =
            data;

        throw error;
    }

    return data;
}

// ==========================================
// PAGE ROUTES
// ==========================================

app.get("/", (req, res) => {
    return sendPage(
        res,
        "index.html"
    );
});

app.get("/dashboard", (req, res) => {
    return sendPage(
        res,
        "dashboard.html"
    );
});

app.get("/owner", (req, res) => {
    return sendPage(
        res,
        "owner.html"
    );
});

app.get("/pricing", (req, res) => {
    return sendPage(
        res,
        "pricing.html"
    );
});

// ==========================================
// HEALTH
// ==========================================

app.get("/health", (req, res) => {

    res.json({
        success: true,

        status: "online",

        service: "Bayan Website",

        time: new Date().toISOString(),

        uptime:
            Math.floor(process.uptime()),

        environment:
            process.env.NODE_ENV || "development"
    });
});

// ==========================================
// CONFIG
// ==========================================

app.get("/api/config", (req, res) => {

    res.json({
        success: true,

        botInvite:
            BOT_INVITE,

        discordConfigured:
            Boolean(
                CLIENT_ID &&
                CLIENT_SECRET &&
                REDIRECT_URI
            ),

        ownerConfigured:
            Boolean(OWNER_ID),

        environment:
            process.env.NODE_ENV || "development"
    });
});

// ==========================================
// DISCORD LOGIN
// ==========================================

app.get(
    "/login",
    rateLimit({
        windowMs: 60_000,
        max: 20
    }),
    (req, res) => {

        if (
            !CLIENT_ID ||
            !CLIENT_SECRET
        ) {
            return res.status(500).send(
                "Discord OAuth is not configured."
            );
        }

        const state =
            crypto.randomBytes(24)
                .toString("hex");

        req.session.oauthState =
            state;

        const params =
            new URLSearchParams({
                client_id: CLIENT_ID,

                response_type: "code",

                redirect_uri:
                    REDIRECT_URI,

                scope:
                    "identify guilds",

                state
            });

        const url =
            `https://discord.com/oauth2/authorize?${params.toString()}`;

        return res.redirect(url);
    }
);

// ==========================================
// DISCORD CALLBACK
// ==========================================

app.get(
    "/auth/discord/callback",
    async (req, res) => {

        try {

            const {
                code,
                state,
                error
            } = req.query;

            if (error) {
                return res.redirect(
                    "/?login=cancelled"
                );
            }

            if (!code) {
                return res.status(400).send(
                    "Missing Discord authorization code."
                );
            }

            if (
                !state ||
                !req.session.oauthState ||
                state !== req.session.oauthState
            ) {
                return res.status(400).send(
                    "Invalid OAuth state."
                );
            }

            delete req.session.oauthState;

            // ----------------------------------
            // Exchange authorization code
            // ----------------------------------

            const body =
                new URLSearchParams({
                    client_id: CLIENT_ID,

                    client_secret:
                        CLIENT_SECRET,

                    grant_type:
                        "authorization_code",

                    code,

                    redirect_uri:
                        REDIRECT_URI
                });

            const tokenResponse =
                await fetch(
                    `${DISCORD_API}/oauth2/token`,
                    {
                        method: "POST",

                        headers: {
                            "Content-Type":
                                "application/x-www-form-urlencoded"
                        },

                        body
                    }
                );

            const tokenData =
                await tokenResponse.json();

            if (!tokenResponse.ok) {
                console.error(
                    "Discord token error:",
                    tokenData
                );

                return res.status(401).send(
                    "Discord login failed."
                );
            }

            const accessToken =
                tokenData.access_token;

            // ----------------------------------
            // Get Discord user
            // ----------------------------------

            const user =
                await discordRequest(
                    "/users/@me",
                    accessToken
                );

            // ----------------------------------
            // Get Discord servers
            // ----------------------------------

            const guilds =
                await discordRequest(
                    "/users/@me/guilds",
                    accessToken
                );

            // ----------------------------------
            // Filter manageable servers
            // ----------------------------------

            const managedGuilds =
                guilds
                    .filter(
                        discordPermissionsAllowManagement
                    )
                    .map(guild => ({
                        id: guild.id,

                        name: guild.name,

                        icon:
                            guild.icon,

                        owner:
                            Boolean(guild.owner),

                        permissions:
                            guild.permissions
                    }));

            // ----------------------------------
            // Store session
            // ----------------------------------

            req.session.user = {
                id: user.id,

                username:
                    user.username,

                globalName:
                    user.global_name ||
                    user.username,

                avatar:
                    user.avatar
            };

            req.session.accessToken =
                accessToken;

            req.session.managedGuilds =
                managedGuilds;

            req.session.loginAt =
                new Date().toISOString();

            return res.redirect(
                "/dashboard"
            );

        } catch (error) {

            console.error(
                "Discord OAuth callback error:",
                error
            );

            return res.status(500).send(
                "Discord login failed. Check the server console."
            );
        }
    }
);

// ==========================================
// LOGOUT
// ==========================================

app.get("/logout", (req, res) => {

    req.session.destroy(() => {

        res.clearCookie(
            "bayan.sid"
        );

        return res.redirect("/");
    });
});

// ==========================================
// CURRENT USER
// ==========================================

app.get(
    "/api/me",
    requireLogin,
    (req, res) => {

        return res.json({
            success: true,

            user:
                req.session.user,

            isOwner:
                isOwner(req),

            loginAt:
                req.session.loginAt
        });
    }
);

// ==========================================
// USER SERVERS
// ==========================================

app.get(
    "/api/servers",
    requireLogin,
    (req, res) => {

        const guilds =
            req.session.managedGuilds || [];

        return res.json({
            success: true,

            servers: guilds.map(guild => ({
                id: guild.id,

                name: guild.name,

                icon: guild.icon,

                owner: guild.owner
            }))
        });
    }
);

// ==========================================
// SINGLE SERVER
// ==========================================

app.get(
    "/api/servers/:guildId",
    requireLogin,
    (req, res) => {

        const guild =
            (req.session.managedGuilds || [])
                .find(
                    server =>
                        server.id ===
                        req.params.guildId
                );

        if (!guild) {
            return res.status(403).json({
                success: false,
                error:
                    "You do not have permission to manage this server."
            });
        }

        return res.json({
            success: true,

            server: guild
        });
    }
);

// ==========================================
// PREMIUM STATUS
// ==========================================

app.get(
    "/api/premium/:guildId",
    requireLogin,
    (req, res) => {

        const guildId =
            req.params.guildId;

        if (
            !userCanManageGuild(
                req,
                guildId
            )
        ) {
            return res.status(403).json({
                success: false,

                error:
                    "You do not have permission to manage this server."
            });
        }

        try {

            const status =
                getPremiumStatus(
                    guildId
                );

            return res.json({
                success: true,

                guildId,

                ...status
            });

        } catch (error) {

            console.error(
                "Premium status error:",
                error
            );

            return res.status(500).json({
                success: false,

                premium: false,

                error:
                    "Unable to check Premium status."
            });
        }
    }
);

// ==========================================
// TEST PREMIUM CHECKOUT
// ==========================================
//
// IMPORTANT:
// This is a local/test activation system.
// It does NOT process real money.
// ==========================================

app.post(
    "/api/test/checkout",
    requireLogin,
    (req, res) => {

        try {

            const {
                guildId,
                planKey
            } = req.body;

            if (!guildId || !planKey) {
                return res.status(400).json({
                    success: false,

                    error:
                        "Missing server or Premium plan."
                });
            }

            // Never trust a client-provided guild ID.
            if (
                !userCanManageGuild(
                    req,
                    guildId
                )
            ) {
                return res.status(403).json({
                    success: false,

                    error:
                        "You cannot activate Premium for this server."
                });
            }

            const result =
                simulateCheckout({
                    guildId,

                    userDiscordId:
                        req.session.user.id,

                    planKey
                });

            return res.json(result);

        } catch (error) {

            console.error(
                "Test checkout error:",
                error
            );

            return res.status(400).json({
                success: false,

                error:
                    error.message ||
                    "Checkout failed."
            });
        }
    }
);

// ==========================================
// OWNER CHECK
// ==========================================

app.get(
    "/api/owner/status",
    requireLogin,
    (req, res) => {

        return res.json({
            success: true,

            owner:
                isOwner(req)
        });
    }
);

// ==========================================
// OWNER PREMIUM GRANT
// ==========================================
//
// Grants Premium without payment.
// ==========================================

app.post(
    "/api/owner/premium",
    requireLogin,
    requireOwner,
    (req, res) => {

        try {

            const {
                guildId,
                planKey = "lifetime"
            } = req.body;

            if (!guildId) {
                return res.status(400).json({
                    success: false,

                    error:
                        "Missing server ID."
                });
            }

            /*
             * Owner grants intentionally use
             * the same Premium activation engine
             * but mark the user as the owner.
             *
             * This remains a TEST/ADMIN grant.
             */

            const result =
                simulateCheckout({
                    guildId,

                    userDiscordId:
                        req.session.user.id,

                    planKey
                });

            return res.json({
                success: true,

                type: "owner_grant",

                ...result
            });

        } catch (error) {

            console.error(
                "Owner Premium grant error:",
                error
            );

            return res.status(400).json({
                success: false,

                error:
                    error.message ||
                    "Unable to grant Premium."
            });
        }
    }
);

// ==========================================
// OWNER PREMIUM REMOVE
// ==========================================

app.delete(
    "/api/owner/premium/:guildId",
    requireLogin,
    requireOwner,
    (req, res) => {

        try {

            const Database =
                require("better-sqlite3");

            const db =
                new Database(
                    path.join(
                        __dirname,
                        "database",
                        "bayan.db"
                    )
                );

            const result =
                db.prepare(`
                    UPDATE subscriptions
                    SET
                        status = 'cancelled',
                        updated_at =
                            CURRENT_TIMESTAMP
                    WHERE
                        guild_id = ?
                    AND
                        status = 'active'
                `).run(
                    req.params.guildId
                );

            db.close();

            return res.json({
                success: true,

                removed:
                    result.changes > 0
            });

        } catch (error) {

            console.error(
                "Owner Premium removal error:",
                error
            );

            return res.status(500).json({
                success: false,

                error:
                    "Unable to remove Premium."
            });
        }
    }
);

// ==========================================
// DASHBOARD SUMMARY
// ==========================================

app.get(
    "/api/dashboard",
    requireLogin,
    (req, res) => {

        const servers =
            req.session.managedGuilds || [];

        return res.json({
            success: true,

            user:
                req.session.user,

            isOwner:
                isOwner(req),

            serverCount:
                servers.length,

            servers
        });
    }
);

// ==========================================
// BOT INVITE
// ==========================================

app.get(
    "/api/bot/invite",
    (req, res) => {

        return res.json({
            success: true,

            url:
                BOT_INVITE
        });
    }
);

// ==========================================
// 404
// ==========================================

app.use((req, res) => {

    if (
        req.path.startsWith("/api/")
    ) {
        return res.status(404).json({
            success: false,

            error:
                "API endpoint not found."
        });
    }

    return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Bayan - 404</title>

            <style>
                body {
                    margin: 0;
                    background: #0b0d12;
                    color: white;
                    font-family: Arial, sans-serif;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    min-height: 100vh;
                    text-align: center;
                }

                h1 {
                    font-size: 72px;
                    margin: 0;
                }

                p {
                    color: #aeb4c0;
                }

                a {
                    color: #5865f2;
                    text-decoration: none;
                }
            </style>
        </head>

        <body>
            <div>
                <h1>404</h1>

                <p>
                    الصفحة التي تبحث عنها غير موجودة.
                </p>

                <a href="/">
                    العودة إلى Bayan
                </a>
            </div>
        </body>
        </html>
    `);
});

// ==========================================
// ERROR HANDLER
// ==========================================

app.use(
    (error, req, res, next) => {

        console.error(
            "Unhandled server error:",
            error
        );

        if (res.headersSent) {
            return next(error);
        }

        if (
            req.path.startsWith("/api/")
        ) {
            return res.status(500).json({
                success: false,

                error:
                    "Internal server error."
            });
        }

        return res.status(500).send(
            "Internal server error."
        );
    }
);

// ==========================================
// START SERVER
// ==========================================

const server =
    app.listen(
        PORT,
        HOST,
        error => {

            if (error) {
                console.error(
                    "Failed to start server:",
                    error
                );

                process.exit(1);
            }

            console.log("");
            console.log(
                "======================================"
            );
            console.log(
                "           BAYAN WEBSITE"
            );
            console.log(
                "======================================"
            );

            console.log(
                `Server: http://${HOST}:${PORT}`
            );

            console.log(
                `Website: ${WEBSITE_DIR}`
            );

            console.log(
                `OAuth: ${
                    CLIENT_ID &&
                    CLIENT_SECRET
                        ? "CONFIGURED"
                        : "NOT CONFIGURED"
                }`
            );

            console.log(
                `Owner: ${
                    OWNER_ID
                        ? "CONFIGURED"
                        : "NOT CONFIGURED"
                }`
            );

            console.log(
                `Premium DB: ENABLED`
            );

            console.log(
                "======================================"
            );
            console.log("");
        }
    );

// ==========================================
// GRACEFUL SHUTDOWN
// ==========================================

function shutdown(signal) {

    console.log(
        `${signal} received. Shutting down...`
    );

    server.close(() => {

        console.log(
            "Bayan Website stopped."
        );

        process.exit(0);
    });
}

process.on(
    "SIGINT",
    () => shutdown("SIGINT")
);

process.on(
    "SIGTERM",
    () => shutdown("SIGTERM")
);