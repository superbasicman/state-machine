/**
 * File: /vercel-server/api/submit/[token].js
 *
 * POST endpoint for browser interaction submissions
 */

import {
  getSession,
  addEvent,
  redis,
  KEYS,
} from '../../lib/redis.js';

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token } = req.query;

  if (!token) {
    return res.status(400).json({ error: 'Missing token parameter' });
  }

  try {
    // Validate session
    const session = await getSession(token);
    if (!session) {
      return res.status(404).json({ error: 'Session not found or expired' });
    }

    // Check if CLI is connected
    if (!session.cliConnected) {
      return res.status(503).json({ error: 'CLI is disconnected. Cannot submit interaction.' });
    }

    // Parse body
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { slug, targetKey, response } = body;

    if (!slug || response === undefined || response === null) {
      return res.status(400).json({ error: 'Missing required fields: slug, response' });
    }

    const responseString = typeof response === 'string' ? response : JSON.stringify(response);

    // Validate response size (max 1MB)
    if (responseString.length > 1024 * 1024) {
      return res.status(413).json({ error: 'Response too large (max 1MB)' });
    }

    // Push to pending interactions list (for CLI to poll)
    const pendingKey = `${KEYS.interactions(token)}:pending`;
    await redis.rpush(pendingKey, JSON.stringify({
      slug,
      targetKey: targetKey || `_interaction_${slug}`,
      response,
    }));

    // Set TTL on pending list (24 hours - same as session, allows laptop sleep)
    await redis.expire(pendingKey, 24 * 60 * 60);

    // Log event to events list (single source of truth for UI)
    await addEvent(token, {
      timestamp: new Date().toISOString(),
      event: 'INTERACTION_SUBMITTED',
      slug,
      targetKey: targetKey || `_interaction_${slug}`,
      answer: responseString.substring(0, 200) + (responseString.length > 200 ? '...' : ''),
      source: 'remote',
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Error submitting interaction:', err);
    return res.status(500).json({ error: err.message });
  }
}
