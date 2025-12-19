/**
 * File: /vercel-server/api/events/[token].js
 *
 * SSE endpoint for browser connections
 * Streams history and real-time events to connected browsers
 */

import {
  getSession,
  getHistory,
  redis,
  KEYS,
  refreshSession,
} from '../../lib/redis.js';

export const config = {
  maxDuration: 60, // Maximum 60 seconds for SSE
};

export default async function handler(req, res) {
  const { token } = req.query;

  if (!token) {
    return res.status(400).json({ error: 'Missing token parameter' });
  }

  // Validate session
  const session = await getSession(token);
  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired' });
  }

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Send retry interval
  res.write('retry: 3000\n\n');

  // Send initial data
  try {
    // Send connection status
    res.write(`data: ${JSON.stringify({
      type: 'status',
      cliConnected: session.cliConnected,
      workflowName: session.workflowName,
    })}\n\n`);

    // Send existing history
    const history = await getHistory(token);
    res.write(`data: ${JSON.stringify({
      type: 'history',
      entries: history,
    })}\n\n`);

    // Poll for new events
    const eventsListKey = `${KEYS.events(token)}:list`;
    let lastEventIndex = 0;

    // Get current list length to start from
    const currentLength = await redis.llen(eventsListKey);
    lastEventIndex = currentLength;

    const pollInterval = setInterval(async () => {
      try {
        // Refresh session TTL
        await refreshSession(token);

        // Check for new events
        const newLength = await redis.llen(eventsListKey);

        if (newLength > lastEventIndex) {
          // Get new events (newest first)
          const newEvents = await redis.lrange(eventsListKey, 0, newLength - lastEventIndex - 1);

          for (const event of newEvents.reverse()) {
            const eventData = typeof event === 'object' ? event : JSON.parse(event);
            res.write(`data: ${JSON.stringify(eventData)}\n\n`);
          }

          lastEventIndex = newLength;
        }

        // Check CLI status
        const updatedSession = await getSession(token);
        if (updatedSession && updatedSession.cliConnected !== session.cliConnected) {
          session.cliConnected = updatedSession.cliConnected;
          res.write(`data: ${JSON.stringify({
            type: updatedSession.cliConnected ? 'cli_reconnected' : 'cli_disconnected',
          })}\n\n`);
        }
      } catch (err) {
        console.error('Error polling events:', err);
      }
    }, 2000);

    // Clean up on client disconnect
    req.on('close', () => {
      clearInterval(pollInterval);
    });

    // For Vercel, we need to keep the connection alive but also respect function timeout
    // Send keepalive pings
    const keepaliveInterval = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 15000);

    req.on('close', () => {
      clearInterval(keepaliveInterval);
    });

  } catch (err) {
    console.error('SSE error:', err);
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    res.end();
  }
}
