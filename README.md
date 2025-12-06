# GitHub Stats Generator

A serverless GitHub statistics dashboard that displays your contribution metrics and activity graph.

## Features

- Real-time contribution data from GitHub API
- Current and longest streak tracking
- 90-day activity graph
- Auto-updating every 4 hours
- Automatic dark/light theme switching

## Setup

1. **Install dependencies**

```bash
   npm install
```

2. **Get GitHub Token (recommended)**

   - Go to https://github.com/settings/tokens
   - Generate new token (classic)
   - Select `read:user` scope
   - Copy the token

3. **Deploy to Vercel**

```bash
   npm i -g vercel
   vercel
```

4. **Add environment variable**
   - Go to Vercel Dashboard → Your Project → Settings → Environment Variables
   - Add: `GITHUB_TOKEN` with your token value
   - Redeploy

## Usage

```
https://your-project.vercel.app/api/stats?username=YOUR_USERNAME
```

### Add to GitHub README

```markdown
![GitHub Stats](https://your-project.vercel.app/api/stats?username=YOUR_USERNAME)
```

## Troubleshooting

If you get a 404 error:

- Ensure `api/stats.js` is in the correct location
- Check URL format: `/api/stats?username=...`
- Verify deployment logs in Vercel dashboard

## How It Works

- Fetches data from GitHub GraphQL API
- Calculates streaks by analyzing contribution history
- Generates SVG with embedded CSS for theme switching
- Caches for 4 hours to reduce API calls

## Rate Limits

- Without token: 60 requests/hour
- With token: 5,000 requests/hour
