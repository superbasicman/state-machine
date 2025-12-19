/**
 * File: /lib/runtime/runtime.js
 */

/**
 * WorkflowRuntime - Native JavaScript workflow execution engine
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { createMemoryProxy } from './memory.js';

// Global runtime reference for agent() and memory access
// stored on globalThis to ensure singleton access across different module instances (CLI vs local)
const RUNTIME_KEY = Symbol.for('agent-state-machine.runtime');

// ANSI Colors
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

export function getCurrentRuntime() {
  return globalThis[RUNTIME_KEY];
}

export function setCurrentRuntime(runtime) {
  globalThis[RUNTIME_KEY] = runtime;
}

export function clearCurrentRuntime() {
  globalThis[RUNTIME_KEY] = null;
}

/**
 * WorkflowRuntime class - manages native JS workflow execution
 */
export class WorkflowRuntime {
  constructor(workflowDir) {
    this.workflowDir = workflowDir;
    this.workflowName = path.basename(workflowDir);
    this.stateDir = path.join(workflowDir, 'state');
    this.agentsDir = path.join(workflowDir, 'agents');
    this.interactionsDir = path.join(workflowDir, 'interactions');
    this.steeringDir = path.join(workflowDir, 'steering');
    this.historyFile = path.join(this.stateDir, 'history.jsonl');
    this.stateFile = path.join(this.stateDir, 'current.json');

    // Ensure directories exist
    this.ensureDirectories();

    // Load persisted state
    const savedState = this.loadState();
    this._rawMemory = savedState.memory || {};
    this._error = savedState._error || null;
    this.status = savedState.status || 'IDLE';
    this.startedAt = savedState.startedAt || null;

    // Create memory proxy for auto-persistence
    this.memory = createMemoryProxy(this._rawMemory, () => this.persist());

    // Native workflow config (populated when workflow module is loaded)
    this.workflowConfig = {
      models: {},
      apiKeys: {},
      description: ''
    };

    // Load steering
    this.steering = this.loadSteering();
  }

  ensureDirectories() {
    const dirs = [this.stateDir, this.interactionsDir];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  /**
   * Load state from current.json
   */
  loadState() {
    if (fs.existsSync(this.stateFile)) {
      try {
        return JSON.parse(fs.readFileSync(this.stateFile, 'utf-8'));
      } catch (err) {
        console.warn(`${C.yellow}Warning: Failed to load state: ${err.message}${C.reset}`);
      }
    }
    return {};
  }

  /**
   * Load steering configuration and global prompt
   */
  loadSteering() {
    const configPath = path.join(this.steeringDir, 'config.json');
    const globalPath = path.join(this.steeringDir, 'global.md');

    const steering = {
      enabled: true,
      global: ''
    };

    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        steering.enabled = config.enabled !== false;
      } catch (err) {
        console.warn(`${C.yellow}Warning: Failed to load steering config: ${err.message}${C.reset}`);
      }
    }

    if (fs.existsSync(globalPath)) {
      steering.global = fs.readFileSync(globalPath, 'utf-8');
    }

    return steering;
  }

  /**
   * Persist state to disk
   */
  persist() {
    const state = {
      format: 'native',
      status: this.status,
      memory: this._rawMemory,
      _error: this._error,
      startedAt: this.startedAt,
      lastUpdatedAt: new Date().toISOString()
    };

    fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2));
  }

  /**
   * Prepend an event to history.jsonl (newest first)
   */
  prependHistory(event) {
    const entry = {
      timestamp: new Date().toISOString(),
      ...event
    };

    const line = JSON.stringify(entry) + '\n';

    // Prepend to file (read existing, write new + existing)
    let existing = '';
    if (fs.existsSync(this.historyFile)) {
      existing = fs.readFileSync(this.historyFile, 'utf-8');
    }
    fs.writeFileSync(this.historyFile, line + existing);
  }

  /**
   * Run workflow (load and execute workflow.js)
   */
  async runWorkflow(workflowPath) {
    setCurrentRuntime(this);

    try {
      this.status = 'RUNNING';
      this._error = null;
      if (!this.startedAt) this.startedAt = new Date().toISOString();
      this.persist();

      this.prependHistory({ event: 'WORKFLOW_STARTED' });

      // Import workflow module
      const workflowModule = await import(workflowPath);
      const runFn = workflowModule.default || workflowModule.run || workflowModule;

      // Load workflow config from module export
      const cfg = workflowModule.config || {};
      this.workflowConfig = {
        models: cfg.models || {},
        apiKeys: cfg.apiKeys || {},
        description: cfg.description || ''
      };

      if (typeof runFn !== 'function') {
        throw new Error('Workflow module must export a default async function');
      }

      // Run workflow - interactions block inline, no re-running needed
      await runFn();

      this.status = 'COMPLETED';
      this.persist();
      this.prependHistory({ event: 'WORKFLOW_COMPLETED' });

      console.log(`\n${C.green}✓ Workflow '${this.workflowName}' completed successfully!${C.reset}`);
    } catch (err) {
      this.status = 'FAILED';
      this._error = err.message;
      this.persist();

      this.prependHistory({
        event: 'WORKFLOW_FAILED',
        error: err.message
      });

      console.error(`\n${C.red}✗ Workflow '${this.workflowName}' failed: ${err.message}${C.reset}`);
      throw err;
    } finally {
      clearCurrentRuntime();
    }
  }

  /**
   * Wait for user to confirm interaction is complete, then return the response
   */
  async waitForInteraction(filePath, slug, targetKey) {
    console.log(`\n${C.yellow}${C.bold}⏸  Interaction required.${C.reset} Edit: ${C.cyan}${filePath}${C.reset}`);
    console.log(`  Enter ${C.bold}y${C.reset} to proceed or ${C.bold}q${C.reset} to quit.\n`);

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve, reject) => {
      const ask = () => {
        rl.question(`${C.dim}> ${C.reset}`, (answer) => {
          const a = answer.trim().toLowerCase();
          if (a === 'y') {
            rl.close();
            // Read and return the response
            try {
              const response = this.readInteractionResponse(filePath, slug, targetKey);
              resolve(response);
            } catch (err) {
              reject(err);
            }
          } else if (a === 'q') {
            rl.close();
            reject(new Error('User quit workflow'));
          } else {
            ask();
          }
        });
      };
      ask();
    });
  }

  /**
   * Read the user's response from an interaction file
   */
  readInteractionResponse(filePath, slug, targetKey) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Interaction file not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const response = content.trim();

    if (!response) {
      throw new Error(`Interaction file is empty: ${filePath}`);
    }

    // Store in memory for reference
    this._rawMemory[targetKey] = response;
    this.persist();

    this.prependHistory({
      event: 'INTERACTION_RESOLVED',
      slug,
      targetKey
    });

    console.log(`\n${C.green}✓ Interaction resolved: ${slug}${C.reset}`);
    return response;
  }

  /**
   * Show workflow status
   */
  showStatus() {
    console.log(`\n${C.bold}Workflow: ${C.cyan}${this.workflowName}${C.reset}`);
    console.log(`${C.dim}${'─'.repeat(40)}${C.reset}`);
    
    let statusColor = C.reset;
    if (this.status === 'COMPLETED') statusColor = C.green;
    if (this.status === 'FAILED') statusColor = C.red;
    if (this.status === 'RUNNING') statusColor = C.blue;
    if (this.status === 'IDLE') statusColor = C.gray;
    
    console.log(`Status: ${statusColor}${this.status}${C.reset}`);

    if (this.startedAt) {
      console.log(`Started: ${this.startedAt}`);
    }

    if (this._error) {
      console.log(`Error: ${C.red}${this._error}${C.reset}`);
    }

    const memoryKeys = Object.keys(this._rawMemory).filter((k) => !k.startsWith('_'));
    console.log(`\nMemory Keys: ${C.yellow}${memoryKeys.length}${C.reset}`);
    if (memoryKeys.length > 0) {
      console.log(`  ${memoryKeys.slice(0, 10).join(', ')}${memoryKeys.length > 10 ? '...' : ''}`);
    }
  }

  /**
   * Show execution history
   */
  showHistory(limit = 20) {
    console.log(`\n${C.bold}History: ${C.cyan}${this.workflowName}${C.reset}`);
    console.log(`${C.dim}${'─'.repeat(40)}${C.reset}`);

    if (!fs.existsSync(this.historyFile)) {
      console.log('No history found.');
      return;
    }

    const lines = fs
      .readFileSync(this.historyFile, 'utf-8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .slice(0, limit);

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        const time = entry.timestamp ? entry.timestamp.split('T')[1]?.split('.')[0] : '';
        
        let eventColor = C.reset;
        if (entry.event.endsWith('_STARTED')) eventColor = C.blue;
        if (entry.event.endsWith('_COMPLETED')) eventColor = C.green;
        if (entry.event.endsWith('_FAILED')) eventColor = C.red;
        if (entry.event.includes('INTERACTION')) eventColor = C.yellow;

        console.log(`${C.dim}[${time}]${C.reset} ${eventColor}${entry.event}${C.reset}`);
        if (entry.agent) console.log(`  ${C.dim}Agent:${C.reset} ${entry.agent}`);
        if (entry.slug) console.log(`  ${C.dim}Slug:${C.reset} ${entry.slug}`);
        if (entry.error) console.log(`  ${C.red}Error: ${entry.error}${C.reset}`);
      } catch {}
    }
  }

  /**
   * Reset workflow state (clears memory)
   */
  reset() {
    this._rawMemory = {};
    this._error = null;
    this.status = 'IDLE';
    this.startedAt = null;

    // Recreate memory proxy
    this.memory = createMemoryProxy(this._rawMemory, () => this.persist());

    this.persist();
    this.prependHistory({ event: 'WORKFLOW_RESET' });

    console.log(`\n${C.yellow}✓ Workflow '${this.workflowName}' reset${C.reset}`);
  }

  /**
   * Hard reset workflow state (clears history, interactions, and memory)
   */
  resetHard() {
    // 1. Delete history file
    if (fs.existsSync(this.historyFile)) {
      fs.unlinkSync(this.historyFile);
    }

    // 3. Clear interactions directory
    if (fs.existsSync(this.interactionsDir)) {
      fs.rmSync(this.interactionsDir, { recursive: true, force: true });
      fs.mkdirSync(this.interactionsDir, { recursive: true });
    }

    // 4. Reset internal state and overwrite current.json
    this._rawMemory = {};
    this._error = null;
    this.status = 'IDLE';
    this.startedAt = null;

    // Recreate memory proxy
    this.memory = createMemoryProxy(this._rawMemory, () => this.persist());

    this.persist();

    console.log(`\n${C.red}✓ Workflow '${this.workflowName}' hard reset (history and interactions cleared)${C.reset}`);
  }
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\\]/g, '\\$&'); // $& means the whole matched string
}
