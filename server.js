require('dotenv').config();
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const db = require('./db');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  store: new FileStore({ path: './sessions', logFn: ()=>{} }),
  secret: process.env.SESSION_SECRET || 'santen-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

const DISCORD_CLIENT_ID     = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI  = process.env.DISCORD_REDIRECT_URI || `http://localhost:${PORT}/auth/discord/callback`;
const DISCORD_BOT_TOKEN     = process.env.DISCORD_BOT_TOKEN;
const DISCORD_GUILD_ID      = process.env.DISCORD_GUILD_ID;

app.get('/auth/discord', (req, res) => {
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify'
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

app.get('/auth/discord/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/');
  try {
    const tokenRes = await axios.post('https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: DISCORD_REDIRECT_URI,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }}
    );
    const { access_token } = tokenRes.data;
    const userRes = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    const du = userRes.data;
    const existing = db.getUser(du.id);
    db.upsertUser(du.id, { username: du.username, avatar: du.avatar });
    if (!existing) {
      notifyDiscord(`🎰 **${du.username}** just joined **Santen Casino**! They received **1,000 Santen Coins** to start. Good luck!`);
    }
    req.session.discord_id = du.id;
    res.redirect('/');
  } catch (e) {
    console.error('OAuth error:', e.response?.data || e.message);
    res.redirect('/');
  }
});

app.post('/auth/logout', (req, res) => { req.session.destroy(); res.json({ ok: true }); });

function requireAuth(req, res, next) {
  if (!req.session.discord_id) return res.status(401).json({ error: 'Not logged in' });
  const user = db.getUser(req.session.discord_id);
  if (!user) return res.status(401).json({ error: 'User not found' });
  req.user = user;
  next();
}

app.get('/api/me', requireAuth, (req, res) => {
  const { discord_id, username, avatar, balance, streak } = req.user;
  res.json({ discord_id, username, avatar, balance, streak });
});

app.post('/api/balance/deduct', requireAuth, (req, res) => {
  const { amount } = req.body;
  if (req.user.balance < amount) return res.status(400).json({ error: 'Insufficient balance' });
  res.json({ newBalance: db.addBalance(req.user.discord_id, -amount).balance });
});

app.post('/api/balance/add', requireAuth, (req, res) => {
  res.json({ newBalance: db.addBalance(req.user.discord_id, req.body.amount).balance });
});

// Slots
const SLOT_SYMBOLS = ['💎','7️⃣','🍒','⭐','🔔','🍋'];
const SLOT_WEIGHTS = [1,3,6,10,15,20];
function weightedSlot() {
  const total = SLOT_WEIGHTS.reduce((a,b)=>a+b,0);
  let r = Math.random()*total;
  for(let i=0;i<SLOT_SYMBOLS.length;i++){r-=SLOT_WEIGHTS[i];if(r<=0)return SLOT_SYMBOLS[i];}
  return SLOT_SYMBOLS[SLOT_SYMBOLS.length-1];
}
app.post('/api/slots', requireAuth, (req, res) => {
  const { bet } = req.body;
  if (!bet||bet<10) return res.status(400).json({error:'Minimum bet is 10 ST'});
  if (req.user.balance<bet) return res.status(400).json({error:'Insufficient balance'});
  const reels=[weightedSlot(),weightedSlot(),weightedSlot()];
  let multiplier=0;
  if(reels[0]===reels[1]&&reels[1]===reels[2]){
    const s=reels[0];
    if(s==='💎')multiplier=50;else if(s==='7️⃣')multiplier=25;else if(s==='🍒')multiplier=10;else if(s==='⭐')multiplier=5;else multiplier=3;
  } else if(reels[0]===reels[1]||reels[1]===reels[2]||reels[0]===reels[2]) multiplier=2;
  const won=multiplier>0, payout=won?bet*multiplier:0, net=payout-bet;
  const updated=db.addBalance(req.user.discord_id,net);
  db.logTransaction(req.user.discord_id,'slots',net,reels.join(''));
  if(multiplier>=25) notifyDiscord(`🎰 **${req.user.username}** hit **${reels.join('')}** and won **${payout.toLocaleString()} Santen Coins** (${multiplier}×)! 💰`);
  res.json({reels,won,multiplier,payout,newBalance:updated.balance});
});

// Roulette
const R_NUMS=[0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
const R_COLORS={};
R_NUMS.forEach(n=>R_COLORS[n]='black');
[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36].forEach(n=>R_COLORS[n]='red');
R_COLORS[0]='green';
app.post('/api/roulette', requireAuth, (req, res) => {
  const {bet,betType}=req.body;
  if(!bet||bet<10)return res.status(400).json({error:'Minimum bet is 10 ST'});
  if(req.user.balance<bet)return res.status(400).json({error:'Insufficient balance'});
  const number=R_NUMS[Math.floor(Math.random()*R_NUMS.length)], color=R_COLORS[number];
  let multiplier=0;
  if(betType==='red'&&color==='red')multiplier=2;
  else if(betType==='black'&&color==='black')multiplier=2;
  else if(betType==='green'&&color==='green')multiplier=14;
  else if(betType==='low'&&number>=1&&number<=18)multiplier=2;
  else if(betType==='high'&&number>=19&&number<=36)multiplier=2;
  else if(betType==='odd'&&number%2===1&&number!==0)multiplier=2;
  else if(betType==='even'&&number%2===0&&number!==0)multiplier=2;
  const won=multiplier>0, payout=won?bet*multiplier:0, net=payout-bet;
  const updated=db.addBalance(req.user.discord_id,net);
  db.logTransaction(req.user.discord_id,'roulette',net,`${number} ${color}`);
  res.json({number,color,won,multiplier,payout,newBalance:updated.balance});
});

// Coinflip
app.post('/api/coinflip', requireAuth, (req, res) => {
  const {bet,choice}=req.body;
  if(!bet||bet<10)return res.status(400).json({error:'Minimum bet is 10 ST'});
  if(req.user.balance<bet)return res.status(400).json({error:'Insufficient balance'});
  const result=Math.random()<0.5?'heads':'tails', won=result===choice;
  const payout=won?bet*2:0, net=payout-bet;
  const updated=db.addBalance(req.user.discord_id,net);
  db.logTransaction(req.user.discord_id,'coinflip',net,result);
  res.json({result,won,payout,newBalance:updated.balance});
});

// Crash
function generateCrashPoint(){const r=Math.random();if(r<0.04)return 1.0;return Math.max(1.01,Math.floor(100/(1-r*0.96))/100);}
app.post('/api/crash/start', requireAuth, (req, res) => {
  const {bet}=req.body;
  if(!bet||bet<10)return res.status(400).json({error:'Minimum bet is 10 ST'});
  if(req.user.balance<bet)return res.status(400).json({error:'Insufficient balance'});
  const crashPoint=generateCrashPoint();
  const updated=db.addBalance(req.user.discord_id,-bet);
  res.json({crashPoint,newBalance:updated.balance});
});
app.post('/api/crash/cashout', requireAuth, (req, res) => {
  const safePayout=Math.min(Math.max(0,req.body.payout),1000000);
  const updated=db.addBalance(req.user.discord_id,safePayout);
  db.logTransaction(req.user.discord_id,'crash',safePayout,'cashout');
  if(safePayout>=5000)notifyDiscord(`📈 **${req.user.username}** cashed out on Crash for **${safePayout.toLocaleString()} Santen Coins**! 🚀`);
  res.json({newBalance:updated.balance});
});

// Daily
app.get('/api/daily/status', requireAuth, (req, res) => {
  const now=Date.now(), last=req.user.last_daily||0;
  const nextClaimAt=last+24*60*60*1000;
  res.json({canClaim:now>=nextClaimAt, streak:req.user.streak||0, nextClaimAt});
});
app.post('/api/daily/claim', requireAuth, (req, res) => {
  const now=Date.now(), last=req.user.last_daily||0;
  if(now<last+24*60*60*1000)return res.status(400).json({error:'Already claimed today'});
  const isStreak=now<last+48*60*60*1000&&last>0;
  const newStreak=isStreak?(req.user.streak||0)+1:1;
  const reward=250+(newStreak-1)*50;
  db.updateUser(req.user.discord_id,{streak:newStreak,last_daily:now});
  const updated=db.addBalance(req.user.discord_id,reward);
  notifyDiscord(`🎁 **${req.user.username}** claimed their daily reward of **${reward.toLocaleString()} Santen Coins**! (${newStreak} day streak 🔥)`);
  res.json({reward,streak:newStreak,newBalance:updated.balance});
});

// Leaderboard
app.get('/api/leaderboard', requireAuth, (req, res) => res.json(db.getLeaderboard(20)));

async function notifyDiscord(message) {
  if (!DISCORD_BOT_TOKEN||!DISCORD_GUILD_ID) return;
  try {
    const r=await axios.get(`https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/channels`,{headers:{Authorization:`Bot ${DISCORD_BOT_TOKEN}`}});
    const ch=r.data.find(c=>c.name==='casino-feed'&&c.type===0)||r.data.find(c=>c.type===0);
    if(!ch)return;
    await axios.post(`https://discord.com/api/v10/channels/${ch.id}/messages`,{content:message},{headers:{Authorization:`Bot ${DISCORD_BOT_TOKEN}`}});
  } catch(e){}
}

app.listen(PORT, ()=>console.log(`\n🎰 Santen Casino running at http://localhost:${PORT}\n`));
