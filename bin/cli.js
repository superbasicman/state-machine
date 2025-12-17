#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const { StateMachine } = require('../lib');
const { setup } = require('../lib/setup');

const args = process.argv.slice(2);
const command = args[0];

function printHelp() {
  console.log(`
Agent State Machine CLI

Usage:
  state-machine --setup <workflow-name>    Create a new workflow project
  state-machine run <workflow-name>        Run a workflow from the beginning
  state-machine resume <workflow-name>     Resume a failed/stopped workflow
  state-machine status [workflow-name]     Show current state
  state-machine history [workflow-name]    Show execution history
  state-machine reset [workflow-name]      Reset workflow state
  state-machine list                       List all workflows
  state-machine help                       Show this help

Options:
  --setup, -s     Initialize a new workflow with directory structure
  --help, -h      Show help

Examples:
  state-machine --setup my-workflow        Creates workflows/my-workflow/
  state-machine run my-workflow            Runs the my-workflow workflow
  state-machine resume my-workflow         Resumes from last failed step
  state-machine status my-workflow         Shows my-workflow state

Workflow Structure:
  workflows/<name>/
  ├── workflow.js        # Workflow definition
  ├── agents/            # Custom agents (.js or .md)
  ├── scripts/           # Custom scripts  
  ├── state/             # State files (current.json, history.jsonl)
  └── steering/          # Steering configuration (global.md)
`);
}

async function main() {
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    process.exit(0);
  }

  // Handle --setup / -s
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

  // Handle other commands
  const workflowName = args[1];
  const sm = new StateMachine(workflowName);

  switch (command) {
    case 'run':
      if (!workflowName) {
        console.error('Error: Workflow name required');
        console.error('Usage: state-machine run <workflow-name>');
        process.exit(1);
      }
      try {
        await sm.run();
      } catch (err) {
        console.error('Error:', err.message);
        process.exit(1);
      }
      break;

    case 'resume':
      if (!workflowName) {
        console.error('Error: Workflow name required');
        console.error('Usage: state-machine resume <workflow-name>');
        process.exit(1);
      }
      try {
        await sm.resume();
      } catch (err) {
        console.error('Error:', err.message);
        process.exit(1);
      }
      break;

    case 'status':
      sm.showStatus();
      break;

    case 'history':
      const limit = parseInt(args[2]) || 20;
      sm.showHistory(limit);
      break;

    case 'reset':
      sm.reset();
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

function listWorkflows() {
  const workflowsDir = path.join(process.cwd(), 'workflows');

  if (!fs.existsSync(workflowsDir)) {
    console.log('No workflows directory found.');
    console.log('Run `state-machine --setup <name>` to create your first workflow.');
    return;
  }

  const workflows = fs.readdirSync(workflowsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  if (workflows.length === 0) {
    console.log('No workflows found.');
    console.log('Run `state-machine --setup <name>` to create your first workflow.');
    return;
  }

  console.log('\nAvailable Workflows:');
  console.log('─'.repeat(40));
  workflows.forEach(w => {
    const workflowFileJs = path.join(workflowsDir, w, 'workflow.js');
    const stateFile = path.join(workflowsDir, w, 'state', 'current.json');

    let description = 'No description';
    let status = '';

    // Load workflow config
    if (fs.existsSync(workflowFileJs)) {
      try {
        const config = require(workflowFileJs);
        description = config.description || description;
      } catch { }
    }

    // Load state
    if (fs.existsSync(stateFile)) {
      try {
        const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
        if (state.status === 'WORKFLOW_FAILED') {
          status = ' [FAILED - can resume]';
        } else if (state.status === 'WORKFLOW_COMPLETED') {
          status = ' [completed]';
        } else if (state.status === 'RUNNING' || state.status === 'STEP_EXECUTING') {
          status = ' [in progress]';
        }
      } catch { }
    }

    console.log(`  ${w}${status}`);
    console.log(`    ${description}`);
  });
  console.log('');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
