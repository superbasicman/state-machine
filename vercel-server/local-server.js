#!/usr/bin/env node

/**
 * Local development server for testing remote follow
 * Uses in-memory storage instead of Redis
 *
 * Usage:
 *   node vercel-server/local-server.js
 *
 * Then run your workflow with:
 *   STATE_MACHINE_REMOTE_URL=http://localhost:3001 state-machine run my-workflow --remote
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
  const { type, sessionToken } = body;

  if (!sessionToken) {
    return sendJson(res, 400, { error: 'Missing sessionToken' });
  }

  switch (type) {
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
      delete historyEvent.type;

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
      return sendJson(res, 400, { error: `Unknown type: ${type}` });
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

  if (!slug || !response) {
    return sendJson(res, 400, { error: 'Missing slug or response' });
  }

  // Add to pending interactions for CLI to pick up
  session.pendingInteractions.push({
    slug,
    targetKey: targetKey || `_interaction_${slug}`,
    response,
  });

  // Log to history
  const event = {
    timestamp: new Date().toISOString(),
    event: 'INTERACTION_SUBMITTED',
    slug,
    targetKey: targetKey || `_interaction_${slug}`,
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

  // Read the session UI template from api/session/[token].js and extract HTML
  // For simplicity, serve a standalone version
  const html = getSessionHTML(token, session.workflowName);
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
}

/**
 * Get session HTML (inline version for local dev)
 */
function getSessionHTML(token, workflowName) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${workflowName} - Remote Follow</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <style>
    .animate-pulse-slow { animation: pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
  </style>
</head>
<body class="bg-zinc-950 text-zinc-100 min-h-screen">
  <div id="root"></div>
  <script>
    window.SESSION_TOKEN = '${token}';
    window.WORKFLOW_NAME = '${workflowName}';
  </script>
  <script type="text/babel">
    const { useState, useEffect, useRef } = React;

    function StatusBadge({ status }) {
      const colors = {
        connected: 'bg-green-500',
        disconnected: 'bg-red-500',
        connecting: 'bg-yellow-500 animate-pulse-slow',
      };
      const labels = {
        connected: 'Live',
        disconnected: 'CLI Offline',
        connecting: 'Connecting...',
      };
      return (
        <div className="flex items-center gap-2">
          <div className={\`w-2 h-2 rounded-full \${colors[status] || colors.disconnected}\`}></div>
          <span className="text-xs uppercase tracking-wider text-zinc-400">{labels[status] || status}</span>
        </div>
      );
    }

    function CopyButton({ text }) {
      const [copied, setCopied] = useState(false);
      const handleCopy = async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      };
      return (
        <button onClick={handleCopy} className="px-2 py-1 text-xs bg-zinc-700 hover:bg-zinc-600 rounded">
          {copied ? 'Copied!' : 'Copy'}
        </button>
      );
    }

    function JsonView({ data, label }) {
      const [isRaw, setIsRaw] = useState(false);
      const jsonStr = JSON.stringify(data, null, 2);
      return (
        <div className="bg-zinc-800 rounded-lg overflow-hidden">
          <div className="flex justify-between items-center px-3 py-2 bg-zinc-700">
            <span className="text-xs font-medium text-zinc-300">{label}</span>
            <div className="flex gap-2">
              <button onClick={() => setIsRaw(!isRaw)} className="text-xs text-zinc-400 hover:text-zinc-200">
                {isRaw ? 'Clean' : 'Raw'}
              </button>
              <CopyButton text={jsonStr} />
            </div>
          </div>
          <pre className="p-3 text-xs overflow-auto max-h-96 text-zinc-300">{jsonStr}</pre>
        </div>
      );
    }

    function InteractionForm({ interaction, onSubmit, disabled }) {
      const [response, setResponse] = useState('');
      const [submitting, setSubmitting] = useState(false);

      const handleSubmit = async (e) => {
        e.preventDefault();
        if (!response.trim() || submitting) return;
        setSubmitting(true);
        try {
          await onSubmit(interaction.slug, interaction.targetKey, response.trim());
          setResponse('');
        } finally {
          setSubmitting(false);
        }
      };

      return (
        <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-lg p-6 mb-6">
          <div className="text-sm font-bold text-yellow-200 mb-2">Input Required</div>
          <div className="text-sm text-yellow-100/80 mb-4 whitespace-pre-wrap">
            {interaction.question || 'Please provide your input.'}
          </div>
          <form onSubmit={handleSubmit}>
            <textarea
              value={response}
              onChange={(e) => setResponse(e.target.value)}
              className="w-full p-3 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-yellow-500"
              rows={4}
              placeholder="Enter your response..."
              disabled={submitting || disabled}
            />
            <div className="flex justify-end mt-3 gap-2">
              {disabled && <span className="text-sm text-red-400">CLI is offline</span>}
              <button
                type="submit"
                disabled={submitting || disabled || !response.trim()}
                className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? 'Submitting...' : 'Submit'}
              </button>
            </div>
          </form>
        </div>
      );
    }

    function EventCard({ entry }) {
      const eventColors = {
        WORKFLOW_STARTED: 'border-blue-500',
        WORKFLOW_COMPLETED: 'border-green-500',
        WORKFLOW_FAILED: 'border-red-500',
        AGENT_STARTED: 'border-blue-400',
        AGENT_COMPLETED: 'border-green-400',
        AGENT_FAILED: 'border-red-400',
        PROMPT_REQUESTED: 'border-yellow-500',
        PROMPT_ANSWERED: 'border-yellow-400',
        INTERACTION_REQUESTED: 'border-yellow-500',
        INTERACTION_RESOLVED: 'border-yellow-400',
        INTERACTION_SUBMITTED: 'border-yellow-300',
      };
      const borderColor = eventColors[entry.event] || 'border-zinc-600';
      const time = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '';

      return (
        <div className={\`border-l-2 \${borderColor} pl-4 py-3\`}>
          <div className="flex justify-between items-start mb-2">
            <span className="font-medium text-sm">{entry.event}</span>
            <span className="text-xs text-zinc-500">{time}</span>
          </div>
          {entry.agent && <div className="text-xs text-zinc-400 mb-1">Agent: <span className="text-zinc-300">{entry.agent}</span></div>}
          {entry.slug && <div className="text-xs text-zinc-400 mb-1">Slug: <span className="text-zinc-300">{entry.slug}</span></div>}
          {entry.question && (
            <div className="text-xs text-zinc-400 mt-2">
              <div className="text-zinc-500 mb-1">Question:</div>
              <div className="text-zinc-300 whitespace-pre-wrap">{entry.question}</div>
            </div>
          )}
          {entry.answer && (
            <div className="text-xs text-zinc-400 mt-2">
              <div className="text-zinc-500 mb-1">Answer:</div>
              <div className="text-zinc-300">{entry.answer}</div>
            </div>
          )}
          {entry.error && <div className="text-xs text-red-400 mt-2">{entry.error}</div>}
          {entry.output && <div className="mt-2"><JsonView data={entry.output} label="Output" /></div>}
          {entry.prompt && (
            <details className="mt-2">
              <summary className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-300">Show Prompt</summary>
              <pre className="mt-2 p-2 bg-zinc-800 rounded text-xs text-zinc-400 overflow-auto max-h-48">
                {typeof entry.prompt === 'string' ? entry.prompt : JSON.stringify(entry.prompt, null, 2)}
              </pre>
            </details>
          )}
        </div>
      );
    }

    function App() {
      const [history, setHistory] = useState([]);
      const [status, setStatus] = useState('connecting');
      const [pendingInteraction, setPendingInteraction] = useState(null);
      const [sortNewest, setSortNewest] = useState(true);

      useEffect(() => {
        if (history.length === 0) return;
        const latest = history[0];
        const isRequest = latest?.event === 'INTERACTION_REQUESTED' || latest?.event === 'PROMPT_REQUESTED';
        const hasResolution = history.some(e =>
          (e.event === 'INTERACTION_RESOLVED' || e.event === 'PROMPT_ANSWERED' || e.event === 'INTERACTION_SUBMITTED') &&
          e.slug === latest?.slug
        );
        if (isRequest && !hasResolution) {
          setPendingInteraction({
            slug: latest.slug,
            targetKey: latest.targetKey || \`_interaction_\${latest.slug}\`,
            question: latest.question,
          });
        } else {
          setPendingInteraction(null);
        }
      }, [history]);

      useEffect(() => {
        const token = window.SESSION_TOKEN;
        fetch(\`/api/history/\${token}\`)
          .then(res => res.json())
          .then(data => {
            if (data.entries) setHistory(data.entries);
            setStatus(data.cliConnected ? 'connected' : 'disconnected');
          })
          .catch(() => setStatus('disconnected'));

        const eventSource = new EventSource(\`/api/events/\${token}\`);
        eventSource.onopen = () => setStatus('connected');
        eventSource.onerror = () => setStatus('disconnected');
        eventSource.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            switch (data.type) {
              case 'status': setStatus(data.cliConnected ? 'connected' : 'disconnected'); break;
              case 'history': setHistory(data.entries || []); break;
              case 'event': setHistory(prev => [data, ...prev]); break;
              case 'cli_connected':
              case 'cli_reconnected': setStatus('connected'); break;
              case 'cli_disconnected': setStatus('disconnected'); break;
            }
          } catch (err) { console.error(err); }
        };
        return () => eventSource.close();
      }, []);

      const handleSubmit = async (slug, targetKey, response) => {
        const res = await fetch(\`/api/submit/\${window.SESSION_TOKEN}\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug, targetKey, response }),
        });
        if (!res.ok) {
          const error = await res.json();
          throw new Error(error.error || 'Failed to submit');
        }
      };

      const sortedHistory = sortNewest ? history : [...history].reverse();

      return (
        <div className="max-w-4xl mx-auto p-6">
          <div className="sticky top-0 bg-zinc-950/95 backdrop-blur py-4 mb-6 border-b border-zinc-800">
            <div className="flex justify-between items-center">
              <div>
                <h1 className="text-xl font-bold text-zinc-100">{window.WORKFLOW_NAME || 'Workflow'}</h1>
                <div className="text-xs text-zinc-500 mt-1">Remote Follow (Local Dev)</div>
              </div>
              <div className="flex items-center gap-4">
                <button onClick={() => setSortNewest(!sortNewest)} className="text-xs text-zinc-400 hover:text-zinc-200">
                  {sortNewest ? 'Newest First' : 'Oldest First'}
                </button>
                <StatusBadge status={status} />
              </div>
            </div>
          </div>

          {pendingInteraction && (
            <InteractionForm interaction={pendingInteraction} onSubmit={handleSubmit} disabled={status !== 'connected'} />
          )}

          {status === 'disconnected' && !pendingInteraction && (
            <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-4 mb-6">
              <div className="text-sm text-red-200">CLI is disconnected. Waiting for reconnection...</div>
            </div>
          )}

          <div className="space-y-2">
            {sortedHistory.length === 0 ? (
              <div className="text-center text-zinc-500 py-12">No events yet. Waiting for workflow activity...</div>
            ) : (
              sortedHistory.map((entry, i) => <EventCard key={\`\${entry.timestamp}-\${i}\`} entry={entry} />)
            )}
          </div>
        </div>
      );
    }

    ReactDOM.createRoot(document.getElementById('root')).render(<App />);
  </script>
</body>
</html>`;
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
  if (pathname === '/' || pathname === '/index.html') {
    return serveStatic(res, 'index.html');
  }

  // 404
  res.writeHead(404);
  res.end('Not found');
}

// Create and start server
const server = http.createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`
┌─────────────────────────────────────────────────────────────┐
│  Agent State Machine - Local Remote Follow Server           │
├─────────────────────────────────────────────────────────────┤
│  Server running at: http://localhost:${PORT}                   │
│                                                             │
│  To test remote follow, run your workflow with:             │
│                                                             │
│  STATE_MACHINE_REMOTE_URL=http://localhost:${PORT} \\          │
│    state-machine run <workflow-name> --remote               │
│                                                             │
│  Or export the env var first:                               │
│  export STATE_MACHINE_REMOTE_URL=http://localhost:${PORT}      │
│                                                             │
│  Press Ctrl+C to stop                                       │
└─────────────────────────────────────────────────────────────┘
`);
});
