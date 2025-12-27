/**
 * File: /vercel-server/api/config/[token].js
 *
 * POST endpoint for browser config updates (fullAuto, autoSelectDelay, stop)
 */

import {
  getSession,
  updateSession,
  pushConfigUpdate,
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
      return res.status(503).json({ error: 'CLI is disconnected. Cannot update config.' });
    }

    // Parse body
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { fullAuto, autoSelectDelay, stop } = body;

    // Build config update object with only provided fields
    const configUpdate = {};
    if (fullAuto !== undefined) configUpdate.fullAuto = fullAuto;
    if (autoSelectDelay !== undefined) configUpdate.autoSelectDelay = autoSelectDelay;
    if (stop !== undefined) configUpdate.stop = stop;

    if (Object.keys(configUpdate).length === 0) {
      return res.status(400).json({ error: 'No config fields provided' });
    }

    // Push config update to pending queue for CLI to poll
    await pushConfigUpdate(token, configUpdate);

    // Update session metadata with new config (except stop which is transient)
    if (!stop) {
      const currentConfig = session.config || { fullAuto: false, autoSelectDelay: 20 };
      const newConfig = { ...currentConfig };
      if (fullAuto !== undefined) newConfig.fullAuto = fullAuto;
      if (autoSelectDelay !== undefined) newConfig.autoSelectDelay = autoSelectDelay;
      await updateSession(token, { config: newConfig });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Error updating config:', err);
    return res.status(500).json({ error: err.message });
  }
}
