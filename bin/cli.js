#!/usr/bin/env node

import path from 'path';
import fs from 'fs';
import readline from 'readline';
import { spawn } from 'child_process';
import { pathToFileURL, fileURLToPath } from 'url';
import { WorkflowRuntime } from '../lib/index.js';
import { setup } from '../lib/setup.js';
import { generateSessionToken } from '../lib/remote/client.js';
import { readRemotePathFromConfig, writeRemotePathToConfig } from '../lib/config-utils.js';

import { startLocalServer } from '../vercel-server/local-server.js';

/**
 * Prevent system sleep on macOS using caffeinate
 * Returns a function to stop caffeinate, or null if not available
 */
function preventSleep() {
  // Only works on macOS
  if (process.platform !== 'darwin') {
    return null;
  }

  try {
    // -i: prevent idle sleep (system stays awake)
    // -s: prevent sleep when on AC power
    // Display can still sleep (screen goes black, requires password)
    const caffeinate = spawn('caffeinate', ['-is'], {
      stdio: 'ignore',
      detached: false,
    });

    caffeinate.on('error', () => {
      // caffeinate not available, ignore
    });

    return () => {
      try {
        caffeinate.kill();
      } catch {
        // Already dead, ignore
      }
    };
  } catch {
    return null;
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let args = process.argv.slice(2);
let command = args[0];
const legacyResetCommand = command === '-reset' || command === '-reset-hard';
if (legacyResetCommand) {
  command = command.slice(1);
  args = [command, ...args.slice(1)];
}

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
const DEFAULT_REMOTE_URL = process.env.STATE_MACHINE_REMOTE_URL || 'https://supamachine.vercel.app';

function printHelp() {
  console.log(`
Agent State Machine CLI (Native JS Workflows Only) v${getVersion()}

Usage:
  state-machine --setup <workflow-name> [--template <template-name>]    Create a new workflow project
  state-machine run <workflow-name>        Run a workflow (remote follow enabled by default)
  state-machine run <workflow-name> -l  Run with local server (localhost:3000)
  state-machine run <workflow-name> -n  Generate a new remote follow path
  state-machine run <workflow-name> -reset  Reset workflow state before running
  state-machine run <workflow-name> -reset-hard  Hard reset workflow before running

  state-machine -reset <workflow-name>     Reset workflow state (legacy alias)
  state-machine -reset-hard <workflow-name> Hard reset workflow (legacy alias)
  state-machine status [workflow-name]     Show current state (or list all)
  state-machine history <workflow-name> [limit]  Show execution history logs
  state-machine reset <workflow-name>      Reset workflow state (clears memory/state)
  state-machine reset-hard <workflow-name> Hard reset (clears everything: history/interactions/memory)
  state-machine list                       List all workflows
  state-machine help                       Show this help

Options:
  --setup, -s     Initialize a new workflow with directory structure
  --template, -t  Template name for --setup (default: starter)
  --local, -l     Use local server instead of remote (starts on localhost:3000)
  --new, -n       Generate a new remote follow path
  --full-auto, -a Auto-select first option for choice interactions (no blocking)
  --delay, -d     Seconds to wait before auto-select in full-auto mode (default: 20)
  --non-verbose, -q  Suppress per-agent token usage display (show only final summary)
  -reset          Reset workflow state before running
  -reset-hard     Hard reset workflow before running
  --help, -h      Show help
  --version, -v   Show version

Environment Variables:
  STATE_MACHINE_REMOTE_URL    Override the default remote server URL (for local dev testing)

Workflow Structure:
  .workflows/<name>/
  ├── workflow.js        # Native JS workflow (async/await)
  ├── config.js          # Model/API key configuration
  ├── package.json       # Sets "type": "module" for this workflow folder
  ├── agents/            # Custom agents (.js/.mjs/.cjs or .md)
  ├── interactions/      # Human-in-the-loop files (auto-created)
  ├── state/             # current.json, history.jsonl
  └── steering/          # global.md + config.json
`);
}

async function confirmHardReset(workflowName) {
  if (!process.stdin.isTTY) {
    console.error('Error: Hard reset requires confirmation in a TTY.');
    return false;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));
  try {
    const answer = String(
      await ask(
        `Hard reset deletes history, interactions, and memory for '${workflowName}'. Type 'y' to continue: `
      )
    )
      .trim()
      .toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

function workflowsRoot() {
  return path.join(process.cwd(), '.workflows');
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

function ensureRemotePath(configFile, { forceNew = false } = {}) {
  const existing = readRemotePathFromConfig(configFile);
  if (existing && !forceNew) return existing;

  const remotePath = generateSessionToken();
  writeRemotePathToConfig(configFile, remotePath);
  return remotePath;
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
  if (s === 'STOPPED') return ' [stopped - can resume]';
  if (s === 'RUNNING') return ' [running]';
  if (s === 'IDLE') return ' [idle]';
  return state.status ? ` [${state.status}]` : '';
}

/**
 * Display usage summary after workflow completion
 */
function displayUsageSummary(runtime) {
  const u = runtime._usageTotals;
  if (!u || (!u.totalInputTokens && !u.totalOutputTokens)) return;

  const C = {
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    cyan: '\x1b[36m',
    reset: '\x1b[0m'
  };

  const formatTokens = (count) => {
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 10000) return `${Math.round(count / 1000)}k`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
    return count.toString();
  };

  console.log(`\n${C.bold}Token Usage Summary${C.reset}`);
  console.log(`${C.dim}${'─'.repeat(40)}${C.reset}`);
  console.log(`  Input:  ${formatTokens(u.totalInputTokens)}`);
  console.log(`  Output: ${formatTokens(u.totalOutputTokens)}`);
  if (u.totalCachedTokens > 0) {
    console.log(`  Cached: ${formatTokens(u.totalCachedTokens)}`);
  }
  console.log(`  ${C.bold}Total:  ${formatTokens(u.totalInputTokens + u.totalOutputTokens)}${C.reset}`);
  if (u.totalCost > 0) {
    console.log(`  ${C.cyan}Cost:   $${u.totalCost.toFixed(4)}${C.reset}`);
  }

  // Show per-model breakdown if multiple models used
  const models = Object.keys(u.modelUsage || {});
  if (models.length > 1) {
    console.log(`\n${C.dim}By Model:${C.reset}`);
    for (const model of models) {
      const m = u.modelUsage[model];
      console.log(`  ${model}: ${formatTokens(m.inputTokens)} in / ${formatTokens(m.outputTokens)} out`);
    }
  }
}

function listWorkflows() {
  const root = workflowsRoot();

  if (!fs.existsSync(root)) {
    console.log('No .workflows directory found.');
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

async function runOrResume(
  workflowName,
  {
    remoteEnabled = false,
    useLocalServer = false,
    forceNewRemotePath = false,
    preReset = false,
    preResetHard = false,
    fullAuto = false,
    autoSelectDelay = null,
    nonVerbose = false
  } = {}
) {
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
  if (preResetHard) {
    const confirmed = await confirmHardReset(workflowName);
    if (!confirmed) {
      console.log('Hard reset cancelled.');
      return;
    }
    runtime.resetHard();
  } else if (preReset) {
    runtime.reset();
  }

  const workflowUrl = pathToFileURL(entry).href;
  const configFile = path.join(workflowDir, 'config.js');

  let localServer = null;
  let remoteUrl = null;

  // Start local server if --local flag is used
  if (useLocalServer) {
    try {
      const result = await startLocalServer(3000, true);
      localServer = result.server;
      remoteUrl = result.url;
      console.log(`Local server started at ${remoteUrl}`);
    } catch (err) {
      console.error(`Failed to start local server: ${err.message}`);
      process.exit(1);
    }
  } else if (remoteEnabled) {
    remoteUrl = process.env.STATE_MACHINE_REMOTE_URL || DEFAULT_REMOTE_URL;
  }

  // Set full-auto mode from CLI flag BEFORE enabling remote (so session_init includes correct config)
  if (fullAuto) {
    runtime.workflowConfig.fullAuto = true;
    if (autoSelectDelay !== null) {
      runtime.workflowConfig.autoSelectDelay = autoSelectDelay;
    }
    const delay = runtime.workflowConfig.autoSelectDelay;
    console.log(`\n\x1b[36m\x1b[1m⚡ Full-auto mode enabled\x1b[0m - Agent will auto-select recommended options after ${delay}s countdown`);
  }

  // Enable remote follow mode if we have a URL
  if (remoteUrl) {
    const sessionToken = ensureRemotePath(configFile, { forceNew: forceNewRemotePath });
    await runtime.enableRemote(remoteUrl, { sessionToken, uiBaseUrl: useLocalServer });
  }

  // Set non-verbose mode from CLI flag
  if (nonVerbose) {
    runtime.workflowConfig.nonVerbose = true;
  }

  // Prevent system sleep while workflow runs (macOS only)
  // Display can still sleep, but system stays awake for remote follow
  const stopCaffeinate = preventSleep();
  if (stopCaffeinate) {
    console.log('☕ Preventing system sleep while workflow runs (display may still sleep)');
  }

  try {
    await runtime.runWorkflow(workflowUrl);

    // Display usage summary after workflow completion
    displayUsageSummary(runtime);
  } finally {
    // Allow sleep again
    if (stopCaffeinate) {
      stopCaffeinate();
    }

    // Keep local server alive after run so the session remains accessible.
    if (!useLocalServer && remoteUrl) {
      await runtime.disableRemote();
    }
    if (!useLocalServer && localServer) {
      localServer.close();
    }
  }

  if (useLocalServer) {
    console.log('Local server still running for follow session. Press Ctrl+C to stop.');
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
      console.error('Usage: state-machine --setup <workflow-name> [--template <template-name>]');
      process.exit(1);
    }
    const templateFlagIndex = args.findIndex((arg) => arg === '--template' || arg === '-t');
    let templateName = null;
    if (templateFlagIndex !== -1) {
      templateName = args[templateFlagIndex + 1];
      if (!templateName || templateName.startsWith('-')) {
        console.error('Error: Template name required');
        console.error('Usage: state-machine --setup <workflow-name> [--template <template-name>]');
        process.exit(1);
      }
    }
    await setup(workflowName, { template: templateName || undefined });
    process.exit(0);
  }

  const workflowName = args[1];

  switch (command) {
    case 'run':
      if (!workflowName) {
        console.error('Error: Workflow name required');
        console.error(`Usage: state-machine ${command} <workflow-name> [--local] [--new] [-reset] [-reset-hard]`);
        process.exit(1);
      }
      {
        // Remote is enabled by default, --local uses local server instead
        const useLocalServer = args.includes('--local') || args.includes('-l');
        const forceNewRemotePath = args.includes('--new') || args.includes('-n');
        const preReset = args.includes('-reset');
        const preResetHard = args.includes('-reset-hard');
        const fullAuto = args.includes('--full-auto') || args.includes('-a');
        const nonVerbose = args.includes('--non-verbose') || args.includes('-q') || args.includes('--quiet');
        const remoteEnabled = !useLocalServer; // Use Vercel if not local

        // Parse --delay or -d flag
        let autoSelectDelay = null;
        const delayFlagIndex = args.findIndex((arg) => arg === '--delay' || arg === '-d');
        if (delayFlagIndex !== -1 && args[delayFlagIndex + 1]) {
          const delayValue = parseInt(args[delayFlagIndex + 1], 10);
          if (!isNaN(delayValue) && delayValue >= 0) {
            autoSelectDelay = delayValue;
          }
        }

        try {
          await runOrResume(workflowName, {
            remoteEnabled,
            useLocalServer,
            forceNewRemotePath,
            preReset,
            preResetHard,
            fullAuto,
            autoSelectDelay,
            nonVerbose
          });
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
        const confirmed = await confirmHardReset(workflowName);
        if (!confirmed) {
          console.log('Hard reset cancelled.');
          process.exit(0);
        }
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
