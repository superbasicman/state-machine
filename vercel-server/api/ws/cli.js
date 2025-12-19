/**
 * File: /vercel-server/api/ws/cli.js
 *
 * HTTP-based endpoint for CLI communication (replaces WebSocket for serverless)
 *
 * POST: Receive messages from CLI (session_init, event, session_end)
 * GET: Long-poll for interaction responses
 */

import {
  createSession,
  getSession,
  updateSession,
  setCLIConnected,
  addHistoryEvent,
  addHistoryEvents,
  publishEvent,
  redis,
  KEYS,
} from '../../lib/redis.js';

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'POST') {
    return handlePost(req, res);
  }

  if (req.method === 'GET') {
    return handleGet(req, res);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

/**
 * Handle POST requests from CLI
 */
async function handlePost(req, res) {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { type, sessionToken } = body;

  if (!sessionToken) {
    return res.status(400).json({ error: 'Missing sessionToken' });
  }

  try {
    switch (type) {
      case 'session_init': {
        const { workflowName, history } = body;

        // Create session
        await createSession(sessionToken, { workflowName, cliConnected: true });

        // Replace any existing history and event stream with the provided snapshot
        await redis.del(KEYS.history(sessionToken), `${KEYS.events(sessionToken)}:list`);

        // Store initial history
        if (history && history.length > 0) {
          await addHistoryEvents(sessionToken, history);
        }

        // Notify browsers
        await publishEvent(sessionToken, {
          type: 'cli_connected',
          workflowName,
        });

        return res.status(200).json({ success: true });
      }

      case 'session_reconnect': {
        const { workflowName } = body;

        // Update session as connected
        await setCLIConnected(sessionToken, true);

        // Notify browsers
        await publishEvent(sessionToken, {
          type: 'cli_reconnected',
          workflowName,
        });

        return res.status(200).json({ success: true });
      }

      case 'event': {
        const { timestamp, event, ...eventData } = body;

        const historyEvent = {
          timestamp: timestamp || new Date().toISOString(),
          event,
          ...eventData,
        };

        // Remove sessionToken and type from event data
        delete historyEvent.sessionToken;
        delete historyEvent.type;

        // Add to history
        await addHistoryEvent(sessionToken, historyEvent);

        // Notify browsers
        await publishEvent(sessionToken, {
          type: 'event',
          ...historyEvent,
        });

        return res.status(200).json({ success: true });
      }

      case 'session_end': {
        const { reason } = body;

        // Mark CLI as disconnected
        await setCLIConnected(sessionToken, false);

        // Notify browsers
        await publishEvent(sessionToken, {
          type: 'cli_disconnected',
          reason,
        });

        return res.status(200).json({ success: true });
      }

      default:
        return res.status(400).json({ error: `Unknown message type: ${type}` });
    }
  } catch (err) {
    console.error('Error handling CLI message:', err);
    return res.status(500).json({ error: err.message });
  }
}

/**
 * Handle GET requests - long-poll for interaction responses
 */
async function handleGet(req, res) {
  const { token, timeout = '30000' } = req.query;

  if (!token) {
    return res.status(400).json({ error: 'Missing token parameter' });
  }

  const session = await getSession(token);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const timeoutMs = Math.min(parseInt(timeout, 10), 55000); // Max 55s for Vercel
  const channel = KEYS.interactions(token);

  // Check for pending interactions using a list
  const pendingKey = `${channel}:pending`;

  try {
    // Try to get a pending interaction
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const pending = await redis.lpop(pendingKey);

      if (pending) {
        const data = typeof pending === 'object' ? pending : JSON.parse(pending);
        return res.status(200).json({
          type: 'interaction_response',
          ...data,
        });
      }

      // Wait before checking again
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Timeout - no interaction received
    return res.status(204).end();
  } catch (err) {
    console.error('Error polling for interactions:', err);
    return res.status(500).json({ error: err.message });
  }
}
