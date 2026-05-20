// Sol's Stat Tracker Webhook Client
// Created by @mongoo.se

// ── Express uptime server ─────────────────────────────────────────────────────
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => res.send('Tracker is Active'));

app.listen(PORT, () => {
    console.log(`Uptime server listening on port ${PORT}`);
});

// ── Core dependencies ─────────────────────────────────────────────────────────
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { Client, GatewayIntentBits, WebhookClient, Events, EmbedBuilder } = require('discord.js');

const {
    token, webhookURL, commandChannelId,
    overrideUsername, overrideAvatarURL, colors, emojis,
    gatewayURL, maxReconnectInterval, reconnectOnDuplicateConnection, verboseLogging
} = require('./config');

// ── Single-instance lock via PID file ────────────────────────────────────────
const PID_FILE = path.join(__dirname, '.pid');
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

let killedOldProcess = false;
try {
    if (fs.existsSync(PID_FILE)) {
        const oldPid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
        if (oldPid && oldPid !== process.pid) {
            try {
                process.kill(oldPid, 'SIGTERM');
                console.log(`Sent SIGTERM to old instance (PID ${oldPid})`);
                killedOldProcess = true;
            } catch (_) {}
        }
    }
} catch (_) {}

fs.writeFileSync(PID_FILE, String(process.pid));

// ── Persistent tracking ───────────────────────────────────────────────────────
const TRACKED_FILE = path.join(__dirname, 'tracked_users.json');

const loadTrackedUsers = () => {
    try {
        if (fs.existsSync(TRACKED_FILE)) {
            const raw = JSON.parse(fs.readFileSync(TRACKED_FILE, 'utf8'));
            for (const [key, val] of Object.entries(raw)) {
                trackedRobloxUsers.set(key, val);
            }
            console.log(`Loaded ${trackedRobloxUsers.size} tracked user(s) from disk.`);
        }
    } catch (err) {
        console.error(`Failed to load tracked users: ${err.message}`);
    }
};

const saveTrackedUsers = () => {
    try {
        const obj = Object.fromEntries(trackedRobloxUsers);
        fs.writeFileSync(TRACKED_FILE, JSON.stringify(obj, null, 2));
    } catch (err) {
        console.error(`Failed to save tracked users: ${err.message}`);
    }
};

// ── Tracked users — Map<lowercaseUsername, { id: number, name: string }> ─────
const trackedRobloxUsers = new Map();
const getTrackedIds = () => new Set([...trackedRobloxUsers.values()].map((u) => u.id));

// ── Session stats ────────────────────────────────────────────────────────────
const botStartTime = Date.now();
let totalRollsProcessed = 0;

// ── Discord bot ───────────────────────────────────────────────────────────────
const bot = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

bot.once(Events.ClientReady, (c) => {
    console.log(`Bot ready: logged in as ${c.user.tag}`);
    c.user.setPresence({
        status: 'online',
        activities: [{ name: 'Sol\'s Stat Tracker', type: 3 }]
    });
});

bot.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    if (message.channelId !== commandChannelId) return;

    const content = message.content.trim();

    // !link [RobloxUsername]
    const linkMatch = content.match(/^!link\s+(\S+)$/i);
    if (linkMatch) {
        const inputName = linkMatch[1];
        try {
            const { data } = await axios.get(
                'https://users.roblox.com/v1/users/search',
                { params: { keyword: inputName, limit: 10 } }
            );
            const found = (data.data ?? []).find(
                (u) => u.name.toLowerCase() === inputName.toLowerCase()
            );
            if (!found) {
                console.log(`Roblox validation failed: "${inputName}" not found`);
                message.reply(`**${inputName}** does not exist on Roblox. Please check the username and try again.`);
                return;
            }
            const key = found.name.toLowerCase();
            trackedRobloxUsers.set(key, { id: found.id, name: found.name });
            saveTrackedUsers();
            console.log(`Tracking added: ${found.name} (ID: ${found.id}, total: ${trackedRobloxUsers.size})`);
            message.reply(
                `Verified and now tracking **${found.name}** (Roblox ID: \`${found.id}\`). ` +
                `Total tracked: ${trackedRobloxUsers.size}`
            );
        } catch (err) {
            console.error(`Roblox API error during !link: ${err.message}`);
            message.reply('Could not reach the Roblox API to verify that username. Try again in a moment.');
        }
        return;
    }

    // !unlink [RobloxUsername]
    const unlinkMatch = content.match(/^!unlink\s+(\S+)$/i);
    if (unlinkMatch) {
        const key = unlinkMatch[1].toLowerCase();
        const entry = trackedRobloxUsers.get(key);
        if (entry) {
            trackedRobloxUsers.delete(key);
            saveTrackedUsers();
            console.log(`Tracking removed: ${entry.name} (ID: ${entry.id}, total: ${trackedRobloxUsers.size})`);
            message.reply(`Stopped tracking **${entry.name}** (ID: \`${entry.id}\`). Total tracked: ${trackedRobloxUsers.size}`);
        } else {
            message.reply(`**${unlinkMatch[1]}** was not in the tracked list.`);
        }
        return;
    }

    // !list
    if (/^!list$/i.test(content)) {
        if (trackedRobloxUsers.size === 0) {
            message.reply('No users are currently being tracked.');
        } else {
            const list = [...trackedRobloxUsers.values()]
                .map((u, i) => `${i + 1}. **${u.name}** — ID \`${u.id}\``)
                .join('\n');
            message.reply(`**Tracked Roblox users (${trackedRobloxUsers.size}):**\n${list}`);
        }
        return;
    }

    // !status
    if (/^!status$/i.test(content)) {
        const ms = Date.now() - botStartTime;
        const h = Math.floor(ms / 3_600_000);
        const m = Math.floor((ms % 3_600_000) / 60_000);
        const s = Math.floor((ms % 60_000) / 1_000);
        message.reply(
            `**📊 Sol's Stat Tracker — Status**\n` +
            `• Gateway: **🟢 Connected**\n` +
            `• Uptime: **${h}h ${m}m ${s}s**\n` +
            `• Linked users: **${trackedRobloxUsers.size}**\n` +
            `• Rolls processed (session): **${totalRollsProcessed.toLocaleString()}**`
        );
        return;
    }
});

// ── Webhook clients ───────────────────────────────────────────────────────────
let reconnectInterval = 31_000;
let activeWs = null;

// Tracks consecutive 4003 attempts so we use backoff and avoid infinite loops.
let duplicateRetryCount = 0;
let stableConnectionTimer = null;

// Public tracker — every global roll is sent here
const publicWebhookClient = new WebhookClient({ url: process.env.DISCORD_WEBHOOK_URL_FOR_PUBLIC_TRACKER });
publicWebhookClient.on(Events.Error, (err) => console.error(`Public webhook error: ${err.message}`));

// Linked tracker — only rolls from tracked Roblox users are sent here
const linkedWebhookClient = new WebhookClient({ url: process.env.DISCORD_WEBHOOK_URL_FOR_LINKED_USER_TRACKER });
linkedWebhookClient.on(Events.Error, (err) => console.error(`Linked webhook error: ${err.message}`));

// ── Clean shutdown ────────────────────────────────────────────────────────────
const shutdown = () => {
    console.log('Shutting down gracefully...');
    try { fs.unlinkSync(PID_FILE); } catch (_) {}
    if (stableConnectionTimer) clearTimeout(stableConnectionTimer);
    if (activeWs) { activeWs.terminate(); activeWs = null; }
    bot.destroy();
    process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ── Helpers ───────────────────────────────────────────────────────────────────
const extractUserIdFromUrl = (url) => {
    if (!url) return null;
    const match = url.match(/\/users\/(\d+)\/profile/);
    return match ? parseInt(match[1], 10) : null;
};

// ── Gateway connection ────────────────────────────────────────────────────────
const connect = () => {
    const ws = new WebSocket(gatewayURL, { headers: { token } });
    activeWs = ws;

    ws.on('open', () => {
        console.log(`WS client connected: ${gatewayURL}`);
        reconnectInterval = 31_000;

        // Only mark the connection as stable (and reset retry count) after it
        // has been open for 10 seconds without a 4003 close.
        if (stableConnectionTimer) clearTimeout(stableConnectionTimer);
        stableConnectionTimer = setTimeout(() => {
            if (ws.readyState === ws.OPEN) {
                duplicateRetryCount = 0;
                console.log('Connection is stable.');

                if (verboseLogging) {
                    const connectedEmbed = new EmbedBuilder()
                        .setDescription(`${emojis.success} **Sol's Stat Tracker** - Connected`)
                        .setColor(colors.success);
                    linkedWebhookClient.send({ embeds: [connectedEmbed] });
                }
            }
        }, 10_000);
    });

    ws.on('message', (rawData) => {
        try {
            const data = JSON.parse(rawData.toString('utf8'));

            console.log('--- Incoming packet ---');
            console.log(JSON.stringify(data, null, 2));
            console.log('-----------------------');

            switch (data.action) {
                case 'enabled': {
                    const embed = new EmbedBuilder()
                        .setDescription(`${emojis.success} **Sol's Stat Tracker** - Enabled`)
                        .setColor(colors.success);
                    linkedWebhookClient.send({ embeds: [embed] });
                    break;
                }

                case 'disabled': {
                    const embed = new EmbedBuilder()
                        .setDescription(`${emojis.error} **Sol's Stat Tracker** - Disabled`)
                        .setColor(colors.error);
                    linkedWebhookClient.send({ embeds: [embed] });
                    break;
                }

                case 'executeWebhook': {
    const payload = data.data ?? {};
    const rawEmbeds = Array.isArray(payload.embeds) ? payload.embeds : [];
    const lines = (payload.content ?? '').split('\n').filter(l => l.trim());

    // ── Public channel — forward the raw payload exactly as the gateway sent it.
    // This preserves everything including transcendent auras, formatted embeds, etc.
    publicWebhookClient.send({
        username: overrideUsername ?? payload.username,
        avatarURL: overrideAvatarURL ?? payload.avatarURL,
        allowedMentions: { parse: [] },
        content: payload.content ?? undefined,
        embeds: rawEmbeds
    }).catch(err => console.error(`Public send error: ${err.message}`));

    // ── Linked channel — parse content lines for tracked users only.
    // Transcendent auras won't appear here since they aren't in payload.content,
    // but all standard globals will be filtered correctly.
    const linkedEmbeds = [];

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];
        const lineLower = line.toLowerCase();

        let username, displayName, aura, chanceStr, embedColor;
        let customMatched = false;

        const customAuras = {
            "pixelation":  { name: "▣ PIXELATION ▣",  chance: "1,073,741,824", color: 0x00FFCC, phrase: "has become pixelated"             },
            "luminosity": { name: "[ LUMINOSITY ]",   chance: "1,200,000,000", color: 0xFFFFFF, phrase: "the blinding light has devoured"   },
            "equinox":    { name: "『EQUINOX』",      chance: "2,500,000,000", color: 0xFF8C00, phrase: "between positive and"              },
            "leviathan":  { name: "LEVIATHAN",        chance: "1,730,400,000", color: 0x00008B, phrase: "has tamed the ruler of beneath"    },
            "glitch":     { name: "GLITCH",           chance: "12,210,110",    color: 0x8A2BE2, phrase: "error occured from"                },
            "nyctophobia":{ name: "NYCTOPHOBIA",      chance: "1,011,111,010", color: 0x1A1A1A, phrase: "experienced the literal nightmare" },
        };

        for (const [, entry] of Object.entries(customAuras)) {
            if (lineLower.includes(entry.phrase)) {
                const boldMatch = line.match(/\*\*(?:(.+?)\(@(.+?)\)|@(\S+?))\*\*/);
                if (!boldMatch) {
                    console.log(`Custom aura line missing bold username (skipping): ${line.slice(0, 80)}`);
                    break;
                }
                username    = boldMatch[2] || boldMatch[3];
                displayName = boldMatch[1] || `@${username}`;
                aura        = entry.name;
                chanceStr   = entry.chance;
                embedColor  = entry.color;
                customMatched = true;
                console.log(`Custom aura detected: ${aura} for ${username}`);
                break;
            }
        }

        if (!customMatched) {
            const m = line.match(
                /\*\*(?:(.+?)\(@(.+?)\)|@(\S+?))\*\*.*?(?:HAS FOUND|has found)\s+\*\*(.+?)\*\*.*?(?:CHANCE OF|chance of)\s+\*\*1 IN ([\d,]+)/i
            );
            if (!m) {
                console.log(`Unparseable line (skipping): ${line.slice(0, 80)}`);
                continue;
            }
            username    = m[2] || m[3];
            displayName = m[1] || `@${username}`;
            aura        = m[4];
            chanceStr   = m[5];
            embedColor  = null;
        }

        const isBT = lineLower.includes('breakthrough');
        const key = username.toLowerCase();
        const tracked = trackedRobloxUsers.get(key);

        if (!tracked) continue;

        const embedForLine = rawEmbeds[lineIdx];
        const rollsVal =
            embedForLine?.fields?.find(f => /rolls?/i.test(f.name))?.value
            ?? payload.rolls
            ?? payload.player?.rolls
            ?? 'N/A';
        const luckVal =
            embedForLine?.fields?.find(f => /luck/i.test(f.name))?.value
            ?? payload.luck
            ?? payload.player?.luck
            ?? 'N/A';

        totalRollsProcessed++;

        const trackedProfileURL = `https://www.roblox.com/users/${tracked.id}/profile`;

        console.log(`Tracked match: ${displayName} (@${username}, ID: ${tracked.id}) found ${aura}`);
        linkedEmbeds.push(
            new EmbedBuilder()
                .setDescription(
                    `✅ **Successfully tracked ${displayName} (${username} • ID: ${tracked.id})!**\n` +
                    `**${aura}** — 1 in ${chanceStr}${isBT ? '  🔥 **BREAKTHROUGH!**' : ''}\n` +
                    `Rolls: ${rollsVal}\n` +
                    `Luck: ${luckVal}\n` +
                    `[View Roblox Profile](${trackedProfileURL})`
                )
                .setTimestamp()
                .setColor(embedColor ?? (isBT ? colors.error : colors.success))
        );
    }

    if (linkedEmbeds.length > 0) {
        for (let i = 0; i < linkedEmbeds.length; i += 10) {
            linkedWebhookClient.send({
                username: overrideUsername ?? payload.username,
                avatarURL: overrideAvatarURL ?? payload.avatarURL,
                allowedMentions: { parse: [] },
                embeds: linkedEmbeds.slice(i, i + 10)
            }).catch(err => console.error(`Linked send error: ${err.message}`));
        }
    }

    console.log(`Packet processed: linked ${linkedEmbeds.length} tracked match(es).`);
    break;
}
                }

                default:
                    console.error(`WS client invalid action: ${data.action}`);
                    break;
            }
        } catch (error) {
            console.error(`WS client message error: ${error.message}`);
        }
    });

    ws.on('close', async (code, reason) => {
        if (activeWs === ws) activeWs = null;
        if (stableConnectionTimer) { clearTimeout(stableConnectionTimer); stableConnectionTimer = null; }
        reason = reason.toString('utf8');
        console.warn(`WS client disconnected: Code ${code}${reason ? ` - ${reason}` : ''}`);

        switch (code) {
            case 4001:
                console.error('The API token is missing.');
                if (verboseLogging) {
                    await linkedWebhookClient.send({ embeds: [new EmbedBuilder()
                        .setDescription(`${emojis.error} **Sol's Stat Tracker** - The API token is missing.`)
                        .setColor(colors.error)] });
                }
                return;

            case 4002:
                console.error('The API token is invalid.');
                if (verboseLogging) {
                    await linkedWebhookClient.send({ embeds: [new EmbedBuilder()
                        .setDescription(`${emojis.error} **Sol's Stat Tracker** - The API token is invalid.`)
                        .setColor(colors.error)] });
                }
                return;

            case 4004:
                console.error('The API token has been deleted.');
                if (verboseLogging) {
                    await linkedWebhookClient.send({ embeds: [new EmbedBuilder()
                        .setDescription(`${emojis.error} **Sol's Stat Tracker** - The API token has been deleted.`)
                        .setColor(colors.error)] });
                }
                return;

            case 4003: {
                // Silently retry with backoff — do NOT send a Discord message here,
                // as 4003 is a transient stale-session state that resolves on its own
                // and sending a message every retry floods the channel.
                duplicateRetryCount++;
                const delay = Math.min(maxReconnectInterval, 5_000 * duplicateRetryCount);
                console.warn(`API token already in-use (attempt ${duplicateRetryCount}). Retrying in ${delay}ms...`);
                setTimeout(connect, delay);
                return;
            }

            default:
                console.warn(`Reconnecting WS client in ${reconnectInterval}ms...`);
                if (verboseLogging) {
                    await linkedWebhookClient.send({ embeds: [new EmbedBuilder()
                        .setDescription(`${emojis.none} **Sol's Stat Tracker** - Reconnecting`)
                        .setColor(colors.none)] });
                }
                setTimeout(connect, reconnectInterval);
                reconnectInterval = Math.min(maxReconnectInterval, reconnectInterval * 2);
        }
    });

    ws.on('error', async (error) => {
        console.error(`WS client error: ${error.message}`);
        ws.terminate();
    });
};

// ── Startup ───────────────────────────────────────────────────────────────────
(async () => {
    if (killedOldProcess) {
        console.log('Waiting 3 s for old instance to fully disconnect...');
        await sleep(3_000);
    }

    loadTrackedUsers();

    bot.login(process.env.DISCORD_BOT_TOKEN).catch((err) => {
        console.error(`Bot login failed: ${err.message}`);
        process.exit(1);
    });

    connect();
})();
