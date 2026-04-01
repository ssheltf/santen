const fs   = require('fs');
const path = require('path');

// ── Database file location ─────────────────────────────────────────────────────
// Priority:
//   1. DB_PATH env var  (set this in your .env to an absolute path anywhere)
//   2. ~/.santen/casino_data.json  (outside the project, survives git pulls)
//   3. Falls back to legacy ./casino_data.json for first-run migration
//
// Set in .env:  DB_PATH=/home/youruser/santen_db/casino_data.json
// ──────────────────────────────────────────────────────────────────────────────
const DB_FILE = process.env.DB_PATH
  || path.join(require('os').homedir(), '.santen', 'casino_data.json');

// Ensure directory exists
const DB_DIR = path.dirname(DB_FILE);
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
  console.log(`[db] Created database directory: ${DB_DIR}`);
}

// ── One-time migration: copy legacy file if new path is empty ─────────────────
const LEGACY = path.join(__dirname, 'casino_data.json');
if (!fs.existsSync(DB_FILE) && fs.existsSync(LEGACY)) {
  try {
    fs.copyFileSync(LEGACY, DB_FILE);
    console.log(`[db] Migrated legacy casino_data.json → ${DB_FILE}`);
  } catch(e) {
    console.warn('[db] Migration failed:', e.message);
  }
}

console.log(`[db] Using database: ${DB_FILE}`);

let _cache = null;
let _dirty = false;

function load() {
  if (_cache) return _cache;
  try { _cache = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { _cache = { users: {}, transactions: [], chat: [] }; }
  if (!_cache.users)        _cache.users = {};
  if (!_cache.transactions) _cache.transactions = [];
  if (!_cache.chat)         _cache.chat = [];
  return _cache;
}

function save() {
  if (!_cache) return;
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(_cache));
  fs.renameSync(tmp, DB_FILE);
  _dirty = false;
}

setInterval(() => { if (_dirty) save(); }, 2000);
process.on('exit',   () => { if (_dirty) save(); });
process.on('SIGINT',  () => { if (_dirty) save(); process.exit(); });
process.on('SIGTERM', () => { if (_dirty) save(); process.exit(); });

function mark() { _dirty = true; }

module.exports = {
  getUser(id) { return load().users[id] || null; },
  upsertUser(id, fields) {
    const d = load();
    if (!d.users[id]) d.users[id] = { discord_id:id, balance:1000, streak:0, last_daily:0, total_wagered:0, total_won:0, games_played:0, biggest_win:0, created_at:Date.now(), ...fields };
    else Object.assign(d.users[id], fields);
    mark(); return d.users[id];
  },
  updateUser(id, fields) {
    const d = load(); if (!d.users[id]) return null;
    Object.assign(d.users[id], fields); mark(); return d.users[id];
  },
  addBalance(id, amount) {
    const d = load(); if (!d.users[id]) return null;
    d.users[id].balance = Math.max(0, (d.users[id].balance||0) + amount);
    mark(); return d.users[id];
  },
  recordBet(id, wagered, payout) {
    const d = load(); const u = d.users[id]; if (!u) return;
    u.total_wagered = (u.total_wagered||0) + wagered;
    u.games_played  = (u.games_played||0)  + 1;
    const profit = payout - wagered;
    if (profit > 0) { u.total_won = (u.total_won||0) + profit; if (profit > (u.biggest_win||0)) u.biggest_win = profit; }
    u.balance = Math.max(0, (u.balance||0) - wagered + payout);
    mark(); return u;
  },
  getLeaderboard(limit=20) {
    return Object.values(load().users).sort((a,b)=>b.balance-a.balance).slice(0,limit);
  },
  logTransaction(id, type, amount, result) {
    const d = load();
    d.transactions.push({ discord_id:id, type, amount, result, created_at:Date.now() });
    if (d.transactions.length > 50000) d.transactions = d.transactions.slice(-50000);
    mark();
  },
  getUserStats(id) {
    const txns = load().transactions.filter(t=>t.discord_id===id);
    const by = {};
    txns.forEach(t=>{
      if(!by[t.type]) by[t.type]={type:t.type,plays:0,wins:0,net:0};
      by[t.type].plays++; if(t.amount>0)by[t.type].wins++; by[t.type].net+=t.amount;
    });
    return Object.values(by);
  },
  getUserHistory(id, limit=50) {
    return load().transactions.filter(t=>t.discord_id===id).slice(-limit).reverse();
  },
  addChatMessage(id, username, avatar, message) {
    const d = load();
    const msg = { id: Date.now()+Math.random(), discord_id:id, username, avatar, message, ts:Date.now() };
    d.chat.push(msg);
    if (d.chat.length > 500) d.chat = d.chat.slice(-500);
    mark(); return msg;
  },
  getRecentChat(limit=80) { return load().chat.slice(-limit); },
  getAllUsers() { return Object.values(load().users); },
  saveNow() { save(); },
  getDbPath() { return DB_FILE; },
};
