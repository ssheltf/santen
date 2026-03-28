# 🎰 SCoins Casino

A full-stack Discord-linked gambling website with fake S Coins currency. Players log in with Discord, their balance syncs with the server, and the Discord bot posts live updates.

---

## ✨ Features

| Category | Details |
|----------|---------|
| **Games** | Slots, Blackjack, Roulette, Coinflip, Crash |
| **Rewards** | Daily claim with streak bonuses (+50 SC/day) |
| **Leaderboard** | Top 20 players ranked by balance |
| **Discord Bot** | `/balance`, `/leaderboard`, `/daily`, `/give`, `/take`, `/stats`, `/casino` |
| **Live Feed** | Big wins & daily claims posted to `#casino-feed` channel |
| **Auth** | Discord OAuth2 login — one account per Discord user |

---

## 🚀 Setup Guide

### Step 1 — Create a Discord Application

1. Go to https://discord.com/developers/applications
2. Click **New Application** → name it "SCoins Casino"
3. Go to **OAuth2** tab:
   - Copy **Client ID** and **Client Secret**
   - Under **Redirects**, add: `http://localhost:3000/auth/discord/callback`
4. Go to **Bot** tab:
   - Click **Add Bot**
   - Copy the **Token**
   - Enable **Server Members Intent** and **Message Content Intent** under Privileged Gateway Intents
5. Invite the bot to your server:
   - Go to **OAuth2 → URL Generator**
   - Scopes: `bot`, `applications.commands`
   - Permissions: `Send Messages`, `Embed Links`, `Read Message History`
   - Copy the generated URL and open it to invite the bot

### Step 2 — Get Your Guild (Server) ID

1. Open Discord → Settings → Advanced → Enable **Developer Mode**
2. Right-click your server name → **Copy Server ID**

### Step 3 — Configure Environment

```bash
# Clone / copy the project folder, then:
cp .env.example .env
```

Edit `.env` and fill in all values:
```
DISCORD_CLIENT_ID=123456789
DISCORD_CLIENT_SECRET=abc123...
DISCORD_BOT_TOKEN=Bot.token.here
DISCORD_GUILD_ID=987654321
DISCORD_REDIRECT_URI=http://localhost:3000/auth/discord/callback
CASINO_URL=http://localhost:3000
SESSION_SECRET=some-very-random-string-here
```

### Step 4 — Install & Run

```bash
# Install dependencies
npm install

# Terminal 1 — Start the web server
npm start

# Terminal 2 — Start the Discord bot
npm run bot
```

Open http://localhost:3000 in your browser. 🎉

---

## 🌐 Deploying to the Internet (optional)

So your Discord friends can access it from anywhere:

### Option A — Railway (easiest, free tier)
1. Push the folder to a GitHub repo
2. Go to https://railway.app → New Project → Deploy from GitHub
3. Add all environment variables in the Railway dashboard
4. Update `DISCORD_REDIRECT_URI` to your Railway URL
5. Update the redirect in Discord dev portal too

### Option B — VPS (DigitalOcean, Linode, etc.)
1. Upload files, run `npm install`
2. Use `pm2` to keep both processes alive:
   ```bash
   npm install -g pm2
   pm2 start server.js --name casino
   pm2 start bot.js --name casino-bot
   pm2 save
   ```
3. Use nginx as a reverse proxy to port 3000

---

## 💬 Discord Bot Commands

| Command | Description | Who |
|---------|-------------|-----|
| `/balance` | Check your SC balance | Everyone |
| `/daily` | Claim daily reward | Everyone |
| `/leaderboard` | Top 10 richest players | Everyone |
| `/stats` | Your gambling stats | Everyone |
| `/casino` | Get casino link | Everyone |
| `/give @user amount` | Give SC to a user | Admins only |
| `/take @user amount` | Remove SC from a user | Admins only |

---

## 🎮 Game Details

| Game | How to Win | Payout |
|------|-----------|--------|
| **Slots** | Match 3 symbols | 2× – 50× bet |
| **Blackjack** | Beat dealer without busting | 2× (2.5× for Blackjack) |
| **Roulette** | Pick color/range | 2× or 14× (green) |
| **Coinflip** | Pick heads or tails | 2× |
| **Crash** | Cash out before crash | Custom multiplier |
| **Daily** | Just show up! | 250 + (streak × 50) SC |

---

## 📁 File Structure

```
scoins-casino/
├── public/
│   ├── index.html    ← Main website
│   ├── style.css     ← Dark luxury styling
│   └── app.js        ← Frontend game logic
├── server.js          ← Express backend + API + OAuth
├── bot.js             ← Discord bot (slash commands)
├── package.json
├── .env.example       ← Copy to .env and fill in
└── README.md
```

Database files created automatically on first run:
- `casino.db` — player balances, transactions
- `sessions.db` — login sessions

---

## ⚠️ Notes

- All currency is **completely fake** — S Coins have no real value
- The crash game's house edge is ~4%
- Slots use weighted symbols (diamonds are rare!)
- Daily streak resets if you miss 2+ days
