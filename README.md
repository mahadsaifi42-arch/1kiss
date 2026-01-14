# Questy AI + Music Bot (Gemini AI Studio)

## Features
- /setup -> creates:
  - #ai-chat (Owner only)
  - #mod-logs
- /help -> full command list
- Owner NO-PREFIX commands work ANYWHERE in server
- AI replies ONLY inside #ai-chat (Owner only)
- Music commands:
  - /play <song/url>
  - /skip
  - /stop
  - /pause
  - /resume
  - /queue

## Render Environment Variables
Set these in Render:
- DISCORD_TOKEN
- OWNER_ID
- GEMINI_API_KEY

## Install locally
```bash
npm i
node index.js
```

## Notes
Music streaming depends on your hosting. If Render blocks voice/ffmpeg sometimes,
use a VPS/Oracle Cloud for stable music.
