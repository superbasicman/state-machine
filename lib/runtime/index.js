/**
 * File: /lib/runtime/index.js
 */

/**
 * Runtime module exports for native JS workflows
 */

export {
  WorkflowRuntime,
  WorkflowPausedError,
  getCurrentRuntime,
  setCurrentRuntime,
  clearCurrentRuntime
} from './runtime.js';

export { agent, executeAgent } from './agent.js';
export { initialPrompt } from './prompt.js';
export { parallel, parallelLimit } from './parallel.js';
export { createMemoryProxy } from './memory.js';

import { getCurrentRuntime } from './runtime.js';

/**
 * Get the current workflow's memory object
 * Returns a proxy that auto-persists on mutation
 */
export function getMemory() {
  const runtime = getCurrentRuntime();
  if (!runtime) {
    // Return empty object when not in workflow context
    // This allows imports to work without throwing
    return {};
  }
  return runtime.memory;
}
