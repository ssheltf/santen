const API = '';
let user = null;
let bets = { slots:50, bj:50, roulette:50, cf:50, crash:50, plinko:50, hilo:50 };
let bjState = null;
let rouletteBet = null;
let coinChoice = null;
let crashState = null;
let hiloState = null;

// ── Auth ────────────────────────────────────────────────
function loginWithDiscord(){ window.location.href='/auth/discord'; }
function logout(){ fetch('/auth/logout',{method:'POST'}).then(()=>window.location.reload()); }

async function init() {
  try {
    const res = await fetch('/api/me');
    if (res.ok) { user = await res.json(); showApp(); }
    else showLanding();
  } catch(e) { showLanding(); }
}

function showLanding() {
  document.getElementById('landing-screen').classList.remove('hidden');
}
function showApp() {
  document.getElementById('landing-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  updateUserUI();
  showPage('slots');
  initReels();
  drawRouletteWheel(0);
  initCrashCanvas();
  initPlinkoCanvas();
}

function updateUserUI(newBalance) {
  if (!user) return;
  if (newBalance !== undefined) user.balance = newBalance;
  document.getElementById('user-name').textContent = user.username;
  document.getElementById('user-balance').textContent = fmtNum(user.balance);
  document.getElementById('header-balance').textContent = fmtNum(user.balance) + ' ST';
  const av = document.getElementById('user-avatar');
  av.src = user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.discord_id}/${user.avatar}.png?size=64`
    : `https://cdn.discordapp.com/embed/avatars/0.png`;
}

function fmtNum(n){ return Number(n).toLocaleString(); }

// ── Navigation ───────────────────────────────────────────
function showPage(page) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.getElementById('page-'+page).classList.add('active');
  const nav = document.querySelector(`.nav-item[data-page="${page}"]`);
  if(nav) nav.classList.add('active');
  const titles = {slots:'Slots',blackjack:'Blackjack',roulette:'Roulette',coinflip:'Coinflip',crash:'Crash',plinko:'Plinko',hilo:'Hi-Lo',daily:'Daily Reward',profile:'Profile',leaderboard:'Leaderboard'};
  document.getElementById('page-title').textContent = titles[page]||page;
  if(page==='leaderboard') loadLeaderboard();
  if(page==='daily') loadDailyStatus();
  if(page==='profile') loadProfile();
  if(page==='roulette') setTimeout(()=>drawRouletteWheel(rouletteAngle||0), 50);
  if(page==='plinko') setTimeout(initPlinkoCanvas, 50);
}

// ── Bet Controls ─────────────────────────────────────────
function adjustBet(game, delta) {
  bets[game] = Math.max(10, Math.min(user?.balance||99999, bets[game]+delta));
  const el = document.getElementById(game+'-bet-display');
  if(el) el.textContent = fmtNum(bets[game]);
  if(game==='hilo' && hiloState) {
    document.getElementById('hilo-potential').textContent = fmtNum(Math.floor(bets.hilo * hiloState.mult)) + ' ST';
  }
}

async function apiPost(path, body) {
  const res = await fetch(path, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!res.ok){ const e=await res.json(); throw new Error(e.error||'Error'); }
  return res.json();
}

// ── SLOTS ────────────────────────────────────────────────
const SYMBOLS = ['💎','7️⃣','🍒','⭐','🔔','🍋','💀'];
const CELL_H = 110;

function buildStrip(targetSymbol, totalCells) {
  const cells = [];
  for(let i=0;i<totalCells;i++) cells.push(SYMBOLS[Math.floor(Math.random()*SYMBOLS.length)]);
  cells[cells.length-1] = targetSymbol;
  return cells;
}
function renderStrip(el, cells) {
  el.innerHTML='';
  cells.forEach(sym=>{ const d=document.createElement('div'); d.className='slot-cell'; d.textContent=sym; el.appendChild(d); });
}
function initReels() {
  [0,1,2].forEach(i=>{
    const s=document.getElementById('reel'+i);
    const cells=buildStrip('💎',6);
    renderStrip(s,cells);
    s.style.transition='none';
    s.style.top=-((cells.length-1)*CELL_H)+'px';
  });
}
function spinReel(el, target, total, delay) {
  return new Promise(resolve=>{
    const cells=buildStrip(target,total);
    renderStrip(el,cells);
    el.style.transition='none';
    el.style.top='0px';
    el.getBoundingClientRect();
    setTimeout(()=>{
      const finalTop=-((cells.length-1)*CELL_H);
      const dur=0.55+total*0.055;
      el.style.transition=`top ${dur}s cubic-bezier(0.12,0.8,0.3,1.0)`;
      el.style.top=finalTop+'px';
      el.addEventListener('transitionend',()=>resolve(),{once:true});
    }, delay);
  });
}

async function spinSlots() {
  if(!user) return;
  const btn=document.getElementById('slots-btn');
  btn.disabled=true;
  document.getElementById('slots-result').innerHTML='';
  try {
    const data = await apiPost('/api/slots',{bet:bets.slots});
    await Promise.all([
      spinReel(document.getElementById('reel0'),data.reels[0],18,0),
      spinReel(document.getElementById('reel1'),data.reels[1],24,120),
      spinReel(document.getElementById('reel2'),data.reels[2],30,240),
    ]);
    // Update balance AFTER animation
    updateUserUI(data.newBalance);
    const res=document.getElementById('slots-result');
    if(data.won){
      res.innerHTML=`<span class="win-text">+${fmtNum(data.payout)} ST · ${data.multiplier}×</span>`;
      document.querySelector('.slots-machine').classList.add('game-win');
      setTimeout(()=>document.querySelector('.slots-machine').classList.remove('game-win'),700);
    } else {
      res.innerHTML=`<span class="lose-text">No match — better luck next spin</span>`;
    }
    btn.disabled=false;
  } catch(e){ showError('slots-result',e.message); btn.disabled=false; }
}

// ── BLACKJACK ────────────────────────────────────────────
const SUITS=['♠','♥','♦','♣'], RANKS=['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
function cardVal(r){if(['J','Q','K'].includes(r))return 10;if(r==='A')return 11;return parseInt(r);}
function handScore(h){let s=0,a=0;h.forEach(c=>{s+=cardVal(c.rank);if(c.rank==='A')a++;});while(s>21&&a>0){s-=10;a--;}return s;}
function renderCard(c,fd=false){
  const d=document.createElement('div');
  d.className='card'+(fd?' face-down':'')+(['♥','♦'].includes(c?.suit)?' red':'');
  if(!fd&&c){const r=document.createElement('div');r.className='card-rank';r.textContent=c.rank;const s=document.createElement('div');s.className='card-suit';s.textContent=c.suit;d.appendChild(r);d.appendChild(s);}
  return d;
}
function renderHand(id,hand,hide=false){const el=document.getElementById(id);el.innerHTML='';hand.forEach((c,i)=>el.appendChild(renderCard(c,hide&&i===1)));}

async function dealBlackjack(){
  if(!user) return;
  const deck=[];SUITS.forEach(s=>RANKS.forEach(r=>deck.push({suit:s,rank:r})));
  for(let i=deck.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]];}
  const player=[deck.pop(),deck.pop()], dealer=[deck.pop(),deck.pop()];
  try{ await apiPost('/api/balance/deduct',{amount:bets.bj}); user.balance-=bets.bj; updateUserUI(); }
  catch(e){showError('bj-result',e.message);return;}
  bjState={player,dealer,deck,bet:bets.bj,over:false};
  renderHand('player-hand',player); renderHand('dealer-hand',dealer,true);
  document.getElementById('player-score').textContent=handScore(player);
  document.getElementById('dealer-score').textContent='?';
  document.getElementById('bj-result').textContent='';
  if(handScore(player)===21){await settleBJ('blackjack');return;}
  document.getElementById('bj-actions').innerHTML=`<button class="bj-btn hit-btn" onclick="bjHit()">HIT</button><button class="bj-btn stand-btn" onclick="bjStand()">STAND</button>`;
}
function bjHit(){
  if(!bjState||bjState.over)return;
  bjState.player.push(bjState.deck.pop());
  renderHand('player-hand',bjState.player);
  const ps=handScore(bjState.player);
  document.getElementById('player-score').textContent=ps;
  if(ps>21)settleBJ('bust'); else if(ps===21)bjStand();
}
async function bjStand(){
  if(!bjState||bjState.over)return;
  renderHand('dealer-hand',bjState.dealer);
  document.getElementById('dealer-score').textContent=handScore(bjState.dealer);
  while(handScore(bjState.dealer)<17){bjState.dealer.push(bjState.deck.pop());renderHand('dealer-hand',bjState.dealer);document.getElementById('dealer-score').textContent=handScore(bjState.dealer);}
  const ds=handScore(bjState.dealer),ps=handScore(bjState.player);
  if(ds>21||ps>ds)settleBJ('win'); else if(ps===ds)settleBJ('push'); else settleBJ('lose');
}
async function settleBJ(result){
  bjState.over=true;
  let msg='',payout=0;
  if(result==='blackjack'){msg='🃏 Blackjack! ×2.5';payout=Math.floor(bjState.bet*2.5);}
  else if(result==='win'){msg='✓ You win! ×2';payout=bjState.bet*2;}
  else if(result==='push'){msg='Push — bet returned';payout=bjState.bet;}
  else if(result==='bust'){msg='Bust! Over 21';}
  else{msg='Dealer wins';}
  if(payout>0){try{const d=await apiPost('/api/balance/add',{amount:payout});updateUserUI(d.newBalance);}catch(e){}}
  renderHand('dealer-hand',bjState.dealer);
  document.getElementById('dealer-score').textContent=handScore(bjState.dealer);
  const res=document.getElementById('bj-result');
  res.textContent=msg; res.style.color=payout>0?'var(--gold)':'var(--red)';
  document.getElementById('bj-actions').innerHTML=`<button class="bj-btn deal-btn" onclick="dealBlackjack()">DEAL AGAIN</button>`;
}

// ── ROULETTE — smooth requestAnimationFrame ───────────────
const R_NUMS=[0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
const R_COLORS={};
R_NUMS.forEach(n=>R_COLORS[n]='black');
[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36].forEach(n=>R_COLORS[n]='red');
R_COLORS[0]='green';
let rouletteAngle=0;

function drawRouletteWheel(angle=0) {
  const canvas=document.getElementById('roulette-canvas');
  if(!canvas)return;
  const ctx=canvas.getContext('2d'), cx=150,cy=150,r=140, arc=(2*Math.PI)/R_NUMS.length;
  ctx.clearRect(0,0,300,300);
  R_NUMS.forEach((num,i)=>{
    const start=angle+i*arc-Math.PI/2, end=start+arc;
    ctx.beginPath(); ctx.moveTo(cx,cy); ctx.arc(cx,cy,r,start,end); ctx.closePath();
    ctx.fillStyle=R_COLORS[num]==='red'?'#c0392b':R_COLORS[num]==='green'?'#27ae60':'#1a1a1a';
    ctx.fill(); ctx.strokeStyle='rgba(255,255,255,0.05)'; ctx.lineWidth=0.5; ctx.stroke();
    ctx.save(); ctx.translate(cx,cy); ctx.rotate(start+arc/2); ctx.translate(r*0.72,0);
    ctx.rotate(Math.PI/2); ctx.fillStyle='#fff'; ctx.font='bold 9px DM Mono,monospace';
    ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(num,0,0); ctx.restore();
  });
  ctx.beginPath(); ctx.arc(cx,cy,18,0,Math.PI*2);
  ctx.fillStyle='#111'; ctx.fill(); ctx.strokeStyle='var(--gold)'; ctx.lineWidth=2; ctx.stroke();
  rouletteAngle=angle;
}

function setRouletteBet(type, btn) {
  rouletteBet=type;
  document.querySelectorAll('.rb-btn').forEach(b=>b.classList.remove('selected'));
  btn.classList.add('selected');
  const labels={red:'Red ×2',black:'Black ×2',green:'Green ×14',low:'1–18 ×2',high:'19–36 ×2',odd:'Odd ×2',even:'Even ×2'};
  document.getElementById('roulette-selection').textContent='Selected: '+labels[type];
}

async function spinRoulette() {
  if(!rouletteBet){alert('Select a bet type first!');return;}
  const btn=document.getElementById('roulette-btn'); btn.disabled=true;
  document.getElementById('roulette-result').textContent='';
  try {
    const data=await apiPost('/api/roulette',{bet:bets.roulette,betType:rouletteBet});
    const targetIdx=R_NUMS.indexOf(data.number);
    const arcSize=2*Math.PI/R_NUMS.length;
    // Angle where target slot center lands at top (pointer position)
    const targetAngle=-(targetIdx*arcSize);
    const totalRotation=Math.PI*14+targetAngle; // ~7 full spins + land on target
    const startAngle=rouletteAngle;
    const duration=4000; // 4 seconds
    const startTime=performance.now();

    function easeOut(t){ return 1-Math.pow(1-t,4); } // quartic ease-out = very smooth decel

    function frame(now) {
      const elapsed=now-startTime;
      const progress=Math.min(elapsed/duration,1);
      const eased=easeOut(progress);
      const currentAngle=startAngle+totalRotation*eased;
      drawRouletteWheel(currentAngle);
      if(progress<1){ requestAnimationFrame(frame); }
      else {
        drawRouletteWheel(startAngle+totalRotation);
        // Update balance AFTER animation finishes
        updateUserUI(data.newBalance);
        const res=document.getElementById('roulette-result');
        const col=R_COLORS[data.number];
        const colCss=col==='red'?'var(--red)':col==='green'?'var(--green)':'var(--text)';
        res.innerHTML=`<span style="color:${colCss}">${data.number} ${col.toUpperCase()}</span>&nbsp;&nbsp;${data.won?`<span style="color:var(--gold)">+${fmtNum(data.payout)} ST</span>`:'<span style="color:var(--muted)">Lost</span>'}`;
        btn.disabled=false;
      }
    }
    requestAnimationFrame(frame);
  } catch(e){ showError('roulette-result',e.message); btn.disabled=false; }
}

// ── COINFLIP ─────────────────────────────────────────────
function setCoinChoice(c){
  coinChoice=c;
  document.getElementById('cf-heads').classList.toggle('selected',c==='heads');
  document.getElementById('cf-tails').classList.toggle('selected',c==='tails');
}
async function flipCoin(){
  if(!coinChoice){alert('Choose heads or tails!');return;}
  const btn=document.getElementById('cf-btn'); btn.disabled=true;
  document.getElementById('cf-result').textContent='';
  const coin=document.getElementById('coin'); coin.classList.add('flipping');
  try {
    const data=await apiPost('/api/coinflip',{bet:bets.cf,choice:coinChoice});
    setTimeout(()=>{
      coin.classList.remove('flipping');
      // Update balance AFTER flip animation
      updateUserUI(data.newBalance);
      const res=document.getElementById('cf-result');
      res.textContent=data.won?`✓ ${data.result.toUpperCase()} — +${fmtNum(data.payout)} ST`:`✗ ${data.result.toUpperCase()} — Better luck next flip`;
      res.style.color=data.won?'var(--gold)':'var(--red)';
      btn.disabled=false;
    },1100);
  } catch(e){ coin.classList.remove('flipping'); showError('cf-result',e.message); btn.disabled=false; }
}

// ── CRASH ────────────────────────────────────────────────
let crashCanvas,crashCtx,crashInterval=null,crashMultiplier=1.0,crashCrashPoint=1,crashBetActive=false,crashCashedOut=false;
function initCrashCanvas(){crashCanvas=document.getElementById('crash-canvas');if(!crashCanvas)return;crashCtx=crashCanvas.getContext('2d');drawCrashIdle();}
function drawCrashIdle(){if(!crashCtx)return;crashCtx.clearRect(0,0,600,300);crashCtx.fillStyle='rgba(255,255,255,0.03)';for(let x=0;x<600;x+=60)crashCtx.fillRect(x,0,1,300);for(let y=0;y<300;y+=50)crashCtx.fillRect(0,y,600,1);}
function drawCrashLine(m){
  if(!crashCtx)return;
  const w=600,h=300;
  crashCtx.clearRect(0,0,w,h);
  crashCtx.fillStyle='rgba(255,255,255,0.03)';
  for(let x=0;x<w;x+=60)crashCtx.fillRect(x,0,1,h);
  for(let y=0;y<h;y+=50)crashCtx.fillRect(0,y,w,1);
  const progress=Math.min((m-1)/9,1);
  const ex=w*progress,ey=h-(h*Math.pow(progress,0.6));
  crashCtx.beginPath();crashCtx.moveTo(0,h);
  for(let p=0;p<=progress;p+=0.01)crashCtx.lineTo(w*p,h-(h*Math.pow(p,0.6)));
  crashCtx.strokeStyle='var(--gold)';crashCtx.lineWidth=2;crashCtx.stroke();
  crashCtx.lineTo(ex,h);crashCtx.closePath();crashCtx.fillStyle='rgba(201,168,76,0.06)';crashCtx.fill();
  crashCtx.beginPath();crashCtx.arc(ex,ey,5,0,Math.PI*2);crashCtx.fillStyle='var(--gold)';crashCtx.fill();
}
async function startCrash(){
  if(!user)return;
  const btn=document.getElementById('crash-btn'),cashBtn=document.getElementById('cashout-btn');
  btn.disabled=true;document.getElementById('crash-result').textContent='';
  try {
    const data=await apiPost('/api/crash/start',{bet:bets.crash});
    user.balance=data.newBalance;updateUserUI();
    crashCrashPoint=data.crashPoint;crashMultiplier=1.0;crashBetActive=true;crashCashedOut=false;
    const mult=document.getElementById('crash-multiplier');mult.classList.remove('crashed');
    btn.classList.add('hidden');cashBtn.classList.remove('hidden');
    crashInterval=setInterval(()=>{
      crashMultiplier+=0.01*(1+crashMultiplier*0.05);
      mult.textContent=crashMultiplier.toFixed(2)+'×';
      drawCrashLine(crashMultiplier);
      if(crashMultiplier>=crashCrashPoint){
        clearInterval(crashInterval);
        if(!crashCashedOut){
          mult.textContent=crashCrashPoint.toFixed(2)+'× CRASHED';mult.classList.add('crashed');
          cashBtn.classList.add('hidden');btn.classList.remove('hidden');btn.disabled=false;
          document.getElementById('crash-result').innerHTML=`<span style="color:var(--red)">Crashed at ${crashCrashPoint.toFixed(2)}× — Lost ${fmtNum(bets.crash)} ST</span>`;
          drawCrashLine(crashCrashPoint);
        }
        crashBetActive=false;
      }
    },60);
  } catch(e){showError('crash-result',e.message);btn.disabled=false;}
}
async function cashOut(){
  if(!crashBetActive||crashCashedOut)return;
  crashCashedOut=true;clearInterval(crashInterval);
  const payout=Math.floor(bets.crash*crashMultiplier),profit=payout-bets.crash;
  try{const d=await apiPost('/api/crash/cashout',{payout});updateUserUI(d.newBalance);}catch(e){}
  document.getElementById('cashout-btn').classList.add('hidden');
  const btn=document.getElementById('crash-btn');btn.classList.remove('hidden');btn.disabled=false;
  document.getElementById('crash-result').innerHTML=`<span style="color:var(--gold)">Cashed out at ${crashMultiplier.toFixed(2)}× — +${fmtNum(profit)} ST profit!</span>`;
  crashBetActive=false;
}

// ── PLINKO ────────────────────────────────────────────────
const PLINKO_ROWS=10;
const PLINKO_MULTIPLIERS=[10,3,1.5,1,0.5,0.3,0.5,1,1.5,3,10];
let plinkoCanvas,plinkoCtx,plinkoPegs=[],plinkoBuckets=[];

function initPlinkoCanvas(){
  plinkoCanvas=document.getElementById('plinko-canvas');
  if(!plinkoCanvas)return;
  plinkoCtx=plinkoCanvas.getContext('2d');
  buildPlinkoLayout();
  drawPlinkoStatic();
}

function buildPlinkoLayout(){
  plinkoPegs=[];
  const W=500,H=400,topPad=40,pegR=5;
  for(let row=0;row<PLINKO_ROWS;row++){
    const cols=row+3,spacing=W/(cols+1);
    for(let col=0;col<cols;col++){
      plinkoPegs.push({x:spacing*(col+1)+(W-(spacing*(cols+1)))/2+spacing*0,y:topPad+(row*(H-80-topPad)/(PLINKO_ROWS-1)),r:pegR,row,col});
    }
  }
  // Buckets at bottom
  const bucketCount=PLINKO_MULTIPLIERS.length;
  const bw=W/bucketCount;
  plinkoBuckets=PLINKO_MULTIPLIERS.map((m,i)=>({x:i*bw,w:bw,mult:m,y:H-40}));
}

function drawPlinkoStatic(highlightBucket=-1){
  if(!plinkoCtx)return;
  const ctx=plinkoCtx,W=500,H=400;
  ctx.clearRect(0,0,W,H);
  // Pegs
  plinkoPegs.forEach(p=>{
    ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
    ctx.fillStyle='rgba(201,168,76,0.6)';ctx.fill();
  });
  // Buckets
  plinkoBuckets.forEach((b,i)=>{
    const isHigh=b.mult>=5,isMid=b.mult>=1;
    const col=isHigh?'rgba(201,168,76,0.8)':isMid?'rgba(61,186,110,0.6)':'rgba(232,228,220,0.2)';
    ctx.fillStyle=i===highlightBucket?'rgba(201,168,76,0.95)':col;
    ctx.fillRect(b.x+1,b.y,b.w-2,30);
    ctx.fillStyle=i===highlightBucket?'#000':'#fff';
    ctx.font=`bold 10px DM Mono,monospace`;ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(b.mult+'×',b.x+b.w/2,b.y+15);
  });
}

function animatePlinkoball(path, onDone){
  if(!plinkoCtx)return;
  const W=500,startX=250,startY=15,ballR=8;
  let step=0;
  // path is array of {x,y} waypoints
  function frame(){
    drawPlinkoStatic();
    if(step>=path.length){onDone();return;}
    const pt=path[step];
    plinkoCtx.beginPath();plinkoCtx.arc(pt.x,pt.y,ballR,0,Math.PI*2);
    plinkoCtx.fillStyle='var(--gold)';plinkoCtx.fill();
    plinkoCtx.strokeStyle='rgba(201,168,76,0.3)';plinkoCtx.lineWidth=2;plinkoCtx.stroke();
    step++;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function computePlinkPath(finalBucket){
  // Simulate path through pegs ending at finalBucket
  const W=500,H=400,topPad=40;
  const path=[];
  let x=250,y=15;
  path.push({x,y});
  // Each row, ball moves left or right toward final bucket
  const bucketCenterX=plinkoBuckets[finalBucket].x+plinkoBuckets[finalBucket].w/2;
  for(let row=0;row<PLINKO_ROWS;row++){
    const rowPegs=plinkoPegs.filter(p=>p.row===row);
    if(!rowPegs.length)continue;
    const pegY=rowPegs[0].y;
    // Interpolate towards bucket
    const progress=(row+1)/PLINKO_ROWS;
    const targetX=x+(bucketCenterX-x)*0.3+(Math.random()-0.5)*20;
    // Animate toward nearest peg in row, then bounce
    const nearest=rowPegs.reduce((a,b)=>Math.abs(b.x-x)<Math.abs(a.x-x)?b:a);
    // Smooth arc to peg
    const steps=8;
    for(let s=1;s<=steps;s++){
      path.push({x:x+(nearest.x-x)*(s/steps),y:y+(pegY-y)*(s/steps)});
    }
    // Bounce direction biased toward final bucket
    const goRight=bucketCenterX>nearest.x?0.65:0.35;
    x=nearest.x+(Math.random()<goRight?18:-18);
    y=pegY;
  }
  // Fall into bucket
  const bucketY=H-25;
  const steps=10;
  for(let s=1;s<=steps;s++) path.push({x:x+(bucketCenterX-x)*(s/steps),y:y+(bucketY-y)*(s/steps)});
  return path;
}

async function dropPlinko(){
  if(!user)return;
  const btn=document.getElementById('plinko-btn');btn.disabled=true;
  document.getElementById('plinko-result').textContent='';
  try {
    const data=await apiPost('/api/plinko',{bet:bets.plinko});
    const path=computePlinkPath(data.bucketIndex);
    animatePlinkoball(path,()=>{
      drawPlinkoStatic(data.bucketIndex);
      // Update balance AFTER ball lands
      updateUserUI(data.newBalance);
      const res=document.getElementById('plinko-result');
      res.innerHTML=data.won
        ?`<span class="win-text">${data.multiplier}× — +${fmtNum(data.payout)} ST</span>`
        :`<span class="lose-text">${data.multiplier}× — Lost ${fmtNum(bets.plinko)} ST</span>`;
      btn.disabled=false;
    });
  } catch(e){showError('plinko-result',e.message);btn.disabled=false;}
}

// ── HI-LO ────────────────────────────────────────────────
const HL_RANKS=['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const HL_SUITS=['♠','♥','♦','♣'];
function hlCardVal(r){const i=HL_RANKS.indexOf(r);return i===-1?0:i+2;}
function randomCard(){return{rank:HL_RANKS[Math.floor(Math.random()*HL_RANKS.length)],suit:HL_SUITS[Math.floor(Math.random()*HL_SUITS.length)]};}
function hlStreakMult(streak){return Math.pow(1.8,streak);}

function renderHiloCard(card){
  const face=document.getElementById('hilo-card-face');
  const suit=document.getElementById('hilo-card-suit');
  const el=document.getElementById('hilo-card');
  el.classList.remove('red','black');
  if(card.rank==='?'){face.textContent='?';suit.textContent='';return;}
  face.textContent=card.rank;
  suit.textContent=card.suit;
  el.classList.add(['♥','♦'].includes(card.suit)?'red':'black');
}

async function startHilo(){
  if(!user)return;
  const btn=document.getElementById('hilo-start-btn');
  try{
    await apiPost('/api/balance/deduct',{amount:bets.hilo});
    user.balance-=bets.hilo;updateUserUI();
  }catch(e){showError('hilo-result',e.message);return;}
  const card=randomCard();
  hiloState={card,streak:0,mult:1,bet:bets.hilo,active:true};
  // Flip animation
  const el=document.getElementById('hilo-card');
  el.classList.add('flip');
  setTimeout(()=>{el.classList.remove('flip');renderHiloCard(card);},200);
  document.getElementById('hilo-streak').textContent='0';
  document.getElementById('hilo-mult').textContent='1.00×';
  document.getElementById('hilo-potential').textContent=fmtNum(bets.hilo)+' ST';
  document.getElementById('hilo-result').textContent='';
  document.getElementById('hilo-higher').disabled=false;
  document.getElementById('hilo-lower').disabled=false;
  document.getElementById('hilo-cashout').style.display='inline-flex';
  btn.textContent='New Game';
  btn.onclick=()=>{ hiloCashout(); setTimeout(startHilo,200); };
}

async function hiloGuess(dir){
  if(!hiloState||!hiloState.active)return;
  document.getElementById('hilo-higher').disabled=true;
  document.getElementById('hilo-lower').disabled=true;
  const newCard=randomCard();
  const oldVal=hlCardVal(hiloState.card.rank),newVal=hlCardVal(newCard.rank);
  let win=false;
  if(dir==='higher'&&newVal>oldVal)win=true;
  if(dir==='lower'&&newVal<oldVal)win=true;
  if(newVal===oldVal)win=false; // tie = lose
  // Flip
  const el=document.getElementById('hilo-card');
  el.classList.add('flip');
  setTimeout(()=>{
    el.classList.remove('flip');
    renderHiloCard(newCard);
    hiloState.card=newCard;
    const res=document.getElementById('hilo-result');
    if(win){
      hiloState.streak++;
      hiloState.mult=hlStreakMult(hiloState.streak);
      document.getElementById('hilo-streak').textContent=hiloState.streak;
      document.getElementById('hilo-mult').textContent=hiloState.mult.toFixed(2)+'×';
      document.getElementById('hilo-potential').textContent=fmtNum(Math.floor(hiloState.bet*hiloState.mult))+' ST';
      res.innerHTML=`<span style="color:var(--green)">✓ Correct! Keep going or cash out</span>`;
      document.getElementById('hilo-higher').disabled=false;
      document.getElementById('hilo-lower').disabled=false;
    } else {
      hiloState.active=false;
      res.innerHTML=`<span style="color:var(--red)">✗ Wrong! Lost ${fmtNum(hiloState.bet)} ST</span>`;
      document.getElementById('hilo-cashout').style.display='none';
      document.getElementById('hilo-start-btn').textContent='Deal Card';
      document.getElementById('hilo-start-btn').onclick=startHilo;
    }
  },200);
}

async function hiloCashout(){
  if(!hiloState||!hiloState.active||hiloState.streak===0)return;
  hiloState.active=false;
  const payout=Math.floor(hiloState.bet*hiloState.mult);
  try{const d=await apiPost('/api/balance/add',{amount:payout});updateUserUI(d.newBalance);}catch(e){}
  document.getElementById('hilo-result').innerHTML=`<span style="color:var(--gold)">Cashed out — +${fmtNum(payout)} ST (${hiloState.mult.toFixed(2)}×)!</span>`;
  document.getElementById('hilo-cashout').style.display='none';
  document.getElementById('hilo-higher').disabled=true;
  document.getElementById('hilo-lower').disabled=true;
  document.getElementById('hilo-start-btn').textContent='Deal Card';
  document.getElementById('hilo-start-btn').onclick=startHilo;
}

// ── DAILY ────────────────────────────────────────────────
async function loadDailyStatus(){
  try{
    const data=await fetch('/api/daily/status').then(r=>r.json());
    document.getElementById('streak-count').textContent=data.streak+' days';
    const reward=250+data.streak*50;
    document.getElementById('reward-amount').textContent='+'+fmtNum(reward)+' ST';
    const btn=document.getElementById('daily-btn');
    if(!data.canClaim){
      const ms=data.nextClaimAt-Date.now(),hrs=Math.floor(ms/3600000),mins=Math.floor((ms%3600000)/60000);
      btn.disabled=true;btn.textContent=`Come back in ${hrs}h ${mins}m`;
      document.getElementById('daily-result').innerHTML=`<span style="color:var(--muted)">Already claimed today</span>`;
    } else{btn.disabled=false;btn.textContent='CLAIM REWARD';}
  }catch(e){}
}
async function claimDaily(){
  try{
    const data=await apiPost('/api/daily/claim',{});
    updateUserUI(data.newBalance);
    document.getElementById('streak-count').textContent=data.streak+' days';
    document.getElementById('daily-result').innerHTML=`<span style="color:var(--gold)">+${fmtNum(data.reward)} ST claimed! 🎉</span>`;
    const btn=document.getElementById('daily-btn');btn.disabled=true;btn.textContent='Come back tomorrow';
  }catch(e){showError('daily-result',e.message);}
}

// ── PROFILE ──────────────────────────────────────────────
async function loadProfile(){
  if(!user)return;
  document.getElementById('profile-name').textContent=user.username;
  document.getElementById('profile-balance').textContent=fmtNum(user.balance)+' ST';
  document.getElementById('profile-streak').textContent='🔥 '+( user.streak||0)+' day streak';
  const av=document.getElementById('profile-avatar');
  av.src=user.avatar?`https://cdn.discordapp.com/avatars/${user.discord_id}/${user.avatar}.png?size=128`:'https://cdn.discordapp.com/embed/avatars/0.png';
  try{
    const stats=await fetch('/api/stats').then(r=>r.json());
    const grid=document.getElementById('stats-grid');
    if(!stats.length){grid.innerHTML='<div class="stat-card-loading">No games played yet — go try your luck!</div>';return;}
    grid.innerHTML='';
    stats.forEach(s=>{
      const card=document.createElement('div');card.className='stat-card';
      const net=s.net||0;
      card.innerHTML=`
        <div class="stat-game">${s.type}</div>
        <div class="stat-plays">${s.plays} plays</div>
        <div class="stat-detail">${s.wins} wins · ${s.plays>0?Math.round(s.wins/s.plays*100):0}% win rate</div>
        <div class="stat-net ${net>=0?'pos':'neg'}">${net>=0?'+':''}${fmtNum(net)} ST net</div>
      `;
      grid.appendChild(card);
    });
    // Total summary card
    const total=stats.reduce((a,s)=>({plays:a.plays+s.plays,wins:a.wins+s.wins,net:a.net+s.net}),{plays:0,wins:0,net:0});
    const sum=document.createElement('div');sum.className='stat-card';
    sum.innerHTML=`<div class="stat-game" style="color:var(--gold)">ALL GAMES</div><div class="stat-plays">${total.plays} total</div><div class="stat-detail">${total.wins} wins overall</div><div class="stat-net ${total.net>=0?'pos':'neg'}">${total.net>=0?'+':''}${fmtNum(total.net)} ST total</div>`;
    grid.prepend(sum);
  }catch(e){}
  // History
  try{
    const hist=await fetch('/api/history').then(r=>r.json());
    const list=document.getElementById('profile-history-list');
    if(!hist.length){list.innerHTML='<div class="ph-row"><div style="color:var(--muted);font-size:12px">No activity yet</div></div>';return;}
    list.innerHTML='';
    hist.forEach(h=>{
      const row=document.createElement('div');row.className='ph-row';
      const ago=timeAgo(h.created_at);
      row.innerHTML=`<div class="ph-game">${h.type}</div><div class="ph-amount ${h.amount>=0?'pos':'neg'}">${h.amount>=0?'+':''}${fmtNum(h.amount)} ST</div><div class="ph-time">${ago}</div>`;
      list.appendChild(row);
    });
  }catch(e){}
}

function timeAgo(ts){
  const diff=Date.now()-ts;
  if(diff<60000)return 'just now';
  if(diff<3600000)return Math.floor(diff/60000)+'m ago';
  if(diff<86400000)return Math.floor(diff/3600000)+'h ago';
  return Math.floor(diff/86400000)+'d ago';
}

// ── LEADERBOARD ──────────────────────────────────────────
async function loadLeaderboard(){
  const list=document.getElementById('leaderboard-list');
  list.innerHTML='<div class="lb-loading">Loading...</div>';
  try{
    const data=await fetch('/api/leaderboard').then(r=>r.json());
    list.innerHTML='';
    const medals=['🥇','🥈','🥉'];
    data.forEach((u,i)=>{
      const row=document.createElement('div');
      row.className='lb-row'+(i<3?' top'+(i+1):'')+(u.discord_id===user?.discord_id?' me':'');
      row.innerHTML=`<div class="lb-rank">${i<3?medals[i]:i+1}</div><img class="lb-avatar" src="${u.avatar?`https://cdn.discordapp.com/avatars/${u.discord_id}/${u.avatar}.png?size=32`:'https://cdn.discordapp.com/embed/avatars/0.png'}" alt=""><div class="lb-username">${u.username}</div><div class="lb-balance">${fmtNum(u.balance)} ST</div>`;
      list.appendChild(row);
    });
  }catch(e){list.innerHTML='<div class="lb-loading">Failed to load</div>';}
}

// ── Helpers ──────────────────────────────────────────────
function showError(id,msg){const el=document.getElementById(id);if(el)el.innerHTML=`<span style="color:var(--red)">${msg}</span>`;}

// ── Boot ─────────────────────────────────────────────────
init();
