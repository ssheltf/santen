(function() {
'use strict';
// All variables are private — console cannot access or modify them

// ── State ────────────────────────────────────────────────
let user = null;
let bets = { slots:50, bj:50, roulette:50, cf:50, crash:50, plinko:50, hilo:50, mines:50 };
let bjState = null, rouletteBet = null, coinChoice = null;
let crashInterval = null, crashMult = 1.0, crashActive = false, crashCashedOut = false;
let minesState = null, mineCount = 5;
let hiloActive = false, hiloBet = 0, hiloMult = 1;
let plinkoRunning = false;
let eventSource = null;
let rouletteAngle = 0;

// ── Auth ──────────────────────────────────────────────────
function loginWithDiscord(){ window.location.href='/auth/discord'; }
function logout(){ fetch('/auth/logout',{method:'POST'}).then(()=>window.location.reload()); }

async function init() {
  try {
    const res = await fetch('/api/me');
    if (res.ok) { user = await res.json(); showApp(); }
    else showLanding();
  } catch(e) { showLanding(); }
}

function showLanding() { document.getElementById('landing-screen').classList.remove('hidden'); }

function showApp() {
  document.getElementById('landing-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  updateUserUI();
  showPage('slots');
  initReels();
  drawRouletteWheel(0);
  initCrashCanvas();
  buildMinesGrid();
  initPlinko();
  initChat();
}

// Balance roll animation — safe, no shared RAF state
let _balRaf = null, _balFrom = null;
function updateUserUI(bal) {
  if (!user) return;
  const prev = (_balFrom !== null) ? _balFrom : (bal !== undefined ? bal : user.balance);
  if (bal !== undefined) user.balance = bal;
  if (typeof user.balance !== 'number') return;
  document.getElementById('user-name').textContent = user.username;
  const src = user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.discord_id}/${user.avatar}.png?size=64`
    : `https://cdn.discordapp.com/embed/avatars/0.png`;
  document.getElementById('user-avatar').src = src;
  const pm = document.getElementById('pm-avatar');
  if (pm) pm.src = src;
  // Animate balance counter
  if (_balRaf) { cancelAnimationFrame(_balRaf); _balRaf = null; }
  const target = user.balance;
  const from = (prev === target) ? target : prev;
  _balFrom = from;
  if (from === target) {
    const n = fmtNum(target);
    document.getElementById('user-balance').textContent = n;
    document.getElementById('header-balance').textContent = n + ' ST';
    return;
  }
  const diff = target - from;
  const dur = Math.min(700, Math.max(200, Math.abs(diff) / 10));
  const t0 = performance.now();
  function step(now) {
    const p = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    const cur = Math.round(from + diff * e);
    _balFrom = cur;
    const n = fmtNum(cur);
    document.getElementById('user-balance').textContent = n;
    document.getElementById('header-balance').textContent = n + ' ST';
    if (p < 1) { _balRaf = requestAnimationFrame(step); }
    else { _balFrom = target; _balRaf = null; }
  }
  _balRaf = requestAnimationFrame(step);
}

function fmtNum(n){ return Number(n).toLocaleString(); }
function fmtNet(n){ return (n>=0?'+':'')+fmtNum(n)+' ST'; }

// ── Nav ───────────────────────────────────────────────────
function showPage(page) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.ni').forEach(n=>n.classList.remove('active'));
  document.getElementById('page-'+page).classList.add('active');
  const nav = document.querySelector(`.ni[data-page="${page}"]`);
  if(nav) nav.classList.add('active');
  const titles={slots:'Slots',blackjack:'Blackjack',roulette:'Roulette',crash:'Crash',mines:'Mines',plinko:'Plinko',coinflip:'Coinflip',hilo:'Hi-Lo',daily:'Daily Reward',leaderboard:'Leaderboard'};
  const badge=document.getElementById('topbar-badge');
  if(badge){badge.style.display=['slots','crash','mines','plinko','hilo'].includes(page)?'':'none';}
  document.getElementById('page-title').textContent = titles[page]||page;
  if(page==='leaderboard') loadLeaderboard();
  if(page==='casebattle'){cbInit();cbStartAutoRefresh();}else{cbStopAutoRefresh();}
  if(page==='crash'){
    const btn=document.getElementById('crash-btn');
    if(btn){ btn.disabled=true; btn.textContent='UNAVAILABLE'; btn.classList.add('crash-disabled-btn'); }
    document.getElementById('crash-result').innerHTML='<span class="crash-unavail-msg">🚧 Crash is temporarily disabled</span>';
  }
  if(page==='daily') loadDailyStatus();
  if(page==='roulette') setTimeout(()=>drawRouletteWheel(rouletteAngle),50);
  if(page==='plinko') setTimeout(initPlinko,60);
}

// ── Bets ──────────────────────────────────────────────────
function adjustBet(game, delta) {
  const key = game==='cf'?'cf':game;
  bets[key] = Math.max(10, Math.min(user?.balance||999999, (bets[key]||50)+delta));
  const el = document.getElementById(game+'-bet-input');
  if (el) el.value = bets[key];
  updateHiloPotential();
}
function setBetDirect(game, val) {
  const v = parseInt(val)||10;
  bets[game] = Math.max(10, Math.min(user?.balance||999999, v));
  const el = document.getElementById(game+'-bet-input');
  if(el) el.value = bets[game];
  updateHiloPotential();
}
function updateHiloPotential() {
  if (!hiloActive) { const el=document.getElementById('hilo-potential'); if(el)el.textContent=fmtNum(bets.hilo)+' ST'; }
}

async function apiPost(path, body) {
  const res = await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!res.ok){const e=await res.json();throw new Error(e.error||'Error');}
  return res.json();
}

// ── SLOTS ─────────────────────────────────────────────────
const SYMS = ['💎','7️⃣','🍒','⭐','🔔','🍋'];
const CELL_H = 110;
function buildStrip(target, n) {
  const c=[]; for(let i=0;i<n;i++)c.push(SYMS[Math.floor(Math.random()*SYMS.length)]); c[c.length-1]=target; return c;
}
function renderStrip(el, cells) {
  el.innerHTML=''; cells.forEach(s=>{const d=document.createElement('div');d.className='sc';d.textContent=s;el.appendChild(d);});
}
function initReels() {
  [0,1,2].forEach(i=>{const s=document.getElementById('reel'+i);const c=buildStrip('💎',6);renderStrip(s,c);s.style.transition='none';s.style.top=-((c.length-1)*CELL_H)+'px';});
}
// Slot tick sound — rapid mechanical clicking that decelerates
function playSlotTick(durationMs, startOffsetMs) {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioCtx();
    const startDelay = (startOffsetMs || 0) / 1000;
    const totalTicks = Math.floor(durationMs / 40); // one tick every ~40ms
    for (let i = 0; i < totalTicks; i++) {
      const progress = i / totalTicks;
      const ease = 1 - Math.pow(1 - progress, 2); // quadratic easing
      const t = ctx.currentTime + startDelay + (durationMs * ease) / 1000;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = 'square';
      // Pitch: high at start, lower as it slows. Each reel has a slightly different base pitch
      o.frequency.value = 180 + (1 - progress) * 80;
      const vol = 0.04 * (1 - progress * 0.6);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.022);
      o.start(t); o.stop(t + 0.025);
    }
    // Final "clunk" when this reel stops — pitched by reel index for 3→2→1 effect
    const stopTime = ctx.currentTime + startDelay + durationMs / 1000;
    const o2 = ctx.createOscillator();
    const g2 = ctx.createGain();
    o2.connect(g2); g2.connect(ctx.destination);
    o2.type = 'sawtooth'; o2.frequency.value = 120;
    g2.gain.setValueAtTime(0.10, stopTime);
    g2.gain.exponentialRampToValueAtTime(0.001, stopTime + 0.09);
    o2.start(stopTime); o2.stop(stopTime + 0.10);
  } catch(e) {}
}

function spinReel(el, target, total, delay, durOverride, noSound) {
  return new Promise(resolve=>{
    const cells=buildStrip(target,total); renderStrip(el,cells);
    el.style.transition='none'; el.style.top='0px'; el.getBoundingClientRect();
    setTimeout(()=>{
      const finalTop=-((cells.length-1)*CELL_H);
      const dur = durOverride !== undefined ? durOverride : (0.6+total*0.05);
      if(!noSound) playSlotTick(dur * 1000, 0);
      el.style.transition=`top ${dur}s cubic-bezier(0.1,0.85,0.25,1.0)`;
      el.style.top=finalTop+'px';
      el.addEventListener('transitionend',()=>resolve(),{once:true});
    },delay);
  });
}

async function spinSlots(instant) {
  if(!user)return;
  const btn=document.getElementById('slots-btn');
  const quickBtn=document.getElementById('slots-quick-btn');
  btn.disabled=true; if(quickBtn)quickBtn.disabled=true;
  document.getElementById('slots-result').innerHTML='';
  try {
    const data=await apiPost('/api/slots',{bet:bets.slots});
    if(instant){
      // Quick spin: very short animation (0.15s each, staggered 60ms)
      await Promise.all([
        spinReel(document.getElementById('reel0'),data.reels[0],8,0,0.18),
        spinReel(document.getElementById('reel1'),data.reels[1],8,60,0.18),
        spinReel(document.getElementById('reel2'),data.reels[2],8,120,0.18),
      ]);
    } else {
      // Normal spin: cascading stop — reel0 short, reel1 medium, reel2 long
      // Schedule all three reel sounds upfront on the same AudioContext timeline
      // so they play at the correct absolute times even with JS timer jitter
      playSlotTick(900,  0);    // reel0: 0.9s, starts immediately
      playSlotTick(1400, 120);  // reel1: 1.4s, starts after 120ms
      playSlotTick(2000, 280);  // reel2: 2.0s, starts after 280ms
      await Promise.all([
        spinReel(document.getElementById('reel0'),data.reels[0],14,0,   0.9,  true),
        spinReel(document.getElementById('reel1'),data.reels[1],20,120, 1.4,  true),
        spinReel(document.getElementById('reel2'),data.reels[2],28,280, 2.0,  true),
      ]);
    }
    updateUserUI(data.newBalance);
    const res=document.getElementById('slots-result');
    if(data.won){
      res.innerHTML=`<span class="win-txt">+${fmtNum(data.payout)} ST · ${data.multiplier}×</span>`;
      document.querySelector('.slots-machine').classList.add('game-win');
      setTimeout(()=>document.querySelector('.slots-machine').classList.remove('game-win'),700);
      sfx(data.multiplier>=25?'jackpot':'win_small');
    } else {
      res.innerHTML=`<span class="lose-txt">No match — spin again</span>`;
      sfx('lose');
    }
    btn.disabled=false; if(quickBtn)quickBtn.disabled=false;
  } catch(e){showErr('slots-result',e.message);btn.disabled=false;if(quickBtn)quickBtn.disabled=false;}
}

// ── BLACKJACK (fair — pure client-side, server just settles) ──
const SUITS=['♠','♥','♦','♣'],RANKS=['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
function cVal(r){if(['J','Q','K'].includes(r))return 10;if(r==='A')return 11;return parseInt(r);}
function score(h){let s=0,a=0;h.forEach(c=>{s+=cVal(c.rank);if(c.rank==='A')a++;});while(s>21&&a-->0)s-=10;return s;}
function mkCard(c,fd=false){
  const d=document.createElement('div');
  d.className='card'+(fd?' fd':'')+(c&&['♥','♦'].includes(c.suit)?' red':'');
  if(!fd&&c){const r=document.createElement('div');r.className='card-rk';r.textContent=c.rank;const s=document.createElement('div');s.className='card-su';s.textContent=c.suit;d.appendChild(r);d.appendChild(s);}
  return d;
}
function renderHand(id,hand,hideSecond=false){const el=document.getElementById(id);el.innerHTML='';hand.forEach((c,i)=>el.appendChild(mkCard(c,hideSecond&&i===1)));}

async function dealBlackjack(){
  if(!user)return;
  // Build fresh deck
  let deck=[];SUITS.forEach(s=>RANKS.forEach(r=>deck.push({suit:s,rank:r})));
  for(let i=deck.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]];}
  const bet=bets.bj;
  if(user.balance<bet){showErr('bj-result','Insufficient balance');return;}
  // Deduct bet
  const deducted=await apiPost('/api/blackjack/deal',{bet});
  user.balance=deducted.newBalance; updateUserUI();

  const player=[deck.pop(),deck.pop()], dealer=[deck.pop(),deck.pop()];
  bjState={player,dealer,deck,bet,over:false};
  renderHand('player-hand',player); renderHand('dealer-hand',dealer,true);
  document.getElementById('player-score').textContent=score(player);
  document.getElementById('dealer-score').textContent='?';
  document.getElementById('bj-result').textContent='';

  if(score(player)===21){await settleBJ('blackjack');return;}
  const acts=document.getElementById('bj-actions');
  acts.innerHTML='';
  const hitB=document.createElement('button');hitB.className='bj-btn hit-btn';hitB.textContent='HIT';hitB.onclick=bjHit;
  const stB=document.createElement('button');stB.className='bj-btn stand-btn';stB.textContent='STAND';stB.onclick=bjStand;
  acts.appendChild(hitB);acts.appendChild(stB);
}
function bjHit(){
  if(!bjState||bjState.over)return;
  bjState.player.push(bjState.deck.pop());
  renderHand('player-hand',bjState.player);
  const ps=score(bjState.player);
  document.getElementById('player-score').textContent=ps;
  if(ps>21)settleBJ('bust'); else if(ps===21)bjStand();
}
async function bjStand(){
  if(!bjState||bjState.over)return;
  // Reveal dealer card first
  renderHand('dealer-hand',bjState.dealer);
  document.getElementById('dealer-score').textContent=score(bjState.dealer);
  // Dealer hits until 17 — use async so we can see it animate
  async function dealerDraw(){
    while(score(bjState.dealer)<17){
      await new Promise(r=>setTimeout(r,400));
      bjState.dealer.push(bjState.deck.pop());
      renderHand('dealer-hand',bjState.dealer);
      document.getElementById('dealer-score').textContent=score(bjState.dealer);
    }
    const ds=score(bjState.dealer),ps=score(bjState.player);
    if(ds>21||ps>ds)await settleBJ('win');
    else if(ps===ds)await settleBJ('push');
    else await settleBJ('lose');
  }
  dealerDraw();
}
async function settleBJ(result){
  bjState.over=true;
  let msg='',col='var(--muted)';
  if(result==='blackjack'){msg='🃏 Blackjack! ×2.5';col='var(--gold)';}
  else if(result==='win'){msg='✓ You win!';col='var(--gold)';}
  else if(result==='push'){msg='Push — bet returned';col='var(--text)';}
  else if(result==='bust'){msg='Bust! Over 21';col='var(--red)';}
  else{msg='Dealer wins';col='var(--red)';}
  try{
    const d=await apiPost('/api/blackjack/settle',{bet:bjState.bet,result});
    updateUserUI(d.newBalance);
  }catch(e){}
  renderHand('dealer-hand',bjState.dealer);
  document.getElementById('dealer-score').textContent=score(bjState.dealer);
  const res=document.getElementById('bj-result');res.textContent=msg;res.style.color=col;
  const actsEl=document.getElementById('bj-actions');
  actsEl.innerHTML='';
  const dealB=document.createElement('button');dealB.className='bj-btn deal-btn';dealB.textContent='DEAL AGAIN';dealB.onclick=dealBlackjack;
  actsEl.appendChild(dealB);
}

// ── ROULETTE (smooth RAF) ─────────────────────────────────
const R_NUMS=[0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
const R_COLORS={};R_NUMS.forEach(n=>R_COLORS[n]='black');
[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36].forEach(n=>R_COLORS[n]='red');R_COLORS[0]='green';

function drawRouletteWheel(angle){
  const canvas=document.getElementById('roulette-canvas');if(!canvas)return;
  const ctx=canvas.getContext('2d'),cx=150,cy=150,r=140,arc=(Math.PI*2)/R_NUMS.length;
  ctx.clearRect(0,0,300,300);
  // Draw glow ring
  ctx.beginPath();ctx.arc(cx,cy,r+2,0,Math.PI*2);
  ctx.strokeStyle='rgba(201,168,76,0.3)';ctx.lineWidth=4;ctx.stroke();
  R_NUMS.forEach((num,i)=>{
    const start=angle+i*arc-Math.PI/2,end=start+arc;
    ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,r,start,end);ctx.closePath();
    ctx.fillStyle=R_COLORS[num]==='red'?'#b83030':R_COLORS[num]==='green'?'#237a45':'#141414';
    ctx.fill();ctx.strokeStyle='rgba(255,255,255,0.06)';ctx.lineWidth=0.5;ctx.stroke();
    ctx.save();ctx.translate(cx,cy);ctx.rotate(start+arc/2);ctx.translate(r*0.74,0);ctx.rotate(Math.PI/2);
    ctx.fillStyle='rgba(255,255,255,0.85)';ctx.font='bold 8.5px DM Mono,monospace';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(num,0,0);ctx.restore();
  });
  // Center hub with gradient
  const grad=ctx.createRadialGradient(cx,cy,0,cx,cy,20);
  grad.addColorStop(0,'#2a2a2a');grad.addColorStop(1,'#111');
  ctx.beginPath();ctx.arc(cx,cy,20,0,Math.PI*2);ctx.fillStyle=grad;ctx.fill();
  ctx.strokeStyle='rgba(201,168,76,0.6)';ctx.lineWidth=1.5;ctx.stroke();
  rouletteAngle=angle;
}

function setRouletteBet(type,btn){
  rouletteBet=type;
  document.querySelectorAll('.rbb').forEach(b=>b.classList.remove('selected'));
  btn.classList.add('selected');
  const L={red:'Red ×2',black:'Black ×2',green:'Green ×14',low:'1–18 ×2',high:'19–36 ×2',odd:'Odd ×2',even:'Even ×2'};
  document.getElementById('r-sel').textContent='Selected: '+L[type];
}
async function spinRoulette(){
  if(!rouletteBet){alert('Select a bet type first!');return;}
  const btn=document.getElementById('roulette-btn');btn.disabled=true;
  document.getElementById('roulette-result').textContent='';
  try{
    const data=await apiPost('/api/roulette',{bet:bets.roulette,betType:rouletteBet});
    const targetIdx=R_NUMS.indexOf(data.number);
    const arcSize=Math.PI*2/R_NUMS.length;
    // Normalise current angle to 0..2π so arithmetic is always clean
    const normCurrent = ((rouletteAngle % (Math.PI*2)) + Math.PI*2) % (Math.PI*2);
    // The angle at which this number sits at the top pointer
    const targetAngle = ((-(targetIdx * arcSize)) % (Math.PI*2) + Math.PI*2) % (Math.PI*2);
    // Always spin forward: 7 full rotations + the extra needed to land on target
    let extra = targetAngle - normCurrent;
    if(extra < 0) extra += Math.PI*2; // ensure forward direction
    const totalRot = Math.PI*2*7 + extra;
    const startAngle = normCurrent;
    const dur=5000, startTime=performance.now();
    function easeOut(t){return 1-Math.pow(1-t,5);}
    function frame(now){
      const p=Math.min((now-startTime)/dur,1),e=easeOut(p);
      drawRouletteWheel(startAngle + totalRot*e);
      if(p<1){requestAnimationFrame(frame);}
      else{
        // Lock to exact target so next spin starts clean
        rouletteAngle = targetAngle;
        drawRouletteWheel(targetAngle);
        updateUserUI(data.newBalance);
        const res=document.getElementById('roulette-result');
        const col=R_COLORS[data.number];
        const css=col==='red'?'var(--red)':col==='green'?'var(--green)':'var(--text2)';
        res.innerHTML=`<span style="color:${css}">⬤ ${data.number} ${col.toUpperCase()}</span>&nbsp;&nbsp;${data.won?`<span style="color:var(--gold)">+${fmtNum(data.payout)} ST</span>`:'<span style="color:var(--red)">−${fmtNum(bets.roulette)} ST</span>'}`;
        btn.disabled=false;
      }
    }
    requestAnimationFrame(frame);
  }catch(e){showErr('roulette-result',e.message);btn.disabled=false;}
}

// ── COINFLIP ──────────────────────────────────────────────
function setCoinChoice(c){
  coinChoice=c;
  document.getElementById('cf-heads').classList.toggle('selected',c==='heads');
  document.getElementById('cf-tails').classList.toggle('selected',c==='tails');
}
async function flipCoin(){
  if(!coinChoice){alert('Choose heads or tails!');return;}
  const btn=document.getElementById('cf-btn');btn.disabled=true;
  document.getElementById('cf-result').textContent='';
  const coin=document.getElementById('coin');

  try{
    const data=await apiPost('/api/coinflip',{bet:bets.cf,choice:coinChoice});

    // Smooth RAF-based flip — no CSS animation jank
    // Heads = lands on 0deg (front), Tails = lands on 180deg (back)
    const finalAngle = data.result==='tails' ? 180 : 0;
    // Always spin a clean number of full rotations (10) plus land on correct face
    const totalRotation = 10 * 360 + finalAngle;
    const duration = 1600; // ms
    const startTime = performance.now();
    let currentAngle = 0;

    // Easing: fast in the middle, slow at start and end (real coin feel)
    function easeInOutQuart(t) {
      return t < 0.5 ? 8*t*t*t*t : 1 - Math.pow(-2*t+2, 4)/2;
    }

    function frame(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easeInOutQuart(progress);
      currentAngle = totalRotation * eased;
      coin.style.transform = `rotateY(${currentAngle}deg)`;

      if (progress < 1) {
        requestAnimationFrame(frame);
      } else {
        // Snap to exact final angle
        coin.style.transform = `rotateY(${finalAngle}deg)`;
        // Update balance AFTER animation
        updateUserUI(data.newBalance);
        const res=document.getElementById('cf-result');
        res.textContent=data.won?`✓ ${data.result.toUpperCase()} — +${fmtNum(data.payout)} ST`:`✗ ${data.result.toUpperCase()} — Better luck!`;
        res.style.color=data.won?'var(--gold)':'var(--red)';
        btn.disabled=false;
      }
    }
    requestAnimationFrame(frame);

  }catch(e){showErr('cf-result',e.message);btn.disabled=false;}
}

// ── CRASH (smooth, Stake-style) ────────────────────────────
let crashCanvas,crashCtx,crashPoints=[],crashRaf=null,crashStartTime=null;
function initCrashCanvas(){
  crashCanvas=document.getElementById('crash-canvas');if(!crashCanvas)return;
  crashCtx=crashCanvas.getContext('2d');
  drawCrashIdle();
}
function drawCrashIdle(){
  if(!crashCtx)return;
  const {width:W,height:H}=crashCanvas;
  crashCtx.clearRect(0,0,W,H);
  // Grid
  crashCtx.strokeStyle='rgba(255,255,255,0.04)';crashCtx.lineWidth=1;
  for(let x=0;x<W;x+=W/6){crashCtx.beginPath();crashCtx.moveTo(x,0);crashCtx.lineTo(x,H);crashCtx.stroke();}
  for(let y=0;y<H;y+=H/4){crashCtx.beginPath();crashCtx.moveTo(0,y);crashCtx.lineTo(W,y);crashCtx.stroke();}
}
function drawCrashFrame(){
  if(!crashCtx||crashPoints.length<2)return;
  const {width:W,height:H}=crashCanvas;
  crashCtx.clearRect(0,0,W,H);
  // Grid
  crashCtx.strokeStyle='rgba(255,255,255,0.04)';crashCtx.lineWidth=1;
  for(let x=0;x<W;x+=W/6){crashCtx.beginPath();crashCtx.moveTo(x,0);crashCtx.lineTo(x,H);crashCtx.stroke();}
  for(let y=0;y<H;y+=H/4){crashCtx.beginPath();crashCtx.moveTo(0,y);crashCtx.lineTo(W,y);crashCtx.stroke();}
  // Curve — map mult to canvas coords
  const maxMult=Math.max(crashMult*1.1,2);
  function mx(t){return t*(W-30)+15;}
  function my(m){return H-10-(m-1)/(maxMult-1)*(H-20);}
  const n=crashPoints.length;
  // Fill under curve
  const grad=crashCtx.createLinearGradient(0,H,0,my(crashMult));
  grad.addColorStop(0,'rgba(201,168,76,0.03)');grad.addColorStop(1,'rgba(201,168,76,0.18)');
  crashCtx.beginPath();crashCtx.moveTo(mx(0),H);
  crashPoints.forEach((p,i)=>crashCtx.lineTo(mx(i/(n-1)),my(p)));
  crashCtx.lineTo(mx((n-1)/(n-1)),H);crashCtx.closePath();
  crashCtx.fillStyle=grad;crashCtx.fill();
  // Line
  crashCtx.beginPath();crashCtx.moveTo(mx(0),my(1));
  crashPoints.forEach((p,i)=>crashCtx.lineTo(mx(i/(n-1)),my(p)));
  crashCtx.strokeStyle='#c9a84c';crashCtx.lineWidth=2.5;
  crashCtx.shadowColor='rgba(201,168,76,0.5)';crashCtx.shadowBlur=8;crashCtx.stroke();
  crashCtx.shadowBlur=0;
  // Dot at end
  const ex=mx((n-1)/(n-1)),ey=my(crashMult);
  crashCtx.beginPath();crashCtx.arc(ex,ey,5,0,Math.PI*2);
  crashCtx.fillStyle='#f0d080';crashCtx.fill();
  crashCtx.beginPath();crashCtx.arc(ex,ey,9,0,Math.PI*2);
  crashCtx.strokeStyle='rgba(201,168,76,0.35)';crashCtx.lineWidth=2;crashCtx.stroke();
}
async function startCrash(){
  const btn=document.getElementById('crash-btn');
  if(btn){ btn.classList.add('crash-disabled-shake'); setTimeout(()=>btn.classList.remove('crash-disabled-shake'),500); }
}
async function cashOut(){
  if(!crashActive||crashCashedOut)return;
  crashCashedOut=true;crashActive=false;
  if(crashRaf)cancelAnimationFrame(crashRaf);
  // Send NO payout/bet — server recalculates from session state
  try{
    const d=await apiPost('/api/crash/cashout',{});
    updateUserUI(d.newBalance);
    document.getElementById('crash-status').textContent='Cashed out!';
    document.getElementById('crash-result').innerHTML=`<span style="color:var(--gold)">Cashed out ${crashMult.toFixed(2)}× — +${fmtNum(d.profit)} ST!</span>`;
  }catch(e){
    document.getElementById('crash-result').innerHTML=`<span style="color:var(--red)">${e.message}</span>`;
  }
  document.getElementById('cashout-btn').classList.add('hidden');
  const btn=document.getElementById('crash-btn');btn.classList.remove('hidden');btn.disabled=false;
}

// ── MINES ─────────────────────────────────────────────────
function adjustMines(d){mineCount=Math.max(1,Math.min(24,mineCount+d));document.getElementById('mine-count').textContent=mineCount;}
function buildMinesGrid(){
  const grid=document.getElementById('mines-grid');if(!grid)return;
  grid.innerHTML='';
  for(let i=0;i<25;i++){
    const c=document.createElement('div');c.className='mine-cell';c.dataset.i=i;c.textContent='';
    c.onclick=()=>revealMineCell(i);grid.appendChild(c);
  }
}
async function startMines(){
  if(!user)return;
  const btn=document.getElementById('mines-btn');btn.disabled=true;
  document.getElementById('mines-result').textContent='';
  try{
    const data=await apiPost('/api/mines/start',{bet:bets.mines,mineCount});
    user.balance=data.newBalance;updateUserUI();
    minesState={active:true,revealed:0,mult:1};
    buildMinesGrid();
    document.getElementById('mines-cashout').classList.remove('hidden');
    document.getElementById('mines-mult').textContent='1.00×';
    document.getElementById('mines-profit').textContent='0 ST';
    btn.textContent='New Game';btn.disabled=false;
  }catch(e){showErr('mines-result',e.message);btn.textContent='PLAY';btn.disabled=false;}
}
async function revealMineCell(idx){
  if(!minesState||!minesState.active)return;
  const cells=document.querySelectorAll('.mine-cell');
  const cell=cells[idx]; if(!cell||cell.classList.contains('revealed')||cell.classList.contains('mine-hit'))return;
  try{
    const data=await apiPost('/api/mines/reveal',{index:idx});
    if(data.isMine){
      sfx('explosion'); cell.classList.add('mine-hit');cell.textContent='💣';
      minesState.active=false;
      // Show all mines
      data.mines.forEach(mi=>{if(mi!==idx){cells[mi].classList.add('mine-shown');cells[mi].textContent='💣';}});
      document.getElementById('mines-cashout').classList.add('hidden');
      document.getElementById('mines-btn').disabled=false;
      document.getElementById('mines-btn').textContent='PLAY';
      updateUserUI();
      document.getElementById('mines-result').innerHTML=`<span style="color:var(--red)">💥 Mine hit! Lost ${fmtNum(bets.mines)} ST</span>`;
    }else{
      sfx('click'); cell.classList.add('revealed');cell.textContent='💎';
      minesState.revealed=data.revealed;minesState.mult=data.multiplier;
      document.getElementById('mines-mult').textContent=data.multiplier.toFixed(2)+'×';
      document.getElementById('mines-profit').textContent=fmtNum(Math.floor(bets.mines*data.multiplier))+' ST';
    }
  }catch(e){showErr('mines-result',e.message);}
}
async function minesCashout(){
  if(!minesState||!minesState.active)return;
  try{
    const data=await apiPost('/api/mines/cashout',{});
    updateUserUI(data.newBalance);
    minesState.active=false;
    document.getElementById('mines-cashout').classList.add('hidden');
    document.getElementById('mines-btn').disabled=false;document.getElementById('mines-btn').textContent='PLAY';
    document.getElementById('mines-result').innerHTML=`<span style="color:var(--gold)">Cashed out ${data.multiplier.toFixed(2)}× — +${fmtNum(data.payout-bets.mines)} ST!</span>`;
    // Show mine positions
    const cells=document.querySelectorAll('.mine-cell');
    data.mines.forEach(mi=>{if(!cells[mi].classList.contains('revealed')){cells[mi].classList.add('mine-shown');cells[mi].textContent='💣';}});
  }catch(e){showErr('mines-result',e.message);}
}

// ── PLINKO (smooth physics) ───────────────────────────────
const PLINKO_ROWS=10,PLINKO_MULTS=[10,3,1.5,1,0.5,0.3,0.5,1,1.5,3,10];
let plinkoCtx,plinkoW=520,plinkoH=440,plinkoPegs=[],plinkoBuckets=[];
let plinkoQueue=[],plinkoRunningBalls=0;

function initPlinko(){
  const canvas=document.getElementById('plinko-canvas');if(!canvas)return;
  plinkoCtx=canvas.getContext('2d');
  buildPlinko();drawPlinkoStatic();
}
function buildPlinko(){
  plinkoPegs=[];plinkoBuckets=[];
  const pad=40,bh=40,usableH=plinkoH-pad-bh;
  for(let row=0;row<PLINKO_ROWS;row++){
    const cols=row+3;
    const spacing=plinkoW/(cols+1);
    const xOffset=(plinkoW-(spacing*cols))/2-spacing/2;
    for(let col=0;col<cols;col++){
      plinkoPegs.push({x:spacing*(col+1),y:pad+row*(usableH/(PLINKO_ROWS-1))});
    }
  }
  const bw=plinkoW/(PLINKO_MULTS.length);
  PLINKO_MULTS.forEach((m,i)=>plinkoBuckets.push({x:i*bw,w:bw,m,y:plinkoH-bh}));
}
function drawPlinkoStatic(highlight=-1){
  if(!plinkoCtx)return;
  plinkoCtx.clearRect(0,0,plinkoW,plinkoH);
  // Pegs
  plinkoPegs.forEach(p=>{
    plinkoCtx.beginPath();plinkoCtx.arc(p.x,p.y,4,0,Math.PI*2);
    plinkoCtx.fillStyle='rgba(201,168,76,0.55)';plinkoCtx.fill();
  });
  // Buckets
  plinkoBuckets.forEach((b,i)=>{
    const hi=b.m>=5,mid=b.m>=1;
    let col=hi?'rgba(201,168,76,0.75)':mid?'rgba(61,186,110,0.5)':'rgba(221,227,236,0.15)';
    if(i===highlight)col='rgba(201,168,76,0.95)';
    plinkoCtx.fillStyle=col;
    plinkoCtx.beginPath();plinkoCtx.roundRect(b.x+1,b.y,b.w-2,34,4);plinkoCtx.fill();
    plinkoCtx.fillStyle=i===highlight?'#000':'rgba(255,255,255,0.85)';
    plinkoCtx.font=`bold 10px DM Mono,monospace`;plinkoCtx.textAlign='center';plinkoCtx.textBaseline='middle';
    plinkoCtx.fillText(b.m+'×',b.x+b.w/2,b.y+17);
  });
}

function computePath(finalBucket){
  const path=[{x:plinkoW/2,y:8}];
  const pad=40,bh=40,usableH=plinkoH-pad-bh;
  const bucketCX=plinkoBuckets[finalBucket].x+plinkoBuckets[finalBucket].w/2;
  let x=plinkoW/2;
  for(let row=0;row<PLINKO_ROWS;row++){
    const rowPegs=plinkoPegs.filter(p=>Math.abs(p.y-(pad+row*(usableH/(PLINKO_ROWS-1))))<2);
    if(!rowPegs.length)continue;
    const nearest=rowPegs.reduce((a,b)=>Math.abs(b.x-x)<Math.abs(a.x-x)?b:a);
    // Arc to peg smoothly
    const steps=12;for(let s=1;s<=steps;s++)path.push({x:x+(nearest.x-x)*(s/steps),y:path[path.length-1].y+(nearest.y-path[path.length-1].y)*(s/steps)});
    // Bounce direction weighted toward final bucket
    const bias=bucketCX>x?0.6:0.4;
    x=nearest.x+(Math.random()<bias?16:-16);
  }
  // Fall to bucket
  const by=plinkoBuckets[finalBucket].y+17;
  const steps=14;const lastX=path[path.length-1].x,lastY=path[path.length-1].y;
  for(let s=1;s<=steps;s++)path.push({x:lastX+(bucketCX-lastX)*(s/steps),y:lastY+(by-lastY)*(s/steps)});
  return path;
}

function animateBall(path,bucketIdx,onDone){
  let step=0;
  function frame(){
    // Redraw static layer then all current balls
    drawPlinkoStatic();
    // Draw current ball
    if(step<path.length){
      const pt=path[step];
      plinkoCtx.beginPath();plinkoCtx.arc(pt.x,pt.y,7,0,Math.PI*2);
      plinkoCtx.fillStyle='#f0d080';plinkoCtx.fill();
      plinkoCtx.strokeStyle='rgba(201,168,76,0.4)';plinkoCtx.lineWidth=2;plinkoCtx.stroke();
      // Trail
      for(let t=1;t<=4&&step-t>=0;t++){
        const pp=path[step-t];
        plinkoCtx.beginPath();plinkoCtx.arc(pp.x,pp.y,7*(1-t/5),0,Math.PI*2);
        plinkoCtx.fillStyle=`rgba(201,168,76,${0.15*(1-t/5)})`;plinkoCtx.fill();
      }
      step++;requestAnimationFrame(frame);
    }else{drawPlinkoStatic(bucketIdx);onDone();}
  }
  requestAnimationFrame(frame);
}

async function dropPlinko(){
  // Allow spamming: queue up
  const btn=document.getElementById('plinko-btn');
  btn.disabled=true;
  try{
    const data=await apiPost('/api/plinko',{bet:bets.plinko});
    // Immediately update balance so spam works
    user.balance=data.newBalance;updateUserUI();
    const path=computePath(data.bucketIndex);
    plinkoRunningBalls++;
    animateBall(path,data.bucketIndex,()=>{
      plinkoRunningBalls--;
      const res=document.getElementById('plinko-result');
      const msg=data.won?`<span class="win-txt">${data.multiplier}× — +${fmtNum(data.payout-bets.plinko)} ST</span>`:`<span class="lose-txt">${data.multiplier}× — Lost ${fmtNum(bets.plinko)} ST</span>`;
      res.innerHTML=msg;
    });
    btn.disabled=false;
  }catch(e){showErr('plinko-result',e.message);btn.disabled=false;}
}

// ── HI-LO (server-side) ───────────────────────────────────
const HL_RANKS_CLIENT=['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
function hlValClient(r){return HL_RANKS_CLIENT.indexOf(r)+2;}
function updateHiloHint(rank){
  const hint=document.getElementById('hilo-hint');
  if(!hint||!rank||rank==='?')return;
  const v=hlValClient(rank);
  const higher=14-v, lower=v-2;
  const hMult=higher>0?((13/higher)*0.97).toFixed(2):'—';
  const lMult=lower>0?((13/lower)*0.97).toFixed(2):'—';
  hint.textContent=`Higher: ${hMult}×  ·  Lower: ${lMult}×`;
}
function setHiloCard(rank,suit){
  const card=document.getElementById('hilo-card');
  const rankEl=document.getElementById('hilo-rank');
  const suitEl=document.getElementById('hilo-suit');
  const isRed=['♥','♦'].includes(suit);
  card.className='hilo-card'+(isRed?' red':' black');
  rankEl.textContent=rank||'?';
  suitEl.textContent=suit||'';
}
function flipHiloCard(rank,suit,cb){
  const card=document.getElementById('hilo-card');
  card.classList.add('flip');
  setTimeout(()=>{setHiloCard(rank,suit);card.classList.remove('flip');if(cb)cb();},180);
}
async function startHilo(){
  if(!user)return;
  const btn=document.getElementById('hilo-start-btn');btn.disabled=true;
  try{
    const data=await apiPost('/api/hilo/start',{bet:bets.hilo});
    user.balance=data.newBalance;updateUserUI();
    hiloActive=true;hiloBet=bets.hilo;hiloMult=1;
    flipHiloCard(data.card.rank,data.card.suit);
    updateHiloHint(data.card.rank);
    document.getElementById('hilo-streak').textContent='0';
    document.getElementById('hilo-mult').textContent='1.00×';
    document.getElementById('hilo-potential').textContent=fmtNum(hiloBet)+' ST';
    document.getElementById('hilo-result').textContent='';
    document.getElementById('hilo-higher').disabled=false;
    document.getElementById('hilo-lower').disabled=false;
    document.getElementById('hilo-cashout').style.display='inline-flex';
    btn.textContent='New Game';btn.onclick=()=>resetHilo();
    btn.disabled=false;
  }catch(e){showErr('hilo-result',e.message);btn.disabled=false;}
}
function resetHilo(){
  hiloActive=false;
  document.getElementById('hilo-higher').disabled=true;
  document.getElementById('hilo-lower').disabled=true;
  document.getElementById('hilo-cashout').style.display='none';
  document.getElementById('hilo-start-btn').textContent='DEAL CARD';
  document.getElementById('hilo-start-btn').onclick=startHilo;
  setHiloCard('?','');
  document.getElementById('hilo-streak').textContent='0';
  document.getElementById('hilo-mult').textContent='1.00×';
  document.getElementById('hilo-potential').textContent=fmtNum(bets.hilo)+' ST';
  document.getElementById('hilo-result').textContent='';
  startHilo();
}
async function hiloGuess(dir){
  if(!hiloActive)return;
  document.getElementById('hilo-higher').disabled=true;
  document.getElementById('hilo-lower').disabled=true;
  try{
    const data=await apiPost('/api/hilo/guess',{direction:dir});
    flipHiloCard(data.newCard.rank,data.newCard.suit,()=>{
      const res=document.getElementById('hilo-result');
      if(data.tie){
        res.innerHTML=`<span style="color:var(--text2)">↔ Same rank — no change</span>`;
        updateHiloHint(data.newCard.rank);
        document.getElementById('hilo-higher').disabled=false;
        document.getElementById('hilo-lower').disabled=false;
        sfx('click');
      } else if(data.win){
        hiloMult=data.mult;
        document.getElementById('hilo-streak').textContent=data.streak;
        document.getElementById('hilo-mult').textContent=hiloMult.toFixed(2)+'×';
        document.getElementById('hilo-potential').textContent=fmtNum(Math.floor(hiloBet*hiloMult))+' ST';
        res.innerHTML=`<span style="color:var(--green)">✓ Correct! Keep going or cash out</span>`;
        updateHiloHint(data.newCard.rank);
        document.getElementById('hilo-higher').disabled=false;
        document.getElementById('hilo-lower').disabled=false;
        sfx('win_small');
      }else{
        hiloActive=false;
        res.innerHTML=`<span style="color:var(--red)">✗ Wrong! Lost ${fmtNum(hiloBet)} ST</span>`;
        document.getElementById('hilo-cashout').style.display='none';
        document.getElementById('hilo-start-btn').textContent='DEAL CARD';
        document.getElementById('hilo-start-btn').onclick=startHilo;
        sfx('lose');
      }
    });
  }catch(e){showErr('hilo-result',e.message);document.getElementById('hilo-higher').disabled=false;document.getElementById('hilo-lower').disabled=false;}
}
async function hiloCashout(){
  if(!hiloActive)return;
  try{
    const data=await apiPost('/api/hilo/cashout',{});
    updateUserUI(data.newBalance);hiloActive=false;
    document.getElementById('hilo-result').innerHTML=`<span style="color:var(--gold)">Cashed out ${data.multiplier.toFixed(2)}× — +${fmtNum(data.payout-hiloBet)} ST!</span>`;
    document.getElementById('hilo-cashout').style.display='none';
    document.getElementById('hilo-higher').disabled=true;document.getElementById('hilo-lower').disabled=true;
    document.getElementById('hilo-start-btn').textContent='DEAL CARD';document.getElementById('hilo-start-btn').onclick=startHilo;
  }catch(e){showErr('hilo-result',e.message);}
}

// ── DAILY ─────────────────────────────────────────────────
async function loadDailyStatus(){
  try{
    const d=await fetch('/api/daily/status').then(r=>r.json());
    document.getElementById('streak-count').textContent=d.streak+' days';
    document.getElementById('reward-amount').textContent='+'+fmtNum(d.reward)+' ST';
    const btn=document.getElementById('daily-btn');
    if(!d.canClaim){
      const ms=d.nextClaimAt-Date.now(),h=Math.floor(ms/3600000),m=Math.floor((ms%3600000)/60000);
      btn.disabled=true;btn.textContent=`Come back in ${h}h ${m}m`;
      document.getElementById('daily-result').innerHTML=`<span style="color:var(--muted)">Already claimed today</span>`;
    }else{btn.disabled=false;btn.textContent='CLAIM REWARD';}
  }catch(e){}
}
async function claimDaily(){
  try{
    const d=await apiPost('/api/daily/claim',{});
    updateUserUI(d.newBalance);
    document.getElementById('streak-count').textContent=d.streak+' days';
    let msg=`<span style="color:var(--gold)">+${fmtNum(d.reward)} ST claimed! 🎉`;
    if(d.milestoneBonus>0)msg+=` (includes ${fmtNum(d.milestoneBonus)} ST milestone bonus!)`;
    msg+='</span>';
    document.getElementById('daily-result').innerHTML=msg;
    const btn=document.getElementById('daily-btn');btn.disabled=true;btn.textContent='Come back tomorrow';
  }catch(e){showErr('daily-result',e.message);}
}

// ── LEADERBOARD ────────────────────────────────────────────
async function loadLeaderboard(){
  const list=document.getElementById('leaderboard-list');list.innerHTML='<div class="lb-load">Loading...</div>';
  try{
    const data=await fetch('/api/leaderboard').then(r=>r.json());
    list.innerHTML='';
    const medals=['🥇','🥈','🥉'];
    data.forEach((u,i)=>{
      const row=document.createElement('div');row.className='lb-row'+(i<3?' top'+(i+1):'')+(u.discord_id===user?.discord_id?' me':'');
      const av=u.avatar?`https://cdn.discordapp.com/avatars/${u.discord_id}/${u.avatar}.png?size=32`:'https://cdn.discordapp.com/embed/avatars/0.png';
      row.innerHTML=`<div class="lb-rank">${i<3?medals[i]:i+1}</div><img class="lb-av" src="${av}" alt=""><div class="lb-un">${u.username}</div><div class="lb-bl">${fmtNum(u.balance)} ST</div>`;
      list.appendChild(row);
    });
  }catch(e){list.innerHTML='<div class="lb-load">Failed to load</div>';}
}

// ── PROFILE MODAL ──────────────────────────────────────────
function openProfile(){
  const modal=document.getElementById('profile-modal');modal.classList.remove('hidden');
  loadProfileModal();
}
function closeProfileModal(){document.getElementById('profile-modal').classList.add('hidden');}
function closeProfile(e){if(e.target===document.getElementById('profile-modal'))closeProfileModal();}

async function loadProfileModal(){
  if(!user)return;
  const av=user.avatar?`https://cdn.discordapp.com/avatars/${user.discord_id}/${user.avatar}.png?size=128`:'https://cdn.discordapp.com/embed/avatars/0.png';
  document.getElementById('pm-avatar').src=av;
  document.getElementById('pm-name').textContent=user.username;
  document.getElementById('pm-balance').textContent=fmtNum(user.balance)+' ST';
  document.getElementById('pm-streak').textContent='🔥 '+(user.streak||0)+' day streak';
  document.getElementById('pm-wagered').textContent=fmtNum(user.total_wagered||0)+' ST';
  document.getElementById('pm-won').textContent=fmtNum(user.total_won||0)+' ST';
  document.getElementById('pm-games').textContent=fmtNum(user.games_played||0);
  document.getElementById('pm-best').textContent=fmtNum(user.biggest_win||0)+' ST';
  try{
    const stats=await fetch('/api/stats').then(r=>r.json());
    const sg=document.getElementById('pm-game-stats');sg.innerHTML='';
    stats.forEach(s=>{
      const d=document.createElement('div');d.className='pm-gs';
      const net=s.net||0;
      d.innerHTML=`<div class="pm-gs-name">${s.type}</div><div class="pm-gs-plays">${s.plays} plays</div><div class="pm-gs-detail">${s.wins} wins</div><div class="pm-gs-net ${net>=0?'pos':'neg'}">${fmtNet(net)}</div>`;
      sg.appendChild(d);
    });
    if(!stats.length)sg.innerHTML='<div style="color:var(--muted);font-size:12px;padding:10px">No games yet</div>';
  }catch(e){}
  try{
    const hist=await fetch('/api/history').then(r=>r.json());
    const hl=document.getElementById('pm-history');hl.innerHTML='';
    if(!hist.length){hl.innerHTML='<div class="pm-h-row"><span style="color:var(--muted)">No activity yet</span></div>';return;}
    hist.slice(0,20).forEach(h=>{
      const row=document.createElement('div');row.className='pm-h-row';
      row.innerHTML=`<div class="pm-h-game">${h.type}</div><div class="pm-h-amt ${h.amount>=0?'pos':'neg'}">${fmtNet(h.amount)}</div><div class="pm-h-time">${timeAgo(h.created_at)}</div>`;
      hl.appendChild(row);
    });
  }catch(e){}
}
function timeAgo(ts){const d=Date.now()-ts;if(d<60000)return 'just now';if(d<3600000)return Math.floor(d/60000)+'m ago';if(d<86400000)return Math.floor(d/3600000)+'h ago';return Math.floor(d/86400000)+'d ago';}

// ── CHAT ──────────────────────────────────────────────────
function initChat(){
  if(eventSource)eventSource.close();
  eventSource=new EventSource('/api/chat/stream');
  eventSource.addEventListener('history',(e)=>{
    const msgs=JSON.parse(e.data);
    const box=document.getElementById('chat-messages');box.innerHTML='';
    msgs.forEach(addChatMsg);scrollChat();
  });
  eventSource.addEventListener('chat',(e)=>{addChatMsg(JSON.parse(e.data));scrollChat();});
  eventSource.addEventListener('bigwin',(e)=>{
    const d=JSON.parse(e.data);
    const box=document.getElementById('chat-messages');
    const div=document.createElement('div');div.className='bigwin-banner';
    div.textContent=`🎉 ${d.username} won ${d.profit.toLocaleString()} ST on ${d.game}${d.mult?` (${d.mult}×)`:''} !`;
    box.appendChild(div);scrollChat();
  });
}
function addChatMsg(msg){
  const box=document.getElementById('chat-messages');if(!box)return;
  const div=document.createElement('div');div.className='chat-msg';
  const isSystem=msg.discord_id==='system';
  const av=isSystem?'':msg.avatar?`https://cdn.discordapp.com/avatars/${msg.discord_id}/${msg.avatar}.png?size=32`:'https://cdn.discordapp.com/embed/avatars/0.png';
  div.innerHTML=`${!isSystem?`<img class="chat-msg-av" src="${av}" alt=""/>`:'<div style="width:22px"></div>'}<div class="chat-msg-body"><div class="chat-msg-name ${isSystem?'system':''}">${msg.username}</div><div class="chat-msg-text">${escHtml(msg.message).replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>')}</div></div>`;
  box.appendChild(div);
  if(box.children.length>80)box.removeChild(box.firstChild);
}
function scrollChat(){const b=document.getElementById('chat-messages');if(b)b.scrollTop=b.scrollHeight;}
function escHtml(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function chatKeydown(e){if(e.key==='Enter')sendChat();}
async function sendChat(){
  const inp=document.getElementById('chat-input');
  const msg=inp.value.trim();if(!msg)return;
  inp.value='';
  try{await apiPost('/api/chat/send',{message:msg});}catch(e){inp.value=msg;alert(e.message);}
}

// ── Helpers ───────────────────────────────────────────────
function showErr(id,msg){const el=document.getElementById(id);if(el)el.innerHTML=`<span style="color:var(--red)">${msg}</span>`;}

// ── SOUND ENGINE ────────────────────────────────────────────
const AudioContext = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;
let soundEnabled = true;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

function sfx(type) {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioCtx();
    const g = ctx.createGain();
    g.connect(ctx.destination);
    const o = ctx.createOscillator();
    o.connect(g);
    const now = ctx.currentTime;

    const sounds = {
      click:     () => { o.type='sine'; o.frequency.setValueAtTime(600,now); g.gain.setValueAtTime(0.08,now); g.gain.exponentialRampToValueAtTime(0.001,now+0.08); o.start(now); o.stop(now+0.08); },
      win_small: () => { o.type='triangle'; o.frequency.setValueAtTime(440,now); o.frequency.exponentialRampToValueAtTime(880,now+0.2); g.gain.setValueAtTime(0.12,now); g.gain.exponentialRampToValueAtTime(0.001,now+0.3); o.start(now); o.stop(now+0.3); },
      jackpot:   () => {
        [523,659,784,1047].forEach((f,i) => {
          const o2=ctx.createOscillator(); const g2=ctx.createGain();
          o2.connect(g2); g2.connect(ctx.destination);
          o2.type='triangle'; o2.frequency.value=f;
          g2.gain.setValueAtTime(0.15,now+i*0.1); g2.gain.exponentialRampToValueAtTime(0.001,now+i*0.1+0.25);
          o2.start(now+i*0.1); o2.stop(now+i*0.1+0.3);
        });
        o.disconnect();
      },
      lose:      () => { o.type='sawtooth'; o.frequency.setValueAtTime(300,now); o.frequency.exponentialRampToValueAtTime(80,now+0.3); g.gain.setValueAtTime(0.08,now); g.gain.exponentialRampToValueAtTime(0.001,now+0.35); o.start(now); o.stop(now+0.35); },
      explosion: () => {
        const buf=ctx.createBuffer(1,ctx.sampleRate*0.4,ctx.sampleRate);
        const d=buf.getChannelData(0);
        for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/d.length,2);
        const src=ctx.createBufferSource(); src.buffer=buf;
        const f=ctx.createBiquadFilter(); f.type='lowpass'; f.frequency.value=400;
        src.connect(f); f.connect(g); g.gain.setValueAtTime(0.4,now); g.gain.exponentialRampToValueAtTime(0.001,now+0.5);
        src.start(now); o.disconnect();
      },
      coin_spin: () => { o.type='sine'; o.frequency.setValueAtTime(800,now); o.frequency.exponentialRampToValueAtTime(1200,now+0.05); g.gain.setValueAtTime(0.06,now); g.gain.exponentialRampToValueAtTime(0.001,now+0.1); o.start(now); o.stop(now+0.1); },
      cashout:   () => { o.type='sine'; o.frequency.setValueAtTime(523,now); o.frequency.exponentialRampToValueAtTime(1047,now+0.15); g.gain.setValueAtTime(0.15,now); g.gain.exponentialRampToValueAtTime(0.001,now+0.25); o.start(now); o.stop(now+0.3); },
      crash_boom:() => {
        const buf=ctx.createBuffer(1,ctx.sampleRate*0.6,ctx.sampleRate);
        const d=buf.getChannelData(0);
        for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/d.length,1.5)*0.5;
        const src=ctx.createBufferSource(); src.buffer=buf;
        const f=ctx.createBiquadFilter(); f.type='lowpass'; f.frequency.value=200;
        src.connect(f); f.connect(g); g.gain.setValueAtTime(0.5,now); g.gain.exponentialRampToValueAtTime(0.001,now+0.7);
        src.start(now); o.disconnect();
      },
      case_spin: () => {
        [200,300,400].forEach((f,i) => {
          const o2=ctx.createOscillator(); const g2=ctx.createGain();
          o2.connect(g2); g2.connect(ctx.destination);
          o2.type='square'; o2.frequency.value=f;
          g2.gain.setValueAtTime(0.04,now+i*0.04); g2.gain.exponentialRampToValueAtTime(0.001,now+i*0.04+0.06);
          o2.start(now+i*0.04); o2.stop(now+i*0.04+0.08);
        });
        o.disconnect();
      },
    };
    sounds[type]?.();
  } catch(e) { /* audio ctx not ready */ }
}

// ── CASE BATTLE ──────────────────────────────────────────────
let cbSelectedCase = null;
let cbSelectedMode = '1v1';
let cbSelectedNumCases = 1;
let cbCurrentBattleId = null;
let cbBattleStream = null;
let cbIsCreator = false;

let cbAutoRefreshTimer = null;
async function cbInit() {
  try {
    const [casesRes, battlesRes] = await Promise.all([
      fetch('/api/cases').then(r=>r.json()),
      fetch('/api/battles').then(r=>r.json())
    ]);
    cbRenderCases(casesRes);
    cbRenderOpenBattles(battlesRes);
  } catch(e) {}
}
function cbStartAutoRefresh() {
  cbStopAutoRefresh();
  cbAutoRefreshTimer = setInterval(async ()=>{
    try {
      const battlesRes = await fetch('/api/battles').then(r=>r.json());
      cbRenderOpenBattles(battlesRes);
    } catch(e) {}
  }, 3000);
}
function cbStopAutoRefresh() {
  if(cbAutoRefreshTimer){ clearInterval(cbAutoRefreshTimer); cbAutoRefreshTimer=null; }
}

function cbRenderCases(cases) {
  window._cbCasesData = cases; // cache for animation
  const grid = document.getElementById('cb-cases-grid');
  if (!grid) return;
  grid.innerHTML = '';
  cases.forEach(c => {
    const div = document.createElement('div');
    div.className = 'cb-case-card';
    div.dataset.id = c.id;
    div.style.borderColor = cbSelectedCase===c.id ? c.color : '';
    div.innerHTML = `<div class="cb-case-emoji">${c.emoji}</div><div class="cb-case-name">${c.name}</div><div class="cb-case-price">${fmtNum(c.price)} ST</div>`;
    div.onclick = () => { cbSelectedCase=c.id; cbUpdateCost(c.price,c.color); document.querySelectorAll('.cb-case-card').forEach(x=>{x.classList.remove('selected');x.style.borderColor='';}); div.classList.add('selected'); div.style.borderColor=c.color; };
    grid.appendChild(div);
  });
}

function cbUpdateCost(price, color) {
  const el = document.getElementById('cb-create-cost');
  const total = price * cbSelectedNumCases;
  if (el) el.textContent = `Cost: ${fmtNum(total)} ST per player${cbSelectedNumCases > 1 ? ` (${cbSelectedNumCases}× ${fmtNum(price)} ST)` : ''}`;
}

function cbGetCaseEmoji(caseId) {
  if (!window._cbCasesData) return '📦';
  const c = window._cbCasesData.find(x=>x.id===caseId);
  return c ? c.emoji : '📦';
}

function cbRenderOpenBattles(battles) {
  const list = document.getElementById('cb-open-list');
  if (!list) return;
  if (!battles.length) { list.innerHTML = '<div class="cb-empty">No open battles — create one or add bots!</div>'; return; }
  list.innerHTML = '';
  battles.forEach(b => {
    const slots = b.slots;
    const filled = b.players.length;
    const row = document.createElement('div');
    row.className = 'cb-battle-row';
    const playerDots = Array.from({length:slots}, (_,i) => {
      const p = b.players[i];
      if (p) {
        const av = p.avatar ? `https://cdn.discordapp.com/avatars/${p.discord_id||'0'}/${p.avatar}.png?size=32` : '';
        return `<div class="cb-player-dot">${av?`<img src="${av}" alt=""/>`:'👤'}</div>`;
      }
      return `<div class="cb-player-dot empty">?</div>`;
    }).join('');
    row.innerHTML = `
      <div class="cb-battle-case">${cbGetCaseEmoji(b.caseId)}</div>
      <div class="cb-battle-info"><div class="cb-battle-name">${b.caseName} · ${b.mode}${b.numCases>1?' · '+b.numCases+' cases':''}</div><div class="cb-battle-meta">${filled}/${slots} players · ${fmtNum((b.casePrice||0)*(b.numCases||1))} ST ea</div></div>
      <div class="cb-battle-players">${playerDots}</div>
      <button class="cb-join-btn" onclick="cbJoinBattle('${b.id}')">Join</button>`;
    list.appendChild(row);
  });
}

function cbShowCreate() {
  document.getElementById('cb-create-panel').classList.remove('hidden');
  cbInit();
}
function cbHideCreate() {
  document.getElementById('cb-create-panel').classList.add('hidden');
}
function cbSetMode(mode, btn) {
  cbSelectedMode = mode;
  document.querySelectorAll('.cb-mode-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
}
function cbSetNumCases(n, btn) {
  cbSelectedNumCases = n;
  document.querySelectorAll('.cb-num-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  // Refresh cost display
  if (cbSelectedCase && window._cbCasesData) {
    const c = window._cbCasesData.find(x=>x.id===cbSelectedCase);
    if (c) cbUpdateCost(c.price, c.color);
  }
}

async function cbCreateBattle() {
  if (!cbSelectedCase) { alert('Select a case first!'); return; }
  try {
    const data = await apiPost('/api/battles/create', {caseId:cbSelectedCase, mode:cbSelectedMode, numCases:cbSelectedNumCases});
    cbIsCreator = true;
    cbEnterRoom(data.id);
  } catch(e) { alert(e.message); }
}

async function cbJoinBattle(battleId) {
  try {
    await apiPost('/api/battles/join', {battleId});
    cbIsCreator = false;
    cbEnterRoom(battleId);
  } catch(e) { alert(e.message); }
}

function cbEnterRoom(battleId) {
  cbCurrentBattleId = battleId;
  document.getElementById('cb-lobby').classList.add('hidden');
  document.getElementById('cb-room').classList.remove('hidden');
  document.getElementById('cb-room-id').textContent = battleId;
  document.getElementById('cb-result-banner').classList.add('hidden');
  document.getElementById('cb-room-actions').style.display = '';
  // Store config for rematch — will be confirmed when state arrives
  _lastBattleConfig = null;
  // Connect SSE
  if (cbBattleStream) cbBattleStream.close();
  cbBattleStream = new EventSource(`/api/battles/stream/${battleId}`);
  cbBattleStream.addEventListener('state', e => {
    const b=JSON.parse(e.data);
    cbRenderRoom(b);
    // Capture config for rematch
    if (!_lastBattleConfig) _lastBattleConfig = {caseId:b.caseId, mode:b.mode, numCases:b.numCases||1};
  });
  cbBattleStream.addEventListener('player_joined', e => { const d=JSON.parse(e.data); cbOnPlayerJoined(d); });
  cbBattleStream.addEventListener('start', e => { cbOnBattleStart(JSON.parse(e.data)); });
  cbBattleStream.addEventListener('round_start', e => { cbOnRoundStart(JSON.parse(e.data)); });
  cbBattleStream.addEventListener('spin', e => { cbOnSpin(JSON.parse(e.data)); });
  cbBattleStream.addEventListener('done', e => { cbOnDone(JSON.parse(e.data)); });
  cbBattleStream.addEventListener('cancelled', e => {
    const d = JSON.parse(e.data);
    // Show message then bounce back to lobby
    const banner = document.getElementById('cb-result-banner');
    if(banner){ banner.classList.remove('hidden'); banner.innerHTML=`<div class="cb-win-title">⏱️ Battle expired</div><div class="cb-win-sub">${d.reason||'Battle cancelled — entry refunded'}</div>`; }
    setTimeout(()=>cbLeaveRoom(), 3000);
  });
}

function cbMakePlayerCard(p, i, status) {
  const card = document.createElement('div');
  card.id = `cb-pcard-${i}`;
  card.className = 'cb-player-card waiting';
  if (p) {
    const av = p.avatar ? `https://cdn.discordapp.com/avatars/${p.discord_id||'0'}/${p.avatar}.png?size=64` : 'https://cdn.discordapp.com/embed/avatars/0.png';
    card.innerHTML = `<img class="cb-player-av" src="${av}" alt=""/><div class="cb-player-name">${p.username}</div><div class="cb-player-status">${status==='waiting'?'Waiting...':'Ready'}</div>`;
  } else {
    card.innerHTML = `<div class="cb-player-av cb-av-empty">?</div><div class="cb-player-name" style="color:var(--text3)">Waiting...</div><div class="cb-player-status"></div>`;
  }
  return card;
}

function cbRenderRoom(battle) {
  const numC = battle.numCases||1;
  const reverseLabel = battle.mode==='reverse' ? ' · 🔻 Lowest Wins' : '';
  document.getElementById('cb-room-title').textContent = `${battle.caseId?.charAt(0).toUpperCase()+battle.caseId?.slice(1)} Battle · ${battle.mode}${numC>1?' · '+numC+' cases':''}${reverseLabel}`;
  const row = document.getElementById('cb-players-row');
  row.innerHTML = '';

  const isTeamMode = battle.mode === '2v2' || battle.mode === '3v3';
  const teamSize = battle.mode === '3v3' ? 3 : 2;

  if (isTeamMode) {
    // Team layout: team1 block | VS | team2 block
    row.classList.add('cb-team-layout');

    const team1 = document.createElement('div');
    team1.className = 'cb-team cb-team-1';
    const team2 = document.createElement('div');
    team2.className = 'cb-team cb-team-2';

    for (let i = 0; i < battle.slots; i++) {
      const p = battle.players[i];
      const card = cbMakePlayerCard(p, i, battle.status);
      (i < teamSize ? team1 : team2).appendChild(card);
    }

    const vs = document.createElement('div');
    vs.className = 'cb-vs-divider';
    vs.textContent = 'VS';

    row.appendChild(team1);
    row.appendChild(vs);
    row.appendChild(team2);
  } else {
    row.classList.remove('cb-team-layout');
    for (let i = 0; i < battle.slots; i++) {
      row.appendChild(cbMakePlayerCard(battle.players[i], i, battle.status));
    }
  }

  const canAddBot = battle.status==='waiting' && battle.players.length < battle.slots;
  document.getElementById('cb-room-actions').style.display = canAddBot ? '' : 'none';
}

function cbOnPlayerJoined(data) {
  // Will be handled by the next 'state' SSE event automatically
  // No manual fetch needed since SSE stream is already connected
}

function cbOnBattleStart(data) {
  sfx('case_spin');
  document.getElementById('cb-room-actions').style.display = 'none';
  data.players.forEach((_,i) => {
    const card = document.getElementById(`cb-pcard-${i}`);
    if (card) { card.classList.remove('waiting'); card.classList.add('spinning'); const st=card.querySelector('.cb-player-status'); if(st)st.textContent='Ready...'; }
  });
}

function cbOnRoundStart(data) {
  // Update round indicator in title
  const titleEl = document.getElementById('cb-room-title');
  if(titleEl && data.numCases > 1){
    const base = titleEl.textContent.replace(/ · Round \d+\/\d+/,'');
    titleEl.textContent = base + ` · Round ${data.round+1}/${data.numCases}`;
  }
  if(data.round === 0){
    // First round — just set cards to spinning immediately
    document.querySelectorAll('.cb-player-card').forEach(card=>{
      card.classList.remove('waiting','done'); card.classList.add('spinning');
      const st=card.querySelector('.cb-player-status'); if(st)st.textContent='Opening...';
    });
  } else {
    // Subsequent rounds — the server already paused 3s so players saw last results.
    // Now move each card's drop into its "history" section, then reset for new spin.
    document.querySelectorAll('.cb-player-card').forEach(card=>{
      // Migrate current drop into history list
      const existingDrop = card.querySelector('.cb-player-drop');
      let histBox = card.querySelector('.cb-round-history');
      if(!histBox){
        histBox = document.createElement('div');
        histBox.className = 'cb-round-history';
        card.appendChild(histBox);
      }
      if(existingDrop){
        existingDrop.classList.remove('cb-drop-reveal');
        existingDrop.classList.add('cb-history-item');
        histBox.appendChild(existingDrop);
      }
      // Remove any lingering reels and jackpot glow from previous round
      card.querySelectorAll('.cb-reel-wrap').forEach(el=>el.remove());
      card.classList.remove('done','cb-jackpot-winner','cb-jackpot-incoming','winner');
      card.classList.add('spinning');
      const st=card.querySelector('.cb-player-status'); if(st)st.textContent='Opening...';
    });
    sfx('case_spin');
  }
}

function launchConfetti(originEl) {
  const colors = ['#e8b84b','#ffd97a','#34d17a','#4f9cf9','#f05252','#8b6cf7','#ff4ecd','#fff'];
  const rect = originEl ? originEl.getBoundingClientRect() : {left:window.innerWidth/2, top:window.innerHeight/2, width:0, height:0};
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const count = 80;
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = 'confetti-particle';
    const color = colors[Math.floor(Math.random() * colors.length)];
    const size = 6 + Math.random() * 8;
    const angle = Math.random() * Math.PI * 2;
    const speed = 180 + Math.random() * 260;
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed - 180; // upward bias
    const rot = Math.random() * 720 - 360;
    const isRect = Math.random() > 0.5;
    el.style.cssText = `
      position:fixed; z-index:9998; pointer-events:none;
      left:${cx}px; top:${cy}px;
      width:${isRect ? size*1.6 : size}px;
      height:${size}px;
      background:${color};
      border-radius:${isRect ? '2px' : '50%'};
      opacity:1;
    `;
    document.body.appendChild(el);
    const dur = 900 + Math.random() * 600;
    const start = performance.now();
    function animate(now) {
      const t = (now - start) / dur;
      if (t >= 1) { el.remove(); return; }
      const ease = 1 - t * t;
      const gravity = 300 * t * t;
      el.style.transform = `translate(${vx*t}px, ${vy*t + gravity}px) rotate(${rot*t}deg)`;
      el.style.opacity = Math.max(0, 1 - t * 1.4);
      requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);
  }
}

function cbOnSpin(data) {
  sfx('case_spin');
  const card = document.getElementById(`cb-pcard-${data.playerIdx}`);
  if (!card) return;
  card.classList.remove('spinning');
  const st = card.querySelector('.cb-player-status'); if(st)st.textContent='';

  const caseInfo = window._cbCasesData ? window._cbCasesData.find(c=>c.id===data.result.caseId) : null;

  // Detect jackpot tier — top 2 items by value get slow mo treatment
  let isJackpot = false;
  if (caseInfo && caseInfo.items) {
    const sorted = [...caseInfo.items].sort((a,b)=>b.value-a.value);
    const jackpotThreshold = sorted[1]?.value || sorted[0]?.value; // top 2
    isJackpot = data.result.value >= jackpotThreshold;
  }

  const fakeItems = [];
  if(caseInfo && caseInfo.items){
    for(let i=0;i<12;i++) fakeItems.push(caseInfo.items[Math.floor(Math.random()*caseInfo.items.length)]);
  }
  fakeItems.push(data.result);

  const reelWrap = document.createElement('div');
  reelWrap.className = 'cb-reel-wrap' + (isJackpot ? ' cb-reel-jackpot' : '');
  const reelInner = document.createElement('div');
  reelInner.className = 'cb-reel-inner';
  fakeItems.forEach((item,idx) => {
    const cell = document.createElement('div');
    cell.className = 'cb-reel-cell' + (idx===fakeItems.length-1?' cb-reel-winner':'');
    cell.innerHTML = `<div class="cb-reel-iname">${item.name}</div><div class="cb-reel-ival">${fmtNum(item.value)} ST</div>`;
    reelInner.appendChild(cell);
  });
  reelWrap.appendChild(reelInner);
  card.appendChild(reelWrap);

  const cellH = 56;
  const totalH = (fakeItems.length-1)*cellH;
  reelInner.style.transform = 'translateY(0)';
  reelInner.getBoundingClientRect();

  // Jackpot: fast spin then dramatically slow at the end
  // Normal: standard 1.2s ease
  const reelDuration = isJackpot ? 2.8 : 1.2;
  const reelEasing = isJackpot
    ? 'cubic-bezier(0.05,0.92,0.12,1.0)'   // fast rush then crawl to stop
    : 'cubic-bezier(0.15,0.85,0.3,1.0)';

  if (isJackpot) {
    // Dramatic build: flash the reel gold, add glow to card
    card.classList.add('cb-jackpot-incoming');
    sfx('jackpot');
  }

  setTimeout(()=>{
    reelInner.style.transition = `transform ${reelDuration}s ${reelEasing}`;
    reelInner.style.transform = `translateY(-${totalH}px)`;
  }, isJackpot ? 400 : 60); // jackpot: brief pause before spin for drama

  const revealDelay = isJackpot ? (400 + reelDuration * 1000 + 300) : 1350;
  setTimeout(()=>{
    card.classList.remove('cb-jackpot-incoming');
    card.classList.add('done');
    if (isJackpot) card.classList.add('cb-jackpot-winner');
    reelWrap.remove();
    const drop = document.createElement('div');
    drop.className = 'cb-player-drop cb-drop-reveal';
    const showTotal = data.numCases > 1 && data.totalValue !== undefined;
    drop.innerHTML = `<div class="cb-drop-name">${isJackpot?'✨ ':''} ${data.result.name}</div><div class="cb-drop-value">${fmtNum(data.result.value)} ST</div>`
      + (showTotal && data.round > 0 ? `<div class="cb-drop-total">Total: ${fmtNum(data.totalValue)} ST</div>` : '');
    card.appendChild(drop);
    sfx(isJackpot ? 'jackpot' : data.result.value >= 1000 ? 'win_small' : 'click');
    if (isJackpot) launchConfetti(card);
  }, revealDelay);
}

// Store last battle config for rematch
let _lastBattleConfig = null;

function cbOnDone(data) {
  sfx(data.winner?.isBot ? 'lose' : 'jackpot');
  data.players.forEach((p, i) => {
    const card = document.getElementById(`cb-pcard-${i}`);
    if (!card) return;
    card.querySelectorAll('.cb-round-history').forEach(el=>el.remove());
    const isWinner = data.winner?.username === p.username || data.winner?.team?.includes(p.username);
    if (isWinner) card.classList.add('winner');
  });

  const banner = document.getElementById('cb-result-banner');
  banner.classList.remove('hidden');

  let resultHTML = '';
  if (data.winner?.team) {
    resultHTML = `<div class="cb-win-title">🏆 Team ${data.winner.team.join(' & ')} wins!</div><div class="cb-win-sub">Total: ${fmtNum(data.winner.total)} ST</div>`;
  } else {
    const isMe = data.winner?.username === user?.username;
    const reverseTag = data.winner?.reverse ? '<span class="cb-reverse-tag">🔻 REVERSE — lowest wins</span>' : '';
    resultHTML = `<div class="cb-win-title">${data.winner?.isBot?'🤖':'🏆'} ${data.winner?.username} wins!</div>${reverseTag}<div class="cb-win-sub">${isMe?`You won ${fmtNum(data.winner.value)} ST! 🎉`:'Better luck next time!'}</div>`;
  }
  // Rematch button — only show if we have the config stored
  resultHTML += `<div class="cb-rematch-row"><button class="cb-rematch-btn" onclick="cbRematch()">🔄 Rematch</button><button class="cb-back-btn" onclick="cbLeaveRoom()" style="margin-top:0">← Lobby</button></div>`;
  banner.innerHTML = resultHTML;

  fetch('/api/me').then(r=>r.json()).then(u=>{if(u.balance)updateUserUI(u.balance);});
}

async function cbRematch() {
  if (!_lastBattleConfig) { cbLeaveRoom(); return; }
  const { caseId, mode, numCases } = _lastBattleConfig;
  cbSelectedCase = caseId;
  cbSelectedMode = mode;
  cbSelectedNumCases = numCases || 1;
  try {
    const data = await apiPost('/api/battles/create', {caseId, mode, numCases: cbSelectedNumCases});
    cbIsCreator = true;
    cbEnterRoom(data.id);
  } catch(e) { alert(e.message); }
}

function cbLeaveRoom() {
  if (cbBattleStream) { cbBattleStream.close(); cbBattleStream=null; }
  cbCurrentBattleId = null;
  document.getElementById('cb-room').classList.add('hidden');
  document.getElementById('cb-lobby').classList.remove('hidden');
  cbInit();
  cbStartAutoRefresh();
}

async function cbAddBot() {
  if (!cbCurrentBattleId) return;
  try { await apiPost('/api/battles/addbot', {battleId:cbCurrentBattleId}); }
  catch(e) { /* battle may have already started, ignore */ }
}

// ── Theme ──────────────────────────────────────────────────
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'light' ? 'dark' : 'light';
  if (next === 'dark') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', 'light');
  }
  const icon = next === 'light' ? '☀️' : '🌙';
  const btn1 = document.getElementById('theme-btn-landing');
  const btn2 = document.getElementById('theme-btn-app');
  if (btn1) btn1.textContent = icon;
  if (btn2) btn2.textContent = icon;
  try { localStorage.setItem('santen-theme', next); } catch(e) {}
}
function initTheme() {
  try {
    const saved = localStorage.getItem('santen-theme');
    if (saved === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
      const btn1 = document.getElementById('theme-btn-landing');
      const btn2 = document.getElementById('theme-btn-app');
      if (btn1) btn1.textContent = '☀️';
      if (btn2) btn2.textContent = '☀️';
    }
  } catch(e) {}
}

// ── Boot ──────────────────────────────────────────────────
initTheme();
init();
initLandingParticles();

function initLandingParticles() {
  const canvas = document.getElementById('landing-particles');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W, H, particles = [];

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  const SYMBOLS = ['♠','♥','♦','♣','7','★'];
  const COLORS  = ['rgba(232,184,75,','rgba(255,217,122,','rgba(255,255,255,','rgba(139,108,247,'];

  for (let i = 0; i < 55; i++) {
    particles.push({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      sym: SYMBOLS[Math.floor(Math.random()*SYMBOLS.length)],
      col: COLORS[Math.floor(Math.random()*COLORS.length)],
      size: 10 + Math.random() * 16,
      speed: 0.15 + Math.random() * 0.3,
      drift: (Math.random() - 0.5) * 0.25,
      rot: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.008,
      alpha: 0.04 + Math.random() * 0.13,
    });
  }

  function frame() {
    const landing = document.getElementById('landing-screen');
    if (!landing || landing.classList.contains('hidden')) { requestAnimationFrame(frame); return; }
    ctx.clearRect(0, 0, W, H);
    for (const p of particles) {
      p.y -= p.speed;
      p.x += p.drift;
      p.rot += p.rotSpeed;
      if (p.y < -40) { p.y = H + 40; p.x = Math.random() * W; }
      if (p.x < -40) p.x = W + 40;
      if (p.x > W + 40) p.x = -40;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.font = `${p.size}px serif`;
      ctx.fillStyle = p.col + p.alpha + ')';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.sym, 0, 0);
      ctx.restore();
    }
    requestAnimationFrame(frame);
  }
  frame();
}

// Expose only what HTML onclick handlers need — nothing else
  window.loginWithDiscord = loginWithDiscord;
  window.toggleTheme = toggleTheme;
  window.cbShowCreate = cbShowCreate;
  window.cbHideCreate = cbHideCreate;
  window.cbSetMode = cbSetMode;
  window.cbSetNumCases = cbSetNumCases;
  window.cbRematch = cbRematch;
  window.cbCreateBattle = cbCreateBattle;
  window.cbJoinBattle = cbJoinBattle;
  window.cbAddBot = cbAddBot;
  window.cbLeaveRoom = cbLeaveRoom;
  window.logout = logout;
  window.showPage = showPage;
  window.adjustBet = adjustBet;
  window.setBetDirect = setBetDirect;
  window.spinSlots = spinSlots;
  window.dealBlackjack = dealBlackjack;
  window.bjHit = bjHit;
  window.bjStand = bjStand;
  window.setRouletteBet = setRouletteBet;
  window.spinRoulette = spinRoulette;
  window.setCoinChoice = setCoinChoice;
  window.flipCoin = flipCoin;
  window.startCrash = startCrash;
  window.cashOut = cashOut;
  window.adjustMines = adjustMines;
  window.startMines = startMines;
  window.minesCashout = minesCashout;
  window.dropPlinko = dropPlinko;
  window.startHilo = startHilo;
  window.hiloGuess = hiloGuess;
  window.hiloCashout = hiloCashout;
  window.claimDaily = claimDaily;
  window.loadLeaderboard = loadLeaderboard;
  window.openProfile = openProfile;
  window.closeProfileModal = closeProfileModal;
  window.closeProfile = closeProfile;
  window.chatKeydown = chatKeydown;
  window.sendChat = sendChat;

})();
