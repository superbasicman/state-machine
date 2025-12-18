/**
 * File: /lib/runtime/memory.js
 */

/**
 * Memory Proxy Module
 * Creates a proxy object that auto-persists to disk on mutation
 */

let persistTimeout = null;
const DEBOUNCE_MS = 10;

/**
 * Schedule a debounced persistence call
 */
function schedulePersist(fn) {
  if (persistTimeout) clearTimeout(persistTimeout);
  persistTimeout = setTimeout(() => {
    fn();
    persistTimeout = null;
  }, DEBOUNCE_MS);
}

/**
 * Force immediate persistence (clears any pending debounce)
 */
export function flushPersist(fn) {
  if (persistTimeout) {
    clearTimeout(persistTimeout);
    persistTimeout = null;
  }
  fn();
}

/**
 * Create a proxy that auto-saves on mutation
 * @param {object} data - The raw data object to proxy
 * @param {function} persistFn - Function to call when data changes
 * @param {object} root - Root object for nested proxy tracking (internal)
 * @returns {Proxy} Proxied memory object
 */
export function createMemoryProxy(data, persistFn, root = null) {
  const handler = {
    get(target, prop) {
      // Return primitives and functions as-is
      if (prop === '_raw') return target;
      if (prop === '_flush') return () => flushPersist(persistFn);

      const value = target[prop];

      // Don't proxy internal properties, functions, or primitives
      if (typeof prop === 'symbol') return value;
      if (prop.startsWith('_')) return value;
      if (typeof value === 'function') return value;
      if (value === null || typeof value !== 'object') return value;

      // Wrap nested objects in proxies for deep observation
      return createMemoryProxy(value, persistFn, root || data);
    },

    set(target, prop, value) {
      // Skip internal properties (don't trigger persist)
      if (typeof prop === 'symbol' || prop.startsWith('_')) {
        target[prop] = value;
        return true;
      }

      target[prop] = value;
      schedulePersist(persistFn);
      return true;
    },

    deleteProperty(target, prop) {
      if (typeof prop === 'symbol' || prop.startsWith('_')) {
        delete target[prop];
        return true;
      }

      delete target[prop];
      schedulePersist(persistFn);
      return true;
    }
  };

  return new Proxy(data, handler);
}

export { schedulePersist };
