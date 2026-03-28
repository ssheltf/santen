// db.js — Simple JSON file database, no native modules required
const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'casino_data.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return { users: {}, transactions: [] };
  }
}

function save(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

module.exports = {
  // Get a user by discord_id
  getUser(discord_id) {
    return load().users[discord_id] || null;
  },

  // Create or update a user
  upsertUser(discord_id, fields) {
    const data = load();
    if (!data.users[discord_id]) {
      data.users[discord_id] = {
        discord_id,
        balance: 1000,
        streak: 0,
        last_daily: 0,
        created_at: Date.now(),
        ...fields
      };
    } else {
      Object.assign(data.users[discord_id], fields);
    }
    save(data);
    return data.users[discord_id];
  },

  // Update specific fields
  updateUser(discord_id, fields) {
    const data = load();
    if (!data.users[discord_id]) return null;
    Object.assign(data.users[discord_id], fields);
    save(data);
    return data.users[discord_id];
  },

  // Add/subtract balance
  addBalance(discord_id, amount) {
    const data = load();
    if (!data.users[discord_id]) return null;
    data.users[discord_id].balance += amount;
    save(data);
    return data.users[discord_id];
  },

  // Get top N users by balance
  getLeaderboard(limit = 20) {
    const data = load();
    return Object.values(data.users)
      .sort((a, b) => b.balance - a.balance)
      .slice(0, limit);
  },

  // Log a transaction
  logTransaction(discord_id, type, amount, result) {
    const data = load();
    data.transactions.push({ discord_id, type, amount, result, created_at: Date.now() });
    // Keep last 10000 transactions
    if (data.transactions.length > 10000) data.transactions = data.transactions.slice(-10000);
    save(data);
  },

  // Get stats per game for a user
  getUserStats(discord_id) {
    const data = load();
    const txns = data.transactions.filter(t => t.discord_id === discord_id);
    const byType = {};
    txns.forEach(t => {
      if (!byType[t.type]) byType[t.type] = { type: t.type, plays: 0, wins: 0, net: 0 };
      byType[t.type].plays++;
      if (t.amount > 0) byType[t.type].wins++;
      byType[t.type].net += t.amount;
    });
    return Object.values(byType);
  }
};
