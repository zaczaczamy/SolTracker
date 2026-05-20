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

    // !preview [RobloxUsername]
    // Sends a sample linked-channel embed to the linked webhook so you can
    // verify the exact format before a real roll comes in.
    const previewMatch = content.match(/^!preview\s+(\S+)$/i);
    if (previewMatch) {
        const key = previewMatch[1].toLowerCase();
        const tracked = trackedRobloxUsers.get(key);
        if (!tracked) {
            message.reply(`**${previewMatch[1]}** is not in the tracked list. Use \`!link\` first.`);
            return;
        }

        const profileURL = `https://www.roblox.com/users/profile?username=${tracked.name}`;

        const previewEmbed = new EmbedBuilder()
            .setTitle('▣ PREVIEW AURA ▣')
            .setURL(profileURL)
            .setDescription(
                `**${tracked.name}** rolled an aura!\n` +
                `\n*(This is a preview — sample data only)*\n` +
                `\n[View Roblox Profile](${profileURL})`
            )
            .addFields(
                { name: 'Rolls',    value: '12,345',        inline: true },
                { name: 'Luck',     value: '2x',            inline: true },
                { name: 'Username', value: `@${tracked.name}`, inline: true }
            )
            .setColor(colors.success)
            .setFooter({ text: `Roblox ID: ${tracked.id}` })
            .setTimestamp();

        try {
            await linkedWebhookClient.send({
                username: overrideUsername,
                avatarURL: overrideAvatarURL,
                allowedMentions: { parse: [] },
                embeds: [previewEmbed]
            });
            message.reply(`Preview sent to the linked channel for **${tracked.name}**.`);
            console.log(`Preview embed sent for tracked user: ${tracked.name} (ID: ${tracked.id})`);
        } catch (err) {
            console.error(`Preview send failed: ${err.message}`);
            message.reply(`Failed to send preview: ${err.message}`);
        }
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

/**
 * Extracts the Roblox username directly from a Discord embed object.
 *
 * Priority order:
 *  1. embed.author.name  — e.g. "DisplayName (@Username)" or "@Username" or "Username"
 *  2. embed.author.url   — e.g. https://www.roblox.com/users/profile?username=Username
 *  3. embed.url          — same format as above
 *  4. embed.description  — bold mention pattern: **DisplayName (@Username)** or **@Username**
 *  5. embed.fields       — a field whose name is "player", "user", or "username"
 *
 * Returns the raw username string, or null if nothing was found.
 */
const extractUsernameFromEmbed = (embed) => {
    // Diagnostic snapshot — logged on every call so you can verify the real
    // gateway payload structure on first live use without guessing.
    console.log('[embed fields] title:', embed.title ?? '(none)');
    console.log('[embed fields] author.name:', embed.author?.name ?? '(none)');
    console.log('[embed fields] author.url:', embed.author?.url ?? '(none)');
    console.log('[embed fields] embed.url:', embed.url ?? '(none)');
    console.log('[embed fields] description (first 80 chars):', (embed.description ?? '(none)').slice(0, 80));
    console.log('[embed fields] field names:', (embed.fields ?? []).map(f => f.name).join(', ') || '(none)');

    // 1. author.name — "DisplayName (@Username)", "@Username", or plain "Username"
    if (embed.author?.name) {
        const parenMatch = embed.author.name.match(/\(@?([A-Za-z0-9_]+)\)\s*$/);
        if (parenMatch) { console.log('[username source] author.name (paren):', parenMatch[1]); return parenMatch[1]; }
        const atMatch = embed.author.name.match(/^@([A-Za-z0-9_]+)/);
        if (atMatch) { console.log('[username source] author.name (@prefix):', atMatch[1]); return atMatch[1]; }
        const plainMatch = embed.author.name.match(/^([A-Za-z0-9_]{3,20})$/);
        if (plainMatch) { console.log('[username source] author.name (plain):', plainMatch[1]); return plainMatch[1]; }
        console.log('[username source] author.name present but no pattern matched:', embed.author.name);
    }

    // 2. author.url — ?username=Username query param
    if (embed.author?.url) {
        const urlMatch = embed.author.url.match(/[?&]username=([^&\s]+)/i);
        if (urlMatch) { console.log('[username source] author.url query param:', urlMatch[1]); return decodeURIComponent(urlMatch[1]); }
        console.log('[username source] author.url present but no ?username= param:', embed.author.url);
    }

    // 3. embed.url — same format
    if (embed.url) {
        const urlMatch = embed.url.match(/[?&]username=([^&\s]+)/i);
        if (urlMatch) { console.log('[username source] embed.url query param:', urlMatch[1]); return decodeURIComponent(urlMatch[1]); }
        console.log('[username source] embed.url present but no ?username= param:', embed.url);
    }

    // 4. embed.description — bold username mention patterns
    if (embed.description) {
        const m = embed.description.match(/\*\*(?:[^*]+?\(@?([A-Za-z0-9_]+)\)|@([A-Za-z0-9_]+))\*\*/);
        if (m) { const u = m[1] ?? m[2]; console.log('[username source] description bold pattern:', u); return u; }
        console.log('[username source] description present but bold pattern did not match');
    }

    // 5. A field explicitly named "player", "user", or "username"
    if (Array.isArray(embed.fields)) {
        const playerField = embed.fields.find(f => /^(player|user|username)$/i.test(f.name));
        if (playerField?.value) {
            const u = playerField.value.replace(/^@/, '').trim();
            console.log('[username source] named field "' + playerField.name + '":', u);
            return u;
        }
    }

    console.log('[username source] FAILED — no username found in embed. Full embed dump:', JSON.stringify(embed));
    return null;
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

                    // ── Public channel — forward the entire raw payload exactly as the
                    // gateway sent it. Preserves transcendental auras, formatted embeds,
                    // custom fields, colours — everything. No transformation applied.
                    publicWebhookClient.send({
                        username: overrideUsername ?? payload.username,
                        avatarURL: overrideAvatarURL ?? payload.avatarURL,
                        allowedMentions: { parse: [] },
                        content: payload.content ?? undefined,
                        embeds: rawEmbeds
                    }).catch(err => console.error(`Public send error: ${err.message}`));

                    // ── Linked channel — one clean custom embed per tracked user.
                    // Username is extracted directly from the embed object (no regex
                    // against content lines). Each match produces exactly one new embed
                    // sent only to the linked channel; the public channel is not
                    // double-notified.
                    const linkedEmbeds = [];

                    for (const embed of rawEmbeds) {
                        // Step 1 — pull the username straight out of the embed object
                        const username = extractUsernameFromEmbed(embed);

                        if (!username) {
                            console.log('Could not extract username from embed — skipping.');
                            continue;
                        }

                        // Step 2 — check the trackedRobloxUsers Map (lowercase key)
                        const key = username.toLowerCase();
                        const tracked = trackedRobloxUsers.get(key);

                        if (!tracked) continue;

                        // Step 3 — build the standard Roblox profile link by username
                        const profileURL = `https://www.roblox.com/users/profile?username=${username}`;

                        // Step 4 — pull aura info and stats directly from the embed fields
                        const auraName = embed.title
                            ?? embed.description?.match(/\*\*(.+?)\*\*/)?.[1]
                            ?? 'Unknown Aura';
                        const auraDesc = embed.description ?? null;
                        const rollsVal = embed.fields?.find(f => /rolls?/i.test(f.name))?.value ?? 'N/A';
                        const luckVal  = embed.fields?.find(f => /luck/i.test(f.name))?.value  ?? 'N/A';
                        const embedColor = embed.color ?? colors.success;
                        const thumbnailURL = embed.thumbnail?.url ?? embed.image?.url ?? null;

                        totalRollsProcessed++;

                        console.log(
                            `Tracked match: ${username} (ID: ${tracked.id}) | Aura: ${auraName} | ` +
                            `Rolls: ${rollsVal} | Luck: ${luckVal} | Profile: ${profileURL}`
                        );

                        // Step 5 — build a single clean embed for this user with all
                        // relevant data. One embed per tracked roll; no bulk forwarding.
                        const customEmbed = new EmbedBuilder()
                            .setTitle(auraName)
                            .setURL(profileURL)
                            .setDescription(
                                `**${tracked.name}** rolled an aura!\n` +
                                (auraDesc ? `\n${auraDesc}\n` : '') +
                                `\n[View Roblox Profile](${profileURL})`
                            )
                            .addFields(
                                { name: 'Rolls',    value: String(rollsVal), inline: true },
                                { name: 'Luck',     value: String(luckVal),  inline: true },
                                { name: 'Username', value: `@${username}`,   inline: true }
                            )
                            .setColor(embedColor)
                            .setTimestamp();

                        if (thumbnailURL) customEmbed.setThumbnail(thumbnailURL);

                        linkedEmbeds.push(customEmbed);
                    }

                    // Send each tracked-user embed individually so the linked channel
                    // never receives a bulk pile of unrelated rolls (Discord limit: 10).
                    for (const linkedEmbed of linkedEmbeds) {
                        linkedWebhookClient.send({
                            username: overrideUsername ?? payload.username,
                            avatarURL: overrideAvatarURL ?? payload.avatarURL,
                            allowedMentions: { parse: [] },
                            embeds: [linkedEmbed]
                        }).catch(err => console.error(`Linked send error: ${err.message}`));
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
