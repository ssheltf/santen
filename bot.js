require('dotenv').config();
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder } = require('discord.js');
const db = require('./db');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
const BOT_TOKEN  = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID  = process.env.DISCORD_CLIENT_ID;
const GUILD_ID   = process.env.DISCORD_GUILD_ID;
const CASINO_URL = process.env.CASINO_URL || 'http://localhost:3000';
const ANNOUNCE   = '1487286454462713856';

const GOLD = 0xC9A84C, GREEN = 0x3DBA6E, RED = 0xE05252, BLUE = 0x5865F2;

const commands = [
  new SlashCommandBuilder().setName('balance').setDescription('Check your Santen Coins balance'),
  new SlashCommandBuilder().setName('leaderboard').setDescription('Top 10 richest players'),
  new SlashCommandBuilder().setName('daily').setDescription('Claim your daily Santen Coins'),
  new SlashCommandBuilder().setName('stats').setDescription('View your gambling statistics'),
  new SlashCommandBuilder().setName('casino').setDescription('Get the Santen Casino link'),
  new SlashCommandBuilder().setName('profile')
    .setDescription("View a player's profile")
    .addUserOption(o=>o.setName('user').setDescription('Player to look up (leave empty for yourself)')),
  new SlashCommandBuilder().setName('give')
    .setDescription('Give Santen Coins to a player (Admin only)')
    .addUserOption(o=>o.setName('user').setDescription('Target user').setRequired(true))
    .addIntegerOption(o=>o.setName('amount').setDescription('Amount to give').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName('take')
    .setDescription('Take Santen Coins from a player (Admin only)')
    .addUserOption(o=>o.setName('user').setDescription('Target user').setRequired(true))
    .addIntegerOption(o=>o.setName('amount').setDescription('Amount to take').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName('pay')
    .setDescription('Send Santen Coins to another player')
    .addUserOption(o=>o.setName('user').setDescription('Who to pay').setRequired(true))
    .addIntegerOption(o=>o.setName('amount').setDescription('Amount to send').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName('setbalance')
    .setDescription('Set a player\'s balance (Admin only)')
    .addUserOption(o=>o.setName('user').setDescription('Target user').setRequired(true))
    .addIntegerOption(o=>o.setName('amount').setDescription('New balance').setRequired(true).setMinValue(0)),
  new SlashCommandBuilder().setName('flip')
    .setDescription('Quick coinflip against the house')
    .addIntegerOption(o=>o.setName('amount').setDescription('Amount to bet').setRequired(true).setMinValue(10)),
  new SlashCommandBuilder().setName('richest').setDescription('Show top 20 players on the leaderboard'),
].map(c=>c.toJSON());

async function registerCommands() {
  const rest = new REST({version:'10'}).setToken(BOT_TOKEN);
  try {
    console.log('📡 Registering slash commands...');
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {body:commands});
    console.log('✅ Commands registered');
  } catch(e) { console.error('Failed to register commands:', e.message); }
}

function fmt(n){ return Number(n).toLocaleString(); }
function isAdmin(m){ return m.permissions.has('Administrator')||m.permissions.has('ManageGuild'); }
function getUser(id){ return db.getUser(id); }
function avURL(u,size=64){ return u.avatar?`https://cdn.discordapp.com/avatars/${u.id||u.discord_id}/${u.avatar}.png?size=${size}`:`https://cdn.discordapp.com/embed/avatars/0.png`; }

client.once('ready', async () => {
  console.log(`\n🤖 Santen Bot logged in as ${client.user.tag}`);
  client.user.setActivity('🎰 Santen Casino', {type:3});
  await registerCommands();
});

client.on('interactionCreate', async interaction => {
  if(!interaction.isChatInputCommand())return;
  const {commandName, user:du, member} = interaction;

  // ── /balance ──────────────────────────────────────────
  if(commandName==='balance'){
    const u=getUser(du.id);
    if(!u)return interaction.reply({content:`❌ You haven't joined yet! Visit ${CASINO_URL}`,ephemeral:true});
    const embed=new EmbedBuilder().setColor(GOLD).setTitle('💰 Balance')
      .setThumbnail(avURL(du))
      .addFields(
        {name:'Player',value:u.username,inline:true},
        {name:'Balance',value:`**${fmt(u.balance)} ST**`,inline:true},
        {name:'Streak',value:`🔥 ${u.streak||0} days`,inline:true},
        {name:'Wagered',value:`${fmt(u.total_wagered||0)} ST`,inline:true},
        {name:'Biggest Win',value:`${fmt(u.biggest_win||0)} ST`,inline:true},
        {name:'Games Played',value:`${fmt(u.games_played||0)}`,inline:true},
      ).setFooter({text:`Santen Casino • ${CASINO_URL}`});
    return interaction.reply({embeds:[embed]});
  }

  // ── /leaderboard ──────────────────────────────────────
  if(commandName==='leaderboard'){
    const rows=db.getLeaderboard(10);
    if(!rows.length)return interaction.reply({content:'No players yet!',ephemeral:true});
    const medals=['🥇','🥈','🥉'];
    const desc=rows.map((r,i)=>`${medals[i]||`**${i+1}.**`} <@${r.discord_id}> — **${fmt(r.balance)} ST**`).join('\n');
    const embed=new EmbedBuilder().setColor(GOLD).setTitle('🏆 Santen Leaderboard').setDescription(desc).setFooter({text:'Santen Casino'}).setTimestamp();
    return interaction.reply({embeds:[embed]});
  }

  // ── /richest ──────────────────────────────────────────
  if(commandName==='richest'){
    const rows=db.getLeaderboard(20);
    const medals=['🥇','🥈','🥉'];
    const desc=rows.map((r,i)=>`${medals[i]||`**${i+1}.**`} **${r.username}** — ${fmt(r.balance)} ST`).join('\n');
    const embed=new EmbedBuilder().setColor(GOLD).setTitle('💎 Top 20 Richest Players').setDescription(desc);
    return interaction.reply({embeds:[embed]});
  }

  // ── /daily ────────────────────────────────────────────
  if(commandName==='daily'){
    let u=getUser(du.id);
    if(!u)return interaction.reply({content:`❌ Visit ${CASINO_URL} first to register!`,ephemeral:true});
    const now=Date.now(),last=u.last_daily||0;
    if(now<last+24*60*60*1000){
      const ms=last+24*60*60*1000-now,h=Math.floor(ms/3600000),m=Math.floor((ms%3600000)/60000);
      return interaction.reply({content:`⏳ Come back in **${h}h ${m}m**!`,ephemeral:true});
    }
    const isStreak=now<last+48*60*60*1000&&last>0;
    const newStreak=isStreak?(u.streak||0)+1:1;
    const base=250,bonus=(newStreak-1)*50,extra=newStreak>=100?10000:newStreak>=30?2000:newStreak>=7?500:0;
    const reward=base+bonus+extra;
    db.updateUser(du.id,{streak:newStreak,last_daily:now});
    db.addBalance(du.id,reward);
    u=getUser(du.id);
    const embed=new EmbedBuilder().setColor(GOLD).setTitle('🎁 Daily Claimed!')
      .setThumbnail(avURL(du))
      .addFields(
        {name:'Reward',value:`**+${fmt(reward)} ST**`,inline:true},
        {name:'Streak',value:`🔥 ${newStreak} days`,inline:true},
        {name:'New Balance',value:`**${fmt(u.balance)} ST**`,inline:true},
      )
      .setFooter({text:`Milestone bonuses at 7, 30, 100 days!`});
    if(extra>0)embed.setDescription(`🎉 **${newStreak}-day milestone bonus: +${fmt(extra)} ST!**`);
    return interaction.reply({embeds:[embed]});
  }

  // ── /stats ────────────────────────────────────────────
  if(commandName==='stats'){
    const u=getUser(du.id);
    if(!u)return interaction.reply({content:`❌ Visit ${CASINO_URL} to register!`,ephemeral:true});
    const stats=db.getUserStats(du.id);
    const desc=stats.length
      ? stats.map(s=>`**${s.type}** — ${fmt(s.plays)} plays, ${s.wins} wins, ${s.net>=0?'+':''}${fmt(s.net)} ST net`).join('\n')
      : 'No games played yet!';
    const total=stats.reduce((a,s)=>({net:a.net+s.net,plays:a.plays+s.plays}),{net:0,plays:0});
    const embed=new EmbedBuilder().setColor(GOLD).setTitle(`📊 ${u.username}'s Stats`)
      .setDescription(desc)
      .addFields({name:'Total Net',value:`${total.net>=0?'+':''}${fmt(total.net)} ST`,inline:true},{name:'Total Games',value:`${fmt(total.plays)}`,inline:true})
      .setFooter({text:'Santen Casino'});
    return interaction.reply({embeds:[embed],ephemeral:true});
  }

  // ── /profile ──────────────────────────────────────────
  if(commandName==='profile'){
    const target=interaction.options.getUser('user')||du;
    const u=getUser(target.id);
    if(!u)return interaction.reply({content:`❌ ${target.username} hasn't joined yet!`,ephemeral:true});
    const embed=new EmbedBuilder().setColor(GOLD).setTitle(`👤 ${u.username}`)
      .setThumbnail(avURL(target))
      .addFields(
        {name:'Balance',value:`**${fmt(u.balance)} ST**`,inline:true},
        {name:'Streak',value:`🔥 ${u.streak||0} days`,inline:true},
        {name:'Games',value:`${fmt(u.games_played||0)}`,inline:true},
        {name:'Total Wagered',value:`${fmt(u.total_wagered||0)} ST`,inline:true},
        {name:'Biggest Win',value:`${fmt(u.biggest_win||0)} ST`,inline:true},
      );
    return interaction.reply({embeds:[embed]});
  }

  // ── /pay ──────────────────────────────────────────────
  if(commandName==='pay'){
    const target=interaction.options.getUser('user');
    const amount=interaction.options.getInteger('amount');
    const sender=getUser(du.id);
    if(!sender)return interaction.reply({content:`❌ You haven't joined! Visit ${CASINO_URL}`,ephemeral:true});
    if(sender.balance<amount)return interaction.reply({content:`❌ Insufficient balance! You have **${fmt(sender.balance)} ST**.`,ephemeral:true});
    const recv=getUser(target.id);
    if(!recv)return interaction.reply({content:`❌ ${target.username} hasn't joined the casino yet!`,ephemeral:true});
    if(target.id===du.id)return interaction.reply({content:`❌ You can't pay yourself!`,ephemeral:true});
    db.addBalance(du.id,-amount);db.addBalance(target.id,amount);
    const embed=new EmbedBuilder().setColor(GREEN).setTitle('💸 Payment Sent')
      .setDescription(`**${du.username}** sent **${fmt(amount)} ST** to **${target.username}**!`);
    return interaction.reply({embeds:[embed]});
  }

  // ── /give ─────────────────────────────────────────────
  if(commandName==='give'){
    if(!isAdmin(member))return interaction.reply({content:'❌ Admin only.',ephemeral:true});
    const target=interaction.options.getUser('user');
    const amount=interaction.options.getInteger('amount');
    const u=getUser(target.id);
    if(!u)return interaction.reply({content:`❌ ${target.username} hasn't joined yet.`,ephemeral:true});
    db.addBalance(target.id,amount);
    const updated=getUser(target.id);
    const embed=new EmbedBuilder().setColor(GREEN).setTitle('✅ Coins Given')
      .setDescription(`Gave **${fmt(amount)} ST** to <@${target.id}>.\nNew balance: **${fmt(updated.balance)} ST**`);
    return interaction.reply({embeds:[embed]});
  }

  // ── /take ─────────────────────────────────────────────
  if(commandName==='take'){
    if(!isAdmin(member))return interaction.reply({content:'❌ Admin only.',ephemeral:true});
    const target=interaction.options.getUser('user');
    const amount=interaction.options.getInteger('amount');
    const u=getUser(target.id);
    if(!u)return interaction.reply({content:`❌ User not found.`,ephemeral:true});
    db.addBalance(target.id,-amount);
    const updated=getUser(target.id);
    const embed=new EmbedBuilder().setColor(RED).setTitle('✅ Coins Taken')
      .setDescription(`Took **${fmt(amount)} ST** from <@${target.id}>.\nNew balance: **${fmt(updated.balance)} ST**`);
    return interaction.reply({embeds:[embed]});
  }

  // ── /setbalance ───────────────────────────────────────
  if(commandName==='setbalance'){
    if(!isAdmin(member))return interaction.reply({content:'❌ Admin only.',ephemeral:true});
    const target=interaction.options.getUser('user');
    const amount=interaction.options.getInteger('amount');
    const u=getUser(target.id);
    if(!u)return interaction.reply({content:`❌ User not found.`,ephemeral:true});
    db.updateUser(target.id,{balance:amount});
    const embed=new EmbedBuilder().setColor(GOLD).setTitle('✅ Balance Set')
      .setDescription(`Set <@${target.id}>'s balance to **${fmt(amount)} ST**`);
    return interaction.reply({embeds:[embed]});
  }

  // ── /flip ─────────────────────────────────────────────
  if(commandName==='flip'){
    const amount=interaction.options.getInteger('amount');
    const u=getUser(du.id);
    if(!u)return interaction.reply({content:`❌ Visit ${CASINO_URL} to join first!`,ephemeral:true});
    if(u.balance<amount)return interaction.reply({content:`❌ Insufficient balance! You have **${fmt(u.balance)} ST**.`,ephemeral:true});
    const won=Math.random()<0.5;
    const side=won?'Heads':'Tails';
    if(won)db.addBalance(du.id,amount);else db.addBalance(du.id,-amount);
    const updated=getUser(du.id);
    const embed=new EmbedBuilder().setColor(won?GREEN:RED)
      .setTitle(`🪙 ${side}! You ${won?'Won':'Lost'}!`)
      .addFields(
        {name:won?'Won':'Lost',value:`**${fmt(amount)} ST**`,inline:true},
        {name:'New Balance',value:`**${fmt(updated.balance)} ST**`,inline:true},
      );
    return interaction.reply({embeds:[embed]});
  }

  // ── /casino ───────────────────────────────────────────
  if(commandName==='casino'){
    const embed=new EmbedBuilder().setColor(GOLD).setTitle('🎰 Santen Casino')
      .setDescription(`**[Open Santen Casino](${CASINO_URL})**\n\nPlay slots, blackjack, roulette, crash, mines, plinko, hi-lo and more!`)
      .addFields(
        {name:'Games',value:'🎰 Slots\n🃏 Blackjack\n🎡 Roulette\n📈 Crash\n💣 Mines\n🔵 Plinko\n🎴 Hi-Lo',inline:true},
        {name:'Commands',value:'`/balance` `/daily` `/pay`\n`/stats` `/flip` `/leaderboard`\n`/profile` `/casino`',inline:true},
      )
      .setFooter({text:'Login with Discord • Santen Coins only'});
    return interaction.reply({embeds:[embed]});
  }
});

client.login(BOT_TOKEN);
