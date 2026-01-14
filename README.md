# Questy Discord Security + AI Bot (ONE FILE) - Gemini AI Studio

## ✅ Features
- Discord.js v14
- Slash commands: /ping, /setup
- Auto setup channels + roles
- Verification button (Verified role)
- Owner-only #ai-chat channel (hidden from everyone)
- Owner-only no-prefix admin commands in #ai-chat:
  - hide all channels (confirm YES)
  - unhide all channels
  - lock server (confirm YES)
  - unlock server
  - create 5 text channels named test
  - delete all empty channels (confirm YES)
- Gemini AI Studio (Google Generative AI) optional for chat

## 📦 Install (PC / Termux)
```bash
npm init -y
npm i discord.js dotenv @google/generative-ai
node index.js
```

## 🔑 .env Template
Create `.env` file:
```env
DISCORD_TOKEN=YOUR_BOT_TOKEN
OWNER_ID=YOUR_DISCORD_ID
GEMINI_API_KEY=YOUR_AI_STUDIO_KEY
```

## ⚙️ Discord Developer Portal Settings
Enable:
- Message Content Intent
- Server Members Intent

## 🚀 Run
```bash
node index.js
```
