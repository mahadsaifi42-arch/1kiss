require("dotenv").config();

const express = require("express");
const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  EmbedBuilder,
  ChannelType,
} = require("discord.js");

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  getVoiceConnection,
} = require("@discordjs/voice");

const playdl = require("play-dl");

// ================== ENV ==================
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const PREFIX = process.env.PREFIX || "$";
const PORT = Number(process.env.PORT || 10000);

if (!DISCORD_TOKEN) throw new Error("❌ Missing DISCORD_TOKEN in env");

// ================== WEB SERVER (Render Fix) ==================
const app = express();
app.get("/", (req, res) => res.send("Questy MultiBot is alive ✅"));
app.listen(PORT, () => console.log(`🌐 Web alive on port ${PORT}`));

// ================== EMOJIS (YOUR PROVIDED) ==================
const EMOJI = {
  ok: "<a:TICK_TICK:1214893859151286272>",
  no: "<a:4NDS_wrong:1458407390419615756>",
  lock: "<a:lock_keyggchillhaven:1307838252568412202>",
  unlock: "<a:lock_keyggchillhaven:1307838252568412202>",
  music: "<a:Music:1438190819512422447>",
  headphones: "<:0041_headphones:1443333046823813151>",
  question: "<a:question:1264568031019925545>",
};

// ================== CLIENT ==================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User, Partials.GuildMember],
});

// ================== HELPERS ==================
const BLACK = 0x000000;

function xlare(title, desc) {
  return new EmbedBuilder()
    .setColor(BLACK)
    .setDescription(`**${title}**\n${desc || ""}`)
    .setTimestamp();
}

function getMentionedUser(message) {
  const user =
    message.mentions.users.first() ||
    (message.content.split(" ").find((x) => /^\d{17,20}$/.test(x))
      ? client.users.cache.get(message.content.split(" ").find((x) => /^\d{17,20}$/.test(x)))
      : null);
  return user || null;
}

function parseDuration(arg) {
  // 10m, 1h, 30s
  if (!arg) return 10 * 60 * 1000;
  const m = arg.match(/^(\d+)(s|m|h|d)$/i);
  if (!m) return 10 * 60 * 1000;
  const num = parseInt(m[1]);
  const unit = m[2].toLowerCase();
  if (unit === "s") return num * 1000;
  if (unit === "m") return num * 60 * 1000;
  if (unit === "h") return num * 60 * 60 * 1000;
  if (unit === "d") return num * 24 * 60 * 60 * 1000;
  return 10 * 60 * 1000;
}

function msToTime(ms) {
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m <= 0) return `${s}s`;
  return `${m}m ${s}s`;
}

// ================== WHITELIST SYSTEM ==================
// per guild whitelist store in memory (simple)
const WL = new Map(); 
// WL structure: guildId -> { prefixless: Set(userId), ban: Set, mute: Set, lock: Set, purge: Set, hide: Set }

function getGuildWL(guildId) {
  if (!WL.has(guildId)) {
    WL.set(guildId, {
      prefixless: new Set(),
      ban: new Set(),
      mute: new Set(),
      lock: new Set(),
      purge: new Set(),
      hide: new Set(),
    });
  }
  return WL.get(guildId);
}

function isAdminOrOwner(member) {
  if (!member) return false;
  if (member.id === member.guild.ownerId) return true;
  return member.permissions.has(PermissionsBitField.Flags.Administrator);
}

function isWL(member, type) {
  if (!member?.guild) return false;
  const data = getGuildWL(member.guild.id);
  return data[type]?.has(member.id) || false;
}

// ================== AFK SYSTEM ==================
const AFK = new Map(); 
// userId -> { reason, time, byTag }

function setAfk(userId, reason, byTag) {
  AFK.set(userId, { reason: reason || "AFK", time: Date.now(), byTag });
}
function removeAfk(userId) {
  AFK.delete(userId);
}
function getAfk(userId) {
  return AFK.get(userId);
}

// ================== MUSIC SYSTEM ==================
const music = new Map(); 
// guildId -> { queue: [], player, connection, playing, textChannelId }

async function ensurePlayDl() {
  // refresh token if needed
  try {
    await playdl.getFreeClientID();
  } catch {}
}

function getMusicState(guildId) {
  if (!music.has(guildId)) {
    const player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    });
    music.set(guildId, {
      queue: [],
      player,
      connection: null,
      playing: false,
      textChannelId: null,
    });
  }
  return music.get(guildId);
}

async function playNext(guild, channel) {
  const state = getMusicState(guild.id);
  const next = state.queue.shift();

  if (!next) {
    state.playing = false;
    return;
  }

  state.playing = true;

  try {
    await ensurePlayDl();

    const stream = await playdl.stream(next.url, { quality: 2 });
    const resource = createAudioResource(stream.stream, {
      inputType: stream.type || StreamType.Arbitrary,
    });

    state.player.play(resource);

    const emb = xlare(
      `${EMOJI.music} Now Playing`,
      `**${next.title}**\nRequested by: <@${next.requestedBy}>`
    );
    channel.send({ embeds: [emb] }).catch(() => {});
  } catch (e) {
    const emb = xlare(`${EMOJI.no} Music Error`, `Failed to play.\n\`${String(e).slice(0, 120)}\``);
    channel.send({ embeds: [emb] }).catch(() => {});
    return playNext(guild, channel);
  }
}

// ================== READY ==================
client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ================== MESSAGE CREATE ==================
client.on("messageCreate", async (message) => {
  try {
    if (!message.guild) return;
    if (message.author.bot) return;

    const guildWL = getGuildWL(message.guild.id);

    // AFK mention reply
    const mentioned = message.mentions.users.first();
    if (mentioned) {
      const afkData = getAfk(mentioned.id);
      if (afkData) {
        const since = msToTime(Date.now() - afkData.time);
        const emb = xlare(
          `${EMOJI.question} AFK`,
          `<@${mentioned.id}> is AFK\nReason: **${afkData.reason}**\nSince: **${since} ago**`
        );
        message.reply({ embeds: [emb] }).catch(() => {});
      }
    }

    // AFK auto remove when user talks
    const myAfk = getAfk(message.author.id);
    if (myAfk) {
      removeAfk(message.author.id);
      const since = msToTime(Date.now() - myAfk.time);
      const emb = xlare(`${EMOJI.ok} Welcome back!`, `I removed your afk. You were afk since **${since} ago**`);
      message.reply({ embeds: [emb] }).catch(() => {});
    }

    // ============ PREFIXLESS SYSTEM ============
    // only these commands can run prefixless, and only if user has whitelist "prefixless"
    const raw = message.content.trim();
    const rawCmd = raw.split(/\s+/)[0]?.toLowerCase();

    const prefixlessAllowedCmds = [
      "lock",
      "unlock",
      "ban",
      "unban",
      "kick",
      "mute",
      "unmute",
      "purge",
      "hide",
      "unhide",
      "afk",
    ];

    const isPrefixlessCommand = prefixlessAllowedCmds.includes(rawCmd);

    // if message doesn't start with PREFIX, ignore completely unless:
    // 1) prefixless command + user is in prefixless whitelist
    if (!raw.startsWith(PREFIX)) {
      if (!isPrefixlessCommand) return;

      // must be whitelist prefixless
      if (!isWL(message.member, "prefixless") && !isAdminOrOwner(message.member)) {
        return; // no reply, silent like xlare
      }

      // handle prefixless command
      return handleCommand(message, rawCmd, raw.split(/\s+/).slice(1), true);
    }

    // ============ PREFIX COMMAND ============
    const args = raw.slice(PREFIX.length).trim().split(/\s+/);
    const cmd = args.shift()?.toLowerCase();

    if (!cmd) return;

    return handleCommand(message, cmd, args, false);
  } catch (e) {
    console.log("messageCreate error:", e);
  }
});

// ================== COMMAND HANDLER ==================
async function handleCommand(message, cmd, args, prefixlessMode) {
  const member = message.member;

  // ================== BASIC ==================
  if (cmd === "ping") {
    const emb = xlare(`${EMOJI.ok} Pong!`, `Latency: **${client.ws.ping}ms**`);
    return message.reply({ embeds: [emb] });
  }

  if (cmd === "help") {
    const emb = xlare(
      `${EMOJI.question} Commands`,
      [
        `**Moderation:**`,
        `\`${PREFIX}lock\` \`${PREFIX}unlock\` \`${PREFIX}hide\` \`${PREFIX}unhide\``,
        `\`${PREFIX}ban @user\` \`${PREFIX}unban userId\``,
        `\`${PREFIX}kick @user\``,
        `\`${PREFIX}mute @user 10m\` \`${PREFIX}unmute @user\``,
        `\`${PREFIX}purge 10\``,
        ``,
        `**AFK:**`,
        `\`${PREFIX}afk [reason]\``,
        ``,
        `**Whitelist (Admins/Owner only):**`,
        `\`${PREFIX}wl add @user prefixless\``,
        `\`${PREFIX}wl remove @user prefixless\``,
        `\`${PREFIX}wl list\``,
        ``,
        `**Music:**`,
        `\`${PREFIX}play <song/url>\``,
        `\`${PREFIX}skip\` \`${PREFIX}stop\` \`${PREFIX}queue\` \`${PREFIX}np\``,
        `\`${PREFIX}pause\` \`${PREFIX}resume\` \`${PREFIX}leave\``,
      ].join("\n")
    );
    return message.reply({ embeds: [emb] });
  }

  // ================== WHITELIST ==================
  if (cmd === "wl") {
    if (!isAdminOrOwner(member)) {
      const emb = xlare(`${EMOJI.no} No Permission`, `Only **Admins/Owner** can manage whitelist.`);
      return message.reply({ embeds: [emb] });
    }

    const sub = (args[0] || "").toLowerCase();
    const target = message.mentions.users.first();
    const type = (args[2] || args[1] || "").toLowerCase();

    const validTypes = ["prefixless", "ban", "mute", "lock", "purge", "hide"];

    if (sub === "list") {
      const g = getGuildWL(message.guild.id);

      const fmt = (set) => (set.size ? Array.from(set).map((id) => `<@${id}>`).join(", ") : "`None`");

      const emb = xlare(
        `${EMOJI.question} Whitelist`,
        [
          `**prefixless:** ${fmt(g.prefixless)}`,
          `**ban:** ${fmt(g.ban)}`,
          `**mute:** ${fmt(g.mute)}`,
          `**lock:** ${fmt(g.lock)}`,
          `**purge:** ${fmt(g.purge)}`,
          `**hide:** ${fmt(g.hide)}`,
        ].join("\n")
      );
      return message.reply({ embeds: [emb] });
    }

    if (!["add", "remove"].includes(sub) || !target || !validTypes.includes(type)) {
      const emb = xlare(
        `${EMOJI.no} Usage`,
        `\`${PREFIX}wl add @user prefixless\`\n\`${PREFIX}wl remove @user prefixless\`\n\`${PREFIX}wl list\``
      );
      return message.reply({ embeds: [emb] });
    }

    const g = getGuildWL(message.guild.id);

    if (sub === "add") {
      g[type].add(target.id);
      const emb = xlare(`${EMOJI.ok} Whitelisted`, `Added <@${target.id}> to **${type}** whitelist.`);
      return message.reply({ embeds: [emb] });
    } else {
      g[type].delete(target.id);
      const emb = xlare(`${EMOJI.ok} Removed`, `Removed <@${target.id}> from **${type}** whitelist.`);
      return message.reply({ embeds: [emb] });
    }
  }

  // ================== AFK ==================
  if (cmd === "afk") {
    const reason = args.join(" ") || "AFK";
    setAfk(message.author.id, reason, message.author.tag);

    const emb = xlare(`${EMOJI.ok} AFK Enabled`, `Reason: **${reason}**\nSet by **${message.author.username}**`);
    return message.reply({ embeds: [emb] });
  }

  // ================== MODERATION PERMISSIONS ==================
  // if command is prefixless, user must be in prefixless whitelist OR admin/owner
  // for actions like ban/mute/lock/hide, must also be whitelisted for that action OR admin/owner

  function needWL(type) {
    if (isAdminOrOwner(member)) return true;
    return isWL(member, type);
  }

  // ================== LOCK ==================
  if (cmd === "lock") {
    if (!needWL("lock")) return;

    const ch = message.channel;
    await ch.permissionOverwrites.edit(message.guild.roles.everyone, {
      SendMessages: false,
    });

    const emb = xlare(`${EMOJI.lock} Channel locked successfully.`, `Locked`);
    return message.reply({ embeds: [emb] });
  }

  if (cmd === "unlock") {
    if (!needWL("lock")) return;

    const ch = message.channel;
    await ch.permissionOverwrites.edit(message.guild.roles.everyone, {
      SendMessages: null,
    });

    const emb = xlare(`${EMOJI.unlock} Channel unlocked successfully.`, `Unlocked`);
    return message.reply({ embeds: [emb] });
  }

  // ================== HIDE / UNHIDE ==================
  if (cmd === "hide") {
    if (!needWL("hide")) return;

    const ch = message.channel;
    await ch.permissionOverwrites.edit(message.guild.roles.everyone, {
      ViewChannel: false,
    });

    const emb = xlare(`${EMOJI.lock} Channel hidden successfully.`, `Hidden`);
    return message.reply({ embeds: [emb] });
  }

  if (cmd === "unhide") {
    if (!needWL("hide")) return;

    const ch = message.channel;
    await ch.permissionOverwrites.edit(message.guild.roles.everyone, {
      ViewChannel: null,
    });

    const emb = xlare(`${EMOJI.unlock} Channel unhidden successfully.`, `Visible`);
    return message.reply({ embeds: [emb] });
  }

  // ================== BAN ==================
  if (cmd === "ban") {
    if (!needWL("ban")) return;

    if (!member.permissions.has(PermissionsBitField.Flags.BanMembers) && !isAdminOrOwner(member)) {
      const emb = xlare(`${EMOJI.no} No Permission`, `You need **Ban Members** permission.`);
      return message.reply({ embeds: [emb] });
    }

    const user = getMentionedUser(message);
    if (!user) {
      const emb = xlare(`${EMOJI.no} Invalid User`, `You didn't provide a valid user`);
      return message.reply({ embeds: [emb] });
    }

    const reason = args.slice(1).join(" ") || "No reason";
    await message.guild.members.ban(user.id, { reason }).catch(() => null);

    const emb = xlare(`${EMOJI.ok} Banned`, `${user.tag} was banned.\nReason: **${reason}**`);
    return message.reply({ embeds: [emb] });
  }

  if (cmd === "unban") {
    if (!needWL("ban")) return;

    const id = args[0];
    if (!id || !/^\d{17,20}$/.test(id)) {
      const emb = xlare(`${EMOJI.no} Invalid User`, `Give valid user id\nExample: \`${PREFIX}unban 123...\``);
      return message.reply({ embeds: [emb] });
    }

    await message.guild.members.unban(id).catch(() => null);
    const emb = xlare(`${EMOJI.ok} Unbanned`, `User **${id}** unbanned.`);
    return message.reply({ embeds: [emb] });
  }

  // ================== KICK ==================
  if (cmd === "kick") {
    if (!needWL("ban")) return;

    if (!member.permissions.has(PermissionsBitField.Flags.KickMembers) && !isAdminOrOwner(member)) {
      const emb = xlare(`${EMOJI.no} No Permission`, `You need **Kick Members** permission.`);
      return message.reply({ embeds: [emb] });
    }

    const user = getMentionedUser(message);
    if (!user) {
      const emb = xlare(`${EMOJI.no} Invalid User`, `You didn't provide a valid user`);
      return message.reply({ embeds: [emb] });
    }

    const m = await message.guild.members.fetch(user.id).catch(() => null);
    if (!m) {
      const emb = xlare(`${EMOJI.no} Not Found`, `User not in server`);
      return message.reply({ embeds: [emb] });
    }

    await m.kick("Kicked by bot").catch(() => null);
    const emb = xlare(`${EMOJI.ok} Kicked`, `${user.tag} was kicked.`);
    return message.reply({ embeds: [emb] });
  }

  // ================== MUTE ==================
  if (cmd === "mute") {
    if (!needWL("mute")) return;

    if (!member.permissions.has(PermissionsBitField.Flags.ModerateMembers) && !isAdminOrOwner(member)) {
      const emb = xlare(`${EMOJI.no} No Permission`, `You need **Timeout Members** permission.`);
      return message.reply({ embeds: [emb] });
    }

    const user = getMentionedUser(message);
    if (!user) {
      const emb = xlare(`${EMOJI.no} Invalid User`, `You didn't provide a valid user`);
      return message.reply({ embeds: [emb] });
    }

    const mem = await message.guild.members.fetch(user.id).catch(() => null);
    if (!mem) {
      const emb = xlare(`${EMOJI.no} Invalid User`, `User not found in server`);
      return message.reply({ embeds: [emb] });
    }

    const durationMs = parseDuration(args[1]);
    await mem.timeout(durationMs, "Muted").catch(() => {});

    const emb = xlare(`${EMOJI.ok} Muted`, `${user.tag} muted for **${msToTime(durationMs)}**`);
    return message.reply({ embeds: [emb] });
  }

  if (cmd === "unmute") {
    if (!needWL("mute")) return;

    if (!member.permissions.has(PermissionsBitField.Flags.ModerateMembers) && !isAdminOrOwner(member)) {
      const emb = xlare(`${EMOJI.no} No Permission`, `You need **Timeout Members** permission.`);
      return message.reply({ embeds: [emb] });
    }

    const user = getMentionedUser(message);
    if (!user) {
      const emb = xlare(`${EMOJI.no} Invalid User`, `You didn't provide a valid user`);
      return message.reply({ embeds: [emb] });
    }

    const mem = await message.guild.members.fetch(user.id).catch(() => null);
    if (!mem) {
      const emb = xlare(`${EMOJI.no} Invalid User`, `User not found in server`);
      return message.reply({ embeds: [emb] });
    }

    await mem.timeout(null).catch(() => {});
    const emb = xlare(`${EMOJI.ok} Unmuted`, `${user.tag} unmuted successfully.`);
    return message.reply({ embeds: [emb] });
  }

  // ================== PURGE ==================
  if (cmd === "purge") {
    if (!needWL("purge")) return;

    const amount = parseInt(args[0]);
    if (!amount || amount < 1 || amount > 100) {
      const emb = xlare(`${EMOJI.no} Invalid Amount`, `Use: \`${PREFIX}purge 1-100\``);
      return message.reply({ embeds: [emb] });
    }

    await message.channel.bulkDelete(amount, true).catch(() => null);
    const emb = xlare(`${EMOJI.ok} Purged`, `Deleted **${amount}** messages.`);
    return message.channel.send({ embeds: [emb] }).then((m) => setTimeout(() => m.delete().catch(() => {}), 3000));
  }

  // ================== MUSIC ==================
  if (cmd === "play") {
    const query = args.join(" ");
    if (!query) {
      const emb = xlare(`${EMOJI.no} Missing`, `Use: \`${PREFIX}play song name / url\``);
      return message.reply({ embeds: [emb] });
    }

    const vc = message.member.voice.channel;
    if (!vc || vc.type !== ChannelType.GuildVoice) {
      const emb = xlare(`${EMOJI.no} Join VC`, `Join a voice channel first.`);
      return message.reply({ embeds: [emb] });
    }

    const state = getMusicState(message.guild.id);
    state.textChannelId = message.channel.id;

    if (!state.connection) {
      state.connection = joinVoiceChannel({
        channelId: vc.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator,
        selfDeaf: true,
      });

      state.connection.subscribe(state.player);

      state.player.on(AudioPlayerStatus.Idle, () => {
        const ch = message.guild.channels.cache.get(state.textChannelId);
        if (ch) playNext(message.guild, ch);
      });
    }

    let info;
    try {
      if (playdl.yt_validate(query) === "video") {
        info = await playdl.video_basic_info(query);
      } else {
        const res = await playdl.search(query, { limit: 1 });
        if (!res?.length) throw new Error("No results");
        info = await playdl.video_basic_info(res[0].url);
      }
    } catch (e) {
      const emb = xlare(`${EMOJI.no} Not Found`, `No results found.`);
      return message.reply({ embeds: [emb] });
    }

    const video = info.video_details;
    state.queue.push({
      title: video.title,
      url: video.url,
      requestedBy: message.author.id,
    });

    const emb = xlare(`${EMOJI.music} Added to Queue`, `**${video.title}**`);
    message.reply({ embeds: [emb] }).catch(() => {});

    if (!state.playing) {
      await playNext(message.guild, message.channel);
    }
    return;
  }

  if (cmd === "queue") {
    const state = getMusicState(message.guild.id);
    if (!state.queue.length) {
      const emb = xlare(`${EMOJI.music} Queue`, "`Empty`");
      return message.reply({ embeds: [emb] });
    }

    const list = state.queue.slice(0, 10).map((x, i) => `**${i + 1}.** ${x.title}`).join("\n");
    const emb = xlare(`${EMOJI.music} Queue`, list);
    return message.reply({ embeds: [emb] });
  }

  if (cmd === "skip") {
    const state = getMusicState(message.guild.id);
    state.player.stop();
    const emb = xlare(`${EMOJI.ok} Skipped`, `Skipped current track.`);
    return message.reply({ embeds: [emb] });
  }

  if (cmd === "stop") {
    const state = getMusicState(message.guild.id);
    state.queue = [];
    state.player.stop();
    const emb = xlare(`${EMOJI.ok} Stopped`, `Stopped music & cleared queue.`);
    return message.reply({ embeds: [emb] });
  }

  if (cmd === "pause") {
    const state = getMusicState(message.guild.id);
    state.player.pause();
    const emb = xlare(`${EMOJI.ok} Paused`, `Paused music.`);
    return message.reply({ embeds: [emb] });
  }

  if (cmd === "resume") {
    const state = getMusicState(message.guild.id);
    state.player.unpause();
    const emb = xlare(`${EMOJI.ok} Resumed`, `Resumed music.`);
    return message.reply({ embeds: [emb] });
  }

  if (cmd === "leave") {
    const conn = getVoiceConnection(message.guild.id);
    if (conn) conn.destroy();
    music.delete(message.guild.id);

    const emb = xlare(`${EMOJI.ok} Disconnected`, `Left voice channel.`);
    return message.reply({ embeds: [emb] });
  }

  if (cmd === "np") {
    const emb = xlare(`${EMOJI.music} Now Playing`, `Use \`${PREFIX}queue\` to see list.`);
    return message.reply({ embeds: [emb] });
  }

  // ================== UNKNOWN COMMAND ==================
  // IMPORTANT: don't reply on every msg, only when it's a prefix command
  const emb = xlare(`${EMOJI.no} Unknown command`, `Use \`${PREFIX}help\``);
  return message.reply({ embeds: [emb] });
}

// ================== LOGIN ==================
client.login(DISCORD_TOKEN);
