#!/usr/bin/env node

/**
 * Local development server for testing remote follow
 * Uses in-memory storage instead of Redis
 *
 * Usage:
 *   node vercel-server/local-server.js
 *
 * Or import and start programmatically:
 *   import { startLocalServer } from './vercel-server/local-server.js';
 *   const { port, url } = await startLocalServer();
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3001;

// In-memory session storage
const sessions = new Map();
let latestSessionToken = null;

// SSE clients per session
const sseClients = new Map(); // token -> Set<res>

/**
 * Get or create a session
 */
function getSession(token) {
  return sessions.get(token);
}

function createSession(token, data) {
  const session = {
    workflowName: data.workflowName,
    cliConnected: true,
    history: data.history || [],
    pendingInteractions: [],
    createdAt: Date.now(),
  };
  sessions.set(token, session);
  latestSessionToken = token;
  return session;
}

/**
 * Broadcast event to all SSE clients for a session
 */
function broadcastToSession(token, event) {
  const clients = sseClients.get(token);
  if (!clients) return;

  const data = JSON.stringify(event);
  for (const client of clients) {
    try {
      client.write(`data: ${data}\n\n`);
    } catch (e) {
      clients.delete(client);
    }
  }
}

/**
 * Parse request body
 */
async function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

/**
 * Parse URL and query params
 */
function parseUrl(req) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  return {
    pathname: url.pathname,
    query: Object.fromEntries(url.searchParams),
  };
}

/**
 * Send JSON response
 */
function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

/**
 * Handle CLI POST requests
 */
async function handleCliPost(req, res) {
  const body = await parseBody(req);
  const { sessionToken } = body;
  // Support both _action (new) and type (legacy) for message routing
  const action = body._action || body.type;

  if (!sessionToken) {
    return sendJson(res, 400, { error: 'Missing sessionToken' });
  }

  switch (action) {
    case 'session_init': {
      const { workflowName, history } = body;
      createSession(sessionToken, { workflowName, history });

      broadcastToSession(sessionToken, {
        type: 'cli_connected',
        workflowName,
      });

      // Send history to any connected browsers
      if (history && history.length > 0) {
        broadcastToSession(sessionToken, {
          type: 'history',
          entries: history,
        });
      }

      return sendJson(res, 200, { success: true });
    }

    case 'event': {
      const session = getSession(sessionToken);
      if (!session) {
        return sendJson(res, 404, { error: 'Session not found' });
      }

      const { timestamp, event, ...eventData } = body;
      const historyEvent = {
        timestamp: timestamp || new Date().toISOString(),
        event,
        ...eventData,
      };
      delete historyEvent.sessionToken;
      delete historyEvent._action;  // Remove routing field, preserve type (interaction type)

      // Add to history
      session.history.unshift(historyEvent);

      // Broadcast to browsers
      broadcastToSession(sessionToken, {
        type: 'event',
        ...historyEvent,
      });

      return sendJson(res, 200, { success: true });
    }

    case 'session_end': {
      const session = getSession(sessionToken);
      if (session) {
        session.cliConnected = false;
        broadcastToSession(sessionToken, {
          type: 'cli_disconnected',
          reason: body.reason,
        });
      }
      return sendJson(res, 200, { success: true });
    }

    default:
      return sendJson(res, 400, { error: `Unknown action: ${action}` });
  }
}

/**
 * Handle CLI GET (long-poll for interactions)
 */
async function handleCliGet(req, res, query) {
  const { token, timeout = '30000' } = query;

  if (!token) {
    return sendJson(res, 400, { error: 'Missing token' });
  }

  const session = getSession(token);
  if (!session) {
    return sendJson(res, 404, { error: 'Session not found' });
  }

  const timeoutMs = Math.min(parseInt(timeout, 10), 55000);
  const startTime = Date.now();

  // Poll for pending interactions
  const checkInterval = setInterval(() => {
    if (session.pendingInteractions.length > 0) {
      clearInterval(checkInterval);
      const interaction = session.pendingInteractions.shift();
      return sendJson(res, 200, {
        type: 'interaction_response',
        ...interaction,
      });
    }

    if (Date.now() - startTime >= timeoutMs) {
      clearInterval(checkInterval);
      res.writeHead(204);
      res.end();
    }
  }, 500);

  // Clean up on client disconnect
  req.on('close', () => {
    clearInterval(checkInterval);
  });
}

/**
 * Handle SSE events endpoint for browsers
 */
function handleEventsSSE(req, res, token) {
  const session = getSession(token);
  if (!session) {
    return sendJson(res, 404, { error: 'Session not found' });
  }

  // Set up SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  res.write('retry: 3000\n\n');

  // Send initial status
  res.write(`data: ${JSON.stringify({
    type: 'status',
    cliConnected: session.cliConnected,
    workflowName: session.workflowName,
  })}\n\n`);

  // Send existing history
  res.write(`data: ${JSON.stringify({
    type: 'history',
    entries: session.history,
  })}\n\n`);

  // Add to SSE clients
  if (!sseClients.has(token)) {
    sseClients.set(token, new Set());
  }
  sseClients.get(token).add(res);

  // Keepalive
  const keepalive = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 15000);

  // Clean up on disconnect
  req.on('close', () => {
    clearInterval(keepalive);
    const clients = sseClients.get(token);
    if (clients) {
      clients.delete(res);
    }
  });
}

/**
 * Handle history GET
 */
function handleHistoryGet(res, token) {
  const session = getSession(token);
  if (!session) {
    return sendJson(res, 404, { error: 'Session not found' });
  }

  return sendJson(res, 200, {
    workflowName: session.workflowName,
    cliConnected: session.cliConnected,
    entries: session.history,
  });
}

/**
 * Handle interaction submit POST
 */
async function handleSubmitPost(req, res, token) {
  const session = getSession(token);
  if (!session) {
    return sendJson(res, 404, { error: 'Session not found' });
  }

  if (!session.cliConnected) {
    return sendJson(res, 503, { error: 'CLI is disconnected' });
  }

  const body = await parseBody(req);
  const { slug, targetKey, response } = body;

  if (!slug || response === undefined || response === null) {
    return sendJson(res, 400, { error: 'Missing slug or response' });
  }

  const responseString = typeof response === 'string' ? response : JSON.stringify(response);

  // Add to pending interactions for CLI to pick up
  session.pendingInteractions.push({
    slug,
    targetKey: targetKey || `_interaction_${slug}`,
    response,
  });

  // Log to history (include answer preview)
  const event = {
    timestamp: new Date().toISOString(),
    event: 'INTERACTION_SUBMITTED',
    slug,
    targetKey: targetKey || `_interaction_${slug}`,
    answer: responseString.substring(0, 200) + (responseString.length > 200 ? '...' : ''),
    source: 'remote',
  };
  session.history.unshift(event);

  // Broadcast to browsers
  broadcastToSession(token, {
    type: 'event',
    ...event,
  });

  return sendJson(res, 200, { success: true });
}

/**
 * Serve session UI
 */
const MASTER_TEMPLATE_PATH = path.join(__dirname, 'public', 'remote', 'index.html');

/**
 * Get session HTML by reading the master template from public/remote/index.html
 */
function getSessionHTML(token, workflowName) {
  try {
    const template = fs.readFileSync(MASTER_TEMPLATE_PATH, 'utf8');
    return template
      .replace(/\{\{SESSION_TOKEN\}\}/g, token)
      .replace(/\{\{WORKFLOW_NAME\}\}/g, workflowName || 'Workflow');
  } catch (err) {
    console.error('Error loading master template:', err);
    return `
      <!DOCTYPE html>
      <html>
        <head><title>Error</title></head>
        <body style="font-family: system-ui; max-width: 600px; margin: 100px auto; text-align: center;">
          <h1>Error loading UI template</h1>
          <p>${err.message}</p>
          <p>Make sure <code>public/remote/index.html</code> exists.</p>
          <p>Build the UI first: <code>cd vercel-server/ui && npm install && npm run build</code></p>
        </body>
      </html>
    `;
  }
}



function serveSessionUI(res, token) {
  const session = getSession(token);

  if (!session) {
    res.writeHead(404, { 'Content-Type': 'text/html' });
    return res.end(`
      <!DOCTYPE html>
      <html>
        <head><title>Session Not Found</title></head>
        <body style="font-family: system-ui; max-width: 600px; margin: 100px auto; text-align: center;">
          <h1>Session Not Found</h1>
          <p>This session has expired or does not exist.</p>
        </body>
      </html>
    `);
  }

  const html = getSessionHTML(token, session.workflowName);
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
}

// getSessionHTML was moved up and updated to read from MASTER_TEMPLATE_PATH

function getDefaultSessionToken() {
  if (latestSessionToken && sessions.has(latestSessionToken)) {
    return latestSessionToken;
  }
  if (sessions.size === 1) {
    return sessions.keys().next().value;
  }
  return null;
}

/**
 * Serve static files
 */
function serveStatic(res, filepath) {
  const fullPath = path.join(__dirname, 'public', filepath);

  if (!fs.existsSync(fullPath)) {
    res.writeHead(404);
    return res.end('Not found');
  }

  const ext = path.extname(fullPath);
  const contentTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
  };

  const content = fs.readFileSync(fullPath);
  res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'text/plain' });
  res.end(content);
}

/**
 * Main request handler
 */
async function handleRequest(req, res) {
  const { pathname, query } = parseUrl(req);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  // Route: CLI endpoint
  if (pathname === '/api/ws/cli') {
    if (req.method === 'POST') {
      return handleCliPost(req, res);
    }
    if (req.method === 'GET') {
      return handleCliGet(req, res, query);
    }
  }

  // Route: Session UI
  const sessionMatch = pathname.match(/^\/s\/([^/]+)$/);
  if (sessionMatch) {
    return serveSessionUI(res, sessionMatch[1]);
  }

  // Route: Events SSE
  const eventsMatch = pathname.match(/^\/api\/events\/([^/]+)$/);
  if (eventsMatch && req.method === 'GET') {
    return handleEventsSSE(req, res, eventsMatch[1]);
  }

  // Route: History
  const historyMatch = pathname.match(/^\/api\/history\/([^/]+)$/);
  if (historyMatch && req.method === 'GET') {
    return handleHistoryGet(res, historyMatch[1]);
  }

  // Route: Submit
  const submitMatch = pathname.match(/^\/api\/submit\/([^/]+)$/);
  if (submitMatch && req.method === 'POST') {
    return handleSubmitPost(req, res, submitMatch[1]);
  }

  // Route: Static files
  if (pathname === '/') {
    const defaultToken = getDefaultSessionToken();
    if (defaultToken) {
      return serveSessionUI(res, defaultToken);
    }
    return serveStatic(res, 'index.html');
  }

  if (pathname === '/index.html') {
    return serveStatic(res, 'index.html');
  }

  if (pathname.startsWith('/remote/')) {
    return serveStatic(res, pathname.slice(1));
  }

  // 404
  res.writeHead(404);
  res.end('Not found');
}

/**
 * Start the local server programmatically
 * @param {number} initialPort - Starting port to try (default 3000)
 * @param {boolean} silent - Suppress console output
 * @returns {Promise<{port: number, url: string, server: http.Server}>}
 */
export function startLocalServer(initialPort = 3000, silent = false) {
  return new Promise((resolve, reject) => {
    let port = initialPort;
    const maxPort = initialPort + 100;

    const tryPort = () => {
      const server = http.createServer(handleRequest);

      server.on('error', (e) => {
        if (e.code === 'EADDRINUSE') {
          if (port < maxPort) {
            port++;
            tryPort();
          } else {
            reject(new Error(`Could not find open port between ${initialPort} and ${maxPort}`));
          }
        } else {
          reject(e);
        }
      });

      server.listen(port, () => {
        const url = `http://localhost:${port}`;
        if (!silent) {
          console.log(`Local server running at ${url}`);
        }
        resolve({ port, url, server });
      });
    };

    tryPort();
  });
}

// Run standalone if executed directly
const isMainModule = process.argv[1] && (
  process.argv[1].endsWith('local-server.js') ||
  process.argv[1].endsWith('local-server')
);

if (isMainModule) {
  const PORT = process.env.PORT || 3000;
  startLocalServer(parseInt(PORT, 10)).then(({ port, url }) => {
    console.log(`
┌─────────────────────────────────────────────────────────────┐
│  Agent State Machine - Local Remote Follow Server           │
├─────────────────────────────────────────────────────────────┤
│  Server running at: ${url.padEnd(37)}│
│                                                             │
│  To test remote follow, run your workflow with:             │
│    state-machine run <workflow-name> --local                │
│                                                             │
│  Press Ctrl+C to stop                                       │
└─────────────────────────────────────────────────────────────┘
`);
  }).catch(err => {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  });
}
