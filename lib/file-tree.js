/**
 * File: /lib/file-tree.js
 *
 * File tree tracking utilities for agent-state-machine.
 * Provides Git-based and filesystem-based change detection.
 */

import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Default ignore patterns (mainly for FS fallback, git respects .gitignore)
export const DEFAULT_IGNORE = [
  'node_modules/**',
  '.git/**',
  'dist/**',
  'build/**',
  'coverage/**',
  '.next/**',
  '.cache/**',
  'workflows/**',
  '*.log',
  '.DS_Store'
];

/**
 * Normalize a path for consistent storage.
 * - Converts backslashes to forward slashes
 * - Rejects absolute paths
 * - Rejects traversal outside projectRoot
 */
export function normalizePath(relativePath, projectRoot) {
  // Normalize slashes
  const normalized = relativePath.replace(/\\/g, '/');

  // Reject absolute paths
  if (path.isAbsolute(normalized)) {
    throw new Error(`Absolute path not allowed: ${normalized}`);
  }

  // Reject traversal outside projectRoot
  const resolved = path.resolve(projectRoot, normalized);
  const normalizedRoot = projectRoot.endsWith(path.sep) ? projectRoot : projectRoot + path.sep;
  if (!resolved.startsWith(normalizedRoot) && resolved !== projectRoot.replace(/\/$/, '')) {
    // Also allow exact match with projectRoot
    if (resolved !== projectRoot) {
      throw new Error(`Path traversal outside projectRoot: ${normalized}`);
    }
  }

  return normalized;
}

/**
 * Check if a path matches any of the ignore patterns.
 */
export function shouldIgnore(relativePath, ignorePatterns = DEFAULT_IGNORE) {
  const normalized = relativePath.replace(/\\/g, '/');

  for (const pattern of ignorePatterns) {
    // Simple glob matching
    if (pattern.endsWith('/**')) {
      const prefix = pattern.slice(0, -3);
      if (normalized.startsWith(prefix + '/') || normalized === prefix) {
        return true;
      }
    } else if (pattern.startsWith('*.')) {
      const ext = pattern.slice(1);
      if (normalized.endsWith(ext)) {
        return true;
      }
    } else if (normalized === pattern || normalized.startsWith(pattern + '/')) {
      return true;
    }
  }

  return false;
}

// ============================================================================
// Git-based change detection
// ============================================================================

/**
 * Parse git status --porcelain -z output into a Map.
 * Format: XY PATH\0 (or XY ORIG\0PATH\0 for renames)
 */
function parseGitStatus(stdout) {
  const files = new Map();
  if (!stdout) return files;

  const entries = stdout.split('\0').filter(Boolean);
  let i = 0;

  while (i < entries.length) {
    const entry = entries[i];
    if (entry.length < 3) {
      i++;
      continue;
    }

    const statusCode = entry.slice(0, 2);
    const filePath = entry.slice(3);

    // Handle renames (R) - next entry is the new path
    if (statusCode.startsWith('R') || statusCode.startsWith('C')) {
      i++;
      const newPath = entries[i];
      if (newPath) {
        files.set(newPath, statusCode);
      }
    } else {
      files.set(filePath, statusCode);
    }

    i++;
  }

  return files;
}

/**
 * Capture current git status as a baseline.
 * Returns Map of file paths to their status codes.
 */
export async function captureGitBaseline(projectRoot) {
  try {
    // Check if git repo
    await execAsync('git rev-parse --git-dir', { cwd: projectRoot });

    // Get status: untracked + staged + unstaged
    const { stdout } = await execAsync(
      'git status --porcelain -z',
      { cwd: projectRoot, maxBuffer: 10 * 1024 * 1024 }
    );

    return { files: parseGitStatus(stdout), isGitRepo: true };
  } catch {
    return { files: new Map(), isGitRepo: false };
  }
}

/**
 * Detect changes between baseline and current state.
 * Only attributes changes made since baseline capture.
 */
export async function detectGitChanges(projectRoot, baseline, ignorePatterns = DEFAULT_IGNORE) {
  const after = await captureGitBaseline(projectRoot);

  const created = [];
  const modified = [];
  const deleted = [];

  // Find new and modified files
  for (const [filePath, status] of after.files) {
    if (shouldIgnore(filePath, ignorePatterns)) continue;

    if (!baseline.files.has(filePath)) {
      created.push(filePath);
    } else if (baseline.files.get(filePath) !== status) {
      modified.push(filePath);
    }
  }

  // Find deleted files
  for (const [filePath] of baseline.files) {
    if (shouldIgnore(filePath, ignorePatterns)) continue;

    if (!after.files.has(filePath)) {
      deleted.push(filePath);
    }
  }

  // MVP: Treat renames as delete+create
  // Future: Use `git diff --name-status -z -M` for rename detection
  return { created, modified, deleted, renamed: [] };
}

// ============================================================================
// Filesystem-based change detection (fallback when no git)
// ============================================================================

/**
 * Recursively walk a directory and collect file info.
 */
async function walkDirectory(dir, baseDir, ignorePatterns, result = new Map()) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return result;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');

    if (shouldIgnore(relativePath, ignorePatterns)) continue;

    if (entry.isDirectory()) {
      await walkDirectory(fullPath, baseDir, ignorePatterns, result);
    } else if (entry.isFile()) {
      try {
        const stats = fs.statSync(fullPath);
        result.set(relativePath, {
          mtime: stats.mtimeMs,
          size: stats.size
        });
      } catch {
        // File may have been deleted between readdir and stat
      }
    }
  }

  return result;
}

/**
 * Capture filesystem snapshot for change detection.
 */
export async function captureFilesystemSnapshot(projectRoot, ignorePatterns = DEFAULT_IGNORE) {
  const files = await walkDirectory(projectRoot, projectRoot, ignorePatterns);
  return { files, isGitRepo: false };
}

/**
 * Detect filesystem changes between baseline and current state.
 */
export async function detectFilesystemChanges(projectRoot, baseline, ignorePatterns = DEFAULT_IGNORE) {
  const after = await captureFilesystemSnapshot(projectRoot, ignorePatterns);

  const created = [];
  const modified = [];
  const deleted = [];

  // Find new and modified files
  for (const [filePath, info] of after.files) {
    const baselineInfo = baseline.files.get(filePath);

    if (!baselineInfo) {
      created.push(filePath);
    } else if (baselineInfo.mtime !== info.mtime || baselineInfo.size !== info.size) {
      modified.push(filePath);
    }
  }

  // Find deleted files
  for (const [filePath] of baseline.files) {
    if (!after.files.has(filePath)) {
      deleted.push(filePath);
    }
  }

  return { created, modified, deleted, renamed: [] };
}

/**
 * Unified baseline capture - uses Git if available, falls back to filesystem.
 */
export async function captureBaseline(projectRoot, ignorePatterns = DEFAULT_IGNORE) {
  const gitBaseline = await captureGitBaseline(projectRoot);

  if (gitBaseline.isGitRepo) {
    return gitBaseline;
  }

  return captureFilesystemSnapshot(projectRoot, ignorePatterns);
}

/**
 * Unified change detection - uses Git if available, falls back to filesystem.
 */
export async function detectChanges(projectRoot, baseline, ignorePatterns = DEFAULT_IGNORE) {
  if (baseline.isGitRepo) {
    return detectGitChanges(projectRoot, baseline, ignorePatterns);
  }

  return detectFilesystemChanges(projectRoot, baseline, ignorePatterns);
}

// ============================================================================
// Export extraction (best-effort)
// ============================================================================

/**
 * Extract exports from JavaScript/TypeScript file content using regex.
 * This is a best-effort extraction, not a full parser.
 */
export function extractExportsFromContent(content) {
  if (!content || typeof content !== 'string') return null;

  const exports = new Set();

  // export const/let/var/function/class Name
  const namedExportPattern = /export\s+(?:const|let|var|function|class|async\s+function)\s+(\w+)/g;
  let match;
  while ((match = namedExportPattern.exec(content)) !== null) {
    exports.add(match[1]);
  }

  // export { Name, Name2 as Alias }
  const bracedExportPattern = /export\s*\{([^}]+)\}/g;
  while ((match = bracedExportPattern.exec(content)) !== null) {
    const items = match[1].split(',');
    for (const item of items) {
      const name = item.trim().split(/\s+as\s+/)[0].trim();
      if (name && /^\w+$/.test(name)) {
        exports.add(name);
      }
    }
  }

  // export default (tracked as 'default')
  if (/export\s+default\s/.test(content)) {
    exports.add('default');
  }

  // module.exports = { name: ... } (CommonJS)
  const cjsPattern = /module\.exports\s*=\s*\{([^}]+)\}/;
  const cjsMatch = content.match(cjsPattern);
  if (cjsMatch) {
    const items = cjsMatch[1].split(',');
    for (const item of items) {
      const name = item.split(':')[0].trim();
      if (name && /^\w+$/.test(name)) {
        exports.add(name);
      }
    }
  }

  // module.exports = Name (CommonJS default)
  const cjsDefaultPattern = /module\.exports\s*=\s*(\w+)\s*[;\n]/;
  const cjsDefaultMatch = content.match(cjsDefaultPattern);
  if (cjsDefaultMatch && cjsDefaultMatch[1] !== '{') {
    exports.add('default');
  }

  return exports.size > 0 ? Array.from(exports).sort() : null;
}

/**
 * Extract exports from a file on disk.
 */
export function extractExportsFromFile(absolutePath) {
  if (!fs.existsSync(absolutePath)) return null;

  const ext = path.extname(absolutePath).toLowerCase();
  if (!['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx'].includes(ext)) return null;

  try {
    const content = fs.readFileSync(absolutePath, 'utf-8');
    return extractExportsFromContent(content);
  } catch {
    return null;
  }
}

// ============================================================================
// File tree management (for manual tracking)
// ============================================================================

// These functions require access to the runtime, so they're implemented
// in track-changes.js and re-exported from index.js
