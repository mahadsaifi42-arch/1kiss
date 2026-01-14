/**
 * ✅ ULTIMATE DISCORD BOT FOR RENDER
 * Node.js v18+ | Discord.js v14 | SQLite | Gemini AI | Express Server
 */

require('dotenv').config();
const express = require('express');
const { 
    Client, GatewayIntentBits, Partials, Collection, 
    EmbedBuilder, PermissionsBitField, ChannelType, REST, Routes 
} = require('discord.js');
const Database = require('better-sqlite3');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Player } = require('discord-player');

// ==========================================
// 🌍 1. RENDER WEB SERVER (KEEP ALIVE)
// ==========================================
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('✅ Bot is Online and Running on Render!');
});

app.listen(port, () => {
    console.log(`🔗 Web Server listening on port ${port}`);
});

// ==========================================
// ⚙️ 2. CONFIGURATION & DATABASE
// ==========================================
// Note: Render Free Tier deletes SQLite files on restart. 
// For permanent data, use MongoDB in future.
const db = new Database('bot_database.sqlite');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildPresences
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

client.commands = new Collection();
const player = new Player(client);
const invitesCache = new Collection();
const confirmationCache = new Collection(); 
const raidCache = new Map();
let panicMode = false;

// Database Tables
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        invites INTEGER DEFAULT 0,
        messages INTEGER DEFAULT 0,
        invitedBy TEXT
    );
    CREATE TABLE IF NOT EXISTS settings (
        guild_id TEXT PRIMARY KEY,
        log_channel TEXT,
        welcome_channel TEXT,
        ai_channel TEXT
    );
    CREATE TABLE IF NOT EXISTS whitelist (
        id TEXT PRIMARY KEY
    );
`);

// ==========================================
// 🎶 3. MUSIC SYSTEM SETUP
// ==========================================
player.events.on('playerStart', (queue, track) => {
    queue.metadata.channel.send(`🎶 Now playing: **${track.title}**`);
});
player.events.on('error', (queue, error) => {
    console.log(`[Music Error] ${error.message}`);
});

// ==========================================
// 🛠️ 4. SLASH COMMANDS LIST
// ==========================================
const slashCommands = [
    { name: 'setup', description: 'Auto-configure channels and logs (Owner)' },
    { name: 'help', description: 'Show command list' },
    { name: 'ban', description: 'Ban a user', options: [{ name: 'user', type: 6, required: true }, { name: 'reason', type: 3 }] },
    { name: 'kick', description: 'Kick a user', options: [{ name: 'user', type: 6, required: true }, { name: 'reason', type: 3 }] },
    { name: 'timeout', description: 'Timeout a user', options: [{ name: 'user', type: 6, required: true }, { name: 'duration', type: 4, required: true }, { name: 'reason', type: 3 }] },
    { name: 'invites', description: 'Check invites', options: [{ name: 'user', type: 6 }] },
    { name: 'topmessages', description: 'Top active users' },
    { name: '8ball', description: 'Ask the magic ball', options: [{ name: 'question', type: 3, required: true }] },
    { name: 'play', description: 'Play music', options: [{ name: 'query', type: 3, required: true }] },
    { name: 'stop', description: 'Stop music' },
    { name: 'skip', description: 'Skip track' }
];

// ==========================================
// 🚀 5. INITIALIZATION
// ==========================================
client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} is Online!`);
    
    // Load Music Extractors
    await player.extractors.loadDefault();

    // Cache Invites
    client.guilds.cache.forEach(async guild => {
        try {
            const invites = await guild.invites.fetch();
            invites.each(inv => invitesCache.set(inv.code, inv.uses));
        } catch (e) {}
    });

    // Register Commands
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    try {
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: slashCommands });
        console.log('✅ Slash Commands Registered');
    } catch (error) {
        console.error(error);
    }
});

// ==========================================
// 🤖 6. AI & SYSTEM LOGIC
// ==========================================
async function handleAI(message) {
    if (!process.env.GEMINI_API_KEY) return message.reply("❌ API Key missing.");
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    try {
        const result = await model.generateContent(message.content);
        const response = result.response.text();
        if(response.length > 2000) {
            message.reply(response.substring(0, 1999));
        } else {
            message.reply(response);
        }
    } catch (error) {
        console.error("AI Error:", error);
        message.reply("Brain overload. Try again.");
    }
}

function logAction(guild, title, desc, color = 'Red') {
    try {
        const settings = db.prepare('SELECT log_channel FROM settings WHERE guild_id = ?').get(guild.id);
        if (!settings || !settings.log_channel) return;
        const channel = guild.channels.cache.get(settings.log_channel);
        if (channel) {
            const embed = new EmbedBuilder().setTitle(title).setDescription(desc).setColor(color).setTimestamp();
            channel.send({ embeds: [embed] }).catch(() => {});
        }
    } catch (e) {}
}

const checkRaid = (guild, type, executorId) => {
    if (executorId === process.env.OWNER_ID) return false;
    if (panicMode) return true;

    const key = `${guild.id}-${type}-${executorId}`;
    const now = Date.now();
    const data = raidCache.get(key) || { count: 0, time: now };

    if (now - data.time > 10000) { 
        data.count = 1;
        data.time = now;
    } else {
        data.count++;
    }
    raidCache.set(key, data);

    if (data.count > 5) {
        const member = guild.members.cache.get(executorId);
        if (member && member.bannable) {
            member.ban({ reason: 'Anti-Nuke: Rate Limit Exceeded' }).catch(() => {});
            logAction(guild, '🛡️ RAID DETECTED', `User <@${executorId}> banned for mass ${type}.`);
        }
        return true;
    }
    return false;
};

// ==========================================
// 📨 7. MESSAGE & OWNER COMMANDS
// ==========================================
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Tracker & DB
    db.prepare('INSERT OR IGNORE INTO users (id) VALUES (?)').run(message.author.id);
    db.prepare('UPDATE users SET messages = messages + 1 WHERE id = ?').run(message.author.id);

    // AI Check
    const settings = db.prepare('SELECT ai_channel FROM settings WHERE guild_id = ?').get(message.guild.id);
    if (settings && message.channel.id === settings.ai_channel && message.author.id === process.env.OWNER_ID) {
        await handleAI(message);
        return;
    }

    // Owner No-Prefix
    if (message.author.id === process.env.OWNER_ID) {
        const content = message.content.toLowerCase();
        
        // Confirmation
        if (confirmationCache.has(message.author.id)) {
            if (content === 'yes') {
                const action = confirmationCache.get(message.author.id);
                confirmationCache.delete(message.author.id);
                await action();
                return message.reply("✅ Executed.");
            } else {
                confirmationCache.delete(message.author.id);
                return message.reply("❌ Cancelled.");
            }
        }

        if (content === 'panic mode on') {
            panicMode = true;
            message.guild.channels.cache.forEach(c => c.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false }).catch(() => {}));
            message.reply("🚨 **PANIC MODE: SERVER LOCKED**");
        }
        else if (content === 'panic mode off') {
            panicMode = false;
            message.reply("✅ Panic Mode Disabled.");
        }
        else if (content === 'delete all empty channels') {
            message.reply("⚠️ **Confirm? Type YES.**");
            confirmationCache.set(message.author.id, async () => {
                message.guild.channels.cache.filter(c => c.type === ChannelType.GuildVoice && c.members.size === 0).forEach(c => c.delete().catch(()=> {}));
            });
        }
        else if (content === 'setup') {
            const guild = message.guild;
            const everyone = guild.roles.everyone;
            const modLog = await guild.channels.create({ name: 'mod-logs', type: ChannelType.GuildText, permissionOverwrites: [{ id: everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] }] });
            const aiChat = await guild.channels.create({ name: 'ai-chat', type: ChannelType.GuildText, permissionOverwrites: [{ id: everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] }, { id: message.author.id, allow: [PermissionsBitField.Flags.ViewChannel] }] });
            const welcome = await guild.channels.create({ name: 'welcome', type: ChannelType.GuildText });
            db.prepare('INSERT OR REPLACE INTO settings (guild_id, log_channel, welcome_channel, ai_channel) VALUES (?, ?, ?, ?)').run(guild.id, modLog.id, welcome.id, aiChat.id);
            message.reply("✅ **Setup Complete!**");
        }
    }
});

// ==========================================
// 🎮 8. INTERACTION HANDLER
// ==========================================
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, options } = interaction;

    if (commandName === '8ball') {
        const replies = ["Yes.", "No.", "Try later."];
        await interaction.reply(`🎱 **${replies[Math.floor(Math.random() * replies.length)]}**`);
    }
    if (commandName === 'invites') {
        const user = options.getUser('user') || interaction.user;
        const row = db.prepare('SELECT invites FROM users WHERE id = ?').get(user.id);
        await interaction.reply(`📈 **${user.username}** has **${row ? row.invites : 0}** invites.`);
    }
    if (commandName === 'play') {
        if (!interaction.member.voice.channel) return interaction.reply("❌ Join VC first!");
        await interaction.deferReply();
        try {
            await player.play(interaction.member.voice.channel, options.getString('query'), {
                nodeOptions: { metadata: { channel: interaction.channel } }
            });
            await interaction.editReply("🎵 Processing...");
        } catch (e) {
            await interaction.editReply(`❌ Error: ${e.message}`);
        }
    }
    if (commandName === 'stop') {
        const queue = player.nodes.get(interaction.guild);
        if(queue) queue.delete();
        await interaction.reply("⏹️ Stopped.");
    }
    if (commandName === 'ban') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.BanMembers)) return interaction.reply("❌ No perm.");
        const user = options.getUser('user');
        await interaction.guild.members.ban(user);
        await interaction.reply(`🔨 Banned ${user.tag}`);
        logAction(interaction.guild, 'User Banned', `Target: ${user.tag}`);
    }
});

// ==========================================
// 🕵️ 9. EVENTS (INVITES + ANTI-NUKE)
// ==========================================
client.on('guildMemberAdd', async member => {
    const newInvites = await member.guild.invites.fetch();
    const usedInvite = newInvites.find(inv => inv.uses > (invitesCache.get(inv.code) || 0));
    if (usedInvite) {
        invitesCache.set(usedInvite.code, usedInvite.uses);
        db.prepare('INSERT OR IGNORE INTO users (id) VALUES (?)').run(usedInvite.inviter.id);
        db.prepare('UPDATE users SET invites = invites + 1 WHERE id = ?').run(usedInvite.inviter.id);
        const settings = db.prepare('SELECT welcome_channel FROM settings WHERE guild_id = ?').get(member.guild.id);
        if (settings && settings.welcome_channel) {
            const channel = member.guild.channels.cache.get(settings.welcome_channel);