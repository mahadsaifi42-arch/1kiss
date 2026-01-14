require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  PermissionsBitField,
  ChannelType,
} = require("discord.js");

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  getVoiceConnection,
} = require("@discordjs/voice");

const ytdl = require("ytdl-core");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
if (!DISCORD_TOKEN) throw new Error("❌ Missing DISCORD_TOKEN in env");

const prefix = "$";

// ===== CUSTOM EMOJIS =====
const EMOJI = {
  ok: "<a:TICK_TICK:1214893859151286272>",
  no: "<a:4NDS_wrong:1458407390419615756>",
  lock: "<a:lock_keyggchillhaven:1307838252568412202>",
  music: "<a:Music:1438190819512422447>",
  headphones: "<:0041_headphones:1443333046823813151>",
  question: "<a:question:1264568031019925545>",
};

// ===== CONFIG =====
const OWNER_IDS = (process.env.OWNER_IDS || "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

// ===== Memory DB (in RAM) =====
const afkMap = new Map(); // userId -> { reason, since }
const wlDB = new Map(); // guildId -> { ban:Set, mute:Set, prefixless:Set, advertise:Set, spam:Set }

// Music per guild
const musicDB = new Map(); // guildId -> { queue:[], player, connection, playing }

// ===== CLIENT =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember],
});

// ===== Xlare style embed =====
function xlareEmbed(title, desc) {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(title)
    .setDescription(desc)
    .setFooter({ text: "Questy MultiBot • Xlare Theme" })
    .setTimestamp();
}

function isOwner(userId) {
  return OWNER_IDS.includes(userId);
}

function ensureGuildWL(guildId) {
  if (!wlDB.has(guildId)) {
    wlDB.set(guildId, {
      ban: new Set(),
      mute: new Set(),
      prefixless: new Set(),
      advertise: new Set(),
      spam: new Set(),
    });
  }
  return wlDB.get(guildId);
}

function isAdmin(member) {
  if (!member) return false;
  return (
    member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    member.permissions.has(PermissionsBitField.Flags.ManageGuild)
  );
}

function hasWL(member, type) {
  if (!member || !member.guild) return false;
  const data = ensureGuildWL(member.guild.id);
  return data[type]?.has(member.id);
}

function canUsePrefixless(member) {
  if (!member) return false;
  if (isOwner(member.id)) return true;
  return hasWL(member, "prefixless") || isAdmin(member);
}

function canUseMod(member, type) {
  if (!member) return false;
  if (isOwner(member.id)) return true;
  if (isAdmin(member)) return true;
  return hasWL(member, type);
}

// ===== MUSIC HELPERS =====
function getMusic(guildId) {
  if (!musicDB.has(guildId)) {
    const player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    });

    musicDB.set(guildId, {
      queue: [],
      player,
      connection: null,
      playing: false,
    });

    player.on(AudioPlayerStatus.Idle, () => {
      playNext(guildId).catch(() => {});
    });

    player.on("error", (err) => {
      console.log("Music error:", err.message);
      playNext(guildId).catch(() => {});
    });
  }
  return musicDB.get(guildId);
}

async function playNext(guildId) {
  const music = getMusic(guildId);
  if (!music.connection) return;

  const next = music.queue.shift();
  if (!next) {
    music.playing = false;
    return;
  }

  music.playing = true;

  const stream = ytdl(next.url, {
    filter: "audioonly",
    quality: "highestaudio",
    highWaterMark: 1 << 25,
  });

  const resource = createAudioResource(stream);
  music.player.play(resource);
  music.connection.subscribe(music.player);
}

// ===== READY =====
client.once("ready", () => {
  console.log(`${EMOJI.ok} Logged in as ${client.user.tag}`);
});

// ===== MESSAGE CREATE =====
client.on("messageCreate", async (message) => {
  try {
    if (!message.guild) return;
    if (message.author.bot) return;

    // ===== AFK mention check =====
    if (message.mentions.users.size > 0) {
      for (const [id, user] of message.mentions.users) {
        const afk = afkMap.get(id);
        if (afk) {
          const sinceMin = Math.floor((Date.now() - afk.since) / 60000);
          const embed = xlareEmbed(
            `${EMOJI.question} AFK Notice`,
            `👤 **${user.username}** is AFK\n📝 **Reason:** ${afk.reason}\n⏱️ **Since:** ${sinceMin} min ago\n🔗 **Message:** [Jump](${message.url})`
          );
          await message.reply({ embeds: [embed] });
        }
      }
    }

    // ===== Remove AFK when user talks =====
    if (afkMap.has(message.author.id)) {
      afkMap.delete(message.author.id);
      const embed = xlareEmbed(`${EMOJI.ok} Welcome back!`, `AFK removed.`);
      await message.reply({ embeds: [embed] });
      // continue; (still allow commands)
    }

    // ===== PREFIXLESS DETECTION =====
    const content = message.content.trim();

    const usedPrefix = content.startsWith(prefix);
    const isPrefixless = !usedPrefix;

    // Prefixless commands list (ONLY WL/OWNER)
    const prefixlessCommands = [
      "ban",
      "kick",
      "mute",
      "unmute",
      "lock",
      "unlock",
      "purge",
      "wl",
      "unwl",
      "wlshow",
    ];

    let cmd = "";
    let args = [];

    if (usedPrefix) {
      const parts = content.slice(prefix.length).trim().split(/\s+/);
      cmd = (parts.shift() || "").toLowerCase();
      args = parts;
    } else {
      const parts = content.split(/\s+/);
      const first = (parts[0] || "").toLowerCase();

      // IMPORTANT: silent unless it is allowed command
      if (!prefixlessCommands.includes(first)) return;

      if (!canUsePrefixless(message.member)) return;

      cmd = first;
      args = parts.slice(1);
    }

    if (!cmd) return;

    // ===== HELP =====
    if (cmd === "help") {
      const embed = xlareEmbed(
        `📌 Commands Panel`,
        `**Prefix:** \`${prefix}\`\n\n` +
          `**Basic:**\n` +
          `\`${prefix}ping\` → latency\n` +
          `\`${prefix}afk <reason>\` → set AFK\n\n` +
          `**Music (Everyone):**\n` +
          `${EMOJI.headphones} \`${prefix}join\`\n` +
          `${EMOJI.music} \`${prefix}play <youtube url>\`\n` +
          `${EMOJI.music} \`${prefix}skip\`\n` +
          `${EMOJI.music} \`${prefix}stop\`\n` +
          `${EMOJI.headphones} \`${prefix}leave\`\n\n` +
          `**Mod (WL/Owner/Admin):**\n` +
          `\`${prefix}ban @user reason\` (or prefixless: \`ban @user\`)\n` +
          `\`${prefix}mute @user 10m reason\` (or prefixless: \`mute @user 10m\`)\n` +
          `\`${prefix}lock\` / \`${prefix}unlock\` (or prefixless)\n` +
          `\`${prefix}purge 50\` (or prefixless)\n\n` +
          `**Whitelist:**\n` +
          `\`${prefix}wl add <type> @user\`\n` +
          `\`${prefix}wl remove <type> @user\`\n` +
          `\`${prefix}wlshow\`\n\n` +
          `Types: \`ban\` \`mute\` \`prefixless\` \`advertise\` \`spam\``
      );
      return message.reply({ embeds: [embed] });
    }

    // ===== PING =====
    if (cmd === "ping") {
      const embed = xlareEmbed(`${EMOJI.ok} Pong!`, `Latency: **${client.ws.ping}ms**`);
      return message.reply({ embeds: [embed] });
    }

    // ===== AFK =====
    if (cmd === "afk") {
      const reason = args.join(" ") || "None";
      afkMap.set(message.author.id, { reason, since: Date.now() });

      const embed = xlareEmbed(
        `${EMOJI.ok} AFK Enabled`,
        `${EMOJI.ok} **You're now set AFK**\n📝 **Reason:** ${reason}\n👤 **Set by:** ${message.author}`
      );

      return message.reply({ embeds: [embed] });
    }

    // ===== WHITELIST =====
    if (cmd === "wl" || cmd === "unwl" || cmd === "wlshow") {
      if (!isOwner(message.author.id) && !isAdmin(message.member)) {
        const embed = xlareEmbed(`${EMOJI.no} No Access`, `Only Admin/Owner can manage WL.`);
        return message.reply({ embeds: [embed] });
      }

      const data = ensureGuildWL(message.guild.id);

      if (cmd === "wlshow") {
        const embed = xlareEmbed(
          `📋 Whitelist Status`,
          `**ban:** ${data.ban.size}\n` +
            `**mute:** ${data.mute.size}\n` +
            `**prefixless:** ${data.prefixless.size}\n` +
            `**advertise:** ${data.advertise.size}\n` +
            `**spam:** ${data.spam.size}`
        );
        return message.reply({ embeds: [embed] });
      }

      const action = args[0]?.toLowerCase(); // add/remove
      const type = args[1]?.toLowerCase();
      const user = message.mentions.users.first();

      if (!action || !type || !user) {
        const embed = xlareEmbed(
          `⚠️ Usage`,
          `\`${prefix}wl add <type> @user\`\n\`${prefix}wl remove <type> @user\`\nTypes: ban mute prefixless advertise spam`
        );
        return message.reply({ embeds: [embed] });
      }

      if (!data[type]) {
        const embed = xlareEmbed(`${EMOJI.no} Invalid Type`, `Valid: ban mute prefixless advertise spam`);
        return message.reply({ embeds: [embed] });
      }

      if (action === "add") {
        data[type].add(user.id);
        const embed = xlareEmbed(`${EMOJI.ok} WL Updated`, `Added **${user.tag}** to **${type}** WL`);
        return message.reply({ embeds: [embed] });
      }

      if (action === "remove") {
        data[type].delete(user.id);
        const embed = xlareEmbed(`${EMOJI.ok} WL Updated`, `Removed **${user.tag}** from **${type}** WL`);
        return message.reply({ embeds: [embed] });
      }

      const embed = xlareEmbed(`${EMOJI.question} Unknown`, `Use add/remove only.`);
      return message.reply({ embeds: [embed] });
    }

    // ===== LOCK / UNLOCK (current channel) =====
    if (cmd === "lock" || cmd === "unlock") {
      if (!canUseMod(message.member, "spam")) {
        const embed = xlareEmbed(`${EMOJI.no} No Access`, `You are not allowed to lock/unlock.`);
        return message.reply({ embeds: [embed] });
      }

      const channel = message.channel;
      const everyone = message.guild.roles.everyone;

      if (cmd === "lock") {
        await channel.permissionOverwrites.edit(everyone, { SendMessages: false });
        const embed = xlareEmbed(`${EMOJI.lock} Locked`, `Locked by ${message.author}`);
        return message.reply({ embeds: [embed] });
      } else {
        await channel.permissionOverwrites.edit(everyone, { SendMessages: null });
        const embed = xlareEmbed(`${EMOJI.lock} Unlocked`, `Unlocked by ${message.author}`);
        return message.reply({ embeds: [embed] });
      }
    }

    // ===== PURGE =====
    if (cmd === "purge") {
      if (!canUseMod(message.member, "spam")) {
        const embed = xlareEmbed(`${EMOJI.no} No Access`, `You are not allowed to purge.`);
        return message.reply({ embeds: [embed] });
      }

      const amount = parseInt(args[0], 10);
      if (!amount || amount < 1 || amount > 100) {
        const embed = xlareEmbed(`⚠️ Usage`, `\`${prefix}purge 1-100\``);
        return message.reply({ embeds: [embed] });
      }

      await message.channel.bulkDelete(amount, true);
      const embed = xlareEmbed(`${EMOJI.ok} Purged`, `Deleted **${amount}** messages.`);
      return message.channel.send({ embeds: [embed] });
    }

    // ===== BAN =====
    if (cmd === "ban") {
      if (!canUseMod(message.member, "ban")) {
        const embed = xlareEmbed(`${EMOJI.no} No Access`, `You are not allowed to ban.`);
        return message.reply({ embeds: [embed] });
      }

      const user = message.mentions.users.first();
      if (!user) {
        const embed = xlareEmbed(`⚠️ Usage`, `\`${prefix}ban @user reason\``);
        return message.reply({ embeds: [embed] });
      }

      const reason = args.slice(1).join(" ") || "No reason";
      const member = await message.guild.members.fetch(user.id).catch(() => null);

      if (!member) {
        const embed = xlareEmbed(`${EMOJI.no} Error`, `User not found in server.`);
        return message.reply({ embeds: [embed] });
      }

      await member.ban({ reason }).catch(() => null);
      const embed = xlareEmbed(`${EMOJI.ok} Banned`, `👤 **${user.tag}**\n📝 **Reason:** ${reason}`);
      return message.reply({ embeds: [embed] });
    }

    // ===== KICK =====
    if (cmd === "kick") {
      if (!canUseMod(message.member, "ban")) {
        const embed = xlareEmbed(`${EMOJI.no} No Access`, `You are not allowed to kick.`);
        return message.reply({ embeds: [embed] });
      }

      const user = message.mentions.users.first();
      if (!user) {
        const embed = xlareEmbed(`⚠️ Usage`, `\`${prefix}kick @user reason\``);
        return message.reply({ embeds: [embed] });
      }

      const reason = args.slice(1).join(" ") || "No reason";
      const member = await message.guild.members.fetch(user.id).catch(() => null);

      if (!member) {
        const embed = xlareEmbed(`${EMOJI.no} Error`, `User not found in server.`);
        return message.reply({ embeds: [embed] });
      }

      await member.kick(reason).catch(() => null);
      const embed = xlareEmbed(`${EMOJI.ok} Kicked`, `👤 **${user.tag}**\n📝 **Reason:** ${reason}`);
      return message.reply({ embeds: [embed] });
    }

    // ===== MUTE / UNMUTE =====
    if (cmd === "mute" || cmd === "unmute") {
      if (!canUseMod(message.member, "mute")) {
        const embed = xlareEmbed(`${EMOJI.no} No Access`, `You are not allowed to mute/unmute.`);
        return message.reply({ embeds: [embed] });
      }

      const user = message.mentions.users.first();
      if (!user) {
        const embed = xlareEmbed(`⚠️ Usage`, `\`${prefix}${cmd} @user 10m reason\``);
        return message.reply({ embeds: [embed] });
      }

      const member = await message.guild.members.fetch(user.id).catch(() => null);
      if (!member) {
        const embed = xlareEmbed(`${EMOJI.no} Error`, `User not found in server.`);
        return message.reply({ embeds: [embed] });
      }

      if (cmd === "unmute") {
        await member.timeout(null).catch(() => null);
        const embed = xlareEmbed(`${EMOJI.ok} Unmuted`, `👤 **${user.tag}** unmuted.`);
        return message.reply({ embeds: [embed] });
      }

      const timeArg = args[1] || "10m";
      const reason = args.slice(2).join(" ") || "No reason";

      const match = timeArg.match(/^(\d+)(s|m|h|d)$/);
      if (!match) {
        const embed = xlareEmbed(`⚠️ Invalid Time`, `Use: 10m / 1h / 30s / 1d`);
        return message.reply({ embeds: [embed] });
      }

      const num = parseInt(match[1], 10);
      const unit = match[2];

      let ms = 0;
      if (unit === "s") ms = num * 1000;
      if (unit === "m") ms = num * 60 * 1000;
      if (unit === "h") ms = num * 60 * 60 * 1000;
      if (unit === "d") ms = num * 24 * 60 * 60 * 1000;

      await member.timeout(ms, reason).catch(() => null);

      const embed = xlareEmbed(
        `${EMOJI.ok} Muted`,
        `👤 **${user.tag}**\n⏱️ **Time:** ${timeArg}\n📝 **Reason:** ${reason}`
      );
      return message.reply({ embeds: [embed] });
    }

    // ===== MUSIC (Everyone) =====
    if (cmd === "join") {
      const vc = message.member.voice.channel;
      if (!vc) {
        const embed = xlareEmbed(`${EMOJI.headphones} Join`, `You must be in a voice channel.`);
        return message.reply({ embeds: [embed] });
      }

      const music = getMusic(message.guild.id);
      music.connection = joinVoiceChannel({
        channelId: vc.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator,
        selfDeaf: true,
      });

      const embed = xlareEmbed(`${EMOJI.headphones} Connected`, `Joined **${vc.name}**`);
      return message.reply({ embeds: [embed] });
    }

    if (cmd === "leave") {
      const conn = getVoiceConnection(message.guild.id);
      if (conn) conn.destroy();

      const music = getMusic(message.guild.id);
      music.queue = [];
      music.playing = false;

      const embed = xlareEmbed(`${EMOJI.ok} Disconnected`, `Left voice channel.`);
      return message.reply({ embeds: [embed] });
    }

    if (cmd === "play") {
      const url = args[0];
      if (!url || !ytdl.validateURL(url)) {
        const embed = xlareEmbed(`${EMOJI.music} Play`, `Usage: \`${prefix}play <youtube-url>\``);
        return message.reply({ embeds: [embed] });
      }

      const vc = message.member.voice.channel;
      if (!vc) {
        const embed = xlareEmbed(`${EMOJI.headphones} Voice Required`, `Join a voice channel first.`);
        return message.reply({ embeds: [embed] });
      }

      const music = getMusic(message.guild.id);

      if (!music.connection) {
        music.connection = joinVoiceChannel({
          channelId: vc.id,
          guildId: message.guild.id,
          adapterCreator: message.guild.voiceAdapterCreator,
          selfDeaf: true,
        });
      }

      music.queue.push({ url });

      const embed = xlareEmbed(`${EMOJI.music} Added`, `🔗 ${url}`);
      await message.reply({ embeds: [embed] });

      if (!music.playing) {
        await playNext(message.guild.id);
      }
      return;
    }

    if (cmd === "skip") {
      const music = getMusic(message.guild.id);
      music.player.stop(true);
      const embed = xlareEmbed(`${EMOJI.ok} Skipped`, `Skipped current track.`);
      return message.reply({ embeds: [embed] });
    }

    if (cmd === "stop") {
      const music = getMusic(message.guild.id);
      music.queue = [];
      music.player.stop(true);
      const embed = xlareEmbed(`${EMOJI.ok} Stopped`, `Queue cleared and stopped.`);
      return message.reply({ embeds: [embed] });
    }

    // ===== UNKNOWN (only if prefix used) =====
    if (usedPrefix) {
      return message.reply(`${EMOJI.question} Unknown command. Use \`$help\``);
    }
  } catch (err) {
    console.log("Error:", err);
  }
});

// ===== LOGIN =====
client.login(DISCORD_TOKEN);
