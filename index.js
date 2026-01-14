/**
 * 1Love MultiBot (Xlare Style) - One File
 * - Prefix commands for everyone: $
 * - Prefixless commands only for WL users
 * - Black embeds + custom emojis
 * - Welcome/Leave + AutoRole
 * - AutoReply + AutoReaction
 * - Reaction Roles (Buttons)
 * - VC join/leave logs
 *
 * ENV:
 * DISCORD_TOKEN=xxxx
 * PREFIX=$
 * PORT=10000
 */

require("dotenv").config();
const express = require("express");

const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
if (!DISCORD_TOKEN) throw new Error("❌ Missing DISCORD_TOKEN in env");

const PREFIX = process.env.PREFIX || "$";
const PORT = process.env.PORT || 10000;

// ===== Render keep-alive web =====
const app = express();
app.get("/", (req, res) => res.send("1Love MultiBot running ✅"));
app.listen(PORT, () => console.log("🌐 Web alive on port", PORT));

// ===== Emojis (YOUR IDs) =====
const EMOJI = {
  ok: "<a:TICK_TICK:1214893859151286272>",
  no: "<a:4NDS_wrong:1458407390419615756>",
  lock: "<a:lock_keyggchillhaven:1307838252568412202>",
  music: "<a:Music:1438190819512422447>",
  headphones: "<:0041_headphones:1443333046823813151>",
  q: "<a:question:1264568031019925545>",
};

// ===== Embed style (BLACK) =====
const BLACK = 0x000000;
function xlare(title, desc) {
  return new EmbedBuilder().setColor(BLACK).setTitle(title).setDescription(desc);
}

// ===== Simple settings (edit here) =====
const SETTINGS = {
  welcomeEnabled: true,
  leaveEnabled: true,
  autoRoleEnabled: false, // turn ON if you want auto role
  autoRoleId: "", // put role ID here if enabled
  welcomeChannelName: "welcome",
  logsChannelName: "mod-logs",
  vcLogsChannelName: "voice-logs",
};

// ===== Auto Reply + Auto Reaction (edit here) =====
const AUTO_REPLY = [
  { trigger: "hi", reply: "hey 👋" },
  { trigger: "hello", reply: "hello bro 😈" },
  { trigger: "gm", reply: "good morning ☀️" },
];

const AUTO_REACTION = [
  { trigger: "lol", emoji: "😂" },
  { trigger: "love", emoji: "❤️" },
];

// ===== Whitelist System (in-memory) =====
// NOTE: Render restart pe reset ho jayega
const WL = {
  prefixless: new Set(),
  ban: new Set(),
  mute: new Set(),
  lock: new Set(),
  purge: new Set(),
  advertise: new Set(),
  spam: new Set(),
};

// ===== AFK System =====
const AFK = new Map(); // userId => { reason, since }

// ===== Client =====
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

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ===== Helpers =====
function isOwner(member) {
  return member?.id === member?.guild?.ownerId;
}

function isAdmin(member) {
  return (
    member?.permissions?.has(PermissionsBitField.Flags.Administrator) || isOwner(member)
  );
}

function parseArgs(str) {
  return str.trim().split(/\s+/);
}

function getMentionedUser(message) {
  return message.mentions.users.first() || null;
}

function cleanId(arg) {
  if (!arg) return null;
  const m = arg.match(/^<@!?(\d+)>$/);
  if (m) return m[1];
  if (/^\d+$/.test(arg)) return arg;
  return null;
}

function hasWL(member, type) {
  if (!member) return false;
  if (isAdmin(member)) return true;
  return WL[type]?.has(member.id);
}

function formatSince(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

async function getOrCreateChannel(guild, name) {
  let ch = guild.channels.cache.find((c) => c.name === name);
  if (!ch) {
    ch = await guild.channels.create({
      name,
      reason: "Auto setup channel",
    });
  }
  return ch;
}

async function logTo(guild, channelName, embed) {
  try {
    const ch = guild.channels.cache.find((c) => c.name === channelName);
    if (ch) await ch.send({ embeds: [embed] });
  } catch {}
}

// ===== Welcome / Leave =====
client.on("guildMemberAdd", async (member) => {
  try {
    if (SETTINGS.autoRoleEnabled && SETTINGS.autoRoleId) {
      const role = member.guild.roles.cache.get(SETTINGS.autoRoleId);
      if (role) await member.roles.add(role).catch(() => {});
    }

    if (!SETTINGS.welcomeEnabled) return;

    const welcomeCh = await getOrCreateChannel(member.guild, SETTINGS.welcomeChannelName);
    const emb = xlare(
      `${EMOJI.ok} Welcome`,
      `Welcome ${member} to **${member.guild.name}**!\nEnjoy your stay 😈`
    );
    await welcomeCh.send({ embeds: [emb] });
  } catch {}
});

client.on("guildMemberRemove", async (member) => {
  try {
    if (!SETTINGS.leaveEnabled) return;

    const welcomeCh = await getOrCreateChannel(member.guild, SETTINGS.welcomeChannelName);
    const emb = xlare(`${EMOJI.no} Member Left`, `**${member.user.tag}** left the server.`);
    await welcomeCh.send({ embeds: [emb] });
  } catch {}
});

// ===== VC Logs =====
client.on("voiceStateUpdate", async (oldState, newState) => {
  try {
    const guild = newState.guild;
    const user = newState.member?.user;

    if (!user) return;

    // join
    if (!oldState.channelId && newState.channelId) {
      const emb = xlare(
        `${EMOJI.ok} VC Join`,
        `${user.tag} joined <#${newState.channelId}>`
      );
      await logTo(guild, SETTINGS.vcLogsChannelName, emb);
    }

    // leave
    if (oldState.channelId && !newState.channelId) {
      const emb = xlare(
        `${EMOJI.no} VC Leave`,
        `${user.tag} left <#${oldState.channelId}>`
      );
      await logTo(guild, SETTINGS.vcLogsChannelName, emb);
    }
  } catch {}
});

// ===== Reaction Roles (Buttons) =====
// command: $rr create @role1 @role2
async function sendReactionRolePanel(message, roles) {
  const row = new ActionRowBuilder();
  roles.slice(0, 5).forEach((r, i) => {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`rr_${r.id}`)
        .setLabel(r.name)
        .setStyle(ButtonStyle.Secondary)
    );
  });

  const emb = xlare(`${EMOJI.ok} Roles`, `Click buttons to get roles.`);
  await message.channel.send({ embeds: [emb], components: [row] });
}

client.on("interactionCreate", async (interaction) => {
  try {
    if (!interaction.isButton()) return;
    if (!interaction.guild) return;

    if (!interaction.customId.startsWith("rr_")) return;

    const roleId = interaction.customId.replace("rr_", "");
    const role = interaction.guild.roles.cache.get(roleId);

    if (!role) return interaction.reply({ content: "Role not found.", ephemeral: true });

    const member = await interaction.guild.members.fetch(interaction.user.id);

    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId).catch(() => {});
      return interaction.reply({ content: `Removed: ${role.name}`, ephemeral: true });
    } else {
      await member.roles.add(roleId).catch(() => {});
      return interaction.reply({ content: `Added: ${role.name}`, ephemeral: true });
    }
  } catch (e) {
    try {
      return interaction.reply({ content: "Error.", ephemeral: true });
    } catch {}
  }
});

// ===== Message Commands =====
client.on("messageCreate", async (message) => {
  try {
    if (!message.guild) return;
    if (message.author.bot) return;

    const content = message.content.trim();
    const lower = content.toLowerCase();

    // ===== AFK remove on message =====
    if (AFK.has(message.author.id)) {
      const data = AFK.get(message.author.id);
      AFK.delete(message.author.id);

      const emb = xlare(
        `${EMOJI.ok} Welcome back!`,
        `I removed your AFK.\nYou were AFK since **${formatSince(Date.now() - data.since)}** ago.`
      );
      await message.reply({ embeds: [emb] }).catch(() => {});
    }

    // ===== AFK mention reply =====
    if (message.mentions.users.size > 0) {
      for (const [id] of message.mentions.users) {
        if (AFK.has(id)) {
          const data = AFK.get(id);
          const emb = xlare(
            `${EMOJI.q} AFK`,
            `<@${id}> is AFK\n**Reason:** ${data.reason}\n**Since:** ${formatSince(
              Date.now() - data.since
            )} ago`
          );
          await message.reply({ embeds: [emb] }).catch(() => {});
          break;
        }
      }
    }

    // ===== Auto Reply (only if NOT command) =====
    if (!content.startsWith(PREFIX)) {
      for (const item of AUTO_REPLY) {
        if (lower === item.trigger) {
          await message.reply(item.reply).catch(() => {});
          break;
        }
      }

      for (const item of AUTO_REACTION) {
        if (lower.includes(item.trigger)) {
          await message.react(item.emoji).catch(() => {});
          break;
        }
      }
    }

    // ===== Command Detection =====
    const isPrefix = content.startsWith(PREFIX);

    // Prefixless allowed ONLY for WL.prefixless
    const prefixlessAllowed = [
      "ban",
      "unban",
      "kick",
      "mute",
      "unmute",
      "lock",
      "unlock",
      "hide",
      "unhide",
      "purge",
    ];

    const firstWord = content.split(/\s+/)[0]?.toLowerCase();
    const isPrefixless =
      prefixlessAllowed.includes(firstWord) && hasWL(message.member, "prefixless");

    if (!isPrefix && !isPrefixless) return;

    // ===== Parse command =====
    let cmdText = "";
    if (isPrefix) cmdText = content.slice(PREFIX.length).trim();
    else cmdText = content;

    const parts = parseArgs(cmdText);
    const cmd = parts.shift()?.toLowerCase();

    // ===== Commands =====
    if (cmd === "ping") {
      const emb = xlare(`${EMOJI.ok} Pong!`, `Latency: **${client.ws.ping}ms**`);
      return message.reply({ embeds: [emb] });
    }

    if (cmd === "help") {
      const emb = xlare(
        `${EMOJI.q} Help`,
        `**Prefix:** \`${PREFIX}\`\n\n` +
          `**Public:** \`${PREFIX}help\`, \`${PREFIX}ping\`, \`${PREFIX}afk\`\n` +
          `**Moderation:** ban/unban/kick/mute/unmute\n` +
          `**Channel:** lock/unlock/hide/unhide\n` +
          `**Utility:** purge\n` +
          `**Whitelist:** \`${PREFIX}wl add/remove/list\`\n` +
          `**Reaction Roles:** \`${PREFIX}rr create @role1 @role2 ...\`\n\n` +
          `${EMOJI.ok} Whitelisted users can use commands without prefix.`
      );
      return message.reply({ embeds: [emb] });
    }

    // AFK
    if (cmd === "afk") {
      const reason = parts.join(" ") || "AFK";
      AFK.set(message.author.id, { reason, since: Date.now() });

      const emb = xlare(
        `${EMOJI.ok} AFK Enabled`,
        `You're now set AFK.\n**Reason:** ${reason}`
      );
      return message.reply({ embeds: [emb] });
    }

    // WL
    if (cmd === "wl") {
      if (!isAdmin(message.member) && !isOwner(message.member)) {
        const emb = xlare(`${EMOJI.no} No Permission`, `Only Admin/Owner can use this.`);
        return message.reply({ embeds: [emb] });
      }

      const action = (parts.shift() || "").toLowerCase();
      const type = (parts.shift() || "").toLowerCase();
      const user = message.mentions.users.first();

      if (!["add", "remove", "list"].includes(action)) {
        const emb = xlare(
          `${EMOJI.q} Whitelist`,
          `Usage:\n\`${PREFIX}wl add prefixless @user\`\n\`${PREFIX}wl remove prefixless @user\`\n\`${PREFIX}wl list\``
        );
        return message.reply({ embeds: [emb] });
      }

      if (action === "list") {
        const emb = xlare(
          `${EMOJI.q} Whitelist List`,
          `prefixless: **${WL.prefixless.size}**\nban: **${WL.ban.size}**\nmute: **${WL.mute.size}**\nlock: **${WL.lock.size}**\npurge: **${WL.purge.size}**`
        );
        return message.reply({ embeds: [emb] });
      }

      if (!WL[type]) {
        const emb = xlare(
          `${EMOJI.no} Invalid Type`,
          `Valid: prefixless, ban, mute, lock, purge, advertise, spam`
        );
        return message.reply({ embeds: [emb] });
      }

      if (!user) {
        const emb = xlare(`${EMOJI.no} Invalid User`, `Mention a valid user.`);
        return message.reply({ embeds: [emb] });
      }

      if (action === "add") {
        WL[type].add(user.id);
        const emb = xlare(`${EMOJI.ok} Whitelisted`, `Added ${user} to **${type}** WL.`);
        return message.reply({ embeds: [emb] });
      }

      if (action === "remove") {
        WL[type].delete(user.id);
        const emb = xlare(`${EMOJI.ok} Removed`, `Removed ${user} from **${type}** WL.`);
        return message.reply({ embeds: [emb] });
      }
    }

    // RR Panel
    if (cmd === "rr" && parts[0] === "create") {
      if (!isAdmin(message.member)) {
        const emb = xlare(`${EMOJI.no} No Permission`, `Admin only.`);
        return message.reply({ embeds: [emb] });
      }

      const roleMentions = message.mentions.roles;
      if (!roleMentions || roleMentions.size === 0) {
        const emb = xlare(
          `${EMOJI.q} Reaction Roles`,
          `Usage: \`${PREFIX}rr create @Role1 @Role2\``
        );
        return message.reply({ embeds: [emb] });
      }

      return sendReactionRolePanel(message, [...roleMentions.values()]);
    }

    // LOCK / UNLOCK
    if (cmd === "lock") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
        const emb = xlare(`${EMOJI.no} No Permission`, `Need **Manage Channels**.`);
        return message.reply({ embeds: [emb] });
      }

      await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, {
        SendMessages: false,
      });

      const emb = xlare(`${EMOJI.lock} Locked`, `${EMOJI.lock} Channel locked successfully.`);
      return message.reply({ embeds: [emb] });
    }

    if (cmd === "unlock") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
        const emb = xlare(`${EMOJI.no} No Permission`, `Need **Manage Channels**.`);
        return message.reply({ embeds: [emb] });
      }

      await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, {
        SendMessages: true,
      });

      const emb = xlare(`${EMOJI.ok} Unlocked`, `${EMOJI.ok} Channel unlocked successfully.`);
      return message.reply({ embeds: [emb] });
    }

    // HIDE / UNHIDE
    if (cmd === "hide") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
        const emb = xlare(`${EMOJI.no} No Permission`, `Need **Manage Channels**.`);
        return message.reply({ embeds: [emb] });
      }

      await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, {
        ViewChannel: false,
      });

      const emb = xlare(`${EMOJI.lock} Hidden`, `${EMOJI.lock} Channel hidden successfully.`);
      return message.reply({ embeds: [emb] });
    }

    if (cmd === "unhide") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
        const emb = xlare(`${EMOJI.no} No Permission`, `Need **Manage Channels**.`);
        return message.reply({ embeds: [emb] });
      }

      await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, {
        ViewChannel: true,
      });

      const emb = xlare(`${EMOJI.ok} Unhidden`, `${EMOJI.ok} Channel unhidden successfully.`);
      return message.reply({ embeds: [emb] });
    }

    // PURGE
    if (cmd === "purge") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        const emb = xlare(`${EMOJI.no} No Permission`, `Need **Manage Messages**.`);
        return message.reply({ embeds: [emb] });
      }

      const amount = parseInt(parts[0], 10);
      if (!amount || amount < 1 || amount > 100) {
        const emb = xlare(`${EMOJI.no} Invalid`, `Usage: \`${PREFIX}purge 1-100\``);
        return message.reply({ embeds: [emb] });
      }

      await message.channel.bulkDelete(amount, true).catch(() => {});
      const emb = xlare(`${EMOJI.ok} Purged`, `${EMOJI.ok} Deleted **${amount}** messages.`);
      const sent = await message.channel.send({ embeds: [emb] });
      setTimeout(() => sent.delete().catch(() => {}), 3000);
      return;
    }

    // BAN / UNBAN / KICK / MUTE / UNMUTE
    if (cmd === "ban") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
        const emb = xlare(`${EMOJI.no} No Permission`, `Need **Ban Members**.`);
        return message.reply({ embeds: [emb] });
      }

      const user = getMentionedUser(message);
      if (!user) {
        const emb = xlare(`${EMOJI.no} Invalid User`, `You didn't provide a valid user.`);
        return message.reply({ embeds: [emb] });
      }

      const reason = parts.slice(1).join(" ") || "No reason";
      await message.guild.members.ban(user.id, { reason }).catch(() => {});
      const emb = xlare(`${EMOJI.ok} Banned`, `${EMOJI.ok} ${user.tag} banned.\nReason: ${reason}`);
      return message.reply({ embeds: [emb] });
    }

    if (cmd === "unban") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
        const emb = xlare(`${EMOJI.no} No Permission`, `Need **Ban Members**.`);
        return message.reply({ embeds: [emb] });
      }

      const id = cleanId(parts[0]);
      if (!id) {
        const emb = xlare(`${EMOJI.no} Invalid User`, `Usage: \`${PREFIX}unban userId\``);
        return message.reply({ embeds: [emb] });
      }

      await message.guild.members.unban(id).catch(() => {});
      const emb = xlare(`${EMOJI.ok} Unbanned`, `${EMOJI.ok} Unbanned **${id}**`);
      return message.reply({ embeds: [emb] });
    }

    if (cmd === "kick") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
        const emb = xlare(`${EMOJI.no} No Permission`, `Need **Kick Members**.`);
        return message.reply({ embeds: [emb] });
      }

      const user = getMentionedUser(message);
      if (!user) {
        const emb = xlare(`${EMOJI.no} Invalid User`, `You didn't provide a valid user.`);
        return message.reply({ embeds: [emb] });
      }

      const mem = await message.guild.members.fetch(user.id).catch(() => null);
      if (!mem) {
        const emb = xlare(`${EMOJI.no} Error`, `User not found.`);
        return message.reply({ embeds: [emb] });
      }

      await mem.kick().catch(() => {});
      const emb = xlare(`${EMOJI.ok} Kicked`, `${EMOJI.ok} ${user.tag} kicked.`);
      return message.reply({ embeds: [emb] });
    }

    if (cmd === "mute") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        const emb = xlare(`${EMOJI.no} No Permission`, `Need **Timeout Members**.`);
        return message.reply({ embeds: [emb] });
      }

      const user = getMentionedUser(message);
      if (!user) {
        const emb = xlare(`${EMOJI.no} Invalid User`, `You didn't provide a valid user.`);
        return message.reply({ embeds: [emb] });
      }

      const mem = await message.guild.members.fetch(user.id).catch(() => null);
      if (!mem) {
        const emb = xlare(`${EMOJI.no} Error`, `User not found.`);
        return message.reply({ embeds: [emb] });
      }

      const durationMs = 10 * 60 * 1000; // default 10m
      await mem.timeout(durationMs, "Muted").catch(() => {});
      const emb = xlare(`${EMOJI.ok} Muted`, `${EMOJI.ok} ${user.tag} muted for 10m.`);
      return message.reply({ embeds: [emb] });
    }

    if (cmd === "unmute") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        const emb = xlare(`${EMOJI.no} No Permission`, `Need **Timeout Members**.`);
        return message.reply({ embeds: [emb] });
      }

      const user = getMentionedUser(message);
      if (!user) {
        const emb = xlare(`${EMOJI.no} Invalid User`, `You didn't provide a valid user.
        client.login(DISCORD_TOKEN);
