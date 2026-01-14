/**
 * Questy Final MultiBot - index.js
 * Prefix: from env PREFIX (default $)
 * Whitelist users can run commands WITHOUT prefix:
 * ban, unban, mute, unmute, lock, unlock, purge, afk
 */

require("dotenv").config();
const express = require("express");
const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  EmbedBuilder,
} = require("discord.js");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
if (!DISCORD_TOKEN) throw new Error("❌ Missing DISCORD_TOKEN in env");

const PREFIX = process.env.PREFIX || "$";
const PORT = process.env.PORT || 10000;

// ====== Emojis (Your IDs) ======
const EMOJI = {
  ok: "<a:TICK_TICK:1214893859151286272>",
  no: "<a:4NDS_wrong:1458407390419615756>",
  lock: "<a:lock_keyggchillhaven:1307838252568412202>",
  music: "<a:Music:1438190819512422447>",
  headphones: "<:0041_headphones:1443333046823813151>",
  q: "<a:question:1264568031019925545>",
};

// ====== Simple In-Memory DB (resets on restart) ======
const whitelist = {
  // userId: { ban:true, mute:true, lock:true, unlock:true, purge:true, prefixless:true }
};
const afkMap = new Map(); // userId -> { reason, since }

function now() {
  return Date.now();
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);

  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function xlareEmbed(type, title, desc) {
  const color =
    type === "ok" ? 0x2ecc71 : type === "warn" ? 0xf1c40f : 0xe74c3c;

  return new EmbedBuilder()
    .setColor(color)
    .setDescription(desc)
    .setFooter({ text: title || "1Love" });
}

function getUserWL(userId) {
  return whitelist[userId] || {};
}

function isOwner(member) {
  return member?.id === member?.guild?.ownerId;
}

function isAdmin(member) {
  return (
    member?.permissions?.has(PermissionsBitField.Flags.Administrator) ||
    isOwner(member)
  );
}

function hasWL(member, permKey) {
  if (!member) return false;
  if (isAdmin(member)) return true; // Admin/Owner always allowed
  const wl = getUserWL(member.id);
  return wl?.[permKey] === true;
}

// ====== Discord Client ======
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User],
});

// ====== Render Keep Alive ======
const app = express();
app.get("/", (req, res) => res.send("1Love Bot is running ✅"));
app.listen(PORT, () => console.log(`🌐 Web alive on port ${PORT}`));

// ====== Command Helpers ======
function parseArgs(content) {
  return content.trim().split(/\s+/);
}

function cleanMentionToId(str) {
  if (!str) return null;
  const m = str.match(/^<@!?(\d+)>$/);
  if (m) return m[1];
  if (/^\d+$/.test(str)) return str;
  return null;
}

async function safeReply(message, embed) {
  try {
    return await message.reply({ embeds: [embed] });
  } catch {
    try {
      return await message.channel.send({ embeds: [embed] });
    } catch {}
  }
}

// ====== Core Actions ======
async function doLock(channel) {
  await channel.permissionOverwrites.edit(channel.guild.roles.everyone, {
    SendMessages: false,
  });
}

async function doUnlock(channel) {
  await channel.permissionOverwrites.edit(channel.guild.roles.everyone, {
    SendMessages: null,
  });
}

// ====== Message Handler ======
client.on("messageCreate", async (message) => {
  try {
    if (!message.guild) return;
    if (message.author.bot) return;

    const member = message.member;

    // ---- AFK remove when user sends message (only if they were AFK) ----
    if (afkMap.has(message.author.id)) {
      afkMap.delete(message.author.id);
      const emb = xlareEmbed(
        "ok",
        "AFK Removed",
        `${EMOJI.ok} Welcome back! I removed your afk.`
      );
      await safeReply(message, emb);
      // continue, but don't block command processing
    }

    // ---- AFK notify when someone mentions AFK user ----
    if (message.mentions.users.size > 0) {
      for (const [id] of message.mentions.users) {
        if (afkMap.has(id)) {
          const afk = afkMap.get(id);
          const since = formatDuration(now() - afk.since);
          const emb = xlareEmbed(
            "warn",
            "AFK",
            `${EMOJI.q} <@${id}> is AFK\n**Reason:** ${afk.reason}\n**Since:** ${since} ago`
          );
          await safeReply(message, emb);
          break;
        }
      }
    }

    // ====== Determine if it's a command ======
    const content = message.content.trim();

    const isPrefixed = content.startsWith(PREFIX);
    const lower = content.toLowerCase();

    // without prefix command allowed list
    const noPrefixCommands = [
      "ban",
      "unban",
      "mute",
      "unmute",
      "lock",
      "unlock",
      "purge",
      "afk",
      "wl",
      "help",
      "ping",
    ];

    let cmdText = null;

    if (isPrefixed) {
      cmdText = content.slice(PREFIX.length).trim();
    } else {
      // only allow without prefix if user is whitelisted (prefixless) OR admin
      const firstWord = parseArgs(content)[0]?.toLowerCase();
      if (
        noPrefixCommands.includes(firstWord) &&
        (hasWL(member, "prefixless") || isAdmin(member))
      ) {
        cmdText = content;
      } else {
        // IMPORTANT: no reply on normal messages
        return;
      }
    }

    if (!cmdText) return;

    const parts = parseArgs(cmdText);
    const cmd = parts.shift()?.toLowerCase();

    // ====== Commands ======

    // PING
    if (cmd === "ping") {
      const emb = xlareEmbed(
        "ok",
        "Ping",
        `${EMOJI.ok} Pong! **${client.ws.ping}ms**`
      );
      return safeReply(message, emb);
    }

    // HELP
    if (cmd === "help") {
      const emb = xlareEmbed(
        "ok",
        "Help",
        `${EMOJI.ok} **Commands**\n` +
          `\`${PREFIX}ping\`\n` +
          `\`${PREFIX}lock\` / \`${PREFIX}unlock\`\n` +
          `\`${PREFIX}ban @user [reason]\`\n` +
          `\`${PREFIX}mute @user [minutes]\`\n` +
          `\`${PREFIX}unmute @user\`\n` +
          `\`${PREFIX}purge <count>\`\n` +
          `\`${PREFIX}afk [reason]\`\n\n` +
          `**Whitelist (Admin only):**\n` +
          `\`${PREFIX}wl add @user <ban|mute|lock|unlock|purge|prefixless>\`\n` +
          `\`${PREFIX}wl remove @user <perm>\`\n` +
          `\`${PREFIX}wl list @user\``
      );
      return safeReply(message, emb);
    }

    // WHITELIST
    if (cmd === "wl") {
      if (!isAdmin(member)) {
        const emb = xlareEmbed(
          "err",
          "No Permission",
          `${EMOJI.no} Only **Admins/Owner** can manage whitelist.`
        );
        return safeReply(message, emb);
      }

      const sub = (parts.shift() || "").toLowerCase();
      const userArg = parts.shift();
      const perm = (parts.shift() || "").toLowerCase();

      const userId = cleanMentionToId(userArg);
      if (!sub || !userId) {
        const emb = xlareEmbed(
          "warn",
          "Whitelist",
          `${EMOJI.q} Usage:\n` +
            `\`${PREFIX}wl add @user ban\`\n` +
            `\`${PREFIX}wl remove @user ban\`\n` +
            `\`${PREFIX}wl list @user\`\n\n` +
            `Perms: ban, mute, lock, unlock, purge, prefixless`
        );
        return safeReply(message, emb);
      }

      whitelist[userId] = whitelist[userId] || {};

      if (sub === "add") {
        if (!perm) {
          const emb = xlareEmbed(
            "warn",
            "Whitelist",
            `${EMOJI.q} Choose a permission:\n**ban / mute / lock / unlock / purge / prefixless**`
          );
          return safeReply(message, emb);
        }
        whitelist[userId][perm] = true;

        const emb = xlareEmbed(
          "ok",
          "Whitelist Added",
          `${EMOJI.ok} Added **${perm}** whitelist for <@${userId}>`
        );
        return safeReply(message, emb);
      }

      if (sub === "remove") {
        if (!perm) {
          const emb = xlareEmbed(
            "warn",
            "Whitelist",
            `${EMOJI.q} Choose a permission to remove.`
          );
          return safeReply(message, emb);
        }
        whitelist[userId][perm] = false;

        const emb = xlareEmbed(
          "ok",
          "Whitelist Removed",
          `${EMOJI.ok} Removed **${perm}** whitelist for <@${userId}>`
        );
        return safeReply(message, emb);
      }

      if (sub === "list") {
        const wl = getUserWL(userId);
        const list = Object.keys(wl)
          .filter((k) => wl[k] === true)
          .map((k) => `• ${k}`)
          .join("\n");

        const emb = xlareEmbed(
          "ok",
          "Whitelist List",
          `${EMOJI.ok} <@${userId}> whitelist:\n${list || "• none"}`
        );
        return safeReply(message, emb);
      }

      const emb = xlareEmbed(
        "warn",
        "Whitelist",
        `${EMOJI.q} Unknown subcommand. Use \`${PREFIX}wl add/remove/list\``
      );
      return safeReply(message, emb);
    }

    // LOCK
    if (cmd === "lock") {
      if (!hasWL(member, "lock")) {
        const emb = xlareEmbed(
          "err",
          "No Permission",
          `${EMOJI.no} You are not whitelisted for **lock**.`
        );
        return safeReply(message, emb);
      }

      await doLock(message.channel);
      const emb = xlareEmbed(
        "ok",
        "Locked",
        `${EMOJI.lock} Channel locked successfully.`
      );
      return safeReply(message, emb);
    }

    // UNLOCK
    if (cmd === "unlock") {
      if (!hasWL(member, "unlock")) {
        const emb = xlareEmbed(
          "err",
          "No Permission",
          `${EMOJI.no} You are not whitelisted for **unlock**.`
        );
        return safeReply(message, emb);
      }

      await doUnlock(message.channel);
      const emb = xlareEmbed(
        "ok",
        "Unlocked",
        `${EMOJI.ok} Channel unlocked successfully.`
      );
      return safeReply(message, emb);
    }

    // BAN
    if (cmd === "ban") {
      if (!hasWL(member, "ban")) {
        const emb = xlareEmbed(
          "err",
          "No Permission",
          `${EMOJI.no} You are not whitelisted for **ban**.`
        );
        return safeReply(message, emb);
      }

      const targetArg = parts.shift();
      const targetId = cleanMentionToId(targetArg);

      if (!targetId) {
        const emb = xlareEmbed(
          "err",
          "Invalid User",
          `${EMOJI.no} You didn't provide a valid user`
        );
        return safeReply(message, emb);
      }

      const reason = parts.join(" ") || "No reason";

      try {
        await message.guild.members.ban(targetId, { reason });
        const emb = xlareEmbed(
          "ok",
          "Banned",
          `${EMOJI.ok} <@${targetId}> has been banned.\n**Reason:** ${reason}`
        );
        return safeReply(message, emb);
      } catch (e) {
        const emb = xlareEmbed(
          "err",
          "Ban Failed",
          `${EMOJI.no} I couldn't ban that user.`
        );
        return safeReply(message, emb);
      }
    }

    // UNBAN
    if (cmd === "unban") {
      if (!hasWL(member, "ban")) {
        const emb = xlareEmbed(
          "err",
          "No Permission",
          `${EMOJI.no} You are not whitelisted for **unban**.`
        );
        return safeReply(message, emb);
      }

      const id = parts.shift();
      if (!id || !/^\d+$/.test(id)) {
        const emb = xlareEmbed(
          "err",
          "Invalid User",
          `${EMOJI.no} Provide a valid user ID`
        );
        return safeReply(message, emb);
      }

      try {
        await message.guild.members.unban(id);
        const emb = xlareEmbed(
          "ok",
          "Unbanned",
          `${EMOJI.ok} Unbanned **${id}**`
        );
        return safeReply(message, emb);
      } catch {
        const emb = xlareEmbed(
          "err",
          "Unban Failed",
          `${EMOJI.no} Couldn't unban that ID`
        );
        return safeReply(message, emb);
      }
    }

    // MUTE (timeout)
    if (cmd === "mute") {
      if (!hasWL(member, "mute")) {
        const emb = xlareEmbed(
          "err",
          "No Permission",
          `${EMOJI.no} You are not whitelisted for **mute**.`
        );
        return safeReply(message, emb);
      }

      const targetArg = parts.shift();
      const targetId = cleanMentionToId(targetArg);

      if (!targetId) {
        const emb = xlareEmbed(
          "err",
          "Invalid User",
          `${EMOJI.no} You didn't provide a valid user`
        );
        return safeReply(message, emb);
      }

      const minutes = parseInt(parts.shift() || "10", 10);
      const ms = Math.max(1, minutes) * 60 * 1000;

      try {
        const targetMember = await message.guild.members.fetch(targetId);
        await targetMember.timeout(ms, `Muted by ${message.author.tag}`);

        const emb = xlareEmbed(
          "ok",
          "Muted",
          `${EMOJI.ok} Muted <@${targetId}> for **${minutes}m**`
        );
        return safeReply(message, emb);
      } catch {
        const emb = xlareEmbed(
          "err",
          "Mute Failed",
          `${EMOJI.no} I couldn't mute that user.`
        );
        return safeReply(message, emb);
      }
    }

    // UNMUTE
    if (cmd === "unmute") {
      if (!hasWL(member, "mute")) {
        const emb = xlareEmbed(
          "err",
          "No Permission",
          `${EMOJI.no} You are not whitelisted for **unmute**.`
        );
        return safeReply(message, emb);
      }

      const targetArg = parts.shift();
      const targetId = cleanMentionToId(targetArg);

      if (!targetId) {
        const emb = xlareEmbed(
          "err",
          "Invalid User",
          `${EMOJI.no} You didn't provide a valid user`
        );
        return safeReply(message, emb);
      }

      try {
        const targetMember = await message.guild.members.fetch(targetId);
        await targetMember.timeout(null);

        const emb = xlareEmbed(
          "ok",
          "Unmuted",
          `${EMOJI.ok} Unmuted <@${targetId}>`
        );
        return safeReply(message, emb);
      } catch {
        const emb = xlareEmbed(
          "err",
          "Unmute Failed",
          `${EMOJI.no} I couldn't unmute that user.`
        );
        return safeReply(message, emb);
      }
    }

    // PURGE
    if (cmd === "purge") {
      if (!hasWL(member, "purge")) {
        const emb = xlareEmbed(
          "err",
          "No Permission",
          `${EMOJI.no} You are not whitelisted for **purge**.`
        );
        return safeReply(message, emb);
      }

      const count = parseInt(parts.shift() || "0", 10);
      if (!count || count < 1 || count > 100) {
        const emb = xlareEmbed(
          "warn",
          "Purge",
          `${EMOJI.q} Usage: \`${PREFIX}purge 1-100\``
        );
        return safeReply(message, emb);
      }

      try {
        await message.channel.bulkDelete(count, true);
        const emb = xlareEmbed(
          "ok",
          "Purged",
          `${EMOJI.ok} Deleted **${count}** messages.`
        );
        const msg = await safeReply(message, emb);
        setTimeout(() => msg?.delete().catch(() => {}), 3000);
      } catch {
        const emb = xlareEmbed(
          "err",
          "Purge Failed",
          `${EMOJI.no} Couldn't delete messages.`
        );
        return safeReply(message, emb);
      }
    }

    // AFK
    if (cmd === "afk") {
      // without prefix allowed only if prefixless wl or admin
      // with prefix allowed for everyone
      const isWithoutPrefix = !isPrefixed;
      if (isWithoutPrefix && !(hasWL(member, "prefixless") || isAdmin(member))) {
        return;
      }

      const reason = parts.join(" ") || "AFK";
      afkMap.set(message.author.id, { reason, since: now() });

      const emb = xlareEmbed(
        "ok",
        "AFK Enabled",
        `${EMOJI.ok} You're now set afk with status- **${reason}**`
      );
      return safeReply(message, emb);
    }

    // Unknown command -> ONLY if prefixed (so normal msgs won't trigger)
    if (isPrefixed) {
      const emb = xlareEmbed(
        "err",
        "Unknown",
        `${EMOJI.no} Unknown command. Use \`${PREFIX}help\``
      );
      return safeReply(message, emb);
    }
  } catch (err) {
    console.log("messageCreate error:", err?.message || err);
  }
});

// ====== Ready ======
client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`Prefix: ${PREFIX}`);
});

client.login(DISCORD_TOKEN);
