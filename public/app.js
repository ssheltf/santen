// ── Config ──────────────────────────────────────────────
const API = '';  // same origin — backend serves this file

// ── State ───────────────────────────────────────────────
let user = null;
let bets = { slots:50, bj:50, roulette:50, cf:50, crash:50 };
let bjState = null;
let rouletteBet = null;
let coinChoice = null;
let crashState = null;

// ── Auth ────────────────────────────────────────────────
function loginWithDiscord() {
  window.location.href = '/auth/discord';
}
function logout() {
  fetch('/auth/logout', {method:'POST'}).then(()=>{ window.location.reload(); });
}

async function init() {
  try {
    const res = await fetch('/api/me');
    if (res.ok) {
      user = await res.json();
      showApp();
    }
  } catch(e) {}
}

function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  updateUserUI();
  showPage('slots');
  initReels();
  drawRouletteWheel();
  initCrashCanvas();
}

function updateUserUI() {
  if (!user) return;
  document.getElementById('user-name').textContent = user.username;
  document.getElementById('user-balance').textContent = fmtNum(user.balance);
  document.getElementById('header-balance').textContent = fmtNum(user.balance) + ' ST';
  const av = document.getElementById('user-avatar');
  av.src = user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.discord_id}/${user.avatar}.png?size=64`
    : `https://cdn.discordapp.com/embed/avatars/0.png`;
}

function fmtNum(n) { return Number(n).toLocaleString(); }

// ── Navigation ───────────────────────────────────────────
function showPage(page) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.getElementById('page-'+page).classList.add('active');
  const nav = document.querySelector(`.nav-item[data-page="${page}"]`);
  if(nav) nav.classList.add('active');
  const titles = {slots:'Slots',blackjack:'Blackjack',roulette:'Roulette',coinflip:'Coinflip',crash:'Crash',daily:'Daily Reward',leaderboard:'Leaderboard'};
  document.getElementById('page-title').textContent = titles[page]||page;
  if(page==='leaderboard') loadLeaderboard();
  if(page==='daily') loadDailyStatus();
  if(page==='roulette') setTimeout(drawRouletteWheel,50);
}

// ── Bet Controls ─────────────────────────────────────────
function adjustBet(game, delta) {
  const key = game;
  bets[key] = Math.max(10, Math.min(user?.balance||99999, bets[key]+delta));
  const el = document.getElementById(key+'-bet-display');
  if(el) el.textContent = fmtNum(bets[key]);
}

async function apiPost(path, body) {
  const res = await fetch(path, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify(body)
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error||'Error'); }
  return res.json();
}

// ── SLOTS ────────────────────────────────────────────────
const SYMBOLS = ['💎','7️⃣','🍒','⭐','🔔','🍋'];
const CELL_H  = 110; // must match CSS .slot-cell height

// Build a reel strip with N random symbols + a target at the visible position
function buildStrip(targetSymbol, totalCells) {
  const cells = [];
  for (let i = 0; i < totalCells; i++) {
    cells.push(SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]);
  }
  // The LAST cell is what lands in view — set it to our target
  cells[cells.length - 1] = targetSymbol;
  return cells;
}

function renderStrip(stripEl, cells) {
  stripEl.innerHTML = '';
  cells.forEach(sym => {
    const div = document.createElement('div');
    div.className = 'slot-cell';
    div.textContent = sym;
    stripEl.appendChild(div);
  });
}

// Init reels on page load with a default symbol
function initReels() {
  [0,1,2].forEach(i => {
    const strip = document.getElementById('reel'+i);
    const cells = buildStrip('💎', 6);
    renderStrip(strip, cells);
    // Position so last cell is visible (top = -(totalCells-1)*CELL_H)
    strip.style.transition = 'none';
    strip.style.top = -((cells.length - 1) * CELL_H) + 'px';
  });
}

function spinReel(stripEl, targetSymbol, totalCells, delay) {
  return new Promise(resolve => {
    const cells = buildStrip(targetSymbol, totalCells);
    renderStrip(stripEl, cells);

    // Start at top (position 0 = first cell visible)
    stripEl.style.transition = 'none';
    stripEl.style.top = '0px';

    // Force reflow so browser registers the start position
    stripEl.getBoundingClientRect();

    setTimeout(() => {
      // Animate down to final cell
      const finalTop = -((cells.length - 1) * CELL_H);
      // Duration scales with how many cells we scroll through
      const duration = 0.55 + totalCells * 0.055;
      stripEl.style.transition = `top ${duration}s cubic-bezier(0.12, 0.8, 0.3, 1.0)`;
      stripEl.style.top = finalTop + 'px';

      stripEl.addEventListener('transitionend', () => resolve(), { once: true });
    }, delay);
  });
}

async function spinSlots() {
  if (!user) return;
  const btn = document.getElementById('slots-btn');
  btn.disabled = true;
  document.getElementById('slots-result').innerHTML = '';

  try {
    const data = await apiPost('/api/slots', { bet: bets.slots });
    user.balance = data.newBalance;
    updateUserUI();

    // Stagger each reel: reel 0 shortest, reel 2 longest
    await Promise.all([
      spinReel(document.getElementById('reel0'), data.reels[0], 18, 0),
      spinReel(document.getElementById('reel1'), data.reels[1], 24, 120),
      spinReel(document.getElementById('reel2'), data.reels[2], 30, 240),
    ]);

    const res = document.getElementById('slots-result');
    if (data.won) {
      res.innerHTML = `<span class="win-text">+${fmtNum(data.payout)} ST · ${data.multiplier}×</span>`;
      document.querySelector('.slots-machine').classList.add('game-win');
      setTimeout(() => document.querySelector('.slots-machine').classList.remove('game-win'), 700);
    } else {
      res.innerHTML = `<span class="lose-text">No match — better luck next spin</span>`;
    }
    btn.disabled = false;
  } catch(e) {
    showError('slots-result', e.message);
    btn.disabled = false;
  }
}

// ── BLACKJACK ────────────────────────────────────────────
const SUITS = ['♠','♥','♦','♣'];
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
function cardVal(rank) {
  if(['J','Q','K'].includes(rank)) return 10;
  if(rank==='A') return 11;
  return parseInt(rank);
}
function handScore(hand) {
  let s=0, aces=0;
  hand.forEach(c=>{s+=cardVal(c.rank);if(c.rank==='A')aces++;});
  while(s>21&&aces>0){s-=10;aces--;}
  return s;
}
function renderCard(c, faceDown=false) {
  const div = document.createElement('div');
  div.className = 'card' + (faceDown?' face-down':'') + (['♥','♦'].includes(c?.suit)?' red':'');
  if(!faceDown&&c){
    const r=document.createElement('div'); r.className='card-rank'; r.textContent=c.rank;
    const s=document.createElement('div'); s.className='card-suit'; s.textContent=c.suit;
    div.appendChild(r); div.appendChild(s);
  }
  return div;
}
function renderHand(elId, hand, hideSecond=false) {
  const el = document.getElementById(elId); el.innerHTML='';
  hand.forEach((c,i)=>el.appendChild(renderCard(c, hideSecond&&i===1)));
}

async function dealBlackjack() {
  if(!user) return;
  const deck = [];
  SUITS.forEach(s=>RANKS.forEach(r=>deck.push({suit:s,rank:r})));
  for(let i=deck.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]];}

  const player=[deck.pop(),deck.pop()];
  const dealer=[deck.pop(),deck.pop()];

  try {
    await apiPost('/api/balance/deduct', {amount: bets.bj});
    user.balance -= bets.bj;
    updateUserUI();
  } catch(e) { showError('bj-result',e.message); return; }

  bjState = {player, dealer, deck, bet:bets.bj, over:false};
  renderHand('player-hand', player);
  renderHand('dealer-hand', dealer, true);
  document.getElementById('player-score').textContent = handScore(player);
  document.getElementById('dealer-score').textContent = '?';
  document.getElementById('bj-result').textContent='';

  const ps = handScore(player);
  if(ps===21){
    await settleBJ('blackjack');
    return;
  }
  document.getElementById('bj-actions').innerHTML=`
    <button class="bj-btn hit-btn" onclick="bjHit()">HIT</button>
    <button class="bj-btn stand-btn" onclick="bjStand()">STAND</button>
  `;
}

function bjHit() {
  if(!bjState||bjState.over) return;
  bjState.player.push(bjState.deck.pop());
  renderHand('player-hand', bjState.player);
  const ps = handScore(bjState.player);
  document.getElementById('player-score').textContent=ps;
  if(ps>21) settleBJ('bust');
  else if(ps===21) bjStand();
}

async function bjStand() {
  if(!bjState||bjState.over) return;
  renderHand('dealer-hand', bjState.dealer);
  document.getElementById('dealer-score').textContent = handScore(bjState.dealer);
  while(handScore(bjState.dealer)<17) {
    bjState.dealer.push(bjState.deck.pop());
    renderHand('dealer-hand', bjState.dealer);
    document.getElementById('dealer-score').textContent = handScore(bjState.dealer);
  }
  const ds=handScore(bjState.dealer), ps=handScore(bjState.player);
  if(ds>21||ps>ds) settleBJ('win');
  else if(ps===ds) settleBJ('push');
  else settleBJ('lose');
}

async function settleBJ(result) {
  bjState.over=true;
  const {bet}=bjState;
  let msg='', payout=0;
  if(result==='blackjack'){msg='🃏 Blackjack! ×2.5';payout=Math.floor(bet*2.5);}
  else if(result==='win'){msg='✓ You win! ×2';payout=bet*2;}
  else if(result==='push'){msg='Push — bet returned';payout=bet;}
  else if(result==='bust'){msg='Bust! Over 21';}
  else{msg='Dealer wins';}

  if(payout>0){
    try { await apiPost('/api/balance/add',{amount:payout}); user.balance+=payout; updateUserUI(); } catch(e){}
  }
  renderHand('dealer-hand', bjState.dealer);
  document.getElementById('dealer-score').textContent=handScore(bjState.dealer);
  const res=document.getElementById('bj-result');
  res.textContent=msg;
  res.style.color = payout>0 ? 'var(--gold)' : 'var(--red)';

  document.getElementById('bj-actions').innerHTML=`<button class="bj-btn deal-btn" onclick="dealBlackjack()">DEAL AGAIN</button>`;
}

// ── ROULETTE ─────────────────────────────────────────────
const R_NUMS = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
const R_COLORS = {0:'green'};
[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36].forEach(n=>R_COLORS[n]='red');
R_NUMS.forEach(n=>{if(!R_COLORS[n])R_COLORS[n]='black';});

function drawRouletteWheel(angle=0) {
  const canvas=document.getElementById('roulette-canvas');
  if(!canvas) return;
  const ctx=canvas.getContext('2d');
  const cx=150,cy=150,r=140;
  const arc=(2*Math.PI)/R_NUMS.length;
  ctx.clearRect(0,0,300,300);
  R_NUMS.forEach((num,i)=>{
    const start=angle+i*arc-Math.PI/2;
    const end=start+arc;
    ctx.beginPath();
    ctx.moveTo(cx,cy);
    ctx.arc(cx,cy,r,start,end);
    ctx.closePath();
    const c=R_COLORS[num];
    ctx.fillStyle = c==='red'?'#c0392b': c==='green'?'#27ae60':'#1a1a1a';
    ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,0.05)';
    ctx.lineWidth=0.5;
    ctx.stroke();
    ctx.save();
    ctx.translate(cx,cy);
    ctx.rotate(start+arc/2);
    ctx.translate(r*0.72,0);
    ctx.rotate(Math.PI/2);
    ctx.fillStyle='#fff';
    ctx.font='bold 9px DM Mono,monospace';
    ctx.textAlign='center';
    ctx.textBaseline='middle';
    ctx.fillText(num,0,0);
    ctx.restore();
  });
  ctx.beginPath();
  ctx.arc(cx,cy,18,0,Math.PI*2);
  ctx.fillStyle='#111';
  ctx.fill();
  ctx.strokeStyle='var(--gold)';
  ctx.lineWidth=2;
  ctx.stroke();
}

function setRouletteBet(type) {
  rouletteBet=type;
  document.querySelectorAll('.rb-btn').forEach(b=>b.classList.remove('selected'));
  event.target.classList.add('selected');
  const labels={red:'Red ×2',black:'Black ×2',green:'Green ×14',low:'1–18 ×2',high:'19–36 ×2',odd:'Odd ×2',even:'Even ×2'};
  document.getElementById('roulette-selection').textContent='Selected: '+labels[type];
}

async function spinRoulette() {
  if(!rouletteBet){alert('Select a bet type first!');return;}
  const btn=document.getElementById('roulette-btn');
  btn.disabled=true;
  document.getElementById('roulette-result').textContent='';

  try {
    const data = await apiPost('/api/roulette',{bet:bets.roulette, betType:rouletteBet});
    user.balance=data.newBalance; updateUserUI();

    let spins=0, duration=120, maxSpins=60;
    const targetIdx = R_NUMS.indexOf(data.number);
    const targetAngle = -(targetIdx*(2*Math.PI/R_NUMS.length));
    const spinAnim = () => {
      spins++;
      const progress=spins/maxSpins;
      const ease=1-Math.pow(1-progress,3);
      const angle=(Math.PI*16*ease)+targetAngle;
      drawRouletteWheel(angle);
      if(spins<maxSpins) setTimeout(spinAnim,duration*(0.5+progress*1.5));
      else {
        drawRouletteWheel(targetAngle);
        const res=document.getElementById('roulette-result');
        const col=R_COLORS[data.number];
        res.innerHTML=`<span style="color:${col==='red'?'var(--red)':col==='green'?'var(--green)':'var(--text)'}">${data.number} ${col.toUpperCase()}</span>&nbsp;&nbsp;${data.won?`<span style="color:var(--gold)">+${fmtNum(data.payout)} ST</span>`:'<span style="color:var(--muted)">Lost</span>'}`;
        btn.disabled=false;
      }
    };
    spinAnim();
  } catch(e) { showError('roulette-result',e.message); btn.disabled=false; }
}

// ── COINFLIP ─────────────────────────────────────────────
function setCoinChoice(c) {
  coinChoice=c;
  document.getElementById('cf-heads').classList.toggle('selected',c==='heads');
  document.getElementById('cf-tails').classList.toggle('selected',c==='tails');
}

async function flipCoin() {
  if(!coinChoice){alert('Choose heads or tails!');return;}
  const btn=document.getElementById('cf-btn');
  btn.disabled=true;
  document.getElementById('cf-result').textContent='';
  const coin=document.getElementById('coin');
  coin.classList.add('flipping');

  try {
    const data=await apiPost('/api/coinflip',{bet:bets.cf,choice:coinChoice});
    user.balance=data.newBalance; updateUserUI();
    setTimeout(()=>{
      coin.classList.remove('flipping');
      const res=document.getElementById('cf-result');
      res.textContent = data.won ? `✓ ${data.result.toUpperCase()} — +${fmtNum(data.payout)} ST` : `✗ ${data.result.toUpperCase()} — Better luck next flip`;
      res.style.color = data.won ? 'var(--gold)':'var(--red)';
      btn.disabled=false;
    },1100);
  } catch(e) {
    coin.classList.remove('flipping');
    showError('cf-result',e.message);
    btn.disabled=false;
  }
}

// ── CRASH ────────────────────────────────────────────────
let crashCanvas, crashCtx, crashInterval=null, crashMultiplier=1.0, crashCrashPoint=1, crashBetActive=false, crashCashedOut=false, crashProfitAtCashout=0;

function initCrashCanvas() {
  crashCanvas=document.getElementById('crash-canvas');
  if(!crashCanvas) return;
  crashCtx=crashCanvas.getContext('2d');
  drawCrashIdle();
}

function drawCrashIdle() {
  if(!crashCtx) return;
  crashCtx.clearRect(0,0,600,300);
  crashCtx.fillStyle='rgba(255,255,255,0.03)';
  for(let x=0;x<600;x+=60){crashCtx.fillRect(x,0,1,300);}
  for(let y=0;y<300;y+=50){crashCtx.fillRect(0,y,600,1);}
}

function drawCrashLine(m) {
  if(!crashCtx) return;
  const w=600,h=300;
  crashCtx.clearRect(0,0,w,h);
  crashCtx.fillStyle='rgba(255,255,255,0.03)';
  for(let x=0;x<w;x+=60){crashCtx.fillRect(x,0,1,h);}
  for(let y=0;y<h;y+=50){crashCtx.fillRect(0,y,w,1);}
  const progress=Math.min((m-1)/9,1);
  const ex=w*progress, ey=h-(h*Math.pow(progress,0.6));
  const grad=crashCtx.createLinearGradient(0,h,ex,ey);
  grad.addColorStop(0,'rgba(201,168,76,0.8)');
  grad.addColorStop(1,'rgba(201,168,76,0.2)');
  crashCtx.beginPath();
  crashCtx.moveTo(0,h);
  for(let p=0;p<=progress;p+=0.01){
    crashCtx.lineTo(w*p, h-(h*Math.pow(p,0.6)));
  }
  crashCtx.strokeStyle='var(--gold)';
  crashCtx.lineWidth=2;
  crashCtx.stroke();
  crashCtx.lineTo(ex,h);
  crashCtx.closePath();
  crashCtx.fillStyle='rgba(201,168,76,0.06)';
  crashCtx.fill();
  crashCtx.beginPath();
  crashCtx.arc(ex,ey,5,0,Math.PI*2);
  crashCtx.fillStyle='var(--gold)';
  crashCtx.fill();
}

async function startCrash() {
  if(!user) return;
  const btn=document.getElementById('crash-btn');
  const cashBtn=document.getElementById('cashout-btn');
  btn.disabled=true;
  document.getElementById('crash-result').textContent='';

  try {
    const data=await apiPost('/api/crash/start',{bet:bets.crash});
    user.balance=data.newBalance; updateUserUI();
    crashCrashPoint=data.crashPoint;
    crashMultiplier=1.0;
    crashBetActive=true;
    crashCashedOut=false;
    const mult=document.getElementById('crash-multiplier');
    mult.classList.remove('crashed');

    btn.classList.add('hidden');
    cashBtn.classList.remove('hidden');

    crashInterval=setInterval(()=>{
      crashMultiplier+=0.01*(1+crashMultiplier*0.05);
      mult.textContent=crashMultiplier.toFixed(2)+'×';
      drawCrashLine(crashMultiplier);
      if(crashMultiplier>=crashCrashPoint){
        clearInterval(crashInterval);
        if(!crashCashedOut) {
          mult.textContent=crashCrashPoint.toFixed(2)+'× CRASHED';
          mult.classList.add('crashed');
          cashBtn.classList.add('hidden');
          btn.classList.remove('hidden');
          btn.disabled=false;
          document.getElementById('crash-result').innerHTML=`<span style="color:var(--red)">Crashed at ${crashCrashPoint.toFixed(2)}× — Lost ${fmtNum(bets.crash)} ST</span>`;
          drawCrashLine(crashCrashPoint);
        }
        crashBetActive=false;
      }
    },60);
  } catch(e) {
    showError('crash-result',e.message);
    btn.disabled=false;
  }
}

async function cashOut() {
  if(!crashBetActive||crashCashedOut) return;
  crashCashedOut=true;
  clearInterval(crashInterval);
  const payout=Math.floor(bets.crash*crashMultiplier);
  const profit=payout-bets.crash;
  try {
    const data=await apiPost('/api/crash/cashout',{payout});
    user.balance=data.newBalance; updateUserUI();
  } catch(e){}
  const cashBtn=document.getElementById('cashout-btn');
  const btn=document.getElementById('crash-btn');
  cashBtn.classList.add('hidden');
  btn.classList.remove('hidden');
  btn.disabled=false;
  document.getElementById('crash-result').innerHTML=`<span style="color:var(--gold)">Cashed out at ${crashMultiplier.toFixed(2)}× — +${fmtNum(profit)} ST profit!</span>`;
  crashBetActive=false;
}

// ── DAILY ────────────────────────────────────────────────
async function loadDailyStatus() {
  try {
    const data=await fetch('/api/daily/status').then(r=>r.json());
    document.getElementById('streak-count').textContent=data.streak+' days';
    const reward=250+data.streak*50;
    document.getElementById('reward-amount').textContent='+'+fmtNum(reward)+' ST';
    const btn=document.getElementById('daily-btn');
    if(!data.canClaim){
      const ms=data.nextClaimAt-Date.now();
      const hrs=Math.floor(ms/3600000);
      const mins=Math.floor((ms%3600000)/60000);
      btn.disabled=true;
      btn.textContent=`Come back in ${hrs}h ${mins}m`;
      document.getElementById('daily-result').innerHTML=`<span style="color:var(--muted)">Already claimed today</span>`;
    } else {
      btn.disabled=false;
      btn.textContent='CLAIM REWARD';
    }
  } catch(e){}
}

async function claimDaily() {
  try {
    const data=await apiPost('/api/daily/claim',{});
    user.balance=data.newBalance; updateUserUI();
    document.getElementById('streak-count').textContent=data.streak+' days';
    document.getElementById('daily-result').innerHTML=`<span style="color:var(--gold)">+${fmtNum(data.reward)} ST claimed! 🎉</span>`;
    const btn=document.getElementById('daily-btn');
    btn.disabled=true;
    btn.textContent='Come back tomorrow';
  } catch(e) { showError('daily-result',e.message); }
}

// ── LEADERBOARD ──────────────────────────────────────────
async function loadLeaderboard() {
  const list=document.getElementById('leaderboard-list');
  list.innerHTML='<div class="lb-loading">Loading...</div>';
  try {
    const data=await fetch('/api/leaderboard').then(r=>r.json());
    list.innerHTML='';
    const medals=['🥇','🥈','🥉'];
    data.forEach((u,i)=>{
      const row=document.createElement('div');
      row.className='lb-row'+(i<3?' top'+(i+1):'')+(u.discord_id===user?.discord_id?' me':'');
      row.innerHTML=`
        <div class="lb-rank">${i<3?medals[i]:i+1}</div>
        <img class="lb-avatar" src="${u.avatar?`https://cdn.discordapp.com/avatars/${u.discord_id}/${u.avatar}.png?size=32`:'https://cdn.discordapp.com/embed/avatars/0.png'}" alt="">
        <div class="lb-username">${u.username}</div>
        <div class="lb-balance">${fmtNum(u.balance)} ST</div>
      `;
      list.appendChild(row);
    });
  } catch(e){list.innerHTML='<div class="lb-loading">Failed to load</div>';}
}

// ── Helpers ──────────────────────────────────────────────
function showError(elId, msg) {
  const el=document.getElementById(elId);
  if(el) { el.innerHTML=`<span style="color:var(--red)">${msg}</span>`; }
}

// ── Boot ─────────────────────────────────────────────────
init();
