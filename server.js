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
const CASINO_URL            = process.env.CASINO_URL || `http://localhost:${PORT}`;
const DISCORD_GUILD_ID      = process.env.DISCORD_GUILD_ID;
 
// ── Auth ──────────────────────────────────────────────────
app.get('/auth/discord', (req, res) => {
  const params = new URLSearchParams({ client_id: DISCORD_CLIENT_ID, redirect_uri: DISCORD_REDIRECT_URI, response_type: 'code', scope: 'identify' });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});
 
app.get('/auth/discord/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect(CASINO_URL);
  try {
    const tokenRes = await axios.post('https://discord.com/api/oauth2/token',
      new URLSearchParams({ client_id: DISCORD_CLIENT_ID, client_secret: DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: DISCORD_REDIRECT_URI }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }}
    );
    const { access_token } = tokenRes.data;
    const userRes = await axios.get('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${access_token}` }});
    const du = userRes.data;
    const existing = db.getUser(du.id);
    db.upsertUser(du.id, { username: du.username, avatar: du.avatar });
    if (!existing) notifyDiscord(`🎰 **${du.username}** just joined **Santen Casino**! They received **1,000 Santen Coins** to start. Good luck!`);
    req.session.discord_id = du.id;
    res.redirect(CASINO_URL);
  } catch (e) { console.error('OAuth error:', e.response?.data || e.message); res.redirect(CASINO_URL); }
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
 
// ══════════════════════════════════════════════════════════
// SLOTS — Dice & Roll 5×3, 10 paylines, expanding wild
// ══════════════════════════════════════════════════════════
// Symbols match Dice & Roll:
//   🎲 = WILD  (red dice, expands full reel)
//   ⭐ = SCATTER (gold star, pays anywhere, triggers bonus)
//   7️⃣  = Seven
//   🔔 = Bell
//   🍇 = Grapes
//   🍉 = Watermelon
//   🍑 = Plum/Orange
//   🍋 = Lemon
//   🍒 = Cherry
//
// PAYOUTS — multiplier of bet-per-line (10 lines so bet/10 per line):
//   🎲  x3→5   x4→15  x5→75
//   ⭐  x3→5   x4→20  x5→200  (multiplied by TOTAL bet)
//   7️⃣  x3→2   x4→5   x5→35
//   🔔  x3→2   x4→4.5 x5→20
//   🍇  x3→1.5 x4→3   x5→10
//   🍉  x3→1.5 x4→3   x5→10
//   🍑  x3→0.5 x4→2   x5→5
//   🍋  x3→0.5 x4→2   x5→5
//   🍒  x3→0.5 x4→2   x5→5
 
const SLOT_SYMS  = ['🎲','⭐','7️⃣','🔔','🍇','🍉','🍑','🍋','🍒'];
const SLOT_W     = [  2,   3,   4,   7,   9,   9,  15,  25,  26]; // total=100
const SLOT_TOTAL = SLOT_W.reduce((a,b)=>a+b,0);
 
const PAYOUTS = {
  '🎲': [5,   15,  75],
  '⭐': [5,   20, 200],
  '7️⃣': [2,   5,   35],
  '🔔': [2,   4.5, 20],
  '🍇': [1.5, 3,   10],
  '🍉': [1.5, 3,   10],
  '🍑': [0.5, 2,    5],
  '🍋': [0.5, 2,    5],
  '🍒': [0.5, 2,    5],
};
 
// 10 paylines — array of [row index (0=top,1=mid,2=bot)] per reel
const PAYLINES = [
  [1,1,1,1,1], // 1: middle straight
  [0,0,0,0,0], // 2: top straight
  [2,2,2,2,2], // 3: bottom straight
  [0,1,2,1,0], // 4: V down
  [2,1,0,1,2], // 5: V up
  [0,0,1,2,2], // 6: diagonal down
  [2,2,1,0,0], // 7: diagonal up
  [1,0,0,0,1], // 8: top dip
  [1,2,2,2,1], // 9: bottom dip
  [0,1,0,1,0], // 10: zigzag
];
 
function spinSymbol() {
  let r = Math.floor(Math.random() * SLOT_TOTAL);
  for (let i = 0; i < SLOT_SYMS.length; i++) { r -= SLOT_W[i]; if (r < 0) return SLOT_SYMS[i]; }
  return SLOT_SYMS[SLOT_SYMS.length - 1];
}
 
function generateGrid() {
  // grid[reel][row] — 5 reels × 3 rows
  return Array.from({length: 5}, () => [spinSymbol(), spinSymbol(), spinSymbol()]);
}
 
function applyExpandingWild(grid) {
  const expanded = grid.map(reel => [...reel]);
  const expandedReels = [];
  for (let r = 0; r < 5; r++) {
    if (expanded[r].includes('🎲')) { expanded[r] = ['🎲','🎲','🎲']; expandedReels.push(r); }
  }
  return { expanded, expandedReels };
}
 
function checkPaylines(grid, betPerLine) {
  let totalWin = 0;
  const winLines = [];
  for (let li = 0; li < PAYLINES.length; li++) {
    const seq = PAYLINES[li].map((row, reel) => grid[reel][row]);
    // Find base symbol (skip leading wilds, ignore scatter)
    let baseSymbol = null;
    for (let i = 0; i < 5; i++) {
      if (seq[i] === '⭐') break;
      if (seq[i] !== '🎲') { baseSymbol = seq[i]; break; }
    }
    if (!baseSymbol) continue;
    let count = 0;
    for (let i = 0; i < 5; i++) {
      if (seq[i] === baseSymbol || seq[i] === '🎲') count++;
      else break;
    }
    if (count >= 3) {
      const mult = PAYOUTS[baseSymbol]?.[count - 3] || 0;
      if (mult > 0) {
        const win = Math.floor(betPerLine * mult);
        totalWin += win;
        winLines.push({ line: li + 1, symbol: baseSymbol, count, multiplier: mult, win });
      }
    }
  }
  return { totalWin, winLines };
}
 
function checkScatter(grid, totalBet) {
  let scatterCount = 0;
  for (let r = 0; r < 5; r++) for (let row = 0; row < 3; row++) if (grid[r][row] === '⭐') scatterCount++;
  if (scatterCount < 3) return { scatterCount, scatterWin: 0, bonusTriggered: false };
  const mult = PAYOUTS['⭐'][Math.min(scatterCount - 3, 2)];
  return { scatterCount, scatterWin: Math.floor(totalBet * mult), bonusTriggered: true };
}
 
app.post('/api/slots', requireAuth, (req, res) => {
  const { bet } = req.body;
  if (!bet || bet < 10) return res.status(400).json({ error: 'Minimum bet is 10 ST' });
  if (req.user.balance < bet) return res.status(400).json({ error: 'Insufficient balance' });
  const betPerLine = Math.max(1, Math.floor(bet / 10));
  const rawGrid = generateGrid();
  const { scatterCount, scatterWin, bonusTriggered } = checkScatter(rawGrid, bet);
  const { expanded: grid, expandedReels } = applyExpandingWild(rawGrid);
  const { totalWin: lineWin, winLines } = checkPaylines(grid, betPerLine);
  const totalWin = lineWin + scatterWin;
  const net = totalWin - bet;
  const updated = db.addBalance(req.user.discord_id, net);
  db.logTransaction(req.user.discord_id, 'slots', net, winLines.map(w=>w.symbol).join(',') || 'no win');
  if (totalWin >= bet * 10) notifyDiscord(`🎰 **${req.user.username}** won **${totalWin.toLocaleString()} ST** on Slots (${(totalWin/bet).toFixed(1)}×)! 💰`);
  res.json({ grid, rawGrid, expandedReels, winLines, scatterCount, scatterWin, bonusTriggered, totalWin, net, newBalance: updated.balance });
});
 
// ── Roulette ──────────────────────────────────────────────
const R_NUMS=[0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
const R_COLORS={};
R_NUMS.forEach(n=>R_COLORS[n]='black');
[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36].forEach(n=>R_COLORS[n]='red');
R_COLORS[0]='green';
app.post('/api/roulette', requireAuth, (req, res) => {
  const {bet,betType}=req.body;
  if(!bet||bet<10)return res.status(400).json({error:'Minimum bet is 10 ST'});
  if(req.user.balance<bet)return res.status(400).json({error:'Insufficient balance'});
  const number=R_NUMS[Math.floor(Math.random()*R_NUMS.length)],color=R_COLORS[number];
  let multiplier=0;
  if(betType==='red'&&color==='red')multiplier=2;
  else if(betType==='black'&&color==='black')multiplier=2;
  else if(betType==='green'&&color==='green')multiplier=14;
  else if(betType==='low'&&number>=1&&number<=18)multiplier=2;
  else if(betType==='high'&&number>=19&&number<=36)multiplier=2;
  else if(betType==='odd'&&number%2===1&&number!==0)multiplier=2;
  else if(betType==='even'&&number%2===0&&number!==0)multiplier=2;
  const won=multiplier>0,payout=won?bet*multiplier:0,net=payout-bet;
  const updated=db.addBalance(req.user.discord_id,net);
  db.logTransaction(req.user.discord_id,'roulette',net,`${number} ${color}`);
  res.json({number,color,won,multiplier,payout,newBalance:updated.balance});
});
 
// ── Coinflip ──────────────────────────────────────────────
app.post('/api/coinflip', requireAuth, (req, res) => {
  const {bet,choice}=req.body;
  if(!bet||bet<10)return res.status(400).json({error:'Minimum bet is 10 ST'});
  if(req.user.balance<bet)return res.status(400).json({error:'Insufficient balance'});
  const result=Math.random()<0.5?'heads':'tails',won=result===choice;
  const payout=won?bet*2:0,net=payout-bet;
  const updated=db.addBalance(req.user.discord_id,net);
  db.logTransaction(req.user.discord_id,'coinflip',net,result);
  res.json({result,won,payout,newBalance:updated.balance});
});
 
// ── Crash ─────────────────────────────────────────────────
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
  if(safePayout>=5000)notifyDiscord(`📈 **${req.user.username}** cashed out on Crash for **${safePayout.toLocaleString()} ST**! 🚀`);
  res.json({newBalance:updated.balance});
});
 
// ── Plinko ────────────────────────────────────────────────
const PLINKO_MULTS=[10,3,1.5,1,0.5,0.3,0.5,1,1.5,3,10];
app.post('/api/plinko', requireAuth, (req,res)=>{
  const {bet}=req.body;
  if(!bet||bet<10)return res.status(400).json({error:'Minimum bet is 10 ST'});
  if(req.user.balance<bet)return res.status(400).json({error:'Insufficient balance'});
  const weights=[1,3,6,12,20,28,20,12,6,3,1],total=weights.reduce((a,b)=>a+b,0);
  let r=Math.random()*total,bucketIndex=0;
  for(let i=0;i<weights.length;i++){r-=weights[i];if(r<=0){bucketIndex=i;break;}}
  const multiplier=PLINKO_MULTS[bucketIndex],payout=Math.floor(bet*multiplier),net=payout-bet;
  const updated=db.addBalance(req.user.discord_id,net);
  db.logTransaction(req.user.discord_id,'plinko',net,multiplier+'x');
  if(multiplier>=5)notifyDiscord(`🔵 **${req.user.username}** hit **${multiplier}×** on Plinko and won **${payout.toLocaleString()} ST**! 💰`);
  res.json({bucketIndex,multiplier,won:multiplier>1,payout,newBalance:updated.balance});
});
 
// ── Hi-Lo (fully server-authoritative) ───────────────────
// Cards generated server-side; result is never trusted from client.
const HL_RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const HL_SUITS = ['♠','♥','♦','♣'];
function randomHLCard(){return{rank:HL_RANKS[Math.floor(Math.random()*HL_RANKS.length)],suit:HL_SUITS[Math.floor(Math.random()*HL_SUITS.length)]};}
function hlCardVal(rank){return HL_RANKS.indexOf(rank);} // 0=2, 12=A
function hlStreakMult(streak){return parseFloat(Math.pow(1.8,streak).toFixed(2));}
 
const hiloSessions = {};
 
app.post('/api/hilo/start', requireAuth, (req, res) => {
  const {bet}=req.body;
  if(!bet||bet<10)return res.status(400).json({error:'Minimum bet is 10 ST'});
  if(req.user.balance<bet)return res.status(400).json({error:'Insufficient balance'});
  const updated=db.addBalance(req.user.discord_id,-bet);
  const card=randomHLCard();
  hiloSessions[req.user.discord_id]={bet,card,streak:0,mult:1.0,active:true,ts:Date.now()};
  res.json({card,streak:0,mult:1.0,newBalance:updated.balance});
});
 
app.post('/api/hilo/guess', requireAuth, (req, res) => {
  const sess=hiloSessions[req.user.discord_id];
  if(!sess||!sess.active)return res.status(400).json({error:'No active Hi-Lo game'});
  const {direction}=req.body;
  if(!['higher','lower'].includes(direction))return res.status(400).json({error:'Invalid direction'});
  const oldCard=sess.card,newCard=randomHLCard();
  const oldVal=hlCardVal(oldCard.rank),newVal=hlCardVal(newCard.rank);
  const correct=(direction==='higher'&&newVal>oldVal)||(direction==='lower'&&newVal<oldVal);
  // Tie = loss
  sess.card=newCard;
  if(correct){
    sess.streak++;
    sess.mult=hlStreakMult(sess.streak);
    res.json({correct:true,newCard,oldCard,streak:sess.streak,mult:sess.mult});
  } else {
    sess.active=false;
    db.logTransaction(req.user.discord_id,'hilo',-sess.bet,`lost at streak ${sess.streak}`);
    res.json({correct:false,newCard,oldCard,streak:sess.streak,lost:true,bet:sess.bet});
  }
});
 
app.post('/api/hilo/cashout', requireAuth, (req, res) => {
  const sess=hiloSessions[req.user.discord_id];
  if(!sess||!sess.active||sess.streak===0)return res.status(400).json({error:'Nothing to cash out'});
  sess.active=false;
  const payout=Math.floor(sess.bet*sess.mult),profit=payout-sess.bet;
  const updated=db.addBalance(req.user.discord_id,payout);
  db.logTransaction(req.user.discord_id,'hilo',profit,`cashout ${sess.mult}x streak ${sess.streak}`);
  res.json({payout,profit,mult:sess.mult,streak:sess.streak,newBalance:updated.balance});
});
 
// ── Daily ─────────────────────────────────────────────────
app.get('/api/daily/status', requireAuth, (req, res) => {
  const now=Date.now(),last=req.user.last_daily||0,nextClaimAt=last+24*60*60*1000;
  res.json({canClaim:now>=nextClaimAt,streak:req.user.streak||0,nextClaimAt});
});
app.post('/api/daily/claim', requireAuth, (req, res) => {
  const now=Date.now(),last=req.user.last_daily||0;
  if(now<last+24*60*60*1000)return res.status(400).json({error:'Already claimed today'});
  const isStreak=now<last+48*60*60*1000&&last>0,newStreak=isStreak?(req.user.streak||0)+1:1,reward=250+(newStreak-1)*50;
  db.updateUser(req.user.discord_id,{streak:newStreak,last_daily:now});
  const updated=db.addBalance(req.user.discord_id,reward);
  notifyDiscord(`🎁 **${req.user.username}** claimed their daily reward of **${reward.toLocaleString()} ST**! (${newStreak} day streak 🔥)`);
  res.json({reward,streak:newStreak,newBalance:updated.balance});
});
 
// ── Stats / History / Leaderboard ─────────────────────────
app.get('/api/stats',requireAuth,(req,res)=>res.json(db.getUserStats(req.user.discord_id)));
app.get('/api/history',requireAuth,(req,res)=>{
  const data=JSON.parse(require('fs').readFileSync('./casino_data.json','utf8'));
  res.json((data.transactions||[]).filter(t=>t.discord_id===req.user.discord_id).slice(-30).reverse());
});
app.get('/api/leaderboard',requireAuth,(req,res)=>res.json(db.getLeaderboard(20)));
 
async function notifyDiscord(message){
  if(!DISCORD_BOT_TOKEN||!DISCORD_GUILD_ID)return;
  try{
    const r=await axios.get(`https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/channels`,{headers:{Authorization:`Bot ${DISCORD_BOT_TOKEN}`}});
    const ch=r.data.find(c=>c.name==='casino-feed'&&c.type===0)||r.data.find(c=>c.type===0);
    if(!ch)return;
    await axios.post(`https://discord.com/api/v10/channels/${ch.id}/messages`,{content:message},{headers:{Authorization:`Bot ${DISCORD_BOT_TOKEN}`}});
  }catch(e){}
}
 
app.get('/debug',(req,res)=>res.json({
  DISCORD_CLIENT_ID:DISCORD_CLIENT_ID?DISCORD_CLIENT_ID.slice(0,6)+'...':'MISSING',
  DISCORD_CLIENT_SECRET:DISCORD_CLIENT_SECRET?'SET':'MISSING',
  DISCORD_REDIRECT_URI,CASINO_URL,
  DISCORD_BOT_TOKEN:DISCORD_BOT_TOKEN?'SET':'MISSING',
  DISCORD_GUILD_ID:DISCORD_GUILD_ID||'MISSING',
  NODE_ENV:process.env.NODE_ENV||'not set'
}));
 
app.listen(PORT,()=>console.log(`\n🎰 Santen Casino running at http://localhost:${PORT}\n`));
