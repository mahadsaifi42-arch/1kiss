const express = require("express");
const { Client, GatewayIntentBits, Partials, PermissionsBitField, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require("discord.js");
require("dotenv").config();

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const PREFIX = process.env.PREFIX || "$";
const PORT = process.env.PORT || 10000;

if (!DISCORD_TOKEN) throw new Error("❌ Missing DISCORD_TOKEN in env");

// ---- Keep Render alive (Web Service needs a port) ----
const app = express();
app.get("/", (req, res) => res.send("Questy MultiBot is alive ✅"));
app.listen(PORT, () => console.log(`🌐 Web alive on port ${PORT}`));

// ---- Emojis (custom + fallback) ----
const EMOJI = {
  ok: "<a:TICK_TICK:1214893859151286272>",
  no: "<a:4NDS_wrong:1458407390419615756>",
  lock: "<a:lock_keyggchillhaven:1307838252568412202>",
  music: "<a:Music:1438190819512422447>",
  head: "<:0041_headphones:1443333046823813151>",
};

function safeEmoji(e, fallback) {
  if (!e) return fallback;
  // if discord can't render, it shows as :name: text -> still ok but fallback looks better
  return e.includes("<") ? e : fallback;
}

const OK = safeEmoji(EMOJI.ok, "✅");
const NO = safeEmoji(EMOJI.no, "❌");
const LOCK = safeEmoji(EMOJI.lock, "🔒");

// ---- Simple in-memory whitelist store ----
// (Render free restart pe reset ho jayega; later DB add kar denge)
const WL = {
  ban: new Set(),
  mute: new Set(),
  prefixless: new Set(),
  advertise: new Set(),
  spam: new Set(),
};

// ---- Helper: black xlare style embed ----
function xlare(title, desc) {
  return new EmbedBuilder()
    .setColor(0x000000)
    .setTitle(title)
    .setDescription(desc || "")
    .setTimestamp();
}

// ---- Helpers ----
function isAdmin(member) {
  return member.permissions.has(PermissionsBitField.Flags.Administrator);
}

function canUsePrefixless(member, category) {
  if (isAdmin(member)) return true;
  if (!WL[category]) return false;
  return WL[category].has(member.id);
}

function getMentionedUser(message) {
  return message.mentions.users.first() || null;
}

// ---- Client ----
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ---- WL Select Menu memory (per user) ----
const userSelectedWLCategory = new Map();

// ---- Message Handler ----
client.on("messageCreate", async (message) => {
  try {
    if (!message.guild) return;
    if (message.author.bot) return;

    const content = message.content.trim();
    const lower = content.toLowerCase();

    // --------- PREFIX COMMANDS ---------
    const isPrefixCmd = content.startsWith(PREFIX);

    // --------- PREFIXLESS COMMANDS (ONLY WL prefixless) ---------
    const prefixlessAllowedCommands = ["lock", "unlock", "hide", "unhide", "ban", "unban", "mute", "unmute", "purge", "wl"];
    const firstWord = lower.split(/\s+/)[0];

    let cmd = null;
    let args = [];

    if (isPrefixCmd) {
      const sliced = content.slice(PREFIX.length).trim();
      cmd = sliced.split(/\s+/)[0]?.toLowerCase();
      args = sliced.split(/\s+/).slice(1);
    } else {
      // prefixless only for whitelisted users and only for listed cmds
      if (!prefixlessAllowedCommands.includes(firstWord)) return;

      // allow only if user has prefixless wl or admin
      if (!canUsePrefixless(message.member, "prefixless")) return;

      cmd = firstWord;
      args = content.split(/\s+/).slice(1);
    }

    if (!cmd) return;

    // ---------- HELP ----------
    if (cmd === "help") {
      const emb = xlare(`${OK} Help`, 
`**Prefix:** \`${PREFIX}\`

**Moderation**
• \`${PREFIX}ban @user\`
• \`${PREFIX}unban userId\`
• \`${PREFIX}mute @user [minutes]\`
• \`${PREFIX}unmute @user\`
• \`${PREFIX}purge <amount>\`

**Channel**
• \`${PREFIX}lock\`
• \`${PREFIX}unlock\`
• \`${PREFIX}hide\`
• \`${PREFIX}unhide\`

**Whitelist**
• \`${PREFIX}wl\` (panel)
• \`${PREFIX}wl add @user <ban/mute/prefixless/advertise/spam>\`
• \`${PREFIX}wl remove @user <category>\`
• \`${PREFIX}wl list\`

**Prefixless (Only WL prefixless)**
• lock/unlock/hide/unhide/ban/mute/unmute/purge`);
      return message.reply({ embeds: [emb] });
    }

    // ---------- WL PANEL ----------
    if (cmd === "wl" && args.length === 0) {
      if (!isAdmin(message.member)) {
        const emb = xlare(`${NO} No Permission`, `Only **Admins** can open whitelist panel.`);
        return message.reply({ embeds: [emb] });
      }

      const menu = new StringSelectMenuBuilder()
        .setCustomId("wl_category_select")
        .setPlaceholder("Select whitelist category")
        .addOptions([
          { label: "Ban", value: "ban", description: "Allow prefixless ban/unban" },
          { label: "Mute", value: "mute", description: "Allow prefixless mute/unmute" },
          { label: "Prefixless", value: "prefixless", description: "Allow using commands without prefix" },
          { label: "Advertise", value: "advertise", description: "Advertise whitelist (future)" },
          { label: "Spam", value: "spam", description: "Spam whitelist (future)" },
        ]);

      const row = new ActionRowBuilder().addComponents(menu);

      const emb = xlare(`${OK} Whitelist Panel`, 
`Select a category from dropdown.
Then use:

• \`${PREFIX}wl add @user\`
• \`${PREFIX}wl remove @user\`

(Selected category will be used automatically.)`);

      return message.reply({ embeds: [emb], components: [row] });
    }

    // wl list
    if (cmd === "wl" && args[0] === "list") {
      if (!isAdmin(message.member)) {
        const emb = xlare(`${NO} No Permission`, `Only **Admins** can view whitelist list.`);
        return message.reply({ embeds: [emb] });
      }

      const emb = xlare(`${OK} Whitelist List`,
`**Ban:** ${[...WL.ban].length}
**Mute:** ${[...WL.mute].length}
**Prefixless:** ${[...WL.prefixless].length}
**Advertise:** ${[...WL.advertise].length}
**Spam:** ${[...WL.spam].length}`);
      return message.reply({ embeds: [emb] });
    }

    // wl add/remove
    if (cmd === "wl" && (args[0] === "add" || args[0] === "remove")) {
      if (!isAdmin(message.member)) {
        const emb = xlare(`${NO} No Permission`, `Only **Admins** can manage whitelist.`);
        return message.reply({ embeds: [emb] });
      }

      const action = args[0];
      const user = getMentionedUser(message);

      if (!user) {
        const emb = xlare(`${NO} Invalid User`, `Mention a user.\nExample: \`${PREFIX}wl add @user prefixless\``);
        return message.reply({ embeds: [emb] });
      }

      let category = args[2]?.toLowerCase();

      // if category not provided, use selected from menu
      if (!category) category = userSelectedWLCategory.get(message.author.id);

      if (!category || !WL[category]) {
        const emb = xlare(`${NO} Invalid Category`,
`Choose category:
\`ban\` \`mute\` \`prefixless\` \`advertise\` \`spam\`

Example:
\`${PREFIX}wl add @user prefixless\``);
        return message.reply({ embeds: [emb] });
      }

      if (action === "add") {
        WL[category].add(user.id);
        const emb = xlare(`${OK} Whitelisted`, `Added <@${user.id}> to **${category}** whitelist.`);
        return message.reply({ embeds: [emb] });
      } else {
        WL[category].delete(user.id);
        const emb = xlare(`${OK} Removed`, `Removed <@${user.id}> from **${category}** whitelist.`);
        return message.reply({ embeds: [emb] });
      }
    }

    // ---------- LOCK ----------
    if (cmd === "lock") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels) && !canUsePrefixless(message.member, "prefixless")) {
        const emb = xlare(`${NO} No Permission`, `You need **Manage Channels**.`);
        return message.reply({ embeds: [emb] });
      }

      await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, {
        SendMessages: false,
      });

      const emb = xlare(`${LOCK} Channel locked successfully.`, `Locked for **@everyone**`);
      return message.reply({ embeds: [emb] });
    }

    // ---------- UNLOCK ----------
    if (cmd === "unlock") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels) && !canUsePrefixless(message.member, "prefixless")) {
        const emb = xlare(`${NO} No Permission`, `You need **Manage Channels**.`);
        return message.reply({ embeds: [emb] });
      }

      await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, {
        SendMessages: true,
      });

      const emb = xlare(`${OK} Channel unlocked successfully.`, `Unlocked for **@everyone**`);
      return message.reply({ embeds: [emb] });
    }

    // ---------- HIDE ----------
    if (cmd === "hide") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels) && !canUsePrefixless(message.member, "prefixless")) {
        const emb = xlare(`${NO} No Permission`, `You need **Manage Channels**.`);
        return message.reply({ embeds: [emb] });
      }

      await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, {
        ViewChannel: false,
      });

      const emb = xlare(`${LOCK} Channel hidden successfully.`, `Hidden for **@everyone**`);
      return message.reply({ embeds: [emb] });
    }

    // ---------- UNHIDE ----------
    if (cmd === "unhide") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels) && !canUsePrefixless(message.member, "prefixless")) {
        const emb = xlare(`${NO} No Permission`, `You need **Manage Channels**.`);
        return message.reply({ embeds: [emb] });
      }

      await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, {
        ViewChannel: true,
      });

      const emb = xlare(`${OK} Channel unhidden successfully.`, `Visible for **@everyone**`);
      return message.reply({ embeds: [emb] });
    }

    // ---------- BAN ----------
    if (cmd === "ban") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.BanMembers) && !canUsePrefixless(message.member, "ban")) {
        const emb = xlare(`${NO} No Permission`, `You need **Ban Members** or ban whitelist.`);
        return message.reply({ embeds: [emb] });
      }

      const user = getMentionedUser(message);
      if (!user) {
        const emb = xlare(`${NO} Invalid User`, `You didn't provide a valid user.`);
        return message.reply({ embeds: [emb] });
      }

      const member = await message.guild.members.fetch(user.id).catch(() => null);
      if (!member) {
        const emb = xlare(`${NO} Invalid User`, `User not found in server.`);
        return message.reply({ embeds: [emb] });
      }

      await member.ban({ reason: "Banned by bot" }).catch(() => null);

      const emb = xlare(`${OK} Banned`, `Banned **${user.tag}**`);
      return message.reply({ embeds: [emb] });
    }

    // ---------- MUTE ----------
    if (cmd === "mute") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers) && !canUsePrefixless(message.member, "mute")) {
        const emb = xlare(`${NO} No Permission`, `You need **Moderate Members** or mute whitelist.`);
        return message.reply({ embeds: [emb] });
      }

      const user = getMentionedUser(message);
      if (!user) {
        const emb = xlare(`${NO} Invalid User`, `You didn't provide a valid user.`);
        return message.reply({ embeds: [emb] });
      }

      const member = await message.guild.members.fetch(user.id).catch(() => null);
      if (!member) {
        const emb = xlare(`${NO} Invalid User`, `User not found in server.`);
        return message.reply({ embeds: [emb] });
      }

      const mins = parseInt(args[1]) || 10;
      const durationMs = mins * 60 * 1000;

      await member.timeout(durationMs, "Muted by bot").catch(() => null);

      const emb = xlare(`${OK} Muted`, `Muted <@${user.id}> for **${mins}m**`);
      return message.reply({ embeds: [emb] });
    }

    // ---------- PURGE ----------
    if (cmd === "purge") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages) && !canUsePrefixless(message.member, "prefixless")) {
        const emb = xlare(`${NO} No Permission`, `You need **Manage Messages**.`);
        return message.reply({ embeds: [emb] });
      }

      const amount = parseInt(args[0]);
      if (!amount || amount < 1 || amount > 100) {
        const emb = xlare(`${NO} Invalid Amount`, `Use: \`${PREFIX}purge 1-100\``);
        return message.reply({ embeds: [emb] });
      }

      await message.channel.bulkDelete(amount, true).catch(() => null);
      const emb = xlare(`${OK} Purged`, `Deleted **${amount}** messages.`);
      return message.channel.send({ embeds: [emb] });
    }

    // If command not found -> do nothing (no spam)
    return;

  } catch (err) {
    console.log("messageCreate error:", err);
  }
});

// ---- Interaction handler for select menu ----
client.on("interactionCreate", async (interaction) => {
  try {
    if (!interaction.isStringSelectMenu()) return;

    if (interaction.customId === "wl_category_select") {
      const val = interaction.values[0];
      userSelectedWLCategory.set(interaction.user.id, val);

      const emb = xlare(`${OK} Selected`, `Whitelist category set to **${val}**\nNow use:\n\`${PREFIX}wl add @user\``);
      return interaction.reply({ embeds: [emb], ephemeral: true });
    }
  } catch (e) {
    console.log("interaction error:", e);
  }
});

client.login(DISCORD_TOKEN);
