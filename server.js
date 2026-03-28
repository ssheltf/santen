require('dotenv').config();
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const db = require('./db');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ANNOUNCE_CHANNEL = '1487286454462713856';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  store: new FileStore({ path: './sessions', logFn: ()=>{} }),
  secret: process.env.SESSION_SECRET || 'santen-secret',
  resave: false, saveUninitialized: false,
  cookie: { secure: false, maxAge: 7*24*60*60*1000 }
}));

const DISCORD_CLIENT_ID     = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI  = process.env.DISCORD_REDIRECT_URI || `http://localhost:${PORT}/auth/discord/callback`;
const DISCORD_BOT_TOKEN     = process.env.DISCORD_BOT_TOKEN;
const DISCORD_GUILD_ID      = process.env.DISCORD_GUILD_ID;
const CASINO_URL            = process.env.CASINO_URL || `http://localhost:${PORT}`;

// ── SSE clients for real-time chat ───────────────────────
const sseClients = new Set();
function broadcastSSE(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(res => { try { res.write(msg); } catch(e) { sseClients.delete(res); } });
}

// ── Auth ──────────────────────────────────────────────────
app.get('/auth/discord', (req, res) => {
  const p = new URLSearchParams({ client_id:DISCORD_CLIENT_ID, redirect_uri:DISCORD_REDIRECT_URI, response_type:'code', scope:'identify' });
  res.redirect(`https://discord.com/api/oauth2/authorize?${p}`);
});
app.get('/auth/discord/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect(CASINO_URL);
  try {
    const tok = await axios.post('https://discord.com/api/oauth2/token',
      new URLSearchParams({ client_id:DISCORD_CLIENT_ID, client_secret:DISCORD_CLIENT_SECRET, grant_type:'authorization_code', code, redirect_uri:DISCORD_REDIRECT_URI }),
      { headers:{'Content-Type':'application/x-www-form-urlencoded'} });
    const du = (await axios.get('https://discord.com/api/users/@me', { headers:{Authorization:`Bearer ${tok.data.access_token}`} })).data;
    const existing = db.getUser(du.id);
    db.upsertUser(du.id, { username:du.username, avatar:du.avatar });
    if (!existing) notifyChannel(`🎰 **${du.username}** just joined **Santen Casino**! They received **1,000 Santen Coins** to start!`);
    req.session.discord_id = du.id;
    res.redirect(CASINO_URL);
  } catch(e) { console.error('OAuth error:', e.response?.data||e.message); res.redirect(CASINO_URL); }
});
app.post('/auth/logout', (req, res) => { req.session.destroy(); res.json({ok:true}); });

function requireAuth(req, res, next) {
  if (!req.session.discord_id) return res.status(401).json({error:'Not logged in'});
  const u = db.getUser(req.session.discord_id);
  if (!u) return res.status(401).json({error:'User not found'});
  req.user = u; next();
}

app.get('/api/me', requireAuth, (req, res) => {
  const {discord_id,username,avatar,balance,streak,total_wagered,total_won,games_played,biggest_win} = req.user;
  res.json({discord_id,username,avatar,balance,streak,total_wagered,total_won,games_played,biggest_win});
});

app.get('/debug', (req, res) => res.json({
  DISCORD_CLIENT_ID: DISCORD_CLIENT_ID?DISCORD_CLIENT_ID.slice(0,6)+'...':'MISSING',
  DISCORD_CLIENT_SECRET: DISCORD_CLIENT_SECRET?'SET':'MISSING',
  DISCORD_REDIRECT_URI, CASINO_URL,
  DISCORD_BOT_TOKEN: DISCORD_BOT_TOKEN?'SET':'MISSING',
  DISCORD_GUILD_ID: DISCORD_GUILD_ID||'MISSING',
}));

// ── Balance helpers ───────────────────────────────────────
app.post('/api/balance/deduct', requireAuth, (req, res) => {
  if (req.user.balance < req.body.amount) return res.status(400).json({error:'Insufficient balance'});
  res.json({ newBalance: db.addBalance(req.user.discord_id, -req.body.amount).balance });
});
app.post('/api/balance/add', requireAuth, (req, res) => {
  res.json({ newBalance: db.addBalance(req.user.discord_id, req.body.amount).balance });
});

// ── Big win announcer ─────────────────────────────────────
async function announceBigWin(username, game, profit, mult) {
  const emojis = {slots:'🎰',roulette:'🎡',crash:'📈',plinko:'🔵',blackjack:'🃏',coinflip:'🪙',hilo:'🎴',mines:'💣',cases:'📦'};
  const em = emojis[game]||'🎲';
  const msg = `${em} **BIG WIN!** **${username}** won **${profit.toLocaleString()} ST** on **${game}**${mult?` (${mult}×)`:''} 🔥`;
  await notifyChannel(msg);
  broadcastSSE('bigwin', { username, game, profit, mult });
}

async function notifyChannel(message) {
  if (!DISCORD_BOT_TOKEN || !ANNOUNCE_CHANNEL) return;
  try {
    await axios.post(`https://discord.com/api/v10/channels/${ANNOUNCE_CHANNEL}/messages`,
      { content: message },
      { headers:{ Authorization:`Bot ${DISCORD_BOT_TOKEN}` } });
  } catch(e) {}
}

function checkBigWin(username, game, profit, mult, threshold=500) {
  if (profit >= threshold) announceBigWin(username, game, profit, mult);
}

// ── SLOTS ─────────────────────────────────────────────────
const SLOT_SYMBOLS = ['💎','7️⃣','🍒','⭐','🔔','🍋'];
const SLOT_WEIGHTS = [2, 5, 12, 18, 25, 38];
function weightedSlot() {
  let r = Math.random()*100;
  for(let i=0;i<SLOT_SYMBOLS.length;i++){r-=SLOT_WEIGHTS[i];if(r<=0)return SLOT_SYMBOLS[i];}
  return SLOT_SYMBOLS[SLOT_SYMBOLS.length-1];
}
app.post('/api/slots', requireAuth, (req, res) => {
  const {bet} = req.body;
  if (!bet||bet<10) return res.status(400).json({error:'Min bet 10 ST'});
  if (req.user.balance < bet) return res.status(400).json({error:'Insufficient balance'});
  const reels = [weightedSlot(),weightedSlot(),weightedSlot()];
  let multiplier = 0;
  if(reels[0]===reels[1]&&reels[1]===reels[2]) {
    const s=reels[0];
    if(s==='💎')multiplier=50; else if(s==='7️⃣')multiplier=25; else if(s==='🍒')multiplier=10;
    else if(s==='⭐')multiplier=5; else if(s==='🔔')multiplier=3; else multiplier=2;
  } else if(reels[0]===reels[1]||reels[1]===reels[2]||reels[0]===reels[2]) multiplier=1.5;
  const won=multiplier>0, payout=won?Math.floor(bet*multiplier):0;
  const updated = db.recordBet(req.user.discord_id, bet, payout);
  db.logTransaction(req.user.discord_id,'slots',payout-bet,reels.join(''));
  checkBigWin(req.user.username,'slots',payout-bet,multiplier);
  res.json({reels,won,multiplier,payout,newBalance:updated.balance});
});

// ── BLACKJACK ─────────────────────────────────────────────
app.post('/api/blackjack/settle', requireAuth, (req, res) => {
  const {bet, result} = req.body;
  if (!bet||bet<10) return res.status(400).json({error:'Min bet 10 ST'});
  if (req.user.balance + bet < bet) return res.status(400).json({error:'Insufficient balance'});
  let payout = 0;
  if(result==='blackjack') payout=Math.floor(bet*2.5);
  else if(result==='win') payout=bet*2;
  else if(result==='push') payout=bet;
  const profit = payout - bet;
  const updated = db.addBalance(req.user.discord_id, profit);
  db.logTransaction(req.user.discord_id,'blackjack',profit,result);
  if(profit>0) checkBigWin(req.user.username,'blackjack',profit,null);
  res.json({newBalance:updated.balance});
});

// ── ROULETTE ──────────────────────────────────────────────
const R_NUMS=[0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
const R_COLORS={};
R_NUMS.forEach(n=>R_COLORS[n]='black');
[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36].forEach(n=>R_COLORS[n]='red');
R_COLORS[0]='green';
app.post('/api/roulette', requireAuth, (req, res) => {
  const {bet,betType}=req.body;
  if(!bet||bet<10)return res.status(400).json({error:'Min bet 10 ST'});
  if(req.user.balance<bet)return res.status(400).json({error:'Insufficient balance'});
  const number=R_NUMS[Math.floor(Math.random()*R_NUMS.length)], color=R_COLORS[number];
  let mult=0;
  if(betType==='red'&&color==='red')mult=2;
  else if(betType==='black'&&color==='black')mult=2;
  else if(betType==='green'&&color==='green')mult=14;
  else if(betType==='low'&&number>=1&&number<=18)mult=2;
  else if(betType==='high'&&number>=19&&number<=36)mult=2;
  else if(betType==='odd'&&number%2===1&&number!==0)mult=2;
  else if(betType==='even'&&number%2===0&&number!==0)mult=2;
  const payout=mult>0?bet*mult:0;
  const updated=db.recordBet(req.user.discord_id,bet,payout);
  db.logTransaction(req.user.discord_id,'roulette',payout-bet,`${number} ${color}`);
  checkBigWin(req.user.username,'roulette',payout-bet,mult);
  res.json({number,color,won:mult>0,multiplier:mult,payout,newBalance:updated.balance});
});

// ── COINFLIP ─────────────────────────────────────────────
app.post('/api/coinflip', requireAuth, (req, res) => {
  const {bet,choice}=req.body;
  if(!bet||bet<10)return res.status(400).json({error:'Min bet 10 ST'});
  if(req.user.balance<bet)return res.status(400).json({error:'Insufficient balance'});
  const result=Math.random()<0.5?'heads':'tails', won=result===choice;
  const payout=won?bet*2:0;
  const updated=db.recordBet(req.user.discord_id,bet,payout);
  db.logTransaction(req.user.discord_id,'coinflip',payout-bet,result);
  res.json({result,won,payout,newBalance:updated.balance});
});

// ── CRASH ─────────────────────────────────────────────────
function genCrashPoint(){const r=Math.random();if(r<0.04)return 1.0;return Math.max(1.01,Math.floor(100/(1-r*0.96))/100);}
app.post('/api/crash/start', requireAuth, (req, res) => {
  const {bet}=req.body;
  if(!bet||bet<10)return res.status(400).json({error:'Min bet 10 ST'});
  if(req.user.balance<bet)return res.status(400).json({error:'Insufficient balance'});
  const crashPoint=genCrashPoint();
  const updated=db.addBalance(req.user.discord_id,-bet);
  res.json({crashPoint,newBalance:updated.balance});
});
app.post('/api/crash/cashout', requireAuth, (req, res) => {
  const {payout,bet}=req.body;
  const safe=Math.min(Math.max(0,payout),2000000);
  const updated=db.addBalance(req.user.discord_id,safe);
  const profit=safe-(bet||0);
  db.logTransaction(req.user.discord_id,'crash',profit,'cashout');
  db.recordBet(req.user.discord_id,0,0);
  checkBigWin(req.user.username,'crash',profit,null,1000);
  res.json({newBalance:updated.balance});
});

// ── PLINKO ────────────────────────────────────────────────
const PLINKO_MULTS=[10,3,1.5,1,0.5,0.3,0.5,1,1.5,3,10];
const PLINKO_WEIGHTS=[1,3,8,16,24,30,24,16,8,3,1];
app.post('/api/plinko', requireAuth, (req, res) => {
  const {bet}=req.body;
  if(!bet||bet<10)return res.status(400).json({error:'Min bet 10 ST'});
  if(req.user.balance<bet)return res.status(400).json({error:'Insufficient balance'});
  const total=PLINKO_WEIGHTS.reduce((a,b)=>a+b,0);
  let r=Math.random()*total, bi=0;
  for(let i=0;i<PLINKO_WEIGHTS.length;i++){r-=PLINKO_WEIGHTS[i];if(r<=0){bi=i;break;}}
  const mult=PLINKO_MULTS[bi], payout=Math.floor(bet*mult);
  const updated=db.recordBet(req.user.discord_id,bet,payout);
  db.logTransaction(req.user.discord_id,'plinko',payout-bet,mult+'x');
  checkBigWin(req.user.username,'plinko',payout-bet,mult);
  res.json({bucketIndex:bi,multiplier:mult,won:payout>bet,payout,newBalance:updated.balance});
});

// ── MINES ─────────────────────────────────────────────────
app.post('/api/mines/start', requireAuth, (req, res) => {
  const {bet,mineCount=5}=req.body;
  if(!bet||bet<10)return res.status(400).json({error:'Min bet 10 ST'});
  if(req.user.balance<bet)return res.status(400).json({error:'Insufficient balance'});
  if(mineCount<1||mineCount>24)return res.status(400).json({error:'Invalid mine count'});
  const cells=Array.from({length:25},(_,i)=>i);
  for(let i=cells.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[cells[i],cells[j]]=[cells[j],cells[i]];}
  const mines=new Set(cells.slice(0,mineCount));
  const updated=db.addBalance(req.user.discord_id,-bet);
  req.session.mines={positions:[...mines],mineCount,bet,revealed:0,active:true};
  res.json({newBalance:updated.balance,mineCount});
});
app.post('/api/mines/reveal', requireAuth, (req, res) => {
  const {index}=req.body;
  const game=req.session.mines;
  if(!game||!game.active)return res.status(400).json({error:'No active game'});
  const isMine=game.positions.includes(index);
  if(isMine){
    game.active=false; req.session.mines=game;
    db.logTransaction(req.user.discord_id,'mines',-game.bet,'mine');
    return res.json({isMine:true,mines:game.positions,newBalance:req.user.balance});
  }
  game.revealed++;
  req.session.mines=game;
  const safe=25-game.mineCount, found=game.revealed;
  const mult=parseFloat((Math.pow(safe/(safe-found+1),found)*0.97).toFixed(2));
  res.json({isMine:false,revealed:game.revealed,multiplier:mult});
});
app.post('/api/mines/cashout', requireAuth, (req, res) => {
  const game=req.session.mines;
  if(!game||!game.active||game.revealed===0)return res.status(400).json({error:'Nothing to cash out'});
  game.active=false;
  const safe=25-game.mineCount, found=game.revealed;
  const mult=parseFloat((Math.pow(safe/(safe-found+1),found)*0.97).toFixed(2));
  const payout=Math.floor(game.bet*mult);
  const profit=payout-game.bet;
  const updated=db.addBalance(req.user.discord_id,payout);
  db.logTransaction(req.user.discord_id,'mines',profit,`${mult}x`);
  checkBigWin(req.user.username,'mines',profit,mult);
  res.json({payout,multiplier:mult,newBalance:updated.balance,mines:game.positions});
});

// ── HI-LO ─────────────────────────────────────────────────
const HL_RANKS=['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
function hlVal(r){return HL_RANKS.indexOf(r)+2;}
function randCard(){return{rank:HL_RANKS[Math.floor(Math.random()*13)],suit:['♠','♥','♦','♣'][Math.floor(Math.random()*4)]};}

app.post('/api/hilo/start', requireAuth, (req, res) => {
  const {bet}=req.body;
  if(!bet||bet<10)return res.status(400).json({error:'Min bet 10 ST'});
  if(req.user.balance<bet)return res.status(400).json({error:'Insufficient balance'});
  const card=randCard();
  db.addBalance(req.user.discord_id,-bet);
  req.session.hilo={card,bet,streak:0,mult:1,active:true};
  res.json({card,newBalance:req.user.balance-bet});
});
app.post('/api/hilo/guess', requireAuth, (req, res) => {
  const {direction}=req.body;
  const game=req.session.hilo;
  if(!game||!game.active)return res.status(400).json({error:'No active game'});
  const newCard=randCard();
  const oldVal=hlVal(game.card.rank), newVal=hlVal(newCard.rank);
  let win=false;
  if(direction==='higher'&&newVal>oldVal)win=true;
  if(direction==='lower'&&newVal<oldVal)win=true;
  if(!win){
    game.active=false; req.session.hilo=game;
    db.logTransaction(req.user.discord_id,'hilo',-game.bet,'loss');
    return res.json({win:false,newCard,oldCard:game.card});
  }
  game.streak++;
  const risk=direction==='higher'?(13-oldVal)/13:(oldVal-2)/13;
  game.mult=parseFloat((game.mult*(1+(risk*1.5))).toFixed(3));
  game.card=newCard; req.session.hilo=game;
  res.json({win:true,newCard,streak:game.streak,mult:game.mult});
});
app.post('/api/hilo/cashout', requireAuth, (req, res) => {
  const game=req.session.hilo;
  if(!game||!game.active||game.streak===0)return res.status(400).json({error:'Nothing to cash out'});
  game.active=false;
  const payout=Math.floor(game.bet*game.mult);
  const profit=payout-game.bet;
  const updated=db.addBalance(req.user.discord_id,payout);
  db.logTransaction(req.user.discord_id,'hilo',profit,`${game.mult}x`);
  checkBigWin(req.user.username,'hilo',profit,game.mult);
  res.json({payout,multiplier:game.mult,newBalance:updated.balance});
});

// ── DAILY ─────────────────────────────────────────────────
app.get('/api/daily/status', requireAuth, (req, res) => {
  const now=Date.now(), last=req.user.last_daily||0;
  const nextClaimAt=last+24*60*60*1000;
  const streak=req.user.streak||0;
  const base=250, bonus=streak*50, extra=streak>=100?10000:streak>=30?2000:streak>=7?500:0;
  const reward=base+bonus+extra;
  res.json({canClaim:now>=nextClaimAt,streak,nextClaimAt,reward,nextMilestone:streak>=100?null:streak>=30?100:streak>=7?30:7});
});
app.post('/api/daily/claim', requireAuth, (req, res) => {
  const now=Date.now(), last=req.user.last_daily||0;
  if(now<last+24*60*60*1000)return res.status(400).json({error:'Already claimed today'});
  const isStreak=now<last+48*60*60*1000&&last>0;
  const newStreak=isStreak?(req.user.streak||0)+1:1;
  const base=250, bonus=(newStreak-1)*50;
  const extra=newStreak>=100?10000:newStreak>=30?2000:newStreak>=7?500:0;
  const reward=base+bonus+extra;
  db.updateUser(req.user.discord_id,{streak:newStreak,last_daily:now});
  const updated=db.addBalance(req.user.discord_id,reward);
  const milestoneMsg=extra>0?` 🎉 **${newStreak}-day milestone bonus!**`:'';
  notifyChannel(`🎁 **${req.user.username}** claimed **${reward.toLocaleString()} ST** daily reward! (${newStreak}🔥 streak)${milestoneMsg}`);
  res.json({reward,streak:newStreak,newBalance:updated.balance,milestoneBonus:extra});
});

// ── CHAT ──────────────────────────────────────────────────
app.get('/api/chat/stream', requireAuth, (req, res) => {
  res.setHeader('Content-Type','text/event-stream');
  res.setHeader('Cache-Control','no-cache');
  res.setHeader('Connection','keep-alive');
  res.setHeader('Access-Control-Allow-Origin','*');
  const recent=db.getRecentChat(60);
  res.write(`event: history\ndata: ${JSON.stringify(recent)}\n\n`);
  sseClients.add(res);
  req.on('close',()=>sseClients.delete(res));
  const ping=setInterval(()=>{try{res.write(':ping\n\n');}catch(e){clearInterval(ping);}},25000);
  req.on('close',()=>clearInterval(ping));
});

app.post('/api/chat/send', requireAuth, async (req, res) => {
  let {message}=req.body;
  if(!message||!message.trim())return res.status(400).json({error:'Empty message'});
  message=message.slice(0,300).trim();
  const u=req.user;

  if(message.startsWith('.pay ')) {
    const parts=message.split(' ');
    const mention=parts[1], amount=parseInt(parts[2]);
    if(!mention||isNaN(amount)||amount<1)return res.status(400).json({error:'Usage: .pay @username amount'});
    const targetName=mention.replace('@','').toLowerCase();
    const target=db.getAllUsers().find(u=>u.username.toLowerCase()===targetName);
    if(!target)return res.status(400).json({error:`User ${mention} not found`});
    if(u.balance<amount)return res.status(400).json({error:'Insufficient balance'});
    db.addBalance(u.discord_id,-amount);
    db.addBalance(target.discord_id,amount);
    const sysMsg=db.addChatMessage('system','💸 System','',`**${u.username}** sent **${amount.toLocaleString()} ST** to **${target.username}**!`);
    broadcastSSE('chat',sysMsg);
    return res.json({ok:true});
  }
  if(message.startsWith('.balance')) {
    const sysMsg=db.addChatMessage('system','🏦 Bank','',`**${u.username}**'s balance: **${u.balance.toLocaleString()} ST**`);
    broadcastSSE('chat',sysMsg);
    return res.json({ok:true});
  }
  if(message.startsWith('.top')) {
    const top=db.getLeaderboard(5);
    const medals=['🥇','🥈','🥉','4️⃣','5️⃣'];
    const text=top.map((p,i)=>`${medals[i]} ${p.username}: ${p.balance.toLocaleString()} ST`).join(' | ');
    const sysMsg=db.addChatMessage('system','🏆 Leaderboard','',text);
    broadcastSSE('chat',sysMsg);
    return res.json({ok:true});
  }
  if(message.startsWith('.flip ')) {
    const amount=parseInt(message.split(' ')[1]);
    if(!isNaN(amount)&&amount>0&&u.balance>=amount) {
      const won=Math.random()<0.5;
      if(won) db.addBalance(u.discord_id,amount); else db.addBalance(u.discord_id,-amount);
      const sysMsg=db.addChatMessage('system','🪙 Coinflip','',`**${u.username}** flipped ${amount.toLocaleString()} ST and ${won?'**WON** 🎉':'**LOST** 💀'}!`);
      broadcastSSE('chat',sysMsg);
      return res.json({ok:true});
    }
  }

  const msg=db.addChatMessage(u.discord_id,u.username,u.avatar,message);
  broadcastSSE('chat',msg);
  res.json({ok:true,msg});
});

// ── LEADERBOARD / STATS / HISTORY ────────────────────────
app.get('/api/leaderboard', requireAuth, (req, res) => res.json(db.getLeaderboard(20)));
app.get('/api/stats', requireAuth, (req, res) => res.json(db.getUserStats(req.user.discord_id)));
app.get('/api/history', requireAuth, (req, res) => res.json(db.getUserHistory(req.user.discord_id, 50)));

// ── START ─────────────────────────────────────────────────
app.listen(PORT, () => console.log(`\n🎰 Santen Casino running at http://localhost:${PORT}\n`));

// ══════════════════════════════════════════════════════════
// DISCORD BOT — merged into server.js so Railway runs both
// in one process (Railway only executes `npm start`)
// ══════════════════════════════════════════════════════════
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder } = require('discord.js');

const botClient = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
function fmt(n){ return Number(n).toLocaleString(); }

const slashCommands = [
  new SlashCommandBuilder().setName('balance').setDescription('Check your Santen Coins balance'),
  new SlashCommandBuilder().setName('leaderboard').setDescription('Show the top Santen Coins holders'),
  new SlashCommandBuilder().setName('daily').setDescription('Claim your daily Santen Coins reward'),
  new SlashCommandBuilder().setName('stats').setDescription('View your gambling statistics'),
  new SlashCommandBuilder().setName('casino').setDescription('Get the link to the Santen Casino website'),
  new SlashCommandBuilder()
    .setName('give').setDescription('Give Santen Coins to a member (admin only)')
    .addUserOption(o=>o.setName('user').setDescription('Target user').setRequired(true))
    .addIntegerOption(o=>o.setName('amount').setDescription('Amount').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder()
    .setName('take').setDescription('Remove Santen Coins from a member (admin only)')
    .addUserOption(o=>o.setName('user').setDescription('Target user').setRequired(true))
    .addIntegerOption(o=>o.setName('amount').setDescription('Amount').setRequired(true).setMinValue(1)),
].map(c=>c.toJSON());

async function registerBotCommands() {
  if(!DISCORD_BOT_TOKEN||!DISCORD_CLIENT_ID||!DISCORD_GUILD_ID){
    console.log('⚠️  Bot: missing env vars, skipping command registration'); return;
  }
  const rest = new REST({version:'10'}).setToken(DISCORD_BOT_TOKEN);
  try {
    console.log('📡 Registering slash commands...');
    await rest.put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID), {body:slashCommands});
    console.log('✅ Slash commands registered');
  } catch(e) { console.error('Failed to register commands:', e.message); }
}

botClient.once('ready', async () => {
  console.log(`\n🤖 Santen Bot logged in as ${botClient.user.tag}`);
  botClient.user.setActivity('🎰 Santen Casino', {type:3});
  await registerBotCommands();
});

botClient.on('interactionCreate', async interaction => {
  if(!interaction.isChatInputCommand()) return;
  const {commandName, user:dUser, member} = interaction;
  const isAdmin = m => m.permissions.has('Administrator') || m.permissions.has('ManageGuild');

  // /balance
  if(commandName==='balance') {
    const u=db.getUser(dUser.id);
    if(!u) return interaction.reply({content:`❌ You haven't registered yet! Visit ${CASINO_URL} to create your account.`,ephemeral:true});
    const embed=new EmbedBuilder().setColor(0xC9A84C).setTitle('💰 Santen Coins Balance').setThumbnail(dUser.displayAvatarURL())
      .addFields(
        {name:'Player',value:u.username,inline:true},
        {name:'Balance',value:`**${fmt(u.balance)} ST**`,inline:true},
        {name:'Daily Streak',value:`🔥 ${u.streak||0} days`,inline:true}
      ).setFooter({text:'Santen Casino · '+CASINO_URL}).setTimestamp();
    return interaction.reply({embeds:[embed]});
  }

  // /leaderboard
  if(commandName==='leaderboard') {
    const rows=db.getLeaderboard(10);
    if(!rows.length) return interaction.reply({content:'No players yet!',ephemeral:true});
    const medals=['🥇','🥈','🥉'];
    const desc=rows.map((r,i)=>`${medals[i]||`**${i+1}.**`} <@${r.discord_id}> — **${fmt(r.balance)} ST**`).join('\n');
    const embed=new EmbedBuilder().setColor(0xC9A84C).setTitle('🏆 Santen Leaderboard')
      .setDescription(desc).setFooter({text:'Santen Casino'}).setTimestamp();
    return interaction.reply({embeds:[embed]});
  }

  // /give
  if(commandName==='give') {
    if(!isAdmin(member)) return interaction.reply({content:'❌ Admin only.',ephemeral:true});
    const target=interaction.options.getUser('user'), amount=interaction.options.getInteger('amount');
    const u=db.getUser(target.id);
    if(!u) return interaction.reply({content:`❌ ${target.username} hasn't joined the casino yet.`,ephemeral:true});
    db.addBalance(target.id, amount);
    const embed=new EmbedBuilder().setColor(0x3DBA6E).setTitle('✅ Coins Given')
      .setDescription(`Gave **${fmt(amount)} ST** to <@${target.id}>.\nNew balance: **${fmt(u.balance+amount)} ST**`);
    return interaction.reply({embeds:[embed]});
  }

  // /take
  if(commandName==='take') {
    if(!isAdmin(member)) return interaction.reply({content:'❌ Admin only.',ephemeral:true});
    const target=interaction.options.getUser('user'), amount=interaction.options.getInteger('amount');
    const u=db.getUser(target.id);
    if(!u) return interaction.reply({content:'❌ User not found.',ephemeral:true});
    const newBal=Math.max(0, u.balance-amount);
    db.updateUser(target.id, {balance:newBal});
    const embed=new EmbedBuilder().setColor(0xE05252).setTitle('✅ Coins Taken')
      .setDescription(`Took **${fmt(amount)} ST** from <@${target.id}>.\nNew balance: **${fmt(newBal)} ST**`);
    return interaction.reply({embeds:[embed]});
  }

  // /daily — mirrors server milestone logic exactly
  if(commandName==='daily') {
    let u=db.getUser(dUser.id);
    if(!u) return interaction.reply({content:`❌ Visit ${CASINO_URL} first to register!`,ephemeral:true});
    const now=Date.now(), nextClaim=(u.last_daily||0)+24*60*60*1000;
    if(now<nextClaim) {
      const ms=nextClaim-now, h=Math.floor(ms/3600000), m=Math.floor((ms%3600000)/60000);
      return interaction.reply({content:`⏳ Come back in **${h}h ${m}m** to claim your next daily reward!`,ephemeral:true});
    }
    const last=u.last_daily||0, isStreak=now<last+48*60*60*1000&&last>0;
    const newStreak=isStreak?(u.streak||0)+1:1;
    const base=250, bonus=(newStreak-1)*50;
    const extra=newStreak>=100?10000:newStreak>=30?2000:newStreak>=7?500:0;
    const reward=base+bonus+extra;
    db.updateUser(dUser.id,{streak:newStreak,last_daily:now});
    db.addBalance(dUser.id,reward);
    u=db.getUser(dUser.id);
    const embed=new EmbedBuilder().setColor(0xC9A84C).setTitle('🎁 Daily Reward Claimed!').setThumbnail(dUser.displayAvatarURL())
      .addFields(
        {name:'Reward',value:`**+${fmt(reward)} ST**`,inline:true},
        {name:'Streak',value:`🔥 ${newStreak} days`,inline:true},
        {name:'New Balance',value:`**${fmt(u.balance)} ST**`,inline:true}
      )
      .setDescription(extra>0?`🎉 **${newStreak}-day milestone bonus: +${fmt(extra)} ST!**`:null)
      .setFooter({text:'Milestones: 7d (+500) · 30d (+2,000) · 100d (+10,000)'});
    return interaction.reply({embeds:[embed]});
  }

  // /stats
  if(commandName==='stats') {
    const u=db.getUser(dUser.id);
    if(!u) return interaction.reply({content:`❌ Visit ${CASINO_URL} to register!`,ephemeral:true});
    const stats=db.getUserStats(dUser.id);
    const total_net=stats.reduce((a,s)=>a+s.net,0);
    const desc=stats.length
      ? stats.map(s=>`**${s.type}** — ${s.plays} plays, ${s.wins} wins, ${s.net>=0?'+':''}${fmt(s.net)} ST net`).join('\n')
      : 'No games played yet. Visit the casino!';
    const embed=new EmbedBuilder().setColor(0xC9A84C).setTitle(`📊 ${u.username}'s Stats`)
      .setDescription(desc)
      .addFields({name:'Total Net',value:`${total_net>=0?'**+':'**'}${fmt(total_net)} ST**`})
      .setFooter({text:'Santen Casino'});
    return interaction.reply({embeds:[embed],ephemeral:true});
  }

  // /casino
  if(commandName==='casino') {
    const embed=new EmbedBuilder().setColor(0xC9A84C).setTitle('🎰 Santen Casino')
      .setDescription(`Play slots, blackjack, roulette, coinflip, crash and more!\n\n🔗 **[Open Santen Casino](${CASINO_URL})**`)
      .addFields(
        {name:'Games',value:'🎰 Slots\n🃏 Blackjack\n🎡 Roulette\n🪙 Coinflip\n📈 Crash\n🔵 Plinko\n🎴 Hi-Lo\n💣 Mines',inline:true},
        {name:'Rewards',value:'🎁 Daily coins\n🔥 Streak bonuses\n🏆 Leaderboard\n💬 Casino chat',inline:true}
      ).setFooter({text:'Login with Discord to play · Santen Coins only'});
    return interaction.reply({embeds:[embed]});
  }
});

if(DISCORD_BOT_TOKEN) {
  botClient.login(DISCORD_BOT_TOKEN).catch(e => console.error('Bot login failed:', e.message));
} else {
  console.log('⚠️  DISCORD_BOT_TOKEN not set — bot will not start');
}
