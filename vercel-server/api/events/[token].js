/**
 * File: /vercel-server/api/events/[token].js
 *
 * SSE endpoint for browser connections
 * Streams events to connected browsers from a single source of truth (events list)
 */

import {
  getSession,
  getEvents,
  getEventsLength,
  getEventsRange,
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

    // Send all existing events (single source of truth)
    const events = await getEvents(token);
    res.write(`data: ${JSON.stringify({
      type: 'history',
      entries: events,
    })}\n\n`);

    // Track current position for polling new events
    let lastEventIndex = await getEventsLength(token);

    const pollInterval = setInterval(async () => {
      try {
        // Refresh session TTL
        await refreshSession(token);

        // Check for new events
        const newLength = await getEventsLength(token);

        if (newLength > lastEventIndex) {
          // Get new events (they're prepended, so newest are at the start)
          const newCount = newLength - lastEventIndex;
          const newEvents = await getEventsRange(token, 0, newCount - 1);

          // Send in chronological order (oldest first of the new batch)
          for (const eventData of newEvents.reverse()) {
            res.write(`data: ${JSON.stringify({
              type: 'event',
              ...eventData,
            })}\n\n`);
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
    }, 1000); // Poll every 1 second for faster updates

    // Clean up on client disconnect
    req.on('close', () => {
      clearInterval(pollInterval);
    });

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
