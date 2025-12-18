/**
 * File: /lib/index.js
 *
 * Public API (native JS workflows only)
 */

import { setup } from './setup.js';
import { llm, llmText, llmJSON, parseJSON, detectAvailableCLIs } from './llm.js';

import {
  WorkflowRuntime,
  WorkflowPausedError,
  agent,
  executeAgent,
  initialPrompt,
  parallel,
  parallelLimit,
  getMemory,
  getCurrentRuntime
} from './runtime/index.js';

/**
 * Live memory proxy:
 * - Reads/writes always target the *current* workflow runtime's memory proxy
 * - Throws on writes if used outside a workflow run (prevents silent no-op)
 */
export const memory = new Proxy(
  {},
  {
    get(_target, prop) {
      const runtime = getCurrentRuntime();
      if (!runtime) return undefined;
      return runtime.memory[prop];
    },
    set(_target, prop, value) {
      const runtime = getCurrentRuntime();
      if (!runtime) {
        throw new Error('memory can only be mutated within a running workflow');
      }
      runtime.memory[prop] = value;
      return true;
    },
    deleteProperty(_target, prop) {
      const runtime = getCurrentRuntime();
      if (!runtime) {
        throw new Error('memory can only be mutated within a running workflow');
      }
      delete runtime.memory[prop];
      return true;
    },
    has(_target, prop) {
      const runtime = getCurrentRuntime();
      if (!runtime) return false;
      const raw = runtime.memory?._raw || runtime._rawMemory || {};
      return prop in raw;
    },
    ownKeys() {
      const runtime = getCurrentRuntime();
      if (!runtime) return [];
      const raw = runtime.memory?._raw || runtime._rawMemory || {};
      return Reflect.ownKeys(raw);
    },
    getOwnPropertyDescriptor(_target, prop) {
      const runtime = getCurrentRuntime();
      if (!runtime) return undefined;
      const raw = runtime.memory?._raw || runtime._rawMemory || {};
      if (!(prop in raw)) return undefined;
      return {
        enumerable: true,
        configurable: true
      };
    }
  }
);

export {
  setup,
  llm,
  llmText,
  llmJSON,
  parseJSON,
  detectAvailableCLIs,
  WorkflowRuntime,
  WorkflowPausedError,
  agent,
  executeAgent,
  initialPrompt,
  parallel,
  parallelLimit,
  getCurrentRuntime,
  getMemory
};

const api = {
  setup,
  llm,
  llmText,
  llmJSON,
  parseJSON,
  detectAvailableCLIs,
  WorkflowRuntime,
  WorkflowPausedError,
  agent,
  executeAgent,
  initialPrompt,
  parallel,
  parallelLimit,
  getCurrentRuntime,
  getMemory,
  memory
};

export default api;
