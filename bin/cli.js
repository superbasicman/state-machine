#!/usr/bin/env node

import path from 'path';
import fs from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';
import { WorkflowRuntime } from '../lib/index.js';
import { setup } from '../lib/setup.js';
import { startServer } from '../lib/ui/server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
const command = args[0];

function getVersion() {
  try {
    const pkgPath = path.join(__dirname, '../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return pkg.version;
  } catch {
    return 'unknown';
  }
}

// Default remote server URL (can be overridden with STATE_MACHINE_REMOTE_URL env var)
const DEFAULT_REMOTE_URL = process.env.STATE_MACHINE_REMOTE_URL || 'http://localhost:3001';

function printHelp() {
  console.log(`
Agent State Machine CLI (Native JS Workflows Only) v${getVersion()}

Usage:
  state-machine --setup <workflow-name>    Create a new workflow project
  state-machine run <workflow-name> [--remote]  Run a workflow (--remote enables remote follow)
  state-machine follow <workflow-name>    View prompt trace history in browser with live updates
  state-machine status [workflow-name]     Show current state (or list all)
  state-machine history <workflow-name> [limit]  Show execution history logs
  state-machine reset <workflow-name>      Reset workflow state (clears memory/state)
  state-machine reset-hard <workflow-name> Hard reset (clears everything: history/interactions/memory)
  state-machine list                       List all workflows
  state-machine help                       Show this help

Options:
  --setup, -s     Initialize a new workflow with directory structure
  --remote, -r    Enable remote follow (generates shareable URL for browser access)
  --help, -h      Show help
  --version, -v   Show version

Environment Variables:
  STATE_MACHINE_REMOTE_URL    Override the default remote server URL

Workflow Structure:
  workflows/<name>/
  ├── workflow.js        # Native JS workflow (async/await)
  ├── package.json       # Sets "type": "module" for this workflow folder
  ├── agents/            # Custom agents (.js/.mjs/.cjs or .md)
  ├── interactions/      # Human-in-the-loop files (auto-created)
  ├── state/             # current.json, history.jsonl
  └── steering/          # global.md + config.json
`);
}

function workflowsRoot() {
  return path.join(process.cwd(), 'workflows');
}

function resolveWorkflowDir(workflowName) {
  return path.join(workflowsRoot(), workflowName);
}

function resolveWorkflowEntry(workflowDir) {
  const candidates = ['workflow.js', 'workflow.mjs'];
  for (const f of candidates) {
    const p = path.join(workflowDir, f);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function readState(workflowDir) {
  const stateFile = path.join(workflowDir, 'state', 'current.json');
  if (!fs.existsSync(stateFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
  } catch {
    return null;
  }
}

function summarizeStatus(state) {
  if (!state) return ' [no state]';

  const s = String(state.status || '').toUpperCase();
  if (s === 'COMPLETED') return ' [completed]';
  if (s === 'FAILED') return ' [failed - can resume]';
  if (s === 'PAUSED') return ' [paused - can resume]';
  if (s === 'RUNNING') return ' [running]';
  if (s === 'IDLE') return ' [idle]';
  return state.status ? ` [${state.status}]` : '';
}

function listWorkflows() {
  const root = workflowsRoot();

  if (!fs.existsSync(root)) {
    console.log('No workflows directory found.');
    console.log('Run `state-machine --setup <name>` to create your first workflow.');
    return;
  }

  const workflows = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b));

  if (workflows.length === 0) {
    console.log('No workflows found.');
    console.log('Run `state-machine --setup <name>` to create your first workflow.');
    return;
  }

  console.log('\nAvailable Workflows:');
  console.log('─'.repeat(40));

  for (const name of workflows) {
    const dir = resolveWorkflowDir(name);
    const entry = resolveWorkflowEntry(dir);
    const state = readState(dir);

    const entryNote = entry ? '' : ' [missing workflow.js]';
    const statusNote = summarizeStatus(state);

    const pausedNote =
      state && state._pendingInteraction && state._pendingInteraction.file
        ? ` [needs input: ${state._pendingInteraction.file}]`
        : '';

    console.log(`  ${name}${entryNote}${statusNote}${pausedNote}`);
  }

  console.log('');
}

async function runOrResume(workflowName, { remoteEnabled = false } = {}) {
  const workflowDir = resolveWorkflowDir(workflowName);

  if (!fs.existsSync(workflowDir)) {
    console.error(`Error: Workflow '${workflowName}' not found at ${workflowDir}`);
    console.error(`Run: state-machine --setup ${workflowName}`);
    process.exit(1);
  }

  const entry = resolveWorkflowEntry(workflowDir);
  if (!entry) {
    console.error(`Error: No workflow entry found (expected workflow.js or workflow.mjs) in ${workflowDir}`);
    process.exit(1);
  }

  const runtime = new WorkflowRuntime(workflowDir);
  const workflowUrl = pathToFileURL(entry).href;

  // Enable remote follow mode if requested
  if (remoteEnabled) {
    const remoteUrl = process.env.STATE_MACHINE_REMOTE_URL || DEFAULT_REMOTE_URL;
    await runtime.enableRemote(remoteUrl);
  }

  try {
    await runtime.runWorkflow(workflowUrl);
  } finally {
    // Always disable remote on completion
    if (remoteEnabled) {
      await runtime.disableRemote();
    }
  }
}

async function main() {
  if (command === '--version' || command === '-v') {
    console.log(getVersion());
    process.exit(0);
  }

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    process.exit(0);
  }

  if (command === '--setup' || command === '-s') {
    const workflowName = args[1];
    if (!workflowName) {
      console.error('Error: Workflow name required');
      console.error('Usage: state-machine --setup <workflow-name>');
      process.exit(1);
    }
    await setup(workflowName);
    process.exit(0);
  }

  const workflowName = args[1];

  switch (command) {
    case 'run':
      if (!workflowName) {
        console.error('Error: Workflow name required');
        console.error(`Usage: state-machine ${command} <workflow-name> [--remote]`);
        process.exit(1);
      }
      {
        const remoteEnabled = args.includes('--remote') || args.includes('-r');
        try {
          await runOrResume(workflowName, { remoteEnabled });
        } catch (err) {
          console.error('Error:', err.message || String(err));
          process.exit(1);
        }
      }
      break;

    case 'status':
      if (!workflowName) {
        listWorkflows();
        break;
      }
      {
        const workflowDir = resolveWorkflowDir(workflowName);
        const runtime = new WorkflowRuntime(workflowDir);
        runtime.showStatus();
      }
      break;

    case 'history':
      if (!workflowName) {
        console.error('Error: Workflow name required');
        console.error('Usage: state-machine history <workflow-name> [limit]');
        process.exit(1);
      }
      {
        const limit = parseInt(args[2], 10) || 20;
        const workflowDir = resolveWorkflowDir(workflowName);
        const runtime = new WorkflowRuntime(workflowDir);
        runtime.showHistory(limit);
      }
      break;

    case 'follow':
      if (!workflowName) {
        console.error('Error: Workflow name required');
        console.error('Usage: state-machine follow <workflow-name>');
        process.exit(1);
      }
      {
        const workflowDir = resolveWorkflowDir(workflowName);
        if (!fs.existsSync(workflowDir)) {
          console.error(`Error: Workflow '${workflowName}' not found`);
          process.exit(1);
        }
        startServer(workflowDir);
        // Do not exit, server needs to stay alive
      }
      break;

    case 'reset':
      if (!workflowName) {
        console.error('Error: Workflow name required');
        console.error('Usage: state-machine reset <workflow-name>');
        process.exit(1);
      }
      {
        const workflowDir = resolveWorkflowDir(workflowName);
        const runtime = new WorkflowRuntime(workflowDir);
        runtime.reset();
      }
      break;

    case 'reset-hard':
      if (!workflowName) {
        console.error('Error: Workflow name required');
        console.error('Usage: state-machine reset-hard <workflow-name>');
        process.exit(1);
      }
      {
        const workflowDir = resolveWorkflowDir(workflowName);
        const runtime = new WorkflowRuntime(workflowDir);
        runtime.resetHard();
      }
      break;

    case 'list':
      listWorkflows();
      break;

    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
