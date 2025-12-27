/**
 * File: /vercel-server/api/history/[token].js
 *
 * REST endpoint to get session history
 */

import { getSession, getHistory, refreshSession } from '../../lib/redis.js';

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
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

    // Refresh session TTL
    await refreshSession(token);

    // Get history
    const entries = await getHistory(token);

    return res.status(200).json({
      workflowName: session.workflowName,
      cliConnected: session.cliConnected,
      config: session.config || { fullAuto: false, autoSelectDelay: 20 },
      entries,
    });
  } catch (err) {
    console.error('Error getting history:', err);
    return res.status(500).json({ error: err.message });
  }
}
