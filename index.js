require("dotenv").config();
const express = require("express");
const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
} = require("discord.js");
const Database = require("better-sqlite3");

// ================== CONFIG ==================
const PREFIX = process.env.PREFIX || "$";
const PORT = process.env.PORT || 10000;

const EMOJIS = {
  tick: "<a:TICK_TICK:1214893859151286272>",
  wrong: "<a:4NDS_wrong:1458407390419615756>",
  lock: "<a:lock_keyggchillhaven:1307838252568412202>",
  music: "<a:Music:1438190819512422447>",
  headphones: "<:0041_headphones:1443333046823813151>",
  question: "<a:question:1264568031019925545>",
};

// ================== WEB SERVER (Render Port Fix) ==================
const app = express();
app.get("/", (req, res) => res.send("Questy Final MultiBot Running ✅"));
app.listen(PORT, () => console.log(`🌐 Web alive on port ${PORT}`));

// ================== CLIENT ==================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

if (!process.env.DISCORD_TOKEN) {
  throw new Error("❌ Missing DISCORD_TOKEN in env");
}

// ================== DATABASE ==================
const db = new Database("data.db");

// tables
db.prepare(
  `CREATE TABLE IF NOT EXISTS whitelist (
    guildId TEXT NOT NULL,
    userId TEXT NOT NULL,
    perm TEXT NOT NULL,
    PRIMARY KEY (guildId, userId, perm)
  )`
).run();

db.prepare(
  `CREATE TABLE IF NOT EXISTS afk (
    guildId TEXT NOT NULL,
    userId TEXT NOT NULL,
    reason TEXT,
    since INTEGER NOT NULL,
    PRIMARY KEY (guildId, userId)
  )`
).run();

function isAdmin(member) {
  return member.permissions.has(PermissionsBitField.Flags.Administrator);
}

function hasWL(guildId, userId, perm) {
  const row = db
    .prepare(
      "SELECT 1 FROM whitelist WHERE guildId=? AND userId=? AND perm=? LIMIT 1"
    )
    .get(guildId, userId, perm);
  return !!row;
}

function addWL(guildId, userId, perm) {
  db.prepare(
    "INSERT OR IGNORE INTO whitelist (guildId, userId, perm) VALUES (?,?,?)"
  ).run(guildId, userId, perm);
}

function delWL(guildId, userId, perm) {
  db.prepare("DELETE FROM whitelist WHERE guildId=? AND userId=? AND perm=?").run(
    guildId,
    userId,
    perm
  );
}

function listWL(guildId, userId) {
  return db
    .prepare("SELECT perm FROM whitelist WHERE guildId=? AND userId=?")
    .all(guildId, userId)
    .map((x) => x.perm);
}

function formatSince(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s} seconds ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minutes ago`;
  const h = Math.floor(m / 60);
  return `${h} hours ago`;
}

// ================== HELP TEXT ==================
const HELP_TEXT = `
${EMOJIS.question} **Commands**
**Prefix:** \`${PREFIX}\`

**Public (Everyone)**
• \`${PREFIX}help\`
• \`${PREFIX}ping\`
• \`afk [reason]\` (prefixless for all)

**Admin Only**
• \`${PREFIX}wl add @user <ban|mute|prefixless|advertise|spam|purge|lock>\`
• \`${PREFIX}wl remove @user <perm>\`
• \`${PREFIX}wl list @user\`

**Mod Commands**
• \`${PREFIX}lock\` / \`${PREFIX}unlock\`
• \`${PREFIX}ban @user [reason]\`
• \`${PREFIX}unban <userId>\`
• \`${PREFIX}mute @user [minutes]\`
• \`${PREFIX}unmute @user\`
• \`${PREFIX}purge <amount>\`

**Prefixless Access**
Only whitelisted users can run these without prefix.
`;

// ================== COMMAND PARSER ==================
function parseArgs(content) {
  const parts = content.trim().split(/\s+/);
  const cmd = parts.shift()?.toLowerCase();
  return { cmd, args: parts };
}

function isCommandMessage(msg) {
  if (!msg.content) return false;
  const c = msg.content.trim().toLowerCase();
  if (c.startsWith(PREFIX)) return true;
  // prefixless AFK for all
  if (c === "afk" || c.startsWith("afk ")) return true;
  return false;
}

// ================== READY ==================
client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ================== MESSAGE HANDLER ==================
client.on("messageCreate", async (message) => {
  try {
    if (!message.guild) return;
    if (message.author.bot) return;

    // ---------------- AFK remove when user speaks ----------------
    const afkRow = db
      .prepare("SELECT * FROM afk WHERE guildId=? AND userId=?")
      .get(message.guild.id, message.author.id);

    if (afkRow) {
      // if user sends anything (except setting afk again) => remove
      const lower = message.content.trim().toLowerCase();
      if (!(lower === "afk" || lower.startsWith("afk "))) {
        db.prepare("DELETE FROM afk WHERE guildId=? AND userId=?").run(
          message.guild.id,
          message.author.id
        );
        await message.reply(
          `${EMOJIS.tick} Welcome back! I removed your afk. You were afk since ${formatSince(
            Date.now() - afkRow.since
          )}`
        );
      }
    }

    // ---------------- AFK mention reply ----------------
    if (message.mentions.users.size > 0) {
      for (const [, user] of message.mentions.users) {
        const row = db
          .prepare("SELECT * FROM afk WHERE guildId=? AND userId=?")
          .get(message.guild.id, user.id);

        if (row) {
          await message.reply(
            `😴 ${user.username} is AFK: **${row.reason || "AFK"}** • (${formatSince(
              Date.now() - row.since
            )})`
          );
          break;
        }
      }
    }

    // ---------------- Ignore normal chat ----------------
    if (!isCommandMessage(message)) return;

    // ---------------- Parse command ----------------
    let content = message.content.trim();

    // prefix commands
    let usedPrefix = false;
    if (content.startsWith(PREFIX)) {
      usedPrefix = true;
      content = content.slice(PREFIX.length).trim();
    }

    const { cmd, args } = parseArgs(content);
    if (!cmd) return;

    // ---------------- AFK SET (prefixless for all) ----------------
    if (cmd === "afk") {
      const reason = args.join(" ").trim() || "AFK";
      db.prepare(
        "INSERT OR REPLACE INTO afk (guildId, userId, reason, since) VALUES (?,?,?,?)"
      ).run(message.guild.id, message.author.id, reason, Date.now());

      await message.reply(
        `${EMOJIS.tick} Your now set afk with status- **${reason || "None"}**`
      );
      return;
    }

    // ---------------- Public Commands ----------------
    if (cmd === "ping") {
      await message.reply(`${EMOJIS.tick} Pong! ${client.ws.ping}ms`);
      return;
    }

    if (cmd === "help") {
      await message.reply(HELP_TEXT);
      return;
    }

    // ---------------- Admin WL Commands ----------------
    if (cmd === "wl") {
      if (!isAdmin(message.member)) {
        return message.reply(
          `${EMOJIS.wrong} ${message.author} You don't have permission`
        );
      }

      const action = args[0]?.toLowerCase();
      const target = message.mentions.users.first();
      const perm = args[2]?.toLowerCase();

      const validPerms = [
        "ban",
        "mute",
        "prefixless",
        "advertise",
        "spam",
        "purge",
        "lock",
      ];

      if (!action || !["add", "remove", "list"].includes(action)) {
        return message.reply(
          `${EMOJIS.wrong} ${message.author} Use: \`${PREFIX}wl add @user <perm>\``
        );
      }

      if (action === "list") {
        if (!target) {
          return message.reply(
            `${EMOJIS.wrong} ${message.author} You didn't provide a valid user`
          );
        }
        const perms = listWL(message.guild.id, target.id);
        if (perms.length === 0) {
          return message.reply(
            `${EMOJIS.question} ${target.username} has no whitelist perms`
          );
        }
        return message.reply(
          `${EMOJIS.tick} ${target.username} WL: \`${perms.join(", ")}\``
        );
      }

      if (!target || !perm || !validPerms.includes(perm)) {
        return message.reply(
          `${EMOJIS.wrong} ${message.author} Valid perms: \`${validPerms.join(
            ", "
          )}\``
        );
      }

      if (action === "add") {
        addWL(message.guild.id, target.id, perm);
        return message.reply(
          `${EMOJIS.tick} Added **${perm}** whitelist to ${target}`
        );
      }

      if (action === "remove") {
        delWL(message.guild.id, target.id, perm);
        return message.reply(
          `${EMOJIS.tick} Removed **${perm}** whitelist from ${target}`
        );
      }
    }

    // ---------------- MOD COMMANDS (Prefix OR Whitelisted Prefixless) ----------------
    // Prefixless allow only if user has prefixless WL
    const prefixlessAllowed = hasWL(
      message.guild.id,
      message.author.id,
      "prefixless"
    );

    // if not used prefix and not prefixlessAllowed => ignore
    if (!usedPrefix && !prefixlessAllowed) return;

    // ===== lock/unlock =====
    if (cmd === "lock" || cmd === "unlock") {
      // require admin OR lock WL
      if (!isAdmin(message.member) && !hasWL(message.guild.id, message.author.id, "lock")) {
        return message.reply(
          `${EMOJIS.wrong} ${message.author} You don't have permission`
        );
      }

      const channel = message.channel;
      const everyoneRole = message.guild.roles.everyone;

      const lockIt = cmd === "lock";

      await channel.permissionOverwrites.edit(everyoneRole, {
        SendMessages: lockIt ? false : null,
      });

      return message.reply(
        lockIt
          ? `${EMOJIS.lock} Channel locked`
          : `${EMOJIS.tick} Channel unlocked`
      );
    }

    // ===== purge =====
    if (cmd === "purge") {
      if (!isAdmin(message.member) && !hasWL(message.guild.id, message.author.id, "purge")) {
        return message.reply(
          `${EMOJIS.wrong} ${message.author} You don't have permission`
        );
      }

      const amount = parseInt(args[0], 10);
      if (!amount || amount < 1 || amount > 100) {
        return message.reply(
          `${EMOJIS.wrong} ${message.author} Use: \`${PREFIX}purge 1-100\``
        );
      }

      await message.channel.bulkDelete(amount, true);
      return message.reply(`${EMOJIS.tick} Purged **${amount}** messages`);
    }

    // ===== ban =====
    if (cmd === "ban") {
      if (!isAdmin(message.member) && !hasWL(message.guild.id, message.author.id, "ban")) {
        return message.reply(
          `${EMOJIS.wrong} ${message.author} You don't have permission`
        );
      }

      const target = message.mentions.members.first();
      if (!target) {
        return message.reply(
          `${EMOJIS.wrong} ${message.author} You didn't provide a valid user`
        );
      }

      const reason = args.slice(1).join(" ") || "No reason";
      await target.ban({ reason });
      return message.reply(`${EMOJIS.tick} Banned ${target.user.tag}`);
    }

    // ===== unban =====
    if (cmd === "unban") {
      if (!isAdmin(message.member) && !hasWL(message.guild.id, message.author.id, "ban")) {
        return message.reply(
          `${EMOJIS.wrong} ${message.author} You don't have permission`
        );
      }

      const userId = args[0];
      if (!userId || isNaN(userId)) {
        return message.reply(
          `${EMOJIS.wrong} ${message.author} Use: \`${PREFIX}unban <userId>\``
        );
      }

      await message.guild.members.unban(userId);
      return message.reply(`${EMOJIS.tick} Unbanned **${userId}**`);
    }

    // ===== mute/unmute (timeout) =====
    if (cmd === "mute") {
      if (!isAdmin(message.member) && !hasWL(message.guild.id, message.author.id, "mute")) {
        return message.reply(
          `${EMOJIS.wrong} ${message.author} You don't have permission`
        );
      }

      const target = message.mentions.members.first();
      if (!target) {
        return message.reply(
          `${EMOJIS.wrong} ${message.author} You didn't provide a valid user`
        );
      }

      const minutes = parseInt(args[1] || "10", 10);
      const ms = minutes * 60 * 1000;

      await target.timeout(ms, "Muted");
      return message.reply(`${EMOJIS.tick} Muted ${target.user.tag} for ${minutes}m`);
    }

    if (cmd === "unmute") {
      if (!isAdmin(message.member) && !hasWL(message.guild.id, message.author.id, "mute")) {
        return message.reply(
          `${EMOJIS.wrong} ${message.author} You don't have permission`
        );
      }

      const target = message.mentions.members.first();
      if (!target) {
        return message.reply(
          `${EMOJIS.wrong} ${message.author} You didn't provide a valid user`
        );
      }

      await target.timeout(null);
      return message.reply(`${EMOJIS.tick} Unmuted ${target.user.tag}`);
    }

    // Unknown command: ignore silently (NO SPAM)
    return;
  } catch (err) {
    console.log("messageCreate error:", err);
  }
});

// ================== LOGIN ==================
client.login(process.env.DISCORD_TOKEN);
