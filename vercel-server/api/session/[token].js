/**
 * File: /vercel-server/api/session/[token].js
 *
 * Serves the UI HTML for a specific session
 * Token is injected into the page for the frontend to use
 */

import { getSession } from '../../lib/redis.js';

const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{WORKFLOW_NAME}} - Remote Follow</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <style>
    .animate-pulse-slow { animation: pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .7; } }
  </style>
</head>
<body class="bg-zinc-950 text-zinc-100 min-h-screen">
  <div id="root"></div>
  <script>
    window.SESSION_TOKEN = '{{SESSION_TOKEN}}';
    window.WORKFLOW_NAME = '{{WORKFLOW_NAME}}';
  </script>
  <script type="text/babel">
    const { useState, useEffect, useRef } = React;

    // Connection status badge
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
          <span className="text-xs uppercase tracking-wider text-zinc-400">
            {labels[status] || status}
          </span>
        </div>
      );
    }

    // Copy button component
    function CopyButton({ text }) {
      const [copied, setCopied] = useState(false);

      const handleCopy = async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      };

      return (
        <button
          onClick={handleCopy}
          className="px-2 py-1 text-xs bg-zinc-700 hover:bg-zinc-600 rounded transition-colors"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      );
    }

    // JSON viewer component
    function JsonView({ data, label }) {
      const [isRaw, setIsRaw] = useState(false);
      const jsonStr = JSON.stringify(data, null, 2);

      return (
        <div className="bg-zinc-800 rounded-lg overflow-hidden">
          <div className="flex justify-between items-center px-3 py-2 bg-zinc-700">
            <span className="text-xs font-medium text-zinc-300">{label}</span>
            <div className="flex gap-2">
              <button
                onClick={() => setIsRaw(!isRaw)}
                className="text-xs text-zinc-400 hover:text-zinc-200"
              >
                {isRaw ? 'Clean' : 'Raw'}
              </button>
              <CopyButton text={jsonStr} />
            </div>
          </div>
          <pre className="p-3 text-xs overflow-auto max-h-96 text-zinc-300">
            {isRaw ? jsonStr : JSON.stringify(data, null, 2)}
          </pre>
        </div>
      );
    }

    // Interaction form component
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
              {disabled && (
                <span className="text-sm text-red-400">CLI is offline</span>
              )}
              <button
                type="submit"
                disabled={submitting || disabled || !response.trim()}
                className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? 'Submitting...' : 'Submit'}
              </button>
            </div>
          </form>
        </div>
      );
    }

    // Event card component
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

          {entry.agent && (
            <div className="text-xs text-zinc-400 mb-1">
              Agent: <span className="text-zinc-300">{entry.agent}</span>
            </div>
          )}

          {entry.slug && (
            <div className="text-xs text-zinc-400 mb-1">
              Slug: <span className="text-zinc-300">{entry.slug}</span>
            </div>
          )}

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

          {entry.error && (
            <div className="text-xs text-red-400 mt-2">{entry.error}</div>
          )}

          {entry.output && (
            <div className="mt-2">
              <JsonView data={entry.output} label="Output" />
            </div>
          )}

          {entry.prompt && (
            <details className="mt-2">
              <summary className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-300">
                Show Prompt
              </summary>
              <pre className="mt-2 p-2 bg-zinc-800 rounded text-xs text-zinc-400 overflow-auto max-h-48">
                {typeof entry.prompt === 'string' ? entry.prompt : JSON.stringify(entry.prompt, null, 2)}
              </pre>
            </details>
          )}
        </div>
      );
    }

    // Main App component
    function App() {
      const [history, setHistory] = useState([]);
      const [status, setStatus] = useState('connecting');
      const [pendingInteraction, setPendingInteraction] = useState(null);
      const [sortNewest, setSortNewest] = useState(true);
      const eventSourceRef = useRef(null);

      // Detect pending interaction from history
      useEffect(() => {
        if (history.length === 0) return;

        // Check if latest event is an interaction/prompt request
        const latest = history[0];
        const isRequest = latest?.event === 'INTERACTION_REQUESTED' ||
                         latest?.event === 'PROMPT_REQUESTED';

        // Check if it's been resolved
        const hasResolution = history.some(e =>
          (e.event === 'INTERACTION_RESOLVED' ||
           e.event === 'PROMPT_ANSWERED' ||
           e.event === 'INTERACTION_SUBMITTED') &&
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

      // Connect to SSE
      useEffect(() => {
        const token = window.SESSION_TOKEN;
        if (!token) return;

        // Fetch initial history
        fetch(\`/api/history/\${token}\`)
          .then(res => res.json())
          .then(data => {
            if (data.entries) {
              setHistory(data.entries);
            }
            setStatus(data.cliConnected ? 'connected' : 'disconnected');
          })
          .catch(err => {
            console.error('Failed to fetch history:', err);
            setStatus('disconnected');
          });

        // Set up SSE
        const eventSource = new EventSource(\`/api/events/\${token}\`);
        eventSourceRef.current = eventSource;

        eventSource.onopen = () => {
          setStatus('connected');
        };

        eventSource.onerror = () => {
          setStatus('disconnected');
        };

        eventSource.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);

            switch (data.type) {
              case 'status':
                setStatus(data.cliConnected ? 'connected' : 'disconnected');
                break;

              case 'history':
                setHistory(data.entries || []);
                break;

              case 'event':
                setHistory(prev => [data, ...prev]);
                break;

              case 'cli_connected':
              case 'cli_reconnected':
                setStatus('connected');
                break;

              case 'cli_disconnected':
                setStatus('disconnected');
                break;
            }
          } catch (err) {
            console.error('Failed to parse SSE message:', err);
          }
        };

        return () => {
          eventSource.close();
        };
      }, []);

      // Submit interaction
      const handleSubmit = async (slug, targetKey, response) => {
        const token = window.SESSION_TOKEN;

        const res = await fetch(\`/api/submit/\${token}\`, {
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
          {/* Header */}
          <div className="sticky top-0 bg-zinc-950/95 backdrop-blur py-4 mb-6 border-b border-zinc-800">
            <div className="flex justify-between items-center">
              <div>
                <h1 className="text-xl font-bold text-zinc-100">
                  {window.WORKFLOW_NAME || 'Workflow'}
                </h1>
                <div className="text-xs text-zinc-500 mt-1">Remote Follow</div>
              </div>
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setSortNewest(!sortNewest)}
                  className="text-xs text-zinc-400 hover:text-zinc-200"
                >
                  {sortNewest ? 'Newest First' : 'Oldest First'}
                </button>
                <StatusBadge status={status} />
              </div>
            </div>
          </div>

          {/* Pending Interaction */}
          {pendingInteraction && (
            <InteractionForm
              interaction={pendingInteraction}
              onSubmit={handleSubmit}
              disabled={status !== 'connected'}
            />
          )}

          {/* Disconnected Warning */}
          {status === 'disconnected' && !pendingInteraction && (
            <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-4 mb-6">
              <div className="text-sm text-red-200">
                CLI is disconnected. Waiting for reconnection...
              </div>
            </div>
          )}

          {/* History */}
          <div className="space-y-2">
            {sortedHistory.length === 0 ? (
              <div className="text-center text-zinc-500 py-12">
                No events yet. Waiting for workflow activity...
              </div>
            ) : (
              sortedHistory.map((entry, i) => (
                <EventCard key={\`\${entry.timestamp}-\${i}\`} entry={entry} />
              ))
            )}
          </div>
        </div>
      );
    }

    // Render
    ReactDOM.createRoot(document.getElementById('root')).render(<App />);
  </script>
</body>
</html>`;

export default async function handler(req, res) {
  const { token } = req.query;

  if (!token) {
    return res.status(400).send('Missing session token');
  }

  // Validate session
  const session = await getSession(token);
  if (!session) {
    return res.status(404).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Session Not Found</title>
          <style>
            body { font-family: system-ui; max-width: 600px; margin: 100px auto; text-align: center; }
          </style>
        </head>
        <body>
          <h1>Session Not Found</h1>
          <p>This session has expired or does not exist.</p>
          <p>Sessions expire 30 minutes after the last activity.</p>
        </body>
      </html>
    `);
  }

  // Inject token and workflow name into HTML
  const html = HTML_TEMPLATE
    .replace(/\{\{SESSION_TOKEN\}\}/g, token)
    .replace(/\{\{WORKFLOW_NAME\}\}/g, session.workflowName || 'Workflow');

  res.setHeader('Content-Type', 'text/html');
  res.send(html);
}
