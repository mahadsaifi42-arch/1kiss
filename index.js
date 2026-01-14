/**
 * Questy AI + Music Bot (ONE FILE)
 * Discord.js v14
 *
 * Features:
 * ✅ /setup -> creates #ai-chat (Owner only) + #mod-logs
 * ✅ /help -> commands list
 * ✅ Owner NO-PREFIX commands work ANYWHERE in the server
 * ✅ AI replies ONLY inside #ai-chat (Owner only)
 * 🎶 Music: /play /skip /stop /pause /resume /queue
 *
 * Render ENV:
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
  SlashCommandBuilder,
  REST,
  Routes,
} = require("discord.js");

const { GoogleGenerativeAI } = require("@google/generative-ai");

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  getVoiceConnection,
} = require("@discordjs/voice");

const playdl = require("play-dl");

// ================== ENV ==================
const TOKEN = process.env.DISCORD_TOKEN;
const OWNER_ID = process.env.OWNER_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!TOKEN) throw new Error("❌ DISCORD_TOKEN missing (Render Environment)");
if (!OWNER_ID) throw new Error("❌ OWNER_ID missing (Render Environment)");

// Gemini init
const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

// ================== CLIENT ==================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ================== STATE ==================
const pendingConfirmations = new Map(); // ownerId -> { action, createdAt }
const music = new Map(); // guildId -> { queue, player, connection, playing }

function isOwner(id) {
  return id === OWNER_ID;
}
function isExpired(ts, ms = 30000) {
  return Date.now() - ts > ms;
}

// ================== HELPERS ==================
async function ensureChannel(guild, name, type = ChannelType.GuildText) {
  let ch = guild.channels.cache.find((c) => c.name === name);
  if (!ch) {
    ch = await guild.channels.create({
      name,
      type,
      reason: "Auto setup by Questy bot",
    });
  }
  return ch;
}

async function ensureAiChannelOwnerOnly(guild) {
  let ai = guild.channels.cache.find((c) => c.name === "ai-chat");
  if (!ai) {
    ai = await guild.channels.create({
      name: "ai-chat",
      type: ChannelType.GuildText,
      reason: "AI channel setup",
    });
  }

  await ai.permissionOverwrites.set([
    {
      id: guild.roles.everyone.id,
      deny: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
      ],
    },
    {
      id: OWNER_ID,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
      ],
    },
  ]);

  return ai;
}

async function logToModLogs(guild, content) {
  const ch = guild.channels.cache.find((c) => c.name === "mod-logs");
  if (ch) ch.send({ content }).catch(() => {});
}

// ================== OWNER ACTIONS ==================
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
      reason: "Owner command: create channels",
    });
  }
}

async function deleteEmptyTextChannels(guild) {
  for (const [, ch] of guild.channels.cache) {
    if (ch.type !== ChannelType.GuildText) continue;
    try {
      const msgs = await ch.messages.fetch({ limit: 1 });
      if (msgs.size === 0) await ch.delete("Owner command: delete empty channels");
    } catch {}
  }
}

// ================== SLASH COMMANDS ==================
const commands = [
  new SlashCommandBuilder().setName("ping").setDescription("Check bot latency"),
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Setup AI channel + mod logs (Owner only)"),
  new SlashCommandBuilder().setName("help").setDescription("Show commands list"),

  // MUSIC
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a song in your voice channel")
    .addStringOption((opt) =>
      opt.setName("query").setDescription("Song name or URL").setRequired(true)
    ),

  new SlashCommandBuilder().setName("skip").setDescription("Skip current song"),
  new SlashCommandBuilder().setName("stop").setDescription("Stop music and leave"),
  new SlashCommandBuilder().setName("pause").setDescription("Pause music"),
  new SlashCommandBuilder().setName("resume").setDescription("Resume music"),
  new SlashCommandBuilder().setName("queue").setDescription("Show queue"),
].map((c) => c.toJSON());

// ================== REGISTER COMMANDS ==================
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

// ================== MUSIC ==================
function getGuildMusic(guildId) {
  if (!music.has(guildId)) {
    music.set(guildId, {
      queue: [],
      player: createAudioPlayer({
        behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
      }),
      connection: null,
      playing: false,
    });
  }
  return music.get(guildId);
}

async function playNext(guild, textChannel) {
  const state = getGuildMusic(guild.id);
  const next = state.queue.shift();

  if (!next) {
    state.playing = false;
    return;
  }

  state.playing = true;

  try {
    const stream = await playdl.stream(next.url);
    const resource = createAudioResource(stream.stream, { inputType: stream.type });

    state.player.play(resource);

    await textChannel.send(`🎶 Now playing: **${next.title}**`);
    await logToModLogs(guild, `🎶 Music playing: ${next.title}`);
  } catch (e) {
    await textChannel.send("❌ Failed to play this track. Trying next...");
    state.playing = false;
    return playNext(guild, textChannel);
  }
}

// ================== INTERACTIONS ==================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const guild = interaction.guild;

  if (interaction.commandName === "ping") {
    return interaction.reply({
      content: `🏓 Pong! ${client.ws.ping}ms`,
      ephemeral: true,
    });
  }

  if (interaction.commandName === "help") {
    return interaction.reply({
      ephemeral: true,
      content: `📌 **Questy AI + Music Bot Commands**
/ping - bot latency
/setup - create #ai-chat (owner only) + #mod-logs
/help - show commands list

🎶 **Music**
/play <song/url>
/skip
/stop
/pause
/resume
/queue

🤖 **Owner No-Prefix (ANYWHERE)**
hide all channels (YES confirm)
unhide all channels
lock server (YES confirm)
unlock server
create 5 text channels named test
delete all empty channels (YES confirm)

💡 AI Chat:
Only in #ai-chat, owner can chat with Gemini AI.`,
    });
  }

  if (interaction.commandName === "setup") {
    if (!isOwner(interaction.user.id)) {
      return interaction.reply({ content: "❌ Owner only.", ephemeral: true });
    }
    if (!guild) {
      return interaction.reply({ content: "❌ Use in a server.", ephemeral: true });
    }

    await interaction.reply({ content: "⚙️ Setting up AI channel...", ephemeral: true });

    await ensureChannel(guild, "mod-logs");
    const aiCh = await ensureAiChannelOwnerOnly(guild);

    await logToModLogs(guild, `✅ AI-CHAT setup completed by <@${interaction.user.id}>`);

    return interaction.followUp({
      content: `✅ Done! AI Channel: ${aiCh}\nOnly Owner can access it.`,
      ephemeral: true,
    });
  }

  // ===== MUSIC COMMANDS =====
  if (interaction.commandName === "play") {
    if (!guild) return interaction.reply({ content: "❌ Use in server.", ephemeral: true });

    const member = interaction.member;
    const voice = member?.voice?.channel;
    if (!voice) {
      return interaction.reply({
        content: "❌ Join a voice channel first.",
        ephemeral: true,
      });
    }

    const query = interaction.options.getString("query", true);
    await interaction.reply({ content: "🔎 Searching...", ephemeral: true });

    const state = getGuildMusic(guild.id);

    if (!state.connection) {
      state.connection = joinVoiceChannel({
        channelId: voice.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
      });
      state.connection.subscribe(state.player);
    }

    let track = null;
    try {
      if (playdl.yt_validate(query) === "video") {
        const info = await playdl.video_info(query);
        track = { title: info.video_details.title, url: query };
      } else {
        const results = await playdl.search(query, { limit: 1 });
        if (!results.length) throw new Error("No results");
        track = { title: results[0].title, url: results[0].url };
      }
    } catch {
      return interaction.editReply({ content: "❌ Song not found / failed to fetch." });
    }

    state.queue.push(track);
    await interaction.editReply({ content: `✅ Added to queue: **${track.title}**` });

    if (!state.playing) {
      state.player.on(AudioPlayerStatus.Idle, async () => {
        const ch =
          guild.channels.cache.find((c) => c.name === "ai-chat") ||
          guild.systemChannel ||
          interaction.channel;
        if (!ch) return;
        await playNext(guild, ch);
      });

      const ch =
        guild.channels.cache.find((c) => c.name === "ai-chat") || interaction.channel;
      await playNext(guild, ch);
    }
  }

  if (interaction.commandName === "queue") {
    const state = getGuildMusic(guild.id);
    if (!state.queue.length) {
      return interaction.reply({ content: "📭 Queue is empty.", ephemeral: true });
    }
    const list = state.queue.slice(0, 10).map((t, i) => `${i + 1}. ${t.title}`).join("\n");
    return interaction.reply({ content: `🎶 **Queue:**\n${list}`, ephemeral: true });
  }

  if (interaction.commandName === "skip") {
    const state = getGuildMusic(guild.id);
    state.player.stop();
    return interaction.reply({ content: "⏭️ Skipped.", ephemeral: true });
  }

  if (interaction.commandName === "pause") {
    const state = getGuildMusic(guild.id);
    state.player.pause();
    return interaction.reply({ content: "⏸️ Paused.", ephemeral: true });
  }

  if (interaction.commandName === "resume") {
    const state = getGuildMusic(guild.id);
    state.player.unpause();
    return interaction.reply({ content: "▶️ Resumed.", ephemeral: true });
  }

  if (interaction.commandName === "stop") {
    const state = getGuildMusic(guild.id);
    state.queue = [];
    state.player.stop();

    const conn = getVoiceConnection(guild.id);
    if (conn) conn.destroy();

    state.connection = null;
    state.playing = false;

    return interaction.reply({ content: "🛑 Stopped and left VC.", ephemeral: true });
  }
});

// ================== GEMINI ==================
async function geminiReply(prompt) {
  if (!genAI) return null;

  // FIXED MODEL NAME:
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

  const result = await model.generateContent(prompt);
  return result.response.text();
}

// ================== OWNER NO-PREFIX INTENT PARSER ==================
function parseSimpleIntent(text) {
  const t = text.toLowerCase().trim();

  if (t === "yes") return { intent: "confirm_yes" };
  if (t === "no") return { intent: "confirm_no" };

  if (t.includes("hide all channels")) return { intent: "hide_all_channels", danger: true };
  if (t.includes("unhide all channels") || t.includes("show all channels"))
    return { intent: "unhide_all_channels" };

  if (t.includes("lock server") || t.includes("lockdown"))
    return { intent: "lock_server", danger: true };

  if (t.includes("unlock server")) return { intent: "unlock_server" };

  const createMatch = t.match(/create\s+(\d+)\s+text\s+channels?\s+named\s+(.+)/i);
  if (createMatch) {
    return {
      intent: "create_channels",
      count: parseInt(createMatch[1], 10),
      name:
        createMatch[2]
          .replace(/[^a-z0-9\- ]/gi, "")
          .trim()
          .replace(/\s+/g, "-") || "channel",
    };
  }

  if (t.includes("delete all empty channels"))
    return { intent: "delete_empty_channels", danger: true };

  return { intent: "chat" };
}

// ================== OWNER NO-PREFIX (ANYWHERE) ==================
client.on("messageCreate", async (message) => {
  try {
    if (!message.guild) return;
    if (message.author.bot) return;
    if (!isOwner(message.author.id)) return;

    const guild = message.guild;

    // expire old confirmation
    const pending = pendingConfirmations.get(message.author.id);
    if (pending && isExpired(pending.createdAt)) {
      pendingConfirmations.delete(message.author.id);
    }

    const text = message.content.trim();
    const simple = parseSimpleIntent(text);

    // Confirm YES/NO
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
        return message.reply("🧹 Done. Deleted empty channels (best-effort).");
      }

      return message.reply("✅ Confirmed.");
    }

    if (simple.intent === "confirm_no") {
      pendingConfirmations.delete(message.author.id);
      return message.reply("❎ Cancelled.");
    }

    // Actions
    if (simple.intent === "hide_all_channels") {
      pendingConfirmations.set(message.author.id, {
        action: "hide_all_channels",
        createdAt: Date.now(),
      });
      return message.reply("⚠️ Confirm? Type **YES** to proceed (30s).");
    }

    if (simple.intent === "unhide_all_channels") {
      await unhideAllChannels(guild);
      await logToModLogs(guild, `🛡️ Owner used: UNHIDE ALL CHANNELS`);
      return message.reply("✅ Done. All channels visible again.");
    }

    if (simple.intent === "lock_server") {
      pendingConfirmations.set(message.author.id, {
        action: "lock_server",
        createdAt: Date.now(),
      });
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
      return message.reply(
        `✅ Created ${simple.count} text channels named **${simple.name}-1...**`
      );
    }

    if (simple.intent === "delete_empty_channels") {
      pendingConfirmations.set(message.author.id, {
        action: "delete_empty_channels",
        createdAt: Date.now(),
      });
      return message.reply("⚠️ Confirm delete empty channels? Type **YES** to proceed (30s).");
    }

    // AI chat ONLY in #ai-chat
    if (simple.intent === "chat") {
      if (message.channel.name !== "ai-chat") return;

      if (!genAI) {
        return message.reply("🤖 AI disabled. Add GEMINI_API_KEY in Render Environment.");
      }

      const ai = await geminiReply(text);
      if (!ai) return message.reply("❌ AI error.");

      return message.reply(ai.slice(0, 1800));
    }
  } catch (e) {
    console.log("messageCreate error:", e?.message || e);
  }
});

client.login(TOKEN);