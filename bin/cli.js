#!/usr/bin/env node

import path from 'path';
import fs from 'fs';
import readline from 'readline';
import { pathToFileURL, fileURLToPath } from 'url';
import { WorkflowRuntime } from '../lib/index.js';
import { setup } from '../lib/setup.js';
import { generateSessionToken } from '../lib/remote/client.js';

import { startLocalServer } from '../vercel-server/local-server.js';

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
const DEFAULT_REMOTE_URL = process.env.STATE_MACHINE_REMOTE_URL || 'https://supamachine.vercel.app';

function printHelp() {
  console.log(`
Agent State Machine CLI (Native JS Workflows Only) v${getVersion()}

Usage:
  state-machine --setup <workflow-name>    Create a new workflow project
  state-machine run <workflow-name>        Run a workflow (remote follow enabled by default)
  state-machine run <workflow-name> -l  Run with local server (localhost:3000)
  state-machine run <workflow-name> -n  Generate a new remote follow path
  state-machine run <workflow-name> -reset  Reset workflow state before running
  state-machine run <workflow-name> -reset-hard  Hard reset workflow before running

  state-machine status [workflow-name]     Show current state (or list all)
  state-machine history <workflow-name> [limit]  Show execution history logs
  state-machine reset <workflow-name>      Reset workflow state (clears memory/state)
  state-machine reset-hard <workflow-name> Hard reset (clears everything: history/interactions/memory)
  state-machine list                       List all workflows
  state-machine help                       Show this help

Options:
  --setup, -s     Initialize a new workflow with directory structure
  --local, -l     Use local server instead of remote (starts on localhost:3000)
  --new, -n       Generate a new remote follow path
  -reset          Reset workflow state before running
  -reset-hard     Hard reset workflow before running
  --help, -h      Show help
  --version, -v   Show version

Environment Variables:
  STATE_MACHINE_REMOTE_URL    Override the default remote server URL (for local dev testing)

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

function findConfigObjectRange(source) {
  const match = source.match(/export\s+const\s+config\s*=/);
  if (!match) return null;
  const startSearch = match.index + match[0].length;
  const braceStart = source.indexOf('{', startSearch);
  if (braceStart === -1) return null;

  let depth = 0;
  let inString = null;
  let inLineComment = false;
  let inBlockComment = false;
  let escape = false;

  for (let i = braceStart; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === inString) {
        inString = null;
      }
      continue;
    }

    if (ch === '"' || ch === '\'' || ch === '`') {
      inString = ch;
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }

    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }

    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return { start: braceStart, end: i };
      }
    }
  }

  return null;
}

function readRemotePathFromWorkflow(workflowFile) {
  const source = fs.readFileSync(workflowFile, 'utf-8');
  const range = findConfigObjectRange(source);
  if (!range) return null;
  const configSource = source.slice(range.start, range.end + 1);
  const match = configSource.match(/\bremotePath\s*:\s*(['"`])([^'"`]+)\1/);
  return match ? match[2] : null;
}

function writeRemotePathToWorkflow(workflowFile, remotePath) {
  const source = fs.readFileSync(workflowFile, 'utf-8');
  const range = findConfigObjectRange(source);
  const remoteLine = `remotePath: "${remotePath}"`;

  if (!range) {
    const hasConfigExport = /export\s+const\s+config\s*=/.test(source);
    if (hasConfigExport) {
      throw new Error('Workflow config export is not an object literal; add remotePath manually.');
    }
    const trimmed = source.replace(/\s*$/, '');
    const appended = `${trimmed}\n\nexport const config = {\n  ${remoteLine}\n};\n`;
    fs.writeFileSync(workflowFile, appended);
    return;
  }

  const configSource = source.slice(range.start, range.end + 1);
  const remoteRegex = /\bremotePath\s*:\s*(['"`])([^'"`]*?)\1/;
  let updatedConfigSource;

  if (remoteRegex.test(configSource)) {
    updatedConfigSource = configSource.replace(remoteRegex, remoteLine);
  } else {
    const inner = configSource.slice(1, -1);
    const indentMatch = inner.match(/\n([ \t]+)\S/);
    const indent = indentMatch ? indentMatch[1] : '  ';
    const trimmedInner = inner.replace(/\s*$/, '');
    const hasContent = trimmedInner.trim().length > 0;
    let updatedInner = trimmedInner;

    if (hasContent) {
      for (let i = updatedInner.length - 1; i >= 0; i -= 1) {
        const ch = updatedInner[i];
        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') continue;
        if (ch !== ',') {
          updatedInner += ',';
        }
        break;
      }
    }

    const needsNewline = updatedInner && !updatedInner.endsWith('\n');
    const insert = `${indent}${remoteLine},\n`;
    const newInner = hasContent
      ? `${updatedInner}${needsNewline ? '\n' : ''}${insert}`
      : `\n${insert}`;
    updatedConfigSource = `{${newInner}}`;
  }

  const updatedSource =
    source.slice(0, range.start) +
    updatedConfigSource +
    source.slice(range.end + 1);
  fs.writeFileSync(workflowFile, updatedSource);
}

function ensureRemotePath(workflowFile, { forceNew = false } = {}) {
  const existing = readRemotePathFromWorkflow(workflowFile);
  if (existing && !forceNew) return existing;

  const remotePath = generateSessionToken();
  writeRemotePathToWorkflow(workflowFile, remotePath);
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

async function runOrResume(
  workflowName,
  {
    remoteEnabled = false,
    useLocalServer = false,
    forceNewRemotePath = false,
    preReset = false,
    preResetHard = false
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

  // Enable remote follow mode if we have a URL
  if (remoteUrl) {
    const sessionToken = ensureRemotePath(entry, { forceNew: forceNewRemotePath });
    await runtime.enableRemote(remoteUrl, { sessionToken });
  }

  try {
    await runtime.runWorkflow(workflowUrl);
  } finally {
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
        console.error(`Usage: state-machine ${command} <workflow-name> [--local] [--new] [-reset] [-reset-hard]`);
        process.exit(1);
      }
      {
        // Remote is enabled by default, --local uses local server instead
        const useLocalServer = args.includes('--local') || args.includes('-l');
        const forceNewRemotePath = args.includes('--new') || args.includes('-n');
        const preReset = args.includes('-reset');
        const preResetHard = args.includes('-reset-hard');
        const remoteEnabled = !useLocalServer; // Use Vercel if not local
        try {
          await runOrResume(workflowName, {
            remoteEnabled,
            useLocalServer,
            forceNewRemotePath,
            preReset,
            preResetHard
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
