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

                    // ── Public channel — forward raw payload exactly as gateway sent it.
                    // This preserves transcendent auras, formatted embeds, everything.
                    publicWebhookClient.send({
                        username:        overrideUsername  ?? payload.username,
                        avatarURL:       overrideAvatarURL ?? payload.avatarURL,
                        allowedMentions: { parse: [] },
                        content:         payload.content ?? undefined,
                        embeds:          rawEmbeds,
                    }).catch(err => console.error(`Public send error: ${err.message}`));

                    // ── Linked channel — extract data directly from each raw embed object.
                    // No regex text parsing; all fields come straight from embed structure.
                    const linkedEmbeds = [];

                    for (const rawEmbed of rawEmbeds) {
                        // ── 1. Extract username from the embed's author URL or author name.
                        //       The gateway consistently sets embed.author.url to the Roblox profile link,
                        //       e.g. https://www.roblox.com/users/12345/profile
                        //       Fall back to embed.author.name / embed.footer.text if url is absent.
                        let username = null;

                        const authorUrl = rawEmbed?.author?.url ?? '';
                        const userIdFromUrl = extractUserIdFromUrl(authorUrl);

                        if (userIdFromUrl) {
                            // Resolve username from our Map by matching stored id
                            const entry = [...trackedRobloxUsers.values()].find(u => u.id === userIdFromUrl);
                            if (entry) username = entry.name.toLowerCase();
                        }

                        if (!username) {
                            // Try embed.author.name — may be "DisplayName (@username)" or just "@username"
                            const authorName = rawEmbed?.author?.name ?? '';
                            const authorMatch = authorName.match(/@(\S+)/);
                            if (authorMatch) username = authorMatch[1].toLowerCase();
                        }

                        if (!username) {
                            // Last resort: scan footer text for a @handle
                            const footerText = rawEmbed?.footer?.text ?? '';
                            const footerMatch = footerText.match(/@(\S+)/);
                            if (footerMatch) username = footerMatch[1].toLowerCase();
                        }

                        if (!username) {
                            console.log('executeWebhook: could not extract username from embed — skipping.');
                            continue;
                        }

                        // ── 2. Check if this is a tracked user.
                        const tracked = trackedRobloxUsers.get(username);
                        if (!tracked) continue;

                        // ── 3. Build the clean profile link using the stored Roblox ID.
                        const profileURL = `https://www.roblox.com/users/profile?username=${tracked.name}`;

                        // ── 4. Pull aura name and chance from embed fields / description.
                        //       Field names vary ("Aura", "Roll", "Item", etc.) — check all.
                        const fields     = Array.isArray(rawEmbed.fields) ? rawEmbed.fields : [];
                        const auraField  = fields.find(f => /aura|item|roll(?!\s*s)/i.test(f.name));
                        const chanceField = fields.find(f => /chance|odds|probability/i.test(f.name));

                        // Attempt to pull a clean aura name from the embed title or aura field.
                        // If neither exist we fall back to the embed title, then raw description opening.
                        const auraName =
                            auraField?.value
                            ?? rawEmbed?.title
                            ?? (rawEmbed?.description ?? '').split('\n')[0]
                            ?? 'Unknown Aura';

                        const chanceStr =
                            chanceField?.value
                            ?? (() => {
                                // Try to parse "1 in X" from description as a fallback
                                const desc = rawEmbed?.description ?? '';
                                const m = desc.match(/1\s+in\s+([\d,]+)/i);
                                return m ? m[1] : 'N/A';
                            })();

                        // ── 5. Pull rolls / luck from embed fields.
                        const rollsVal =
                            fields.find(f => /rolls?/i.test(f.name))?.value
                            ?? payload.rolls
                            ?? payload.player?.rolls
                            ?? 'N/A';

                        const luckVal =
                            fields.find(f => /luck/i.test(f.name))?.value
                            ?? payload.luck
                            ?? payload.player?.luck
                            ?? 'N/A';

                        // ── 6. Detect breakthrough from embed description / title.
                        const embedText = `${rawEmbed?.title ?? ''} ${rawEmbed?.description ?? ''}`.toLowerCase();
                        const isBT      = embedText.includes('breakthrough');

                        // ── 7. Resolve display name (may differ from username).
                        const displayName =
                            rawEmbed?.author?.name?.replace(/\s*\(@.+?\)/, '').trim()
                            ?? `@${tracked.name}`;

                        // ── 8. Resolve embed colour — prefer the raw embed's own colour.
                        const embedColor =
                            rawEmbed?.color                          // already a number
                            ?? (isBT ? colors.error : colors.success);

                        totalRollsProcessed++;
                        console.log(`Tracked match: ${displayName} (@${tracked.name}, ID: ${tracked.id}) found ${auraName}`);

                        linkedEmbeds.push(
                            new EmbedBuilder()
                                .setDescription(
                                    `✅ **${displayName}** (@${tracked.name})\n` +
                                    `**${auraName}** — 1 in ${chanceStr}${isBT ? '  🔥 **BREAKTHROUGH!**' : ''}\n` +
                                    `🎲 Rolls: **${rollsVal}** · 🍀 Luck: **${luckVal}**\n` +
                                    `[View Roblox Profile](${profileURL})`
                                )
                                .setTimestamp()
                                .setColor(embedColor)
                        );
                    }

                    // ── Route linked embeds exclusively to the linked webhook; public
                    //    channel already received the full raw payload above.
                    if (linkedEmbeds.length > 0) {
                        for (let i = 0; i < linkedEmbeds.length; i += 10) {
                            linkedWebhookClient.send({
                                username:        overrideUsername  ?? payload.username,
                                avatarURL:       overrideAvatarURL ?? payload.avatarURL,
                                allowedMentions: { parse: [] },
                                embeds:          linkedEmbeds.slice(i, i + 10),
                            }).catch(err => console.error(`Linked send error: ${err.message}`));
                        }
                    }

                    console.log(`Packet processed: ${linkedEmbeds.length} linked match(es).`);
                    break;
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
