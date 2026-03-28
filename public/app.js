const API = '';
let user = null;
let bets = { bj:50, roulette:50, cf:50, crash:50, plinko:50 };
let bjState = null;
let rouletteBet = null;
let coinChoice = null;
let crashState = null;
 
// ── Auth ─────────────────────────────────────────────────
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
  const titles={slots:'Slots',blackjack:'Blackjack',roulette:'Roulette',coinflip:'Coinflip',crash:'Crash',plinko:'Plinko',hilo:'Hi-Lo',daily:'Daily Reward',profile:'Profile',leaderboard:'Leaderboard'};
  document.getElementById('page-title').textContent=titles[page]||page;
  if(page==='leaderboard')loadLeaderboard();
  if(page==='daily')loadDailyStatus();
  if(page==='profile')loadProfile();
  if(page==='roulette')setTimeout(()=>drawRouletteWheel(rouletteAngle||0),50);
  if(page==='plinko')setTimeout(initPlinkoCanvas,50);
}
 
function adjustBet(game, delta) {
  bets[game] = Math.max(10, Math.min(user?.balance||99999, bets[game]+delta));
  const el = document.getElementById(game+'-bet-display');
  if(el) el.textContent = fmtNum(bets[game]);
}
 
async function apiPost(path, body) {
  const res = await fetch(path, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!res.ok){ const e=await res.json(); throw new Error(e.error||'Error'); }
  return res.json();
}
 
function getSlotsCustomBet() {
  const input = document.getElementById('slots-custom-bet');
  const val = parseInt(input ? input.value : 100, 10);
  if (isNaN(val) || val < 10) return 10;
  if (user && val > user.balance) return user.balance;
  return val;
}
 
// ══════════════════════════════════════════════════════════
// SLOTS — 5×3 Dice & Roll style
// ══════════════════════════════════════════════════════════
const SLOT_SYMS = ['🎲','⭐','7️⃣','🔔','🍇','🍉','🍑','🍋','🍒'];
 
// Symbol → emoji displayed in cells
const SYM_LABEL = {
  '🎲': '🎲', '⭐': '⭐', '7️⃣': '7️⃣', '🔔': '🔔',
  '🍇': '🍇', '🍉': '🍉', '🍑': '🍑', '🍋': '🍋', '🍒': '🍒'
};
 
// For animation — pool of symbols weighted like server
const ANIM_POOL = [];
(function(){
  const weights=[2,3,4,7,9,9,15,25,26];
  SLOT_SYMS.forEach((s,i)=>{ for(let j=0;j<weights[i];j++) ANIM_POOL.push(s); });
})();
 
function randAnimSym(){ return ANIM_POOL[Math.floor(Math.random()*ANIM_POOL.length)]; }
 
// Build the 5×3 grid DOM
function buildSlotGrid() {
  const grid = document.getElementById('slot-grid-5x3');
  if (!grid) return;
  grid.innerHTML = '';
  for (let row = 0; row < 3; row++) {
    for (let reel = 0; reel < 5; reel++) {
      const cell = document.createElement('div');
      cell.className = 'sg-cell';
      cell.id = `sg-${reel}-${row}`;
      cell.textContent = randAnimSym();
      grid.appendChild(cell);
    }
  }
}
 
function setGridSymbol(reel, row, sym, classes=[]) {
  const cell = document.getElementById(`sg-${reel}-${row}`);
  if (!cell) return;
  cell.textContent = sym;
  cell.className = 'sg-cell' + (classes.length ? ' ' + classes.join(' ') : '');
}
 
function clearGridHighlights() {
  for(let r=0;r<5;r++) for(let row=0;row<3;row++) {
    const cell = document.getElementById(`sg-${r}-${row}`);
    if(cell) cell.className='sg-cell';
  }
}
 
// Spin animation: blur spin individual reels with stagger
function animateReel(reel, finalSymbols, delay, duration) {
  return new Promise(resolve => {
    const cells = [0,1,2].map(row => document.getElementById(`sg-${reel}-${row}`));
    cells.forEach(c => { if(c) c.classList.add('spinning'); });
    setTimeout(() => {
      // Fast random tick for spin illusion
      let ticks = 0;
      const maxTicks = 12 + reel * 4;
      const tickInterval = setInterval(() => {
        cells.forEach(c => { if(c) c.textContent = randAnimSym(); });
        ticks++;
        if (ticks >= maxTicks) {
          clearInterval(tickInterval);
          cells.forEach((c, row) => {
            if(c) { c.textContent = finalSymbols[row]; c.classList.remove('spinning'); }
          });
          resolve();
        }
      }, 60);
    }, delay);
  });
}
 
let slotsSpinning = false;
 
async function spinSlots() {
  if (!user || slotsSpinning) return;
  slotsSpinning = true;
  const btn = document.getElementById('slots-btn');
  btn.disabled = true;
  document.getElementById('slots-result').innerHTML = '';
  document.getElementById('slots-winlines').innerHTML = '';
  clearGridHighlights();
 
  const betAmt = getSlotsCustomBet();
 
  try {
    const data = await apiPost('/api/slots', { bet: betAmt });
 
    // Animate each reel with stagger
    const reelPromises = [];
    for (let r = 0; r < 5; r++) {
      const finalCol = [data.grid[r][0], data.grid[r][1], data.grid[r][2]];
      reelPromises.push(animateReel(r, finalCol, r * 120, 400 + r * 100));
    }
    await Promise.all(reelPromises);
 
    // Highlight expanded wilds
    if (data.expandedReels && data.expandedReels.length > 0) {
      await new Promise(r => setTimeout(r, 120));
      data.expandedReels.forEach(reel => {
        for (let row = 0; row < 3; row++) setGridSymbol(reel, row, '🎲', ['wild-flash']);
      });
      await new Promise(r => setTimeout(r, 350));
    }
 
    // Highlight winning lines
    if (data.winLines && data.winLines.length > 0) {
      const PAYLINES = [
        [1,1,1,1,1],[0,0,0,0,0],[2,2,2,2,2],
        [0,1,2,1,0],[2,1,0,1,2],[0,0,1,2,2],
        [2,2,1,0,0],[1,0,0,0,1],[1,2,2,2,1],[0,1,0,1,0]
      ];
      data.winLines.forEach(wl => {
        const payline = PAYLINES[wl.line - 1];
        for (let r = 0; r < wl.count; r++) {
          const cell = document.getElementById(`sg-${r}-${payline[r]}`);
          if (cell) cell.classList.add('win-cell');
        }
      });
    }
 
    // Scatter highlight
    if (data.scatterCount >= 1) {
      for (let r = 0; r < 5; r++) for (let row = 0; row < 3; row++) {
        if (data.rawGrid[r][row] === '⭐') {
          const cell = document.getElementById(`sg-${r}-${row}`);
          if (cell) cell.classList.add('scatter-cell');
        }
      }
    }
 
    updateUserUI(data.newBalance);
 
    // Result text
    const res = document.getElementById('slots-result');
    if (data.totalWin > 0) {
      res.innerHTML = `<span class="win-text">+${fmtNum(data.totalWin)} ST won!</span>`;
      document.getElementById('slot-grid-5x3').classList.add('game-win');
      setTimeout(()=>document.getElementById('slot-grid-5x3').classList.remove('game-win'), 800);
    } else {
      res.innerHTML = `<span class="lose-text">No win — spin again</span>`;
    }
 
    // Win lines breakdown
    const wlEl = document.getElementById('slots-winlines');
    const lines = [];
    if (data.winLines && data.winLines.length > 0) {
      data.winLines.forEach(wl => lines.push(`Line ${wl.line}: ${wl.symbol.repeat(wl.count)} — ×${wl.multiplier} = +${fmtNum(wl.win)} ST`));
    }
    if (data.scatterWin > 0) {
      lines.push(`Scatter ×${data.scatterCount}: +${fmtNum(data.scatterWin)} ST`);
    }
    wlEl.innerHTML = lines.map(l=>`<div class="wl-row">${l}</div>`).join('');
 
    // Bonus round
    if (data.bonusTriggered) {
      setTimeout(() => openBonusGame(betAmt), 1000);
    }
 
  } catch(e) { showError('slots-result', e.message); }
 
  slotsSpinning = false;
  btn.disabled = false;
}
 
// ── Bonus Game (pick-3 boxes) ─────────────────────────────
function openBonusGame(originalBet) {
  const modal = document.getElementById('bonus-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  let chosen = 0;
  const multipliers = shuffle([2, 3, 5, 8, 15, 1, 2, 3, 1]);
  const picks = [];
  document.getElementById('bonus-title').textContent = '⭐ BONUS ROUND! Pick 3 boxes';
  document.getElementById('bonus-result').textContent = '';
  const boxes = document.querySelectorAll('.bonus-box');
  boxes.forEach((box, i) => {
    box.className = 'bonus-box';
    box.textContent = '?';
    box.onclick = () => {
      if (box.classList.contains('revealed') || chosen >= 3) return;
      box.classList.add('revealed');
      box.textContent = multipliers[i] + '×';
      picks.push(multipliers[i]);
      chosen++;
      if (chosen === 3) {
        const total = picks.reduce((a,b)=>a+b, 0);
        const prize = Math.floor(originalBet * total);
        apiPost('/api/balance/add', {amount: prize}).then(d => {
          updateUserUI(d.newBalance);
          document.getElementById('bonus-result').innerHTML =
            `<span class="win-text">🎉 Bonus: +${fmtNum(prize)} ST (${picks.join('+')} = ${total}× your bet)!</span>`;
          document.getElementById('bonus-close').classList.remove('hidden');
          boxes.forEach((b,j) => { if(!b.classList.contains('revealed')){ b.classList.add('dim'); b.textContent=multipliers[j]+'×'; }});
        }).catch(()=>{});
      }
    };
  });
  document.getElementById('bonus-close').classList.add('hidden');
  document.getElementById('bonus-close').onclick = () => modal.classList.add('hidden');
}
 
function shuffle(arr){ const a=[...arr]; for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }
 
// ── BLACKJACK ────────────────────────────────────────────
const SUITS=['♠','♥','♦','♣'],RANKS=['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
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
  if(!user)return;
  const deck=[];SUITS.forEach(s=>RANKS.forEach(r=>deck.push({suit:s,rank:r})));
  for(let i=deck.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]];}
  const player=[deck.pop(),deck.pop()],dealer=[deck.pop(),deck.pop()];
  try{await apiPost('/api/balance/deduct',{amount:bets.bj});user.balance-=bets.bj;updateUserUI();}
  catch(e){showError('bj-result',e.message);return;}
  bjState={player,dealer,deck,bet:bets.bj,over:false};
  renderHand('player-hand',player);renderHand('dealer-hand',dealer,true);
  document.getElementById('player-score').textContent=handScore(player);
  document.getElementById('dealer-score').textContent='?';
  document.getElementById('bj-result').textContent='';
  if(handScore(player)===21){await settleBJ('blackjack');return;}
  document.getElementById('bj-actions').innerHTML=`<button class="bj-btn hit-btn" onclick="bjHit()">HIT</button><button class="bj-btn stand-btn" onclick="bjStand()">STAND</button>`;
}
function bjHit(){
  if(!bjState||bjState.over)return;
  bjState.player.push(bjState.deck.pop());renderHand('player-hand',bjState.player);
  const ps=handScore(bjState.player);document.getElementById('player-score').textContent=ps;
  if(ps>21)settleBJ('bust');else if(ps===21)bjStand();
}
async function bjStand(){
  if(!bjState||bjState.over)return;
  renderHand('dealer-hand',bjState.dealer);document.getElementById('dealer-score').textContent=handScore(bjState.dealer);
  while(handScore(bjState.dealer)<17){bjState.dealer.push(bjState.deck.pop());renderHand('dealer-hand',bjState.dealer);document.getElementById('dealer-score').textContent=handScore(bjState.dealer);}
  const ds=handScore(bjState.dealer),ps=handScore(bjState.player);
  if(ds>21||ps>ds)settleBJ('win');else if(ps===ds)settleBJ('push');else settleBJ('lose');
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
  renderHand('dealer-hand',bjState.dealer);document.getElementById('dealer-score').textContent=handScore(bjState.dealer);
  const res=document.getElementById('bj-result');res.textContent=msg;res.style.color=payout>0?'var(--gold)':'var(--red)';
  document.getElementById('bj-actions').innerHTML=`<button class="bj-btn deal-btn" onclick="dealBlackjack()">DEAL AGAIN</button>`;
}
 
// ── ROULETTE ─────────────────────────────────────────────
const R_NUMS=[0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
const R_COLORS={};
R_NUMS.forEach(n=>R_COLORS[n]='black');
[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36].forEach(n=>R_COLORS[n]='red');
R_COLORS[0]='green';
let rouletteAngle=0;
 
function drawRouletteWheel(angle=0){
  const canvas=document.getElementById('roulette-canvas');if(!canvas)return;
  const ctx=canvas.getContext('2d'),cx=150,cy=150,r=140,arc=(2*Math.PI)/R_NUMS.length;
  ctx.clearRect(0,0,300,300);
  R_NUMS.forEach((num,i)=>{
    const start=angle+i*arc-Math.PI/2,end=start+arc;
    ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,r,start,end);ctx.closePath();
    ctx.fillStyle=R_COLORS[num]==='red'?'#c0392b':R_COLORS[num]==='green'?'#27ae60':'#1a1a1a';
    ctx.fill();ctx.strokeStyle='rgba(255,255,255,0.05)';ctx.lineWidth=0.5;ctx.stroke();
    ctx.save();ctx.translate(cx,cy);ctx.rotate(start+arc/2);ctx.translate(r*0.72,0);
    ctx.rotate(Math.PI/2);ctx.fillStyle='#fff';ctx.font='bold 9px DM Mono,monospace';
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(num,0,0);ctx.restore();
  });
  ctx.beginPath();ctx.arc(cx,cy,18,0,Math.PI*2);ctx.fillStyle='#111';ctx.fill();ctx.strokeStyle='var(--gold)';ctx.lineWidth=2;ctx.stroke();
  rouletteAngle=angle;
}
 
function setRouletteBet(type,btn){
  rouletteBet=type;
  document.querySelectorAll('.rb-btn').forEach(b=>b.classList.remove('selected'));btn.classList.add('selected');
  const labels={red:'Red ×2',black:'Black ×2',green:'Green ×14',low:'1–18 ×2',high:'19–36 ×2',odd:'Odd ×2',even:'Even ×2'};
  document.getElementById('roulette-selection').textContent='Selected: '+labels[type];
}
 
async function spinRoulette(){
  if(!rouletteBet){alert('Select a bet type first!');return;}
  const btn=document.getElementById('roulette-btn');btn.disabled=true;document.getElementById('roulette-result').textContent='';
  try{
    const data=await apiPost('/api/roulette',{bet:bets.roulette,betType:rouletteBet});
    const targetIdx=R_NUMS.indexOf(data.number),arcSize=2*Math.PI/R_NUMS.length;
    const targetAngle=-(targetIdx*arcSize),totalRotation=Math.PI*14+targetAngle;
    const startAngle=rouletteAngle,duration=4000,startTime=performance.now();
    function easeOut(t){return 1-Math.pow(1-t,4);}
    function frame(now){
      const elapsed=now-startTime,progress=Math.min(elapsed/duration,1),eased=easeOut(progress);
      drawRouletteWheel(startAngle+totalRotation*eased);
      if(progress<1){requestAnimationFrame(frame);}
      else{
        drawRouletteWheel(startAngle+totalRotation);
        updateUserUI(data.newBalance);
        const res=document.getElementById('roulette-result');
        res.textContent=data.won?`${data.number} ${data.color.toUpperCase()} — +${fmtNum(data.payout)} ST`:`${data.number} ${data.color.toUpperCase()} — No win`;
        res.style.color=data.won?'var(--gold)':'var(--red)';
        btn.disabled=false;
      }
    }
    requestAnimationFrame(frame);
  }catch(e){showError('roulette-result',e.message);btn.disabled=false;}
}
 
// ── COINFLIP ─────────────────────────────────────────────
function selectCoin(c){
  coinChoice=c;
  document.getElementById('cf-heads').classList.toggle('selected',c==='heads');
  document.getElementById('cf-tails').classList.toggle('selected',c==='tails');
}
async function flipCoin(){
  if(!coinChoice){alert('Choose heads or tails!');return;}
  const btn=document.getElementById('cf-btn');btn.disabled=true;document.getElementById('cf-result').textContent='';
  const coin=document.getElementById('coin');coin.classList.add('flipping');
  try{
    const data=await apiPost('/api/coinflip',{bet:bets.cf,choice:coinChoice});
    setTimeout(()=>{
      coin.classList.remove('flipping');updateUserUI(data.newBalance);
      const res=document.getElementById('cf-result');
      res.textContent=data.won?`✓ ${data.result.toUpperCase()} — +${fmtNum(data.payout)} ST`:`✗ ${data.result.toUpperCase()} — Better luck next flip`;
      res.style.color=data.won?'var(--gold)':'var(--red)';btn.disabled=false;
    },1100);
  }catch(e){coin.classList.remove('flipping');showError('cf-result',e.message);btn.disabled=false;}
}
 
// ── CRASH ─────────────────────────────────────────────────
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
  const progress=Math.min((m-1)/9,1),ex=w*progress,ey=h-(h*Math.pow(progress,0.6));
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
  try{
    const data=await apiPost('/api/crash/start',{bet:bets.crash});
    user.balance=data.newBalance;updateUserUI();
    crashCrashPoint=data.crashPoint;crashMultiplier=1.0;crashBetActive=true;crashCashedOut=false;
    const mult=document.getElementById('crash-multiplier');mult.classList.remove('crashed');
    btn.classList.add('hidden');cashBtn.classList.remove('hidden');
    crashInterval=setInterval(()=>{
      crashMultiplier+=0.01*(1+crashMultiplier*0.05);mult.textContent=crashMultiplier.toFixed(2)+'×';drawCrashLine(crashMultiplier);
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
  }catch(e){showError('crash-result',e.message);btn.disabled=false;}
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
  plinkoCanvas=document.getElementById('plinko-canvas');if(!plinkoCanvas)return;
  plinkoCtx=plinkoCanvas.getContext('2d');buildPlinkoLayout();drawPlinkoStatic();
}
function buildPlinkoLayout(){
  plinkoPegs=[];const W=500,H=400,topPad=40,pegR=5;
  for(let row=0;row<PLINKO_ROWS;row++){
    const cols=row+3,spacing=W/(cols+1);
    for(let col=0;col<cols;col++) plinkoPegs.push({x:spacing*(col+1)+(W-(spacing*(cols+1)))/2+spacing*0,y:topPad+(row*(H-80-topPad)/(PLINKO_ROWS-1)),r:pegR,row,col});
  }
  const bw=W/PLINKO_MULTIPLIERS.length;
  plinkoBuckets=PLINKO_MULTIPLIERS.map((m,i)=>({x:i*bw,w:bw,mult:m,y:H-40}));
}
function drawPlinkoStatic(hi=-1){
  if(!plinkoCtx)return;
  const ctx=plinkoCtx,W=500,H=400;ctx.clearRect(0,0,W,H);
  plinkoPegs.forEach(p=>{ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fillStyle='rgba(201,168,76,0.6)';ctx.fill();});
  plinkoBuckets.forEach((b,i)=>{
    const isHigh=b.mult>=5,isMid=b.mult>=1,col=isHigh?'rgba(201,168,76,0.8)':isMid?'rgba(61,186,110,0.6)':'rgba(232,228,220,0.2)';
    ctx.fillStyle=i===hi?'rgba(201,168,76,0.95)':col;ctx.fillRect(b.x+1,b.y,b.w-2,30);
    ctx.fillStyle=i===hi?'#000':'#fff';ctx.font='bold 10px DM Mono,monospace';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(b.mult+'×',b.x+b.w/2,b.y+15);
  });
}
function computePlinkPath(finalBucket){
  const W=500,H=400,topPad=40,path=[];let x=250,y=15;path.push({x,y});
  const bucketCenterX=plinkoBuckets[finalBucket].x+plinkoBuckets[finalBucket].w/2;
  for(let row=0;row<PLINKO_ROWS;row++){
    const rowPegs=plinkoPegs.filter(p=>p.row===row);if(!rowPegs.length)continue;
    const pegY=rowPegs[0].y,nearest=rowPegs.reduce((a,b)=>Math.abs(b.x-x)<Math.abs(a.x-x)?b:a);
    const steps=8;for(let s=1;s<=steps;s++) path.push({x:x+(nearest.x-x)*(s/steps),y:y+(pegY-y)*(s/steps)});
    const goRight=bucketCenterX>nearest.x?0.65:0.35;x=nearest.x+(Math.random()<goRight?18:-18);y=pegY;
  }
  const bucketY=H-25,steps=10;
  for(let s=1;s<=steps;s++) path.push({x:x+(bucketCenterX-x)*(s/steps),y:y+(bucketY-y)*(s/steps)});
  return path;
}
function animatePlinkoball(path,onDone){
  if(!plinkoCtx)return;let step=0;
  function frame(){drawPlinkoStatic();if(step>=path.length){onDone();return;}
    const pt=path[step];plinkoCtx.beginPath();plinkoCtx.arc(pt.x,pt.y,8,0,Math.PI*2);
    plinkoCtx.fillStyle='var(--gold)';plinkoCtx.fill();step++;requestAnimationFrame(frame);}
  requestAnimationFrame(frame);
}
async function dropPlinko(){
  if(!user)return;const btn=document.getElementById('plinko-btn');btn.disabled=true;document.getElementById('plinko-result').textContent='';
  try{
    const data=await apiPost('/api/plinko',{bet:bets.plinko});
    const path=computePlinkPath(data.bucketIndex);
    animatePlinkoball(path,()=>{
      drawPlinkoStatic(data.bucketIndex);updateUserUI(data.newBalance);
      const res=document.getElementById('plinko-result');
      res.innerHTML=data.won?`<span class="win-text">${data.multiplier}× — +${fmtNum(data.payout)} ST</span>`:`<span class="lose-text">${data.multiplier}× — Lost ${fmtNum(bets.plinko)} ST</span>`;
      btn.disabled=false;
    });
  }catch(e){showError('plinko-result',e.message);btn.disabled=false;}
}
 
// ══════════════════════════════════════════════════════════
// HI-LO — fully server-authoritative
// Cards and results come from server. Client just displays.
// ══════════════════════════════════════════════════════════
let hiloActive = false;
let hiloLastMult = 1.0;
let hiloBet = 50;
 
function getHiloBet() {
  const input = document.getElementById('hilo-custom-bet');
  const val = parseInt(input ? input.value : 50, 10);
  if (isNaN(val) || val < 10) return 10;
  if (user && val > user.balance) return user.balance;
  return val;
}
 
function renderHiloCard(card) {
  const face = document.getElementById('hilo-card-face');
  const suit = document.getElementById('hilo-card-suit');
  const el   = document.getElementById('hilo-card');
  el.classList.remove('red','black');
  if (!card || card.rank === '?') { face.textContent = '?'; suit.textContent = ''; return; }
  face.textContent = card.rank;
  suit.textContent = card.suit;
  el.classList.add(['♥','♦'].includes(card.suit) ? 'red' : 'black');
}
 
function flipHiloCard(card, cb) {
  const el = document.getElementById('hilo-card');
  el.classList.add('flip');
  setTimeout(() => { el.classList.remove('flip'); renderHiloCard(card); if(cb) cb(); }, 220);
}
 
async function startHilo() {
  if (!user) return;
  hiloBet = getHiloBet();
  const btn = document.getElementById('hilo-start-btn');
  btn.disabled = true;
  document.getElementById('hilo-result').textContent = '';
  try {
    const data = await apiPost('/api/hilo/start', { bet: hiloBet });
    updateUserUI(data.newBalance);
    hiloActive = true;
    hiloLastMult = 1.0;
    flipHiloCard(data.card);
    document.getElementById('hilo-streak').textContent = '0';
    document.getElementById('hilo-mult').textContent = '1.00×';
    document.getElementById('hilo-potential').textContent = fmtNum(hiloBet) + ' ST';
    document.getElementById('hilo-higher').disabled = false;
    document.getElementById('hilo-lower').disabled  = false;
    document.getElementById('hilo-cashout').style.display = 'none';
    btn.textContent = 'New Game';
    btn.disabled = false;
    btn.onclick = startHilo;
  } catch(e) { showError('hilo-result', e.message); btn.disabled = false; }
}
 
async function hiloGuess(dir) {
  if (!hiloActive) return;
  document.getElementById('hilo-higher').disabled = true;
  document.getElementById('hilo-lower').disabled  = true;
  try {
    const data = await apiPost('/api/hilo/guess', { direction: dir });
    const res = document.getElementById('hilo-result');
    if (data.correct) {
      hiloLastMult = data.mult;
      flipHiloCard(data.newCard, () => {
        document.getElementById('hilo-streak').textContent = data.streak;
        document.getElementById('hilo-mult').textContent = data.mult.toFixed(2) + '×';
        document.getElementById('hilo-potential').textContent = fmtNum(Math.floor(hiloBet * data.mult)) + ' ST';
        res.innerHTML = `<span style="color:var(--green)">✓ Correct! Keep going or cash out.</span>`;
        document.getElementById('hilo-higher').disabled = false;
        document.getElementById('hilo-lower').disabled  = false;
        document.getElementById('hilo-cashout').style.display = 'inline-flex';
      });
    } else {
      hiloActive = false;
      flipHiloCard(data.newCard, () => {
        res.innerHTML = `<span style="color:var(--red)">✗ Wrong! Lost ${fmtNum(data.bet)} ST</span>`;
        document.getElementById('hilo-cashout').style.display = 'none';
        document.getElementById('hilo-start-btn').textContent = 'Deal Card';
        document.getElementById('hilo-start-btn').onclick = startHilo;
      });
    }
  } catch(e) { showError('hilo-result', e.message); }
}
 
async function hiloCashout() {
  if (!hiloActive) return;
  document.getElementById('hilo-higher').disabled = true;
  document.getElementById('hilo-lower').disabled  = true;
  document.getElementById('hilo-cashout').style.display = 'none';
  try {
    const data = await apiPost('/api/hilo/cashout', {});
    hiloActive = false;
    updateUserUI(data.newBalance);
    document.getElementById('hilo-result').innerHTML =
      `<span style="color:var(--gold)">Cashed out — +${fmtNum(data.profit)} ST (${data.mult.toFixed(2)}×)!</span>`;
    document.getElementById('hilo-start-btn').textContent = 'Deal Card';
    document.getElementById('hilo-start-btn').onclick = startHilo;
  } catch(e) { showError('hilo-result', e.message); }
}
 
// ── DAILY ─────────────────────────────────────────────────
async function loadDailyStatus(){
  try{
    const data=await fetch('/api/daily/status').then(r=>r.json());
    document.getElementById('streak-count').textContent=data.streak+' days';
    const reward=250+data.streak*50;document.getElementById('reward-amount').textContent='+'+fmtNum(reward)+' ST';
    const btn=document.getElementById('daily-btn');
    if(!data.canClaim){
      const ms=data.nextClaimAt-Date.now(),hrs=Math.floor(ms/3600000),mins=Math.floor((ms%3600000)/60000);
      btn.disabled=true;btn.textContent=`Come back in ${hrs}h ${mins}m`;
      document.getElementById('daily-result').innerHTML=`<span style="color:var(--muted)">Already claimed today</span>`;
    }else{btn.disabled=false;btn.textContent='CLAIM REWARD';}
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
 
// ── PROFILE ───────────────────────────────────────────────
async function loadProfile(){
  if(!user)return;
  document.getElementById('profile-name').textContent=user.username;
  document.getElementById('profile-balance').textContent=fmtNum(user.balance)+' ST';
  document.getElementById('profile-streak').textContent='🔥 '+(user.streak||0)+' day streak';
  const av=document.getElementById('profile-avatar');
  av.src=user.avatar?`https://cdn.discordapp.com/avatars/${user.discord_id}/${user.avatar}.png?size=128`:'https://cdn.discordapp.com/embed/avatars/0.png';
  try{
    const stats=await fetch('/api/stats').then(r=>r.json());
    const grid=document.getElementById('stats-grid');
    if(!stats.length){grid.innerHTML='<div class="stat-card-loading">No games played yet — go try your luck!</div>';return;}
    grid.innerHTML='';
    stats.forEach(s=>{
      const card=document.createElement('div');card.className='stat-card';const net=s.net||0;
      card.innerHTML=`<div class="stat-game">${s.type}</div><div class="stat-plays">${s.plays} plays</div><div class="stat-detail">${s.wins} wins · ${s.plays>0?Math.round(s.wins/s.plays*100):0}% win rate</div><div class="stat-net ${net>=0?'pos':'neg'}">${net>=0?'+':''}${fmtNum(net)} ST net</div>`;
      grid.appendChild(card);
    });
    const total=stats.reduce((a,s)=>({plays:a.plays+s.plays,wins:a.wins+s.wins,net:a.net+s.net}),{plays:0,wins:0,net:0});
    const sum=document.createElement('div');sum.className='stat-card';
    sum.innerHTML=`<div class="stat-game" style="color:var(--gold)">ALL GAMES</div><div class="stat-plays">${total.plays} total</div><div class="stat-detail">${total.wins} wins overall</div><div class="stat-net ${total.net>=0?'pos':'neg'}">${total.net>=0?'+':''}${fmtNum(total.net)} ST total</div>`;
    grid.prepend(sum);
  }catch(e){}
  try{
    const hist=await fetch('/api/history').then(r=>r.json());
    const list=document.getElementById('profile-history-list');
    if(!hist.length){list.innerHTML='<div class="ph-row"><div style="color:var(--muted);font-size:12px">No activity yet</div></div>';return;}
    list.innerHTML='';
    hist.forEach(h=>{
      const row=document.createElement('div');row.className='ph-row';
      row.innerHTML=`<div class="ph-game">${h.type}</div><div class="ph-amount ${h.amount>=0?'pos':'neg'}">${h.amount>=0?'+':''}${fmtNum(h.amount)} ST</div><div class="ph-time">${timeAgo(h.created_at)}</div>`;
      list.appendChild(row);
    });
  }catch(e){}
}
function timeAgo(ts){const diff=Date.now()-ts;if(diff<60000)return 'just now';if(diff<3600000)return Math.floor(diff/60000)+'m ago';if(diff<86400000)return Math.floor(diff/3600000)+'h ago';return Math.floor(diff/86400000)+'d ago';}
 
// ── LEADERBOARD ───────────────────────────────────────────
async function loadLeaderboard(){
  const list=document.getElementById('leaderboard-list');list.innerHTML='<div class="lb-loading">Loading...</div>';
  try{
    const data=await fetch('/api/leaderboard').then(r=>r.json());list.innerHTML='';
    const medals=['🥇','🥈','🥉'];
    data.forEach((u,i)=>{
      const row=document.createElement('div');row.className='lb-row'+(i<3?' top'+(i+1):'')+(u.discord_id===user?.discord_id?' me':'');
      row.innerHTML=`<div class="lb-rank">${i<3?medals[i]:i+1}</div><img class="lb-avatar" src="${u.avatar?`https://cdn.discordapp.com/avatars/${u.discord_id}/${u.avatar}.png?size=32`:'https://cdn.discordapp.com/embed/avatars/0.png'}" alt=""><div class="lb-username">${u.username}</div><div class="lb-balance">${fmtNum(u.balance)} ST</div>`;
      list.appendChild(row);
    });
  }catch(e){list.innerHTML='<div class="lb-loading">Failed to load</div>';}
}
 
function showError(id,msg){const el=document.getElementById(id);if(el)el.innerHTML=`<span style="color:var(--red)">${msg}</span>`;}
 
init();
