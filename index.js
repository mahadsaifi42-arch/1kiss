/**
 * Questy Multipurpose Security + AI Bot (ONE FILE) - GEMINI AI STUDIO VERSION
 * Discord.js v14
 *
 * Features:
 * - /setup (auto channels + roles + verify button + ai-chat owner-only)
 * - Owner-only no-prefix AI admin commands (in #ai-chat)
 * - Confirmation system for destructive actions
 * - Basic logs to #mod-logs
 * - Gemini AI Studio (Google Generative AI) optional for chat
 *
 * Install:
 *   npm i discord.js dotenv @google/generative-ai
 * Run:
 *   node index.js
 *
 * .env:
 *   DISCORD_TOKEN=...
 *   OWNER_ID=...
 *   GEMINI_API_KEY=...
 */

require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder
} = require("discord.js");

const { GoogleGenerativeAI } = require("@google/generative-ai");

// ================== CONFIG ==================
const TOKEN = process.env.DISCORD_TOKEN;
const OWNER_ID = process.env.OWNER_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!TOKEN) throw new Error("❌ DISCORD_TOKEN missing in .env");
if (!OWNER_ID) throw new Error("❌ OWNER_ID missing in .env");

const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

// ================== CLIENT ==================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ================== SIMPLE IN-MEM STATE ==================
const pendingConfirmations = new Map(); 
// key: ownerId -> { action, guildId, createdAt, payload }

function isOwner(userId) {
  return userId === OWNER_ID;
}

function isExpired(ts, ms = 30000) {
  return Date.now() - ts > ms;
}

async function ensureRole(guild, roleName) {
  let role = guild.roles.cache.find(r => r.name === roleName);
  if (!role) {
    role = await guild.roles.create({
      name: roleName,
      reason: "Auto setup by bot"
    });
  }
  return role;
}

async function ensureChannel(guild, name, type = ChannelType.GuildText) {
  let ch = guild.channels.cache.find(c => c.name === name);
  if (!ch) {
    ch = await guild.channels.create({
      name,
      type,
      reason: "Auto setup by bot"
    });
  }
  return ch;
}

async function ensureAiChannelOwnerOnly(guild) {
  let ai = guild.channels.cache.find(c => c.name === "ai-chat");
  if (!ai) {
    ai = await guild.channels.create({
      name: "ai-chat",
      type: ChannelType.GuildText,
      reason: "AI channel setup"
    });
  }

  // Lock channel for everyone
  await ai.permissionOverwrites.set([
    {
      id: guild.roles.everyone.id,
      deny: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
    },
    {
      id: OWNER_ID,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory
      ]
    }
  ]);

  return ai;
}

async function logToModLogs(guild, content) {
  const ch = guild.channels.cache.find(c => c.name === "mod-logs");
  if (ch) ch.send({ content }).catch(() => {});
}

async function lockServer(guild) {
  const everyone = guild.roles.everyone;
  for (const [, ch] of guild.channels.cache) {
    try {
      await ch.permissionOverwrites.edit(everyone, { SendMessages: false });
    } catch {}
  }
}

async function unlockServer(guild) {
  const everyone = guild.roles.everyone;
  for (const [, ch] of guild.channels.cache) {
    try {
      await ch.permissionOverwrites.edit(everyone, { SendMessages: null });
    } catch {}
  }
}

async function hideAllChannels(guild) {
  const everyone = guild.roles.everyone;
  for (const [, ch] of guild.channels.cache) {
    try {
      await ch.permissionOverwrites.edit(everyone, { ViewChannel: false });
    } catch {}
  }
}

async function unhideAllChannels(guild) {
  const everyone = guild.roles.everyone;
  for (const [, ch] of guild.channels.cache) {
    try {
      await ch.permissionOverwrites.edit(everyone, { ViewChannel: null });
    } catch {}
  }
}

async function createTextChannels(guild, count, baseName) {
  const n = Math.min(Math.max(count, 1), 50);
  for (let i = 1; i <= n; i++) {
    await guild.channels.create({
      name: `${baseName}-${i}`,
      type: ChannelType.GuildText,
      reason: "Owner AI command: create channels"
    });
  }
}

async function deleteEmptyTextChannels(guild) {
  for (const [, ch] of guild.channels.cache) {
    if (ch.type !== ChannelType.GuildText) continue;
    try {
      const msgs = await ch.messages.fetch({ limit: 1 });
      if (msgs.size === 0) {
        await ch.delete("Owner AI command: delete empty channels");
      }
    } catch {}
  }
}

// ================== SLASH COMMANDS ==================
const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check bot latency"),

  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Auto create channels + roles + verification + AI channel (Owner only)")
].map(c => c.toJSON());

// ================== REGISTER SLASH COMMANDS ON READY ==================
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log("✅ Slash commands registered globally.");
  } catch (e) {
    console.log("❌ Slash command register error:", e?.message || e);
  }
});

// ================== INTERACTIONS ==================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "ping") {
    return interaction.reply({ content: `🏓 Pong! ${client.ws.ping}ms`, ephemeral: true });
  }

  if (interaction.commandName === "setup") {
    if (!isOwner(interaction.user.id)) {
      return interaction.reply({ content: "❌ Owner only.", ephemeral: true });
    }

    const guild = interaction.guild;
    if (!guild) return interaction.reply({ content: "❌ Use in server.", ephemeral: true });

    await interaction.reply({ content: "⚙️ Setting up server...", ephemeral: true });

    // Roles
    const verifiedRole = await ensureRole(guild, "Verified");
    await ensureRole(guild, "Muted");
    await ensureRole(guild, "Quarantine");

    // Channels
    await ensureChannel(guild, "welcome");
    await ensureChannel(guild, "rules");
    const verifyCh = await ensureChannel(guild, "verify");
    await ensureChannel(guild, "mod-logs");
    await ensureChannel(guild, "invite-logs");
    await ensureChannel(guild, "message-logs");
    const aiCh = await ensureAiChannelOwnerOnly(guild);

    // Verify button
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("verify_me")
        .setLabel("✅ Verify")
        .setStyle(ButtonStyle.Success)
    );

    const embed = new EmbedBuilder()
      .setTitle("🔒 Verification")
      .setDescription("Click the button below to get **Verified** role.")
      .setFooter({ text: "Questy Security Bot" });

    await verifyCh.send({ embeds: [embed], components: [row] });

    await logToModLogs(guild, `✅ Setup completed by <@${interaction.user.id}>`);

    return interaction.followUp({
      content: `✅ Setup done!\nAI Channel: ${aiCh}\nVerify Channel: ${verifyCh}`,
      ephemeral: true
    });
  }
});

// ================== BUTTON VERIFY ==================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;
  if (interaction.customId !== "verify_me") return;

  const guild = interaction.guild;
  const member = interaction.member;
  if (!guild || !member) return;

  const verifiedRole = guild.roles.cache.find(r => r.name === "Verified");
  if (!verifiedRole) {
    return interaction.reply({ content: "❌ Verified role not found. Run /setup first.", ephemeral: true });
  }

  if (member.roles.cache.has(verifiedRole.id)) {
    return interaction.reply({ content: "✅ You are already verified.", ephemeral: true });
  }

  await member.roles.add(verifiedRole, "User verified via button");
  await interaction.reply({ content: "✅ Verified! You can now chat.", ephemeral: true });

  await logToModLogs(guild, `✅ <@${member.id}> verified.`);
});

// ================== GEMINI AI ==================
async function geminiReply(prompt) {
  if (!genAI) return null;

  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  const result = await model.generateContent(prompt);
  return result.response.text();
}

function parseSimpleIntent(text) {
  const t = text.toLowerCase().trim();

  if (t === "yes") return { intent: "confirm_yes" };
  if (t === "no") return { intent: "confirm_no" };

  if (t.includes("hide all channels")) return { intent: "hide_all_channels", danger: true };
  if (t.includes("unhide all channels") || t.includes("show all channels")) return { intent: "unhide_all_channels", danger: false };
  if (t.includes("lock server") || t.includes("lockdown")) return { intent: "lock_server", danger: true };
  if (t.includes("unlock server")) return { intent: "unlock_server", danger: false };

  const createMatch = t.match(/create\s+(\d+)\s+text\s+channels?\s+named\s+(.+)/i);
  if (createMatch) {
    return {
      intent: "create_channels",
      danger: false,
      count: parseInt(createMatch[1], 10),
      name: createMatch[2].replace(/[^a-z0-9\- ]/gi, "").trim().replace(/\s+/g, "-") || "channel"
    };
  }

  if (t.includes("delete all empty channels")) return { intent: "delete_empty_channels", danger: true };

  return { intent: "chat" };
}

// ================== OWNER NO-PREFIX AI CHAT ==================
client.on("messageCreate", async (message) => {
  try {
    if (!message.guild) return;
    if (message.author.bot) return;

    // Only Owner no-prefix
    if (!isOwner(message.author.id)) return;

    // Only inside #ai-chat
    if (message.channel.name !== "ai-chat") return;

    const guild = message.guild;

    // Expire old confirmations
    const pending = pendingConfirmations.get(message.author.id);
    if (pending && isExpired(pending.createdAt)) {
      pendingConfirmations.delete(message.author.id);
    }

    const text = message.content.trim();
    const simple = parseSimpleIntent(text);

    // Confirmation flow
    if (simple.intent === "confirm_yes") {
      const p = pendingConfirmations.get(message.author.id);
      if (!p) return message.reply("❌ Nothing to confirm.");

      pendingConfirmations.delete(message.author.id);

      if (p.action === "hide_all_channels") {
        await hideAllChannels(guild);
        await logToModLogs(guild, `🛡️ Owner used: HIDE ALL CHANNELS`);
        return message.reply("✅ Done. All channels hidden for @everyone.");
      }

      if (p.action === "lock_server") {
        await lockServer(guild);
        await logToModLogs(guild, `🛡️ Owner used: LOCK SERVER`);
        return message.reply("🔒 Done. Server locked.");
      }

      if (p.action === "delete_empty_channels") {
        await deleteEmptyTextChannels(guild);
        await logToModLogs(guild, `🛡️ Owner used: DELETE EMPTY CHANNELS`);
        return message.reply("🧹 Done. Deleted empty text channels (best-effort).");
      }

      return message.reply("✅ Confirmed. Action executed.");
    }

    if (simple.intent === "confirm_no") {
      pendingConfirmations.delete(message.author.id);
      return message.reply("❎ Cancelled.");
    }

    // Direct intents
    if (simple.intent === "hide_all_channels") {
      pendingConfirmations.set(message.author.id, { action: "hide_all_channels", guildId: guild.id, createdAt: Date.now() });
      return message.reply("⚠️ Confirm? Type **YES** to proceed (30s).");
    }

    if (simple.intent === "unhide_all_channels") {
      await unhideAllChannels(guild);
      await logToModLogs(guild, `🛡️ Owner used: UNHIDE ALL CHANNELS`);
      return message.reply("✅ Done. All channels visible again (default perms).");
    }

    if (simple.intent === "lock_server") {
      pendingConfirmations.set(message.author.id, { action: "lock_server", guildId: guild.id, createdAt: Date.now() });
      return message.reply("⚠️ Confirm lockdown? Type **YES** to proceed (30s).");
    }

    if (simple.intent === "unlock_server") {
      await unlockServer(guild);
      await logToModLogs(guild, `🛡️ Owner used: UNLOCK SERVER`);
      return message.reply("🔓 Done. Server unlocked.");
    }

    if (simple.intent === "create_channels") {
      await createTextChannels(guild, simple.count, simple.name);
      await logToModLogs(guild, `🛠️ Owner created ${simple.count} channels: ${simple.name}-*`);
      return message.reply(`✅ Created ${simple.count} text channels named **${simple.name}-1...**`);
    }

    if (simple.intent === "delete_empty_channels") {
      pendingConfirmations.set(message.author.id, { action: "delete_empty_channels", guildId: guild.id, createdAt: Date.now() });
      return message.reply("⚠️ Confirm delete empty channels? Type **YES** to proceed (30s).");
    }

    // Gemini AI chat reply
    if (simple.intent === "chat") {
      if (!genAI) {
        return message.reply("🤖 AI disabled. Add GEMINI_API_KEY in .env to enable AI.");
      }

      const ai = await geminiReply(text);
      if (!ai) return message.reply("❌ AI error.");

      return message.reply(ai.slice(0, 1800));
    }
  } catch (e) {
    console.log("messageCreate error:", e?.message || e);
  }
});

// ================== LOGIN ==================
client.login(TOKEN);
