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

function updateUserUI(bal) {
  if (!user) return;
  if (bal !== undefined) user.balance = bal;
  const n = fmtNum(user.balance);
  document.getElementById('user-name').textContent = user.username;
  document.getElementById('user-balance').textContent = n;
  document.getElementById('header-balance').textContent = n + ' ST';
  const src = user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.discord_id}/${user.avatar}.png?size=64`
    : `https://cdn.discordapp.com/embed/avatars/0.png`;
  document.getElementById('user-avatar').src = src;
  const pm = document.getElementById('pm-avatar');
  if (pm) pm.src = src;
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
function spinReel(el, target, total, delay) {
  return new Promise(resolve=>{
    const cells=buildStrip(target,total); renderStrip(el,cells);
    el.style.transition='none'; el.style.top='0px'; el.getBoundingClientRect();
    setTimeout(()=>{
      const finalTop=-((cells.length-1)*CELL_H), dur=0.6+total*0.05;
      el.style.transition=`top ${dur}s cubic-bezier(0.1,0.85,0.25,1.0)`;
      el.style.top=finalTop+'px';
      el.addEventListener('transitionend',()=>resolve(),{once:true});
    },delay);
  });
}
async function spinSlots() {
  if(!user)return;
  const btn=document.getElementById('slots-btn'); btn.disabled=true;
  document.getElementById('slots-result').innerHTML='';
  try {
    const data=await apiPost('/api/slots',{bet:bets.slots});
    await Promise.all([
      spinReel(document.getElementById('reel0'),data.reels[0],18,0),
      spinReel(document.getElementById('reel1'),data.reels[1],24,100),
      spinReel(document.getElementById('reel2'),data.reels[2],30,200),
    ]);
    updateUserUI(data.newBalance);
    const res=document.getElementById('slots-result');
    if(data.won){
      res.innerHTML=`<span class="win-txt">+${fmtNum(data.payout)} ST · ${data.multiplier}×</span>`;
      document.querySelector('.slots-machine').classList.add('game-win');
      setTimeout(()=>document.querySelector('.slots-machine').classList.remove('game-win'),700);
    } else res.innerHTML=`<span class="lose-txt">No match — spin again</span>`;
    btn.disabled=false;
  } catch(e){showErr('slots-result',e.message);btn.disabled=false;}
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
  document.getElementById('bj-actions').innerHTML=`<button class="bj-btn hit-btn" onclick="bjHit()">HIT</button><button class="bj-btn stand-btn" onclick="bjStand()">STAND</button>`;
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
  document.getElementById('bj-actions').innerHTML=`<button class="bj-btn deal-btn" onclick="dealBlackjack()">DEAL AGAIN</button>`;
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
    // Calculate exact angle so target lands at pointer (top center)
    const targetAngle=-(targetIdx*arcSize);
    const totalRot=Math.PI*2*7+targetAngle-rouletteAngle; // 7 full spins
    const start=rouletteAngle,dur=5000,startTime=performance.now();
    function easeOut(t){return 1-Math.pow(1-t,5);} // quintic for very smooth decel
    function frame(now){
      const p=Math.min((now-startTime)/dur,1),e=easeOut(p);
      drawRouletteWheel(start+totalRot*e);
      if(p<1){requestAnimationFrame(frame);}
      else{
        updateUserUI(data.newBalance);
        const res=document.getElementById('roulette-result');
        const col=R_COLORS[data.number];
        const css=col==='red'?'var(--red)':col==='green'?'var(--green)':'var(--text)';
        res.innerHTML=`<span style="color:${css}">⬤ ${data.number} ${col.toUpperCase()}</span>&nbsp;&nbsp;${data.won?`<span style="color:var(--gold)">+${fmtNum(data.payout)} ST</span>`:'<span style="color:var(--muted)">Lost</span>'}`;
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
  if(!user)return;
  const btn=document.getElementById('crash-btn'),cashBtn=document.getElementById('cashout-btn');
  btn.disabled=true;document.getElementById('crash-result').textContent='';
  try{
    const data=await apiPost('/api/crash/start',{bet:bets.crash});
    user.balance=data.newBalance;updateUserUI();
    crashMult=1.0;crashActive=true;crashCashedOut=false;
    crashPoints=[1];crashStartTime=performance.now();
    const mult=document.getElementById('crash-multiplier');
    const status=document.getElementById('crash-status');
    mult.classList.remove('crashed');status.textContent='Fly! 🚀';
    btn.classList.add('hidden');cashBtn.classList.remove('hidden');
    function tick(now){
      if(!crashActive)return;
      const elapsed=(now-crashStartTime)/1000;
      // Exponential growth: m = e^(0.1*t) — same formula server uses
      crashMult=Math.max(1,parseFloat(Math.pow(Math.E,0.1*elapsed).toFixed(2)));
      crashPoints.push(crashMult);
      mult.textContent=crashMult.toFixed(2)+'×';
      drawCrashFrame();
      // Client NEVER knows the crash point — just keeps ticking.
      // The server will tell us if we crashed when we try to cash out.
      // We ping the server every ~500ms to check if it has crashed.
      crashRaf=requestAnimationFrame(tick);
    }
    crashRaf=requestAnimationFrame(tick);
    // Poll server every 500ms to check if crashed — client never stores crash point
    const crashPoll=setInterval(async()=>{
      if(!crashActive){clearInterval(crashPoll);return;}
      try{
        const alive=await fetch('/api/crash/alive');
        const data=await alive.json();
        if(data.crashed){
          clearInterval(crashPoll);
          crashActive=false;
          if(crashRaf)cancelAnimationFrame(crashRaf);
          mult.textContent=data.at.toFixed(2)+'×';mult.classList.add('crashed');
          status.textContent='Crashed! 💥';
          cashBtn.classList.add('hidden');btn.classList.remove('hidden');btn.disabled=false;
          document.getElementById('crash-result').innerHTML=`<span style="color:var(--red)">Crashed at ${data.at.toFixed(2)}× — Lost ${fmtNum(bets.crash)} ST</span>`;
        }
      }catch(e){clearInterval(crashPoll);}
    },500);
  }catch(e){showErr('crash-result',e.message);btn.disabled=false;}
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
      cell.classList.add('mine-hit');cell.textContent='💣';
      minesState.active=false;
      // Show all mines
      data.mines.forEach(mi=>{if(mi!==idx){cells[mi].classList.add('mine-shown');cells[mi].textContent='💣';}});
      document.getElementById('mines-cashout').classList.add('hidden');
      document.getElementById('mines-btn').disabled=false;
      document.getElementById('mines-btn').textContent='PLAY';
      updateUserUI();
      document.getElementById('mines-result').innerHTML=`<span style="color:var(--red)">💥 Mine hit! Lost ${fmtNum(bets.mines)} ST</span>`;
    }else{
      cell.classList.add('revealed');cell.textContent='💎';
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
      if(data.win){
        hiloMult=data.mult;
        document.getElementById('hilo-streak').textContent=data.streak;
        document.getElementById('hilo-mult').textContent=hiloMult.toFixed(2)+'×';
        document.getElementById('hilo-potential').textContent=fmtNum(Math.floor(hiloBet*hiloMult))+' ST';
        res.innerHTML=`<span style="color:var(--green)">✓ Correct! Keep going or cash out</span>`;
        document.getElementById('hilo-higher').disabled=false;
        document.getElementById('hilo-lower').disabled=false;
      }else{
        hiloActive=false;
        res.innerHTML=`<span style="color:var(--red)">✗ Wrong! Lost ${fmtNum(hiloBet)} ST</span>`;
        document.getElementById('hilo-cashout').style.display='none';
        document.getElementById('hilo-start-btn').textContent='DEAL CARD';
        document.getElementById('hilo-start-btn').onclick=startHilo;
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

// Expose only what HTML onclick handlers need — nothing else
  window.loginWithDiscord = loginWithDiscord;
  window.toggleTheme = toggleTheme;
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
