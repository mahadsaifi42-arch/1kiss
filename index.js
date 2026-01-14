/**
 * Questy Security + AI + NoPrefix + Prefix + Setup Bot (One-file)
 * Discord.js v14 + Gemini (AI Studio)
 *
 * ENV REQUIRED:
 * DISCORD_TOKEN=
 * CLIENT_ID=
 * OWNER_ID=
 * GEMINI_API_KEY=
 */

require("dotenv").config();

const express = require("express");
const app = express();
app.get("/", (req, res) => res.send("✅ Bot is running!"));
app.listen(process.env.PORT || 3000, () => console.log("🌐 Web alive"));

const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
  REST,
  Routes,
} = require("discord.js");

const { GoogleGenerativeAI } = require("@google/generative-ai");

// ====== CONFIG ======
const PREFIX = "$"; // normal prefix commands
const OWNER_ID = process.env.OWNER_ID;

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// ====== SAFETY CHECKS ======
if (!DISCORD_TOKEN) throw new Error("❌ Missing DISCORD_TOKEN in env");
if (!CLIENT_ID) throw new Error("❌ Missing CLIENT_ID in env");
if (!OWNER_ID) throw new Error("❌ Missing OWNER_ID in env");

// ====== CLIENT ======
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // needed for setup/verify/joins
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // needed for prefix + no-prefix
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction],
});

// ====== AI ======
let genAI = null;
if (GEMINI_API_KEY) {
  genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
}

async function askGemini(prompt) {
  if (!genAI) return "❌ GEMINI_API_KEY missing. Add it in Render ENV.";
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
  const result = await model.generateContent(prompt);
  return result.response.text();
}

// ====== HELP TEXT ======
const HELP_TEXT = `✅ **Commands List**

**Slash Commands**
- /ping
- /setup  (Owner only)

**Prefix Commands (${PREFIX})**
- ${PREFIX}ping
- ${PREFIX}help
- ${PREFIX}setup  (Owner only)

**Owner No-Prefix (ONLY in #ai-chat)**
Type normal text like:
- hide all channels
- unhide all channels
- lock server
- unlock server
- setup verification
- panic mode on

⚠️ Destructive actions ask confirmation (YES).
`;

// ====== SLASH COMMANDS ======
const slashCommands = [
  new SlashCommandBuilder().setName("ping").setDescription("Check bot latency"),
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Auto create channels + roles + verify + AI channel (Owner only)"),
].map((c) => c.toJSON());

// ====== REGISTER SLASH ======
async function registerSlashCommands() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: slashCommands });
  console.log("✅ Slash commands registered globally.");
}

// ====== UTIL ======
function isOwner(userId) {
  return String(userId) === String(OWNER_ID);
}

function safeName(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9\-]/g, "-");
}

async function ensureRole(guild, name) {
  const existing = guild.roles.cache.find((r) => r.name === name);
  if (existing) return existing;
  return guild.roles.create({ name, reason: "Auto setup role" });
}

async function ensureChannel(guild, name, type = ChannelType.GuildText) {
  const existing = guild.channels.cache.find((c) => c.name === name);
  if (existing) return existing;
  return guild.channels.create({
    name,
    type,
    reason: "Auto setup channel",
  });
}

// ====== SETUP FUNCTION ======
async function runSetup(guild) {
  // roles
  const verifiedRole = await ensureRole(guild, "Verified");
  const mutedRole = await ensureRole(guild, "Muted");
  const quarantineRole = await ensureRole(guild, "Quarantine");

  // channels
  const welcome = await ensureChannel(guild, "welcome");
  const rules = await ensureChannel(guild, "rules");
  const verify = await ensureChannel(guild, "verify");
  const modLogs = await ensureChannel(guild, "mod-logs");
  const aiChat = await ensureChannel(guild, "ai-chat");

  // lock AI channel to owner only
  await aiChat.permissionOverwrites.set([
    {
      id: guild.roles.everyone.id,
      deny: [PermissionsBitField.Flags.ViewChannel],
    },
    {
      id: OWNER_ID,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
      ],
    },
    {
      id: client.user.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.ManageChannels,
      ],
    },
  ]);

  // verify button
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("verify_me")
      .setLabel("✅ Verify")
      .setStyle(ButtonStyle.Success)
  );

  const embed = new EmbedBuilder()
    .setTitle("Verification")
    .setDescription("Click the button below to get **Verified** role.")
    .setColor(0x00ff88);

  await verify.send({ embeds: [embed], components: [row] });

  // rules
  await rules.send(
    `📌 **Server Rules**
1) Respect everyone
2) No spam
3) No scam links
4) Follow Discord TOS
`
  );

  // welcome
  await welcome.send("👋 Welcome! Please verify in #verify");

  // log
  await modLogs.send("✅ Setup complete: channels + roles + verify + ai-chat created.");

  return { verifiedRole, mutedRole, quarantineRole, channels: { welcome, rules, verify, modLogs, aiChat } };
}

// ====== OWNER CONFIRM SYSTEM ======
const pendingConfirm = new Map(); // key: ownerId => { action, guildId, expires }

function setPendingConfirm(ownerId, data) {
  pendingConfirm.set(ownerId, { ...data, expires: Date.now() + 60_000 });
}
function getPendingConfirm(ownerId) {
  const v = pendingConfirm.get(ownerId);
  if (!v) return null;
  if (Date.now() > v.expires) {
    pendingConfirm.delete(ownerId);
    return null;
  }
  return v;
}
function clearPendingConfirm(ownerId) {
  pendingConfirm.delete(ownerId);
}

// ====== BASIC MOD ACTIONS ======
async function hideAllChannels(guild) {
  for (const ch of guild.channels.cache.values()) {
    try {
      await ch.permissionOverwrites.edit(guild.roles.everyone.id, {
        ViewChannel: false,
      });
    } catch {}
  }
}
async function unhideAllChannels(guild) {
  for (const ch of guild.channels.cache.values()) {
    try {
      await ch.permissionOverwrites.edit(guild.roles.everyone.id, {
        ViewChannel: null,
      });
    } catch {}
  }
}
async function lockServer(guild) {
  for (const ch of guild.channels.cache.values()) {
    try {
      await ch.permissionOverwrites.edit(guild.roles.everyone.id, {
        SendMessages: false,
      });
    } catch {}
  }
}
async function unlockServer(guild) {
  for (const ch of guild.channels.cache.values()) {
    try {
      await ch.permissionOverwrites.edit(guild.roles.everyone.id, {
        SendMessages: null,
      });
    } catch {}
  }
}

// ====== EVENTS ======
client.once("clientReady", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  try {
    // verify button
    if (interaction.isButton()) {
      if (interaction.customId === "verify_me") {
        const role = interaction.guild.roles.cache.find((r) => r.name === "Verified");
        if (!role) return interaction.reply({ content: "❌ Verified role not found. Run /setup.", ephemeral: true });

        await interaction.member.roles.add(role);
        return interaction.reply({ content: "✅ You are verified!", ephemeral: true });
      }
    }

    // slash commands
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "ping") {
      return interaction.reply(`🏓 Pong! ${client.ws.ping}ms`);
    }

    if (interaction.commandName === "setup") {
      if (!isOwner(interaction.user.id)) {
        return interaction.reply({ content: "❌ Only Owner can use this.", ephemeral: true });
      }
      await interaction.reply("⚙️ Running setup...");
      await runSetup(interaction.guild);
      return interaction.editReply("✅ Setup done!");
    }
  } catch (err) {
    console.error(err);
    if (interaction.replied || interaction.deferred) {
      interaction.editReply("❌ Error happened.");
    } else {
      interaction.reply({ content: "❌ Error happened.", ephemeral: true });
    }
  }
});

// prefix + no-prefix
client.on("messageCreate", async (message) => {
  try {
    if (!message.guild) return;
    if (message.author.bot) return;

    const content = message.content.trim();

    // PREFIX COMMANDS
    if (content.startsWith(PREFIX)) {
      const args = content.slice(PREFIX.length).trim().split(/\s+/);
      const cmd = (args.shift() || "").toLowerCase();

      if (cmd === "ping") return message.reply(`🏓 Pong! ${client.ws.ping}ms`);
      if (cmd === "help") return message.reply(HELP_TEXT);

      if (cmd === "setup") {
        if (!isOwner(message.author.id)) return message.reply("❌ Owner only.");
        await message.reply("⚙️ Running setup...");
        await runSetup(message.guild);
        return message.reply("✅ Setup done!");
      }

      return;
    }

    // OWNER NO-PREFIX ONLY IN #ai-chat
    const aiChannel = message.guild.channels.cache.find((c) => c.name === "ai-chat");
    const isInAI = aiChannel && message.channel.id === aiChannel.id;

    if (isInAI && isOwner(message.author.id)) {
      // confirm flow
      const pending = getPendingConfirm(message.author.id);
      if (pending && content.toUpperCase() === "YES") {
        const guild = client.guilds.cache.get(pending.guildId);
        if (!guild) {
          clearPendingConfirm(message.author.id);
          return message.reply("❌ Guild not found.");
        }

        if (pending.action === "HIDE_ALL") {
          await message.reply("⏳ Hiding all channels...");
          await hideAllChannels(guild);
          clearPendingConfirm(message.author.id);
          return message.reply("✅ Done. All channels hidden for @everyone.");
        }

        if (pending.action === "UNHIDE_ALL") {
          await message.reply("⏳ Unhiding all channels...");
          await unhideAllChannels(guild);
          clearPendingConfirm(message.author.id);
          return message.reply("✅ Done. All channels unhidden.");
        }

        if (pending.action === "LOCK") {
          await message.reply("⏳ Locking server...");
          await lockServer(guild);
          clearPendingConfirm(message.author.id);
          return message.reply("✅ Server locked.");
        }

        if (pending.action === "UNLOCK") {
          await message.reply("⏳ Unlocking server...");
          await unlockServer(guild);
          clearPendingConfirm(message.author.id);
          return message.reply("✅ Server unlocked.");
        }

        clearPendingConfirm(message.author.id);
        return message.reply("✅ Confirmed.");
      }

      // owner AI admin intent
      const text = content.toLowerCase();

      // quick commands
      if (text === "help" || text === "cmd" || text === "commands") {
        return message.reply(HELP_TEXT);
      }

      if (text.includes("hide all channels")) {
        setPendingConfirm(message.author.id, { action: "HIDE_ALL", guildId: message.guild.id });
        return message.reply("⚠️ Confirm? Type **YES** to proceed (60s).");
      }

      if (text.includes("unhide all channels") || text.includes("show all channels")) {
        setPendingConfirm(message.author.id, { action: "UNHIDE_ALL", guildId: message.guild.id });
        return message.reply("⚠️ Confirm? Type **YES** to proceed (60s).");
      }

      if (text === "lock server" || text.includes("lockdown")) {
        setPendingConfirm(message.author.id, { action: "LOCK", guildId: message.guild.id });
        return message.reply("⚠️ Confirm? Type **YES** to proceed (60s).");
      }

      if (text === "unlock server") {
        setPendingConfirm(message.author.id, { action: "UNLOCK", guildId: message.guild.id });
        return message.reply("⚠️ Confirm? Type **YES** to proceed (60s).");
      }

      if (text.includes("setup") && text.includes("verification")) {
        await message.reply("⚙️ Running setup...");
        await runSetup(message.guild);
        return message.reply("✅ Setup done!");
      }

      // AI Chat fallback
      const prompt = `You are a helpful Discord server assistant.
User message: ${content}
Reply short and helpful.`;

      const aiReply = await askGemini(prompt);
      return message.reply(aiReply.slice(0, 1900));
    }
  } catch (err) {
    console.error("messageCreate error:", err);
  }
});

// ====== START ======
(async () => {
  try {
    await registerSlashCommands();
    await client.login(DISCORD_TOKEN);
  } catch (e) {
    console.error("Startup error:", e);
  }
})();
