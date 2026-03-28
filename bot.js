require('dotenv').config();
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder } = require('discord.js');


const db = require('./db');
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

const BOT_TOKEN  = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID  = process.env.DISCORD_CLIENT_ID;
const GUILD_ID   = process.env.DISCORD_GUILD_ID;
const CASINO_URL = process.env.CASINO_URL || 'http://localhost:3000';

// ── Register slash commands ──────────────────────────────
const commands = [
  new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Check your Santen Coins balance'),

  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Show the top Santen Coins holders'),

  new SlashCommandBuilder()
    .setName('give')
    .setDescription('Give Santen Coins to another member (admin only)')
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Amount to give').setRequired(true).setMinValue(1)),

  new SlashCommandBuilder()
    .setName('take')
    .setDescription('Remove Santen Coins from a member (admin only)')
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Amount to take').setRequired(true).setMinValue(1)),

  new SlashCommandBuilder()
    .setName('daily')
    .setDescription('Claim your daily Santen Coins reward'),

  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('View your gambling statistics'),

  new SlashCommandBuilder()
    .setName('casino')
    .setDescription('Get the link to the Santen Casino website'),
].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  try {
    console.log('📡 Registering slash commands...');
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('✅ Slash commands registered');
  } catch (e) { console.error('Failed to register commands:', e); }
}

// ── Helpers ──────────────────────────────────────────────
function fmt(n) { return Number(n).toLocaleString(); }
function getUser(discordId) {
  return db.getUser(discordId);
}
function isAdmin(member) {
  return member.permissions.has('Administrator') || member.permissions.has('ManageGuild');
}

// ── Event: Ready ──────────────────────────────────────────
client.once('ready', async () => {
  console.log(`\n🤖 Santen Bot logged in as ${client.user.tag}`);
  client.user.setActivity('🎰 Santen Casino', { type: 3 }); // WATCHING
  await registerCommands();
});

// ── Event: Interaction ────────────────────────────────────
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, user: dUser, member } = interaction;

  // ── /balance ─────────────────────────────────────────
  if (commandName === 'balance') {
    const u = getUser(dUser.id);
    if (!u) {
      return interaction.reply({ content: `❌ You haven't registered yet! Visit the casino at ${CASINO_URL} to create your account.`, ephemeral: true });
    }
    const embed = new EmbedBuilder()
      .setColor(0xC9A84C)
      .setTitle('💰 Santen Coins Balance')
      .setThumbnail(dUser.displayAvatarURL())
      .addFields(
        { name: 'Player', value: u.username, inline: true },
        { name: 'Balance', value: `**${fmt(u.balance)} ST**`, inline: true },
        { name: 'Daily Streak', value: `🔥 ${u.streak} days`, inline: true }
      )
      .setFooter({ text: 'Santen Casino • Play at ' + CASINO_URL })
      .setTimestamp();
    return interaction.reply({ embeds: [embed] });
  }

  // ── /leaderboard ──────────────────────────────────────
  if (commandName === 'leaderboard') {
    const rows = db.getLeaderboard(10);
    if (!rows.length) return interaction.reply({ content: 'No players yet!', ephemeral: true });
    const medals = ['🥇','🥈','🥉'];
    const desc = rows.map((r,i) => `${medals[i]||`**${i+1}.**`} <@${r.discord_id}> — **${fmt(r.balance)} ST**`).join('\n');
    const embed = new EmbedBuilder()
      .setColor(0xC9A84C)
      .setTitle('🏆 Santen Leaderboard')
      .setDescription(desc)
      .setFooter({ text: 'Santen Casino' })
      .setTimestamp();
    return interaction.reply({ embeds: [embed] });
  }

  // ── /give ─────────────────────────────────────────────
  if (commandName === 'give') {
    if (!isAdmin(member)) return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    const target = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount');
    const u = getUser(target.id);
    if (!u) return interaction.reply({ content: `❌ ${target.username} hasn't joined the casino yet.`, ephemeral: true });
    db.addBalance(target.id, amount);
    const embed = new EmbedBuilder()
      .setColor(0x3DBA6E)
      .setTitle('✅ Coins Given')
      .setDescription(`Gave **${fmt(amount)} ST** to <@${target.id}>.\nNew balance: **${fmt(u.balance + amount)} ST**`);
    return interaction.reply({ embeds: [embed] });
  }

  // ── /take ─────────────────────────────────────────────
  if (commandName === 'take') {
    if (!isAdmin(member)) return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    const target = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount');
    const u = getUser(target.id);
    if (!u) return interaction.reply({ content: `❌ User not found.`, ephemeral: true });
    const newBal = Math.max(0, u.balance - amount);
    db.updateUser(target.id, { balance: newBal });
    const embed = new EmbedBuilder()
      .setColor(0xE05252)
      .setTitle('✅ Coins Taken')
      .setDescription(`Took **${fmt(amount)} ST** from <@${target.id}>.\nNew balance: **${fmt(newBal)} ST**`);
    return interaction.reply({ embeds: [embed] });
  }

  // ── /daily ────────────────────────────────────────────
  if (commandName === 'daily') {
    let u = getUser(dUser.id);
    if (!u) return interaction.reply({ content: `❌ Visit ${CASINO_URL} first to register!`, ephemeral: true });
    const now = Date.now();
    const nextClaim = (u.last_daily || 0) + 24*60*60*1000;
    if (now < nextClaim) {
      const ms = nextClaim - now;
      const h = Math.floor(ms/3600000), m = Math.floor((ms%3600000)/60000);
      return interaction.reply({ content: `⏳ Come back in **${h}h ${m}m** to claim your next daily reward!`, ephemeral: true });
    }
    const last = u.last_daily || 0;
    const isStreak = now < last + 48*60*60*1000;
    const newStreak = isStreak ? u.streak + 1 : 1;
    const reward = 250 + (newStreak - 1) * 50;
    db.updateUser(dUser.id, { streak: newStreak, last_daily: now });
    db.addBalance(dUser.id, reward);
    u = getUser(dUser.id);
    const embed = new EmbedBuilder()
      .setColor(0xC9A84C)
      .setTitle('🎁 Daily Reward Claimed!')
      .setThumbnail(dUser.displayAvatarURL())
      .addFields(
        { name: 'Reward', value: `**+${fmt(reward)} ST**`, inline: true },
        { name: 'Streak', value: `🔥 ${newStreak} days`, inline: true },
        { name: 'New Balance', value: `**${fmt(u.balance)} ST**`, inline: true }
      )
      .setFooter({ text: 'Streak bonus: +50 ST per day • Santen Casino' });
    return interaction.reply({ embeds: [embed] });
  }

  // ── /stats ────────────────────────────────────────────
  if (commandName === 'stats') {
    const u = getUser(dUser.id);
    if (!u) return interaction.reply({ content: `❌ Visit ${CASINO_URL} to register!`, ephemeral: true });
    const stats = db.getUserStats(dUser.id);
    const total_net = stats.reduce((a,s)=>a+s.net,0);
    const desc = stats.length
      ? stats.map(s=>`**${s.type}** — ${s.plays} plays, ${s.wins} wins, ${total_net>=0?'+':''}${fmt(s.net)} ST net`).join('\n')
      : 'No games played yet. Visit the casino!';
    const embed = new EmbedBuilder()
      .setColor(0xC9A84C)
      .setTitle(`📊 ${u.username}'s Stats`)
      .setDescription(desc)
      .addFields({ name: 'Total Net', value: `${total_net>=0?'**+':'**'}${fmt(total_net)} ST**` })
      .setFooter({ text: 'Santen Casino' });
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // ── /casino ───────────────────────────────────────────
  if (commandName === 'casino') {
    const embed = new EmbedBuilder()
      .setColor(0xC9A84C)
      .setTitle('🎰 Santen Casino')
      .setDescription(`Play slots, blackjack, roulette, coinflip, and crash!\n\n🔗 **[Open Santen Casino](${CASINO_URL})**`)
      .addFields(
        { name: 'Games', value: '🎰 Slots\n🃏 Blackjack\n🎡 Roulette\n🪙 Coinflip\n📈 Crash', inline: true },
        { name: 'Rewards', value: '🎁 Daily coins\n🔥 Streak bonuses\n🏆 Leaderboard', inline: true }
      )
      .setFooter({ text: 'Login with Discord to play • Santen Coins only' });
    return interaction.reply({ embeds: [embed] });
  }
});

// ── Login ────────────────────────────────────────────────
client.login(BOT_TOKEN);
