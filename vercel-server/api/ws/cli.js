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
  addEvent,
  setEvents,
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
  const { sessionToken } = body;
  // Support both _action (new) and type (legacy) for message routing
  const action = body._action || body.type;

  if (!sessionToken) {
    return res.status(400).json({ error: 'Missing sessionToken' });
  }

  try {
    switch (action) {
      case 'session_init': {
        const { workflowName, history } = body;

        // Create session
        await createSession(sessionToken, { workflowName, cliConnected: true });

        // Replace events with the provided history snapshot (single source of truth)
        await setEvents(sessionToken, history || []);

        return res.status(200).json({ success: true });
      }

      case 'session_reconnect': {
        const { workflowName } = body;

        // Update session as connected
        await setCLIConnected(sessionToken, true);

        // Add reconnect event to events list
        await addEvent(sessionToken, {
          timestamp: new Date().toISOString(),
          event: 'CLI_RECONNECTED',
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

        // Remove routing fields, preserve type (interaction type like 'choice')
        delete historyEvent.sessionToken;
        delete historyEvent._action;

        // Add to events list (single source of truth)
        await addEvent(sessionToken, historyEvent);

        return res.status(200).json({ success: true });
      }

      case 'session_end': {
        const { reason } = body;

        // Mark CLI as disconnected
        await setCLIConnected(sessionToken, false);

        // Add disconnect event to events list
        await addEvent(sessionToken, {
          timestamp: new Date().toISOString(),
          event: 'CLI_DISCONNECTED',
          reason,
        });

        return res.status(200).json({ success: true });
      }

      case 'history_sync': {
        const { history } = body;

        // Replace events with synced history (for manual edits to history.jsonl)
        await setEvents(sessionToken, history || []);

        return res.status(200).json({ success: true });
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error('Error handling CLI message:', err);
    return res.status(500).json({ error: err.message });
  }
}

/**
 * Handle GET requests - long-poll for interaction responses
 * Uses Redis BLPOP for efficient blocking wait instead of polling loop
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

  // Max 50s for Vercel (leave buffer for response)
  const timeoutSec = Math.min(Math.floor(parseInt(timeout, 10) / 1000), 50);
  const channel = KEYS.interactions(token);
  const pendingKey = `${channel}:pending`;

  try {
    // Use BLPOP for efficient blocking wait - only 1 Redis call!
    // Returns [key, value] or null on timeout
    const result = await redis.blpop(pendingKey, timeoutSec);

    if (result) {
      const [, value] = result;
      const data = typeof value === 'object' ? value : JSON.parse(value);
      return res.status(200).json({
        type: 'interaction_response',
        ...data,
      });
    }

    // Timeout - no interaction received
    return res.status(204).end();
  } catch (err) {
    console.error('Error polling for interactions:', err);
    return res.status(500).json({ error: err.message });
  }
}
