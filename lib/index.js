/**
 * File: /lib/index.js
 *
 * Public API (native JS workflows only)
 */

import { setup } from './setup.js';
import { llm, llmText, llmJSON, parseJSON, detectAvailableCLIs } from './llm.js';
import { extractExportsFromContent, extractExportsFromFile } from './file-tree.js';
import {
  trackFile as trackFileInternal,
  getFileTree as getFileTreeInternal,
  untrackFile as untrackFileInternal
} from './runtime/track-changes.js';

import {
  WorkflowRuntime,
  agent,
  executeAgent,
  askHuman,
  InteractionSchema,
  InteractionResponseSchema,
  normalizeInteraction,
  validateInteraction,
  normalizeInteractionResponse,
  validateInteractionResponse,
  createInteraction,
  formatInteractionPrompt,
  matchSingleSelect,
  matchMultiSelect,
  parseInteractionResponse,
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

/**
 * Live fileTree proxy:
 * - Reads/writes target the current workflow runtime's fileTree in memory
 * - Indexed by relative file path from projectRoot
 */
export const fileTree = new Proxy(
  {},
  {
    get(_target, prop) {
      const runtime = getCurrentRuntime();
      if (!runtime) return undefined;
      return runtime._rawMemory.fileTree?.[prop];
    },
    set(_target, prop, value) {
      const runtime = getCurrentRuntime();
      if (!runtime) {
        throw new Error('fileTree can only be mutated within a running workflow');
      }
      if (!runtime._rawMemory.fileTree) {
        runtime._rawMemory.fileTree = {};
      }
      runtime._rawMemory.fileTree[prop] = value;
      runtime.memory.fileTree = runtime._rawMemory.fileTree;
      return true;
    },
    deleteProperty(_target, prop) {
      const runtime = getCurrentRuntime();
      if (!runtime) {
        throw new Error('fileTree can only be mutated within a running workflow');
      }
      if (runtime._rawMemory.fileTree) {
        delete runtime._rawMemory.fileTree[prop];
        runtime.memory.fileTree = runtime._rawMemory.fileTree;
      }
      return true;
    },
    has(_target, prop) {
      const runtime = getCurrentRuntime();
      return runtime?._rawMemory.fileTree?.hasOwnProperty(prop) ?? false;
    },
    ownKeys() {
      const runtime = getCurrentRuntime();
      return Object.keys(runtime?._rawMemory.fileTree || {});
    },
    getOwnPropertyDescriptor(_target, prop) {
      const runtime = getCurrentRuntime();
      if (runtime?._rawMemory.fileTree?.hasOwnProperty(prop)) {
        return {
          configurable: true,
          enumerable: true,
          value: runtime._rawMemory.fileTree[prop]
        };
      }
      return undefined;
    }
  }
);

/**
 * Track a file in the fileTree.
 * @param {string} relativePath - Path relative to projectRoot
 * @param {object} options - Tracking options (caption, exports, extractExports, metadata, agentName)
 */
export function trackFile(relativePath, options = {}) {
  const runtime = getCurrentRuntime();
  if (!runtime) {
    throw new Error('trackFile() must be called within a workflow context');
  }
  return trackFileInternal(runtime, relativePath, options);
}

/**
 * Get all tracked files.
 */
export function getFileTree() {
  const runtime = getCurrentRuntime();
  if (!runtime) return {};
  return getFileTreeInternal(runtime);
}

/**
 * Remove a file from tracking.
 */
export function untrackFile(relativePath) {
  const runtime = getCurrentRuntime();
  if (!runtime) {
    throw new Error('untrackFile() must be called within a workflow context');
  }
  return untrackFileInternal(runtime, relativePath);
}

export {
  setup,
  llm,
  llmText,
  llmJSON,
  parseJSON,
  detectAvailableCLIs,
  WorkflowRuntime,
  agent,
  executeAgent,
  askHuman,
  InteractionSchema,
  InteractionResponseSchema,
  normalizeInteraction,
  validateInteraction,
  normalizeInteractionResponse,
  validateInteractionResponse,
  createInteraction,
  formatInteractionPrompt,
  matchSingleSelect,
  matchMultiSelect,
  parseInteractionResponse,
  parallel,
  parallelLimit,
  getCurrentRuntime,
  getMemory,
  // File tree utilities
  extractExportsFromContent,
  extractExportsFromFile
};

const api = {
  setup,
  llm,
  llmText,
  llmJSON,
  parseJSON,
  detectAvailableCLIs,
  WorkflowRuntime,
  agent,
  executeAgent,
  askHuman,
  InteractionSchema,
  InteractionResponseSchema,
  normalizeInteraction,
  validateInteraction,
  normalizeInteractionResponse,
  validateInteractionResponse,
  createInteraction,
  formatInteractionPrompt,
  matchSingleSelect,
  matchMultiSelect,
  parseInteractionResponse,
  parallel,
  parallelLimit,
  getCurrentRuntime,
  getMemory,
  memory,
  // File tree
  fileTree,
  trackFile,
  getFileTree,
  untrackFile,
  extractExportsFromContent,
  extractExportsFromFile
};

export default api;
