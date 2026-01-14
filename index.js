require("dotenv").config();
const express = require("express");
const {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
  EmbedBuilder,
  PermissionsBitField,
} = require("discord.js");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const OWNER_ID = process.env.OWNER_ID;
const CLIENT_ID = process.env.CLIENT_ID;

if (!DISCORD_TOKEN) throw new Error("❌ Missing DISCORD_TOKEN in env");
if (!OWNER_ID) throw new Error("❌ Missing OWNER_ID in env");
if (!CLIENT_ID) console.log("⚠️ CLIENT_ID missing (slash commands may not register)");

/* -------------------- Render Port Bind (IMPORTANT) -------------------- */
const app = express();
app.get("/", (req, res) => res.send("Questy Bot is alive ✅"));
app.listen(process.env.PORT || 3000, () => {
  console.log("🌐 Web alive on port", process.env.PORT || 3000);
});

/* -------------------- Discord Client -------------------- */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel],
});

const prefix = "$";

/* -------------------- Simple DB (in-memory) -------------------- */
const wl = {
  ban: new Set(),
  mute: new Set(),
  prefixless: new Set(),
  advertise: new Set(),
  spam: new Set(),
};

const afkMap = new Map(); // userId -> { reason, since }

/* -------------------- Helpers -------------------- */
function isAdmin(member) {
  return member.permissions.has(PermissionsBitField.Flags.Administrator);
}

function isOwner(userId) {
  return userId === OWNER_ID;
}

function canManageWL(member) {
  return isAdmin(member) || isOwner(member.id);
}

function isPrefixlessAllowed(userId) {
  return wl.prefixless.has(userId) || isOwner(userId);
}

/* -------------------- Ready -------------------- */
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

/* -------------------- Message Handler -------------------- */
client.on("messageCreate", async (message) => {
  try {
    if (!message.guild || message.author.bot) return;

    // AFK mention check
    for (const user of message.mentions.users.values()) {
      const afk = afkMap.get(user.id);
      if (afk) {
        const mins = Math.floor((Date.now() - afk.since) / 60000);
        const embed = new EmbedBuilder()
          .setTitle("😴 AFK User")
          .setDescription(
            `**${user.tag}** is AFK\n**Reason:** ${afk.reason}\n**Since:** ${mins} min ago`
          )
          .setFooter({ text: `Mentioned by ${message.author.tag}` })
          .setTimestamp();

        await message.reply({ embeds: [embed] }).catch(() => {});
      }
    }

    // Remove AFK if user types
    if (afkMap.has(message.author.id)) {
      afkMap.delete(message.author.id);
      await message.reply("✅ Welcome back! AFK removed.").catch(() => {});
    }

    // Prefixless command support
    const content = message.content.trim();
    const usedPrefix = content.startsWith(prefix);

    // if not using prefix, only allow if user is prefixless whitelisted
    if (!usedPrefix && !isPrefixlessAllowed(message.author.id)) return;

    // parse command
    const args = usedPrefix
      ? content.slice(prefix.length).trim().split(/\s+/)
      : content.split(/\s+/);

    const cmd = (args.shift() || "").toLowerCase();
    if (!cmd) return;

    /* -------------------- HELP -------------------- */
    if (cmd === "help") {
      const embed = new EmbedBuilder()
        .setTitle("📌 Questy MultiBot Commands")
        .setDescription("Prefix: **$** (or prefixless if whitelisted)")
        .addFields(
          {
            name: "⚙️ Basic",
            value: "`ping` `help` `afk <reason>`",
            inline: false,
          },
          {
            name: "🛡️ Whitelist (Admin/Owner only)",
            value:
              "`wl add <type> <@user/id>`\n`wl remove <type> <@user/id>`\n`wl list`",
            inline: false,
          },
          {
            name: "🎵 Music (Coming Next Update)",
            value: "`play <song>` `skip` `stop` `queue`",
            inline: false,
          }
        )
        .setFooter({ text: "Made by Questy ⚡" })
        .setTimestamp();

      return message.reply({ embeds: [embed] });
    }

    /* -------------------- PING -------------------- */
    if (cmd === "ping") {
      return message.reply(`🏓 Pong! **${client.ws.ping}ms**`);
    }

    /* -------------------- AFK -------------------- */
    if (cmd === "afk") {
      const reason = args.join(" ") || "AFK";
      afkMap.set(message.author.id, { reason, since: Date.now() });

      const embed = new EmbedBuilder()
        .setTitle("😴 AFK Enabled")
        .setDescription(`**Reason:** ${reason}`)
        .setFooter({ text: `Set by ${message.author.tag}` })
        .setTimestamp();

      return message.reply({ embeds: [embed] });
    }

    /* -------------------- WHITELIST -------------------- */
    if (cmd === "wl") {
      if (!canManageWL(message.member)) {
        return message.reply("❌ Only Admin/Owner can manage whitelist.");
      }

      const sub = (args.shift() || "").toLowerCase();

      if (sub === "list") {
        const embed = new EmbedBuilder()
          .setTitle("📋 Whitelist Types")
          .setDescription(
            "**Types:** ban, mute, prefixless, advertise, spam\n\nExample:\n`$wl add prefixless @user`"
          )
          .setTimestamp();
        return message.reply({ embeds: [embed] });
      }

      const action = sub; // add/remove
      const type = (args.shift() || "").toLowerCase();
      const userArg = args.shift();

      if (!["add", "remove"].includes(action)) {
        return message.reply("❌ Use: `$wl add/remove <type> <@user/id>`");
      }

      if (!wl[type]) {
        return message.reply("❌ Invalid type. Use `$wl list`");
      }

      if (!userArg) return message.reply("❌ Mention user or give ID.");

      const userId =
        userArg.replace("<@", "").replace(">", "").replace("!", "") || null;

      if (!userId || isNaN(userId)) return message.reply("❌ Invalid user ID.");

      if (action === "add") wl[type].add(userId);
      if (action === "remove") wl[type].delete(userId);

      const embed = new EmbedBuilder()
        .setTitle("✅ Whitelist Updated")
        .setDescription(
          `**Action:** ${action}\n**Type:** ${type}\n**User ID:** ${userId}`
        )
        .setTimestamp();

      return message.reply({ embeds: [embed] });
    }

    /* -------------------- UNKNOWN -------------------- */
    return message.reply("❓ Unknown command. Use `$help`");
  } catch (err) {
    console.log("messageCreate error:", err);
  }
});

/* -------------------- Login -------------------- */
client.login(DISCORD_TOKEN);
