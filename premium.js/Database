const Database = require("better-sqlite3");
const path = require("node:path");

const db = new Database(
    path.join(__dirname, "bayan.db")
);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ================================
// TABLES
// ================================

db.exec(`
    CREATE TABLE IF NOT EXISTS plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plan_key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        duration_days INTEGER,
        price_cents INTEGER NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'USD',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        plan_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        starts_at TEXT NOT NULL,
        expires_at TEXT,
        provider TEXT,
        provider_subscription_id TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (plan_id)
        REFERENCES plans(id)
    );

    CREATE INDEX IF NOT EXISTS idx_subscriptions_guild
    ON subscriptions(guild_id);

    CREATE INDEX IF NOT EXISTS idx_subscriptions_status
    ON subscriptions(status);

    CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        user_discord_id TEXT NOT NULL,
        plan_id INTEGER NOT NULL,
        amount_cents INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        status TEXT NOT NULL DEFAULT 'pending',
        provider TEXT,
        provider_payment_id TEXT UNIQUE,
        paid_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (plan_id)
        REFERENCES plans(id)
    );
`);

// ================================
// DEFAULT PLANS
// ================================

const insertPlan = db.prepare(`
    INSERT OR IGNORE INTO plans (
        plan_key,
        name,
        duration_days,
        price_cents,
        currency
    )
    VALUES (?, ?, ?, ?, 'USD')
`);

const plans = [
    ["trial", "7 Day Trial", 7, 0],
    ["monthly", "30 Days", 30, 999],
    ["quarterly", "90 Days", 90, 2499],
    ["lifetime", "Lifetime", null, 9999]
];

for (const plan of plans) {
    insertPlan.run(...plan);
}

// ================================
// SIMULATED CHECKOUT
// ================================

function simulateCheckout({
    guildId,
    userDiscordId,
    planKey
}) {
    if (!guildId) {
        throw new Error("Missing server ID.");
    }

    if (!userDiscordId) {
        throw new Error("Missing Discord user ID.");
    }

    if (!planKey) {
        throw new Error("Missing Premium plan.");
    }

    const plan = db.prepare(`
        SELECT *
        FROM plans
        WHERE plan_key = ?
        AND active = 1
    `).get(planKey);

    if (!plan) {
        throw new Error("Premium plan not found.");
    }

    const now = new Date();

    let expiresAt = null;

    if (plan.duration_days !== null) {
        const expiration = new Date(now);

        expiration.setDate(
            expiration.getDate() + plan.duration_days
        );

        expiresAt = expiration.toISOString();
    }

    const paymentId =
        `test_${Date.now()}_${Math.random()
            .toString(36)
            .slice(2, 10)}`;

    const transaction = db.transaction(() => {

        // Replace current Premium subscription
        db.prepare(`
            UPDATE subscriptions
            SET status = 'replaced',
                updated_at = CURRENT_TIMESTAMP
            WHERE guild_id = ?
            AND status = 'active'
        `).run(guildId);

        // Create payment record
        db.prepare(`
            INSERT INTO payments (
                guild_id,
                user_discord_id,
                plan_id,
                amount_cents,
                currency,
                status,
                provider,
                provider_payment_id,
                paid_at
            )
            VALUES (?, ?, ?, ?, ?, 'paid', 'test', ?, ?)
        `).run(
            guildId,
            userDiscordId,
            plan.id,
            plan.price_cents,
            plan.currency,
            paymentId,
            now.toISOString()
        );

        // Activate Premium
        db.prepare(`
            INSERT INTO subscriptions (
                guild_id,
                plan_id,
                status,
                starts_at,
                expires_at,
                provider,
                provider_subscription_id
            )
            VALUES (?, ?, 'active', ?, ?, 'test', ?)
        `).run(
            guildId,
            plan.id,
            now.toISOString(),
            expiresAt,
            paymentId
        );
    });

    transaction();

    return {
        success: true,
        paymentId,
        guildId,
        planKey: plan.plan_key,
        planName: plan.name,
        expiresAt
    };
}

// ================================
// GET PREMIUM STATUS
// ================================

function getPremiumStatus(guildId) {

    if (!guildId) {
        return {
            premium: false
        };
    }

    const subscription = db.prepare(`
        SELECT
            subscriptions.*,
            plans.plan_key,
            plans.name,
            plans.duration_days
        FROM subscriptions

        JOIN plans
        ON plans.id = subscriptions.plan_id

        WHERE subscriptions.guild_id = ?
        AND subscriptions.status = 'active'

        ORDER BY subscriptions.id DESC

        LIMIT 1
    `).get(guildId);

    if (!subscription) {
        return {
            premium: false
        };
    }

    // Lifetime Premium
    if (!subscription.expires_at) {
        return {
            premium: true,
            planKey: subscription.plan_key,
            planName: subscription.name,
            expiresAt: null,
            lifetime: true
        };
    }

    const expiration =
        new Date(subscription.expires_at);

    const now = new Date();

    // Expired
    if (expiration <= now) {

        db.prepare(`
            UPDATE subscriptions
            SET status = 'expired',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(subscription.id);

        return {
            premium: false
        };
    }

    return {
        premium: true,
        planKey: subscription.plan_key,
        planName: subscription.name,
        expiresAt: subscription.expires_at,
        lifetime: false
    };
}

// ================================
// EXPORTS
// ================================

module.exports = {
    simulateCheckout,
    getPremiumStatus
};
