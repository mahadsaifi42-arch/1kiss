/**
 * Questy Final MultiBot - One File
 * Prefix: $ (normal users)
 * Whitelist users: can use commands WITHOUT prefix
 * Features:
 * - ban, unban
 * - mute, unmute
 * - lock, unlock
 * - purge
 * - whitelist system (ban/mute/prefixless/spam/advertise)
 * - AFK (no auto replies on normal messages)
 * - Embeds: Black Color
 */

const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  EmbedBuilder,
} = require("discord.js");

require("dotenv").config();

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const PREFIX = process.env.PREFIX || "$";
const PORT = process.env.PORT || 10000;

if (!DISCORD_TOKEN) throw new Error("❌ Missing DISCORD_TOKEN in env");

const express = require("express");
const app = express();
app.get("/", (req, res) => res.send("Questy Final MultiBot running ✅"));
app.listen(PORT, () => console.log(`🌐 Web alive on port ${PORT}`));

// ======= EMOJIS (FIXED) =======
const EMOJI = {
  ok: "<a:TICK_TICK:1214893859151286272>",
  no: "<a:4NDS_wrong:1458407390419615756>",
  lock: "<a:lock_keyggchillhaven:1307838252568412202>",
  music: "<a:Music:1438190819512422447>",
  headphones: "<:0041_headphones:1443333046823813151>",
  q: "<a:question:1264568031019925545>",
};

// ======= EMBED STYLE (BLACK) =======
const EMBED_COLOR = 0x000000;

function makeEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(title || " ")
    .setDescription(description || " ");
}

// ======= SIMPLE DB (in-memory) =======
// NOTE: Render restart pe reset ho jayega (free plan)
const WL = {
  ban: new Set(),
  mute: new Set(),
  prefixless: new Set(),
  advertise: new Set(),
  spam: new Set(),
};

const AFK = new Map(); // userId => { reason, since }

// ======= CLIENT =======
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ======= HELP TEXT =======
function helpText() {
  return `
${EMOJI.q} **Commands**
**Prefix:** \`${PREFIX}\`

**Moderation**
• \`${PREFIX}ban @user [reason]\`
• \`${PREFIX}unban userId\`
• \`${PREFIX}mute @user [time] [reason]\` (example: 10m, 1h)
• \`${PREFIX}unmute @user\`

**Channel**
• \`${PREFIX}lock\`
• \`${PREFIX}unlock\`

**Utility**
• \`${PREFIX}purge <amount>\`
• \`${PREFIX}ping\`

**AFK**
• \`${PREFIX}afk [reason]\`

**Whitelist (Admins/Owner only)**
• \`${PREFIX}wl add <ban|mute|prefixless|advertise|spam> @user\`
• \`${PREFIX}wl remove <ban|mute|prefixless|advertise|spam> @user\`
• \`${PREFIX}wl list\`

${EMOJI.ok} **Whitelist Users** can run these WITHOUT prefix:
\`ban mute unmute lock unlock purge\`
`;
}

// ======= UTILS =======
function isAdmin(member) {
  return member.permissions.has(PermissionsBitField.Flags.Administrator);
}

function isOwner(member) {
  return member.id === member.guild.ownerId;
}

function canManageWL(member) {
  return isAdmin(member) || isOwner(member);
}

function parseDuration(str) {
  // 10m, 1h, 2d
  if (!str) return null;
  const match = str.toLowerCase().match(/^(\d+)(s|m|h|d)$/);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  const unit = match[2];
  const mult = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[unit];
  return num * mult;
}

function formatSince(ms) {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  return `${day}d`;
}

function getMentionedUser(message) {
  return message.mentions.users.first() || null;
}

function getWLType(type) {
  if (!type) return null;
  const t = type.toLowerCase();
  if (!["ban", "mute", "prefixless", "advertise", "spam"].includes(t)) return null;
  return t;
}

function hasWL(member, type) {
  if (!type) return false;
  return WL[type]?.has(member.id);
}

// ======= COMMAND HANDLER =======
client.on("messageCreate", async (message) => {
  try {
    if (!message.guild) return;
    if (message.author.bot) return;

    const content = message.content.trim();
    const lower = content.toLowerCase();

    // ===== AFK REMOVE ON MESSAGE (XLARE STYLE: only remove, no spam replies) =====
    if (AFK.has(message.author.id)) {
      AFK.delete(message.author.id);

      // small xlare style embed
      const emb = makeEmbed(
        `${EMOJI.ok} Welcome back!`,
        `I removed your AFK. You were AFK since a few seconds ago.`
      );
      await message.reply({ embeds: [emb] }).catch(() => {});
      // Continue command handling too
    }

    // ===== Detect if message is a command =====
    // 1) Normal prefix command
    const isPrefixCmd = content.startsWith(PREFIX);

    // 2) Prefixless command ONLY for whitelist users (prefixless WL)
    // Allowed prefixless commands: ban mute unmute lock unlock purge
    const prefixlessAllowed = ["ban", "mute", "unmute", "lock", "unlock", "purge"];

    const firstWord = content.split(/\s+/)[0].toLowerCase();
    const isPrefixlessCmd =
      prefixlessAllowed.includes(firstWord) && hasWL(message.member, "prefixless");

    // If not command => DO NOTHING (no "Unknown command" spam)
    if (!isPrefixCmd && !isPrefixlessCmd) return;

    // ===== Parse args =====
    let cmd = "";
    let args = [];

    if (isPrefixCmd) {
      const sliced = content.slice(PREFIX.length).trim();
      if (!sliced) return;
      args = sliced.split(/\s+/);
      cmd = args.shift()?.toLowerCase();
    } else {
      // prefixless
      args = content.split(/\s+/);
      cmd = args.shift()?.toLowerCase();
    }

    if (!cmd) return;

    // ===== COMMANDS =====
    // ping
    if (cmd === "ping") {
      const emb = makeEmbed(`${EMOJI.ok} Pong!`, `Latency: **${client.ws.ping}ms**`);
      return message.reply({ embeds: [emb] });
    }

    // help
    if (cmd === "help") {
      const emb = makeEmbed(`${EMOJI.q} Help`, helpText());
      return message.reply({ embeds: [emb] });
    }

    // afk
    if (cmd === "afk") {
      const reason = args.join(" ").trim() || "AFK";
      AFK.set(message.author.id, { reason, since: Date.now() });

      const emb = makeEmbed(
        `${EMOJI.ok} AFK Enabled`,
        `**Reason:** ${reason}\n**Set by:** <@${message.author.id}>`
      );
      return message.reply({ embeds: [emb] });
    }

    // whitelist commands
    if (cmd === "wl") {
      if (!canManageWL(message.member)) {
        const emb = makeEmbed(
          `${EMOJI.no} No Permission`,
          `Only **Admins/Owner** can manage whitelist.`
        );
        return message.reply({ embeds: [emb] });
      }

      const action = args[0]?.toLowerCase();
      if (!action || !["add", "remove", "list"].includes(action)) {
        const emb = makeEmbed(
          `${EMOJI.q} Whitelist`,
          `Usage:\n\`${PREFIX}wl add <ban|mute|prefixless|advertise|spam> @user\`\n\`${PREFIX}wl remove <type> @user\`\n\`${PREFIX}wl list\``
        );
        return message.reply({ embeds: [emb] });
      }

      if (action === "list") {
        const emb = makeEmbed(
          `${EMOJI.q} Whitelist List`,
          `**Ban WL:** ${WL.ban.size}\n**Mute WL:** ${WL.mute.size}\n**Prefixless WL:** ${WL.prefixless.size}\n**Advertise WL:** ${WL.advertise.size}\n**Spam WL:** ${WL.spam.size}`
        );
        return message.reply({ embeds: [emb] });
      }

      const type = getWLType(args[1]);
      const user = getMentionedUser(message);

      if (!type) {
        const emb = makeEmbed(
          `${EMOJI.no} Invalid Type`,
          `Valid types: \`ban mute prefixless advertise spam\``
        );
        return message.reply({ embeds: [emb] });
      }

      if (!user) {
        const emb = makeEmbed(
          `${EMOJI.no} Invalid User`,
          `You didn't provide a valid user.\nExample: \`${PREFIX}wl ${action} ${type} @user\``
        );
        return message.reply({ embeds: [emb] });
      }

      if (action === "add") {
        WL[type].add(user.id);
        const emb = makeEmbed(
          `${EMOJI.ok} Whitelisted`,
          `${EMOJI.ok} Added <@${user.id}> to **${type}** whitelist.`
        );
        return message.reply({ embeds: [emb] });
      }

      if (action === "remove") {
        WL[type].delete(user.id);
        const emb = makeEmbed(
          `${EMOJI.ok} Removed`,
          `${EMOJI.ok} Removed <@${user.id}> from **${type}** whitelist.`
        );
        return message.reply({ embeds: [emb] });
      }
    }

    // ===== LOCK / UNLOCK =====
    if (cmd === "lock" || cmd === "unlock") {
      // Permission check: Admin OR WL.lock? (we use ban WL or mute WL? -> keep admin)
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
        const emb = makeEmbed(
          `${EMOJI.no} No Permission`,
          `You need **Manage Channels** permission.`
        );
        return message.reply({ embeds: [emb] });
      }

      const channel = message.channel;

      if (cmd === "lock") {
        await channel.permissionOverwrites.edit(message.guild.roles.everyone, {
          SendMessages: false,
        });

        const emb = makeEmbed(
          `${EMOJI.lock} Locked`,
          `${EMOJI.lock} Channel locked successfully.`
        );
        return message.reply({ embeds: [emb] });
      }

      if (cmd === "unlock") {
        await channel.permissionOverwrites.edit(message.guild.roles.everyone, {
          SendMessages: true,
        });

        const emb = makeEmbed(
          `${EMOJI.ok} Unlocked`,
          `${EMOJI.ok} Channel unlocked successfully.`
        );
        return message.reply({ embeds: [emb] });
      }
    }

    // ===== PURGE =====
    if (cmd === "purge") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        const emb = makeEmbed(
          `${EMOJI.no} No Permission`,
          `You need **Manage Messages** permission.`
        );
        return message.reply({ embeds: [emb] });
      }

      const amount = parseInt(args[0], 10);
      if (!amount || amount < 1 || amount > 100) {
        const emb = makeEmbed(
          `${EMOJI.no} Invalid Amount`,
          `Usage: \`${PREFIX}purge 10\`\nMin: 1 | Max: 100`
        );
        return message.reply({ embeds: [emb] });
      }

      await message.channel.bulkDelete(amount, true).catch(() => {});
      const emb = makeEmbed(
        `${EMOJI.ok} Purged`,
        `${EMOJI.ok} Deleted **${amount}** messages.`
      );
      return message.channel.send({ embeds: [emb] }).then((m) => {
        setTimeout(() => m.delete().catch(() => {}), 3000);
      });
    }

    // ===== BAN / UNBAN =====
    if (cmd === "ban") {
      // if prefixless used => only WL.prefixless allowed already
      // but still check actual permission:
      if (!message.member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
        const emb = makeEmbed(
          `${EMOJI.no} No Permission`,
          `You need **Ban Members** permission.`
        );
        return message.reply({ embeds: [emb] });
      }

      const user = getMentionedUser(message);
      if (!user) {
        const emb = makeEmbed(
          `${EMOJI.no} Invalid User`,
          `You didn't provide a valid user.\nUsage: \`${PREFIX}ban @user reason\``
        );
        return message.reply({ embeds: [emb] });
      }

      const reason = args.slice(1).join(" ") || "No reason";
      const member = await message.guild.members.fetch(user.id).catch(() => null);

      if (member && !member.bannable) {
        const emb = makeEmbed(
          `${EMOJI.no} Can't Ban`,
          `I can't ban this user (role higher / missing permission).`
        );
        return message.reply({ embeds: [emb] });
      }

      await message.guild.members.ban(user.id, { reason }).catch(() => {});
      const emb = makeEmbed(
        `${EMOJI.ok} Banned`,
        `${EMOJI.ok} **${user.tag}** was banned.\n**Reason:** ${reason}`
      );
      return message.reply({ embeds: [emb] });
    }

    if (cmd === "unban") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
        const emb = makeEmbed(
          `${EMOJI.no} No Permission`,
          `You need **Ban Members** permission.`
        );
        return message.reply({ embeds: [emb] });
      }

      const userId = args[0];
      if (!userId || isNaN(userId)) {
        const emb = makeEmbed(
          `${EMOJI.no} Invalid User`,
          `Usage: \`${PREFIX}unban userId\``
        );
        return message.reply({ embeds: [emb] });
      }

      await message.guild.members.unban(userId).catch(() => {});
      const emb = makeEmbed(
        `${EMOJI.ok} Unbanned`,
        `${EMOJI.ok} Unbanned **${userId}**`
      );
      return message.reply({ embeds: [emb] });
    }

    // ===== MUTE / UNMUTE =====
    if (cmd === "mute") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        const emb = makeEmbed(
          `${EMOJI.no} No Permission`,
          `You need **Timeout Members** permission.`
        );
        return message.reply({ embeds: [emb] });
      }

      const user = getMentionedUser(message);
      if (!user) {
        const emb = makeEmbed(
          `${EMOJI.no} Invalid User`,
          `You didn't provide a valid user.\nUsage: \`${PREFIX}mute @user 10m reason\``
        );
        return message.reply({ embeds: [emb] });
      }

      const member = await message.guild.members.fetch(user.id).catch(() => null);
      if (!member) {
        const emb = makeEmbed(`${EMOJI.no} Error`, `User not found in server.`);
        return message.reply({ embeds: [emb] });
      }

      const duration = parseDuration(args[1]) || 10 * 60 * 1000; // default 10m
      const reason = args.slice(2).join(" ") || "No reason";

      await member.timeout(duration, reason).catch(() => {});
      const emb = makeEmbed(
        `${EMOJI.ok} Muted`,
        `${EMOJI.ok} Muted <@${member.id}> for **${formatSince(duration)}**\n**Reason:** ${reason}`
      );
      return message.reply({ embeds: [emb] });
    }

    if (cmd === "unmute") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        const emb = makeEmbed(
          `${EMOJI.no} No Permission`,
          `You need **Timeout Members** permission.`
        );
        return message.reply({ embeds: [emb] });
      }

      const user = getMentionedUser(message);
      if (!user) {
        const emb = makeEmbed(
          `${EMOJI.no} Invalid User`,
          `Usage: \`${PREFIX}unmute @user\``
        );
        return message.reply({ embeds: [emb] });
      }

      const member = await message.guild.members.fetch(user.id).catch(() => null);
      if (!member) {
        const emb = makeEmbed(`${EMOJI.no} Error`, `User not found in server.`);
        return message.reply({ embeds: [emb] });
      }

      await member.timeout(null).catch(() => {});
      const emb = makeEmbed(
        `${EMOJI.ok} Unmuted`,
        `${EMOJI.ok} Unmuted <@${member.id}> successfully.`
      );
      return message.reply({ embeds: [emb] });
    }

    // Unknown command => NO REPLY (silent)
    return;
  } catch (err) {
    console.log("messageCreate error:", err);

    const emb = makeEmbed(
      `${EMOJI.no} Error`,
      `Something went wrong.\n\`\`\`${String(err).slice(0, 1500)}\`\`\``
    );

    return message.reply({ embeds: [emb] }).catch(() => {});
  }
});

client.login(DISCORD_TOKEN);
