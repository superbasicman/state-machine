/**
 * File: /vercel-server/lib/redis.js
 *
 * Upstash Redis client setup for serverless session management
 */

import { Redis } from '@upstash/redis';

// Initialize Redis client
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Session TTL in seconds (24 hours - allows long periods of inactivity)
const SESSION_TTL = 24 * 60 * 60;

// Key prefixes
const KEYS = {
  meta: (token) => `session:${token}:meta`,
  history: (token) => `session:${token}:history`,
  events: (token) => `session:${token}:events`,
  interactions: (token) => `session:${token}:interactions`,
  config: (token) => `session:${token}:config`,
};

/**
 * Create or update a session
 */
export async function createSession(token, { workflowName, cliConnected = true, config = null }) {
  const key = KEYS.meta(token);
  const data = {
    workflowName,
    cliConnected,
    createdAt: Date.now(),
    config: config || { fullAuto: false, autoSelectDelay: 20 },
  };

  await redis.set(key, JSON.stringify(data), { ex: SESSION_TTL });
  return data;
}

/**
 * Get session metadata
 */
export async function getSession(token) {
  const key = KEYS.meta(token);
  const data = await redis.get(key);

  if (!data) return null;

  // Handle case where data is already parsed object
  if (typeof data === 'object') return data;

  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * Update session metadata
 */
export async function updateSession(token, updates) {
  const session = await getSession(token);
  if (!session) return null;

  const updated = { ...session, ...updates };
  const key = KEYS.meta(token);
  await redis.set(key, JSON.stringify(updated), { ex: SESSION_TTL });
  return updated;
}

/**
 * Set CLI connection status
 */
export async function setCLIConnected(token, connected) {
  return updateSession(token, { cliConnected: connected });
}

/**
 * Get the events list key (single source of truth)
 */
function getEventsListKey(token) {
  return `${KEYS.events(token)}:list`;
}

/**
 * Add a single event to the events list (prepend, newest first)
 */
export async function addEvent(token, event) {
  const key = getEventsListKey(token);
  const eventStr = JSON.stringify(event);

  await redis.lpush(key, eventStr);
  await redis.expire(key, SESSION_TTL);
}

/**
 * Replace all events with a new set (for session init)
 */
export async function setEvents(token, events) {
  const key = getEventsListKey(token);

  // Clear existing events
  await redis.del(key);

  // Add all events if any (they're already in newest-first order from CLI)
  if (events && events.length > 0) {
    // LPUSH inserts values left-to-right, so reverse to keep newest at the head.
    const eventStrings = events.slice().reverse().map((e) => JSON.stringify(e));
    await redis.lpush(key, ...eventStrings);
    await redis.expire(key, SESSION_TTL);
  }
}

/**
 * Get all events from the events list
 */
export async function getEvents(token) {
  const key = getEventsListKey(token);
  const events = await redis.lrange(key, 0, -1);

  return events.map((e) => {
    if (typeof e === 'object') return e;
    try {
      return JSON.parse(e);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

/**
 * Get events list length
 */
export async function getEventsLength(token) {
  const key = getEventsListKey(token);
  return redis.llen(key);
}

/**
 * Get events by range (for polling new events)
 */
export async function getEventsRange(token, start, end) {
  const key = getEventsListKey(token);
  const events = await redis.lrange(key, start, end);

  return events.map((e) => {
    if (typeof e === 'object') return e;
    try {
      return JSON.parse(e);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

// Legacy aliases for backward compatibility
export const addHistoryEvent = addEvent;
export const addHistoryEvents = async (token, events) => setEvents(token, events);
export const getHistory = getEvents;

/**
 * Publish event notification (for real-time updates via pub/sub)
 */
export async function publishEventNotification(token) {
  const channel = KEYS.events(token);
  await redis.publish(channel, 'update');
}

/**
 * Publish an interaction response to the interactions channel (for CLI)
 */
export async function publishInteraction(token, { slug, targetKey, response }) {
  const channel = KEYS.interactions(token);
  await redis.publish(channel, JSON.stringify({ slug, targetKey, response }));
}

/**
 * Subscribe to events channel (for browser SSE)
 * Note: This returns a function to unsubscribe
 */
export async function subscribeEvents(token, callback) {
  const channel = KEYS.events(token);

  // Create a new Redis instance for subscription
  const subRedis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });

  // For Upstash REST API, we use polling-based "subscription"
  // This is a workaround since true pub/sub requires persistent connections
  let active = true;
  let lastId = '0';

  const poll = async () => {
    while (active) {
      try {
        // Use XREAD on a stream instead of pub/sub for REST API
        // For now, we'll use a simpler approach with polling
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (err) {
        // Ignore errors during polling
      }
    }
  };

  // Start polling (in practice, the SSE endpoint handles this differently)
  poll();

  return () => {
    active = false;
  };
}

/**
 * Refresh session TTL
 */
export async function refreshSession(token) {
  const metaKey = KEYS.meta(token);
  const eventsListKey = `${KEYS.events(token)}:list`;

  await Promise.all([
    redis.expire(metaKey, SESSION_TTL),
    redis.expire(eventsListKey, SESSION_TTL),
  ]);
}

/**
 * Delete a session (cleanup)
 */
export async function deleteSession(token) {
  const keys = [
    KEYS.meta(token),
    `${KEYS.events(token)}:list`,
    `${KEYS.config(token)}:pending`,
  ];
  await redis.del(...keys);
}

/**
 * Push a config update to the pending queue (browser -> CLI)
 */
export async function pushConfigUpdate(token, config) {
  const pendingKey = `${KEYS.config(token)}:pending`;
  await redis.rpush(pendingKey, JSON.stringify(config));
  await redis.expire(pendingKey, SESSION_TTL);
}

/**
 * Peek at pending config update (for CLI polling)
 */
export async function peekConfigUpdate(token) {
  const pendingKey = `${KEYS.config(token)}:pending`;
  const pending = await redis.lindex(pendingKey, 0);
  if (!pending) return null;
  return typeof pending === 'object' ? pending : JSON.parse(pending);
}

/**
 * Remove pending config update after CLI confirms receipt
 */
export async function popConfigUpdate(token) {
  const pendingKey = `${KEYS.config(token)}:pending`;
  await redis.lpop(pendingKey);
}

export { redis, KEYS, SESSION_TTL };
