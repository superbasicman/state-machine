# Agent State Machine - Remote Follow Server

This is the Vercel-hosted server that enables remote follow and interaction for Agent State Machine workflows.

## Features

- Real-time workflow event streaming to browsers
- Remote interaction submission from any browser
- Session-based authentication via URL tokens
- Auto-expiring sessions (30 minutes of inactivity)

## Setup

### 1. Create Upstash Redis Database

1. Go to [Upstash Console](https://console.upstash.com/)
2. Create a new Redis database
3. Copy the REST URL and REST Token

### 2. Deploy to Vercel

```bash
# Install Vercel CLI if you haven't already
npm i -g vercel

# Navigate to vercel-server directory
cd vercel-server

# Install dependencies
npm install

# Deploy to Vercel
vercel

# Set environment variables in Vercel dashboard:
# - UPSTASH_REDIS_REST_URL
# - UPSTASH_REDIS_REST_TOKEN
```

### 3. Configure the CLI

Set the .env STATE_MACHINE_REMOTE_URL to the URL of your Vercel deployment.

Defaults to localhost:3001 if none set.

## Usage

Run a workflow with remote follow enabled:

```bash
state-machine run my-workflow --remote
```

The CLI will print a unique URL that anyone can use to:
- View live workflow events
- Submit interaction responses

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/s/{token}` | GET | Session UI page |
| `/api/events/{token}` | GET (SSE) | Real-time event stream |
| `/api/history/{token}` | GET | Get session history |
| `/api/submit/{token}` | POST | Submit interaction response |
| `/api/ws/cli` | POST | CLI event submission |
| `/api/ws/cli?token={token}` | GET | CLI long-poll for interactions |

## Architecture

```
CLI (Node.js)              Vercel (Serverless + Redis)           Browser
     │                              │                               │
     │──── HTTP POST ──────────────►│◄───── SSE ────────────────────│
     │     (events, history)        │       (events, status)        │
     │                              │                               │
     │◄──── Long-poll ─────────────►│◄───── POST ───────────────────│
     │     (interaction response)   │       (submit interaction)    │
```

- CLI sends events via HTTP POST to `/api/ws/cli`
- CLI polls for interaction responses via GET `/api/ws/cli?token=...`
- Browsers connect via SSE to `/api/events/{token}`
- Browsers submit interactions via POST to `/api/submit/{token}`
- Redis stores session state and acts as message broker

## Security

- Session tokens are 32 bytes of cryptographic randomness (base64url encoded)
- Sessions expire after 30 minutes of inactivity
- Interaction responses are validated and size-limited (1MB max)
- All connections use HTTPS
