/**
 * File: /lib/remote/client.js
 *
 * RemoteClient - HTTP client for connecting to the remote follow server
 * Uses HTTP POST for sending events and long-polling for receiving interactions
 */

import crypto from 'crypto';
import http from 'http';
import https from 'https';

// ANSI Colors
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m'
};

/**
 * Generate a cryptographically secure session token
 * @returns {string} 32-byte base64url-encoded token
 */
export function generateSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Make an HTTP/HTTPS request with timeout
 * @param {string} url - Request URL
 * @param {object} options - Request options
 * @param {object|null} body - Request body
 * @param {number} timeoutMs - Request timeout in milliseconds
 */
function makeRequest(url, options, body = null, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const req = client.request(parsedUrl, options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        let parsedData = null;
        if (data) {
          try {
            parsedData = JSON.parse(data);
          } catch {
            // Response is not JSON (could be HTML error page)
            parsedData = { error: data.substring(0, 200) };
          }
        }
        resolve({
          status: res.statusCode,
          data: parsedData,
        });
      });
    });

    // Timeout prevents hanging on sleep/wake cycles
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

/**
 * RemoteClient class - manages HTTP connection to remote server
 */
export class RemoteClient {
  /**
   * @param {object} options
   * @param {string} options.serverUrl - Base URL of remote server (e.g., https://example.vercel.app)
   * @param {string} options.workflowName - Name of the workflow
   * @param {function} options.onInteractionResponse - Callback when interaction response received
   * @param {function} [options.onStatusChange] - Callback when connection status changes
   * @param {string} [options.sessionToken] - Optional session token to reuse
   * @param {boolean} [options.uiBaseUrl] - If true, return base URL for UI instead of /s/{token}
   */
  constructor(options) {
    this.serverUrl = options.serverUrl.replace(/\/$/, ''); // Remove trailing slash
    this.workflowName = options.workflowName;
    this.onInteractionResponse = options.onInteractionResponse;
    this.onStatusChange = options.onStatusChange || (() => {});
    this.uiBaseUrl = Boolean(options.uiBaseUrl);

    this.sessionToken = options.sessionToken || generateSessionToken();
    this.connected = false;
    this.polling = false;
    this.pollAbortController = null;
    this.initialHistorySent = false;
  }

  /**
   * Get the full remote URL for browser access
   */
  getRemoteUrl() {
    if (this.uiBaseUrl) {
      return this.serverUrl;
    }
    return `${this.serverUrl}/s/${this.sessionToken}`;
  }

  /**
   * Connect to the remote server
   * @returns {Promise<void>}
   */
  async connect() {
    try {
      // Test connection by making a simple request
      const testUrl = `${this.serverUrl}/api/history/${this.sessionToken}`;
      const response = await makeRequest(testUrl, { method: 'GET' });

      // 404 is expected for new sessions
      if (response.status !== 404 && response.status !== 200) {
        throw new Error(`Server returned ${response.status}`);
      }

      this.connected = true;
      this.onStatusChange('connected');

      // Start polling for interactions
      this.startPolling();

    } catch (err) {
      console.log(`${C.yellow}Warning: Could not connect to remote server: ${err.message}${C.reset}`);
      // Don't fail - remote is optional
    }
  }

  /**
   * Send a message to the server via HTTP POST
   */
  async send(msg) {
    if (!this.connected) {
      return;
    }

    try {
      const url = `${this.serverUrl}/api/ws/cli`;
      await makeRequest(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      }, msg);
    } catch (err) {
      console.error(`${C.dim}Remote: Failed to send message: ${err.message}${C.reset}`);
    }
  }

  /**
   * Send initial session info with history
   * @param {Array} history - Array of history entries
   */
  async sendSessionInit(history = []) {
    this.initialHistorySent = true;
    await this.send({
      type: 'session_init',
      sessionToken: this.sessionToken,
      workflowName: this.workflowName,
      history,
    });
  }

  /**
   * Sync history to remote (for manual edits to history.jsonl)
   * @param {Array} history - Array of history entries
   */
  async sendHistorySync(history = []) {
    await this.send({
      type: 'history_sync',
      sessionToken: this.sessionToken,
      history,
    });
  }

  /**
   * Send an event to the server
   * @param {object} event - Event object with timestamp, event type, etc.
   */
  async sendEvent(event) {
    // Only send events after initial history has been sent
    if (!this.initialHistorySent) {
      return;
    }

    await this.send({
      ...event,
      _action: 'event',  // Use _action for message routing to preserve event.type (interaction type)
      sessionToken: this.sessionToken,
    });
  }

  /**
   * Send session end notification
   * @param {string} reason - Reason for ending (completed, failed, user_quit)
   */
  async sendSessionEnd(reason = 'completed') {
    await this.send({
      type: 'session_end',
      sessionToken: this.sessionToken,
      reason,
    });
  }

  /**
   * Start polling for interaction responses
   */
  startPolling() {
    if (this.polling) return;
    this.polling = true;

    this.poll();
  }

  /**
   * Poll for interaction responses
   * Uses 35s timeout to stay under Vercel's 50s limit with buffer
   */
  async poll() {
    let consecutiveErrors = 0;

    while (this.polling && this.connected) {
      try {
        // Request 30s poll from server, with 35s client timeout
        const url = `${this.serverUrl}/api/ws/cli?token=${this.sessionToken}&timeout=30000`;
        const response = await makeRequest(url, { method: 'GET' }, null, 35000);

        consecutiveErrors = 0; // Reset on success

        if (response.status === 200 && response.data) {
          const { type, slug, targetKey, response: interactionResponse } = response.data;

          if (type === 'interaction_response' && this.onInteractionResponse) {
            // Confirm receipt BEFORE processing - removes from Redis pending queue
            // This ensures we don't lose the interaction if processing fails
            try {
              const confirmUrl = `${this.serverUrl}/api/ws/cli?token=${this.sessionToken}`;
              await makeRequest(confirmUrl, { method: 'DELETE' }, null, 10000);
            } catch (err) {
              // Non-fatal - interaction will be re-delivered on next poll
              console.error(`${C.dim}Remote: Failed to confirm receipt: ${err.message}${C.reset}`);
            }

            this.onInteractionResponse(slug, targetKey, interactionResponse);
          }
        }

        // If 204 (no content), just continue polling immediately
        // Small delay only on success to prevent tight loop
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (err) {
        consecutiveErrors++;

        // Exponential backoff: 1s, 2s, 4s, max 10s
        const backoff = Math.min(1000 * Math.pow(2, consecutiveErrors - 1), 10000);
        await new Promise(resolve => setTimeout(resolve, backoff));
      }
    }
  }

  /**
   * Stop polling
   */
  stopPolling() {
    this.polling = false;
  }

  /**
   * Disconnect from the server
   */
  async disconnect() {
    this.stopPolling();

    if (this.connected) {
      await this.sendSessionEnd('completed');
    }

    this.connected = false;
  }
}
