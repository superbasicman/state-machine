/**
 * File: /lib/runtime/track-changes.js
 *
 * Wraps agent execution with file change tracking.
 * Captures baseline before agent runs, detects changes after,
 * and updates memory.fileTree with the results.
 */

import path from 'path';
import {
  captureBaseline,
  detectChanges,
  normalizePath,
  extractExportsFromFile,
  DEFAULT_IGNORE
} from '../file-tree.js';

/**
 * Wrap an async function with file change tracking.
 * Captures baseline before execution, detects changes after,
 * and updates the runtime's fileTree.
 *
 * @param {Object} runtime - The workflow runtime instance
 * @param {string} agentName - Name of the agent (for attribution)
 * @param {Function} fn - Async function to execute
 * @returns {Promise<any>} - Result of the function
 */
export async function withChangeTracking(runtime, agentName, fn) {
  const projectRoot = runtime.workflowConfig.projectRoot;
  const ignorePatterns = runtime.workflowConfig.fileTrackingIgnore || DEFAULT_IGNORE;

  // Capture baseline before agent runs
  const baseline = await captureBaseline(projectRoot, ignorePatterns);

  // Run the agent
  const result = await fn();

  // Detect changes made during agent execution
  const changes = await detectChanges(projectRoot, baseline, ignorePatterns);

  // Update fileTree with detected changes
  applyChangesToFileTree(runtime, changes, agentName);

  // Merge _files annotations if present (preserves existing data unless explicitly overwritten)
  if (result && typeof result === 'object' && Array.isArray(result._files)) {
    mergeAnnotations(runtime, result._files);
  }

  return result;
}

/**
 * Apply detected file changes to the runtime's fileTree.
 */
function applyChangesToFileTree(runtime, changes, agentName) {
  const now = new Date().toISOString();
  const projectRoot = runtime.workflowConfig.projectRoot;

  // Initialize fileTree if needed
  if (!runtime._rawMemory.fileTree) {
    runtime._rawMemory.fileTree = {};
  }

  // Handle created files
  for (const filePath of changes.created) {
    try {
      const normalized = normalizePath(filePath, projectRoot);
      runtime._rawMemory.fileTree[normalized] = {
        path: normalized,
        status: 'created',
        createdBy: agentName,
        lastModifiedBy: agentName,
        createdAt: now,
        updatedAt: now
      };
    } catch (e) {
      // Skip files with invalid paths
      console.warn(`[file-tree] Skipping invalid path: ${filePath} - ${e.message}`);
    }
  }

  // Handle modified files
  for (const filePath of changes.modified) {
    try {
      const normalized = normalizePath(filePath, projectRoot);
      const existing = runtime._rawMemory.fileTree[normalized] || {};
      runtime._rawMemory.fileTree[normalized] = {
        ...existing,
        path: normalized,
        status: 'modified',
        lastModifiedBy: agentName,
        updatedAt: now,
        createdAt: existing.createdAt || now,
        createdBy: existing.createdBy || agentName
      };
    } catch (e) {
      console.warn(`[file-tree] Skipping invalid path: ${filePath} - ${e.message}`);
    }
  }

  // Handle renamed files (MVP: from/to pairs)
  for (const { from, to } of changes.renamed) {
    try {
      const normalizedFrom = normalizePath(from, projectRoot);
      const normalizedTo = normalizePath(to, projectRoot);
      const existing = runtime._rawMemory.fileTree[normalizedFrom] || {};
      delete runtime._rawMemory.fileTree[normalizedFrom];
      runtime._rawMemory.fileTree[normalizedTo] = {
        ...existing,
        path: normalizedTo,
        status: 'renamed',
        renamedFrom: normalizedFrom,
        lastModifiedBy: agentName,
        updatedAt: now
      };
    } catch (e) {
      console.warn(`[file-tree] Skipping invalid rename: ${from} -> ${to} - ${e.message}`);
    }
  }

  // Handle deleted files
  for (const filePath of changes.deleted) {
    try {
      const normalized = normalizePath(filePath, projectRoot);
      if (runtime.workflowConfig.fileTrackingKeepDeleted) {
        runtime._rawMemory.fileTree[normalized] = {
          ...runtime._rawMemory.fileTree[normalized],
          status: 'deleted',
          deletedBy: agentName,
          deletedAt: now
        };
      } else {
        delete runtime._rawMemory.fileTree[normalized];
      }
    } catch (e) {
      console.warn(`[file-tree] Skipping invalid path: ${filePath} - ${e.message}`);
    }
  }

  // Trigger persistence
  runtime.memory.fileTree = runtime._rawMemory.fileTree;
}

/**
 * Merge _files annotations from agent result into fileTree.
 * Only annotates files that were actually detected by change tracking.
 * Preserves existing values unless explicitly overwritten.
 */
function mergeAnnotations(runtime, files) {
  const projectRoot = runtime.workflowConfig.projectRoot;

  for (const file of files) {
    if (!file.path) continue;

    try {
      const normalizedPath = normalizePath(file.path, projectRoot);
      const existing = runtime._rawMemory.fileTree?.[normalizedPath];

      if (!existing) continue; // Only annotate files that were actually detected

      // Preserve existing values unless _files explicitly provides new ones
      if (file.caption !== undefined) existing.caption = file.caption;
      if (file.exports !== undefined) existing.exports = file.exports;
      if (file.metadata !== undefined) {
        existing.metadata = { ...existing.metadata, ...file.metadata };
      }

      // Trigger best-effort export extraction if requested
      if (file.extractExports) {
        const absolutePath = path.resolve(projectRoot, normalizedPath);
        const exports = extractExportsFromFile(absolutePath);
        if (exports) existing.exports = exports;
      }
    } catch (e) {
      console.warn(`[file-tree] Skipping invalid annotation path: ${file.path} - ${e.message}`);
    }
  }

  // Trigger persistence
  runtime.memory.fileTree = runtime._rawMemory.fileTree;
}

/**
 * Manually track a file in the fileTree.
 * Used for files created outside of agent execution.
 */
export function trackFile(runtime, relativePath, options = {}) {
  const projectRoot = runtime.workflowConfig.projectRoot;
  const normalized = normalizePath(relativePath, projectRoot);
  const now = new Date().toISOString();
  const agentName = options.agentName || 'manual';

  // Initialize fileTree if needed
  if (!runtime._rawMemory.fileTree) {
    runtime._rawMemory.fileTree = {};
  }

  const existing = runtime._rawMemory.fileTree[normalized];

  const entry = {
    path: normalized,
    status: existing?.status || 'created',
    createdBy: existing?.createdBy || agentName,
    lastModifiedBy: agentName,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };

  // Apply options
  if (options.caption !== undefined) entry.caption = options.caption;
  if (options.exports !== undefined) entry.exports = options.exports;
  if (options.metadata !== undefined) {
    entry.metadata = { ...existing?.metadata, ...options.metadata };
  }

  // Extract exports if requested
  if (options.extractExports) {
    const absolutePath = path.resolve(projectRoot, normalized);
    const exports = extractExportsFromFile(absolutePath);
    if (exports) entry.exports = exports;
  }

  runtime._rawMemory.fileTree[normalized] = entry;

  // Trigger persistence
  runtime.memory.fileTree = runtime._rawMemory.fileTree;

  return entry;
}

/**
 * Get the current fileTree.
 */
export function getFileTree(runtime) {
  return runtime._rawMemory.fileTree || {};
}

/**
 * Remove a file from tracking.
 */
export function untrackFile(runtime, relativePath) {
  const projectRoot = runtime.workflowConfig.projectRoot;
  const normalized = normalizePath(relativePath, projectRoot);

  if (runtime._rawMemory.fileTree?.[normalized]) {
    delete runtime._rawMemory.fileTree[normalized];
    runtime.memory.fileTree = runtime._rawMemory.fileTree;
    return true;
  }

  return false;
}
