import fs from 'fs';
import path from 'path';
import { memory, getCurrentRuntime } from 'agent-state-machine';

// Write implementation files from code-writer agent output
function writeImplementationFiles(implementation) {
  const runtime = getCurrentRuntime();
  if (!runtime) {
    throw new Error('writeImplementationFiles must be called within a workflow context');
  }

  const projectRoot = runtime.workflowConfig.projectRoot;
  const files = implementation?.implementation?.files || implementation?.files || [];
  const written = [];

  for (const file of files) {
    if (!file.path || !file.code) {
      console.warn(`  [File] Skipping invalid file entry: ${JSON.stringify(file)}`);
      continue;
    }

    const fullPath = path.resolve(projectRoot, file.path);

    // Ensure directory exists
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(fullPath, file.code);
    written.push(file.path);
    console.log(`  [File] Created: ${file.path}`);
  }

  return written;
}

// Write markdown file to workflow state directory
function writeMarkdownFile(stateDir, filename, content) {
  if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
  const filePath = path.join(stateDir, filename);
  fs.writeFileSync(filePath, content);
  console.log(`  [File] Updated: ${filename}`);
  return filePath;
}

// Strict approval parsing - only accepts explicit approval
function isApproval(response) {
  if (!response || typeof response !== 'string') return false;
  const trimmed = response.trim().toLowerCase();
  // Must start with 'a' or be exactly 'approve/approved/yes/y'
  return /^a\b/.test(trimmed) ||
         /^approve/.test(trimmed) ||
         /^yes\b/.test(trimmed) ||
         /^y\b/.test(trimmed);
}

// Generate markdown from roadmap JSON
function renderRoadmapMarkdown(roadmap) {
  if (!roadmap || !roadmap.phases) return '# Project Roadmap\n\nNo phases defined.';

  let md = `# Project Roadmap: ${roadmap.title || 'Untitled Project'}\n\n`;

  for (const phase of roadmap.phases) {
    const status = phase.completed ? ' [COMPLETED]' : '';
    md += `## Phase ${phase.number}: ${phase.title}${status}\n`;
    md += `**Objective:** ${phase.objective || 'No objective specified'}\n\n`;

    for (const item of phase.checklist || []) {
      const check = item.completed ? 'x' : ' ';
      md += `- [${check}] ${item.text}\n`;
    }
    md += '\n';
  }

  if (roadmap.notes && roadmap.notes.length > 0) {
    md += '---\n\n**Notes:**\n';
    for (const note of roadmap.notes) {
      md += `- ${note}\n`;
    }
  }

  return md;
}

// Generate markdown from tasks JSON
function renderTasksMarkdown(phaseNumber, phaseTitle, tasks) {
  if (!tasks || !Array.isArray(tasks)) return `# Phase ${phaseNumber} Tasks\n\nNo tasks defined.`;

  let md = `# Phase ${phaseNumber} Tasks: ${phaseTitle}\n\n`;

  for (const task of tasks) {
    const status = task.stage === 'completed' ? ' [COMPLETED]' :
                   task.stage === 'in_progress' ? ' [IN PROGRESS]' : '';
    md += `## Task ${task.id}: ${task.title}${status}\n`;
    md += `**Description:** ${task.description || 'No description'}\n\n`;
    md += `**Definition of Done:**\n- ${task.doneDefinition || 'Task completed successfully'}\n\n`;
    md += `**Sanity Check:**\n- ${task.sanityCheck || 'Review the implementation and confirm it meets requirements.'}\n\n`;
    md += '---\n\n';
  }

  md += '## Checklist Summary\n';
  for (const task of tasks) {
    const check = task.stage === 'completed' ? 'x' : ' ';
    md += `- [${check}] Task ${task.id}: ${task.title}\n`;
  }

  return md;
}

// Task stage management
const TASK_STAGES = {
  PENDING: 'pending',
  SECURITY_PRE: 'security_pre',
  TEST_PLANNING: 'test_planning',
  IMPLEMENTING: 'implementing',
  CODE_REVIEW: 'code_review',
  SECURITY_POST: 'security_post',
  SANITY_CHECK: 'sanity_check',
  AWAITING_APPROVAL: 'awaiting_approval',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

function getTaskStage(phaseIndex, taskId) {
  const key = `phase_${phaseIndex}_task_${taskId}_stage`;
  return memory[key] || TASK_STAGES.PENDING;
}

function setTaskStage(phaseIndex, taskId, stage) {
  const key = `phase_${phaseIndex}_task_${taskId}_stage`;
  memory[key] = stage;
}

function getTaskData(phaseIndex, taskId, dataKey) {
  const key = `phase_${phaseIndex}_task_${taskId}_${dataKey}`;
  return memory[key];
}

function setTaskData(phaseIndex, taskId, dataKey, value) {
  const key = `phase_${phaseIndex}_task_${taskId}_${dataKey}`;
  memory[key] = value;
}

function clearPartialTaskData(phaseIndex, taskId, keepKeys = []) {
  const allKeys = [
    'security_pre',
    'tests',
    'code',
    'review',
    'security_post',
    'sanity_checks',
    'sanity_results'
  ];
  for (const key of allKeys) {
    if (!keepKeys.includes(key)) {
      setTaskData(phaseIndex, taskId, key, null);
    }
  }
}

function getQuickFixAttempts(phaseIndex, taskId) {
  return getTaskData(phaseIndex, taskId, 'quick_fix_attempts') || 0;
}

function incrementQuickFixAttempts(phaseIndex, taskId) {
  const current = getQuickFixAttempts(phaseIndex, taskId);
  setTaskData(phaseIndex, taskId, 'quick_fix_attempts', current + 1);
}

function resetQuickFixAttempts(phaseIndex, taskId) {
  setTaskData(phaseIndex, taskId, 'quick_fix_attempts', 0);
}

function detectTestFramework() {
  const runtime = getCurrentRuntime();
  const projectRoot = runtime?.workflowConfig?.projectRoot || process.cwd();
  const pkgPath = path.join(projectRoot, 'package.json');

  if (!fs.existsSync(pkgPath)) {
    return { framework: 'vitest', command: 'npx vitest run', isDefault: true };
  }

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  } catch (error) {
    console.warn(`  [Test] Failed to parse package.json: ${error.message}`);
    return { framework: 'vitest', command: 'npx vitest run', isDefault: true };
  }

  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const testScript = pkg.scripts?.test || '';

  if (testScript.includes('vitest') || deps.vitest) {
    return { framework: 'vitest', command: 'npm test' };
  }
  if (testScript.includes('jest') || deps.jest) {
    return { framework: 'jest', command: 'npm test' };
  }
  if (testScript.includes('mocha') || deps.mocha) {
    return { framework: 'mocha', command: 'npm test' };
  }

  return { framework: 'vitest', command: 'npx vitest run', isDefault: true };
}

export {
  writeMarkdownFile,
  writeImplementationFiles,
  isApproval,
  renderRoadmapMarkdown,
  renderTasksMarkdown,
  TASK_STAGES,
  getTaskStage,
  setTaskStage,
  getTaskData,
  setTaskData,
  clearPartialTaskData,
  getQuickFixAttempts,
  incrementQuickFixAttempts,
  resetQuickFixAttempts,
  detectTestFramework
};
