/**
 * Project Builder Workflow
 *
 * A comprehensive workflow that guides users through:
 * 1. Project intake and clarification
 * 2. Phased roadmap generation and approval
 * 3. Sequential phase execution with task lists
 * 4. Task lifecycle with optimal agent sequencing
 */

import { memory, askHuman } from 'agent-state-machine';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  writeMarkdownFile,
  isApproval,
  renderRoadmapMarkdown,
  renderTasksMarkdown,
  safeAgent,
  TASK_STAGES,
  getTaskStage,
  setTaskStage,
  getTaskData,
  setTaskData
} from './scripts/workflow-helpers.js';

// Derive workflow directory dynamically
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKFLOW_DIR = __dirname;
const STATE_DIR = path.join(WORKFLOW_DIR, 'state');

// ============================================
// MAIN WORKFLOW
// ============================================

export default async function () {
  console.log('Starting Project Builder Workflow...\n');

  // ============================================
  // PHASE 1: PROJECT INTAKE
  // ============================================
  console.log('=== PHASE 1: PROJECT INTAKE ===\n');

  if (!memory.projectDescription) {
    const description = await askHuman(
      'Describe the project you want to build. Include any initial requirements, goals, or constraints you have in mind.',
      { slug: 'project-description' }
    );
    memory.projectDescription = description;
  }

  console.log('Project description captured. Starting clarification process...\n');

  // ============================================
  // CLARIFICATION AGENTS (Optimal Sequence)
  // Order: Scope -> Requirements -> Assumptions -> Security
  // Runtime handles interaction blocking automatically
  // ============================================

  // 1. Scope Clarification
  if (!memory.scopeClarified) {
    console.log('--- Scope Clarification ---');
    const scopeResult = await safeAgent('scope-clarifier', {
      projectDescription: memory.projectDescription
    });
    memory.scope = scopeResult;
    memory.scopeClarified = true;
  }

  // 2. Requirements Clarification
  if (!memory.requirementsClarified) {
    console.log('--- Requirements Clarification ---');
    const reqResult = await safeAgent('requirements-clarifier', {
      projectDescription: memory.projectDescription,
      scope: memory.scope
    });
    memory.requirements = reqResult;
    memory.requirementsClarified = true;
  }

  // 3. Assumptions Clarification
  if (!memory.assumptionsClarified) {
    console.log('--- Assumptions Clarification ---');
    const assumeResult = await safeAgent('assumptions-clarifier', {
      projectDescription: memory.projectDescription,
      scope: memory.scope,
      requirements: memory.requirements
    });
    memory.assumptions = assumeResult;
    memory.assumptionsClarified = true;
  }

  // 4. Security Clarification
  if (!memory.securityClarified) {
    console.log('--- Security Clarification ---');
    const secResult = await safeAgent('security-clarifier', {
      projectDescription: memory.projectDescription,
      scope: memory.scope,
      requirements: memory.requirements,
      assumptions: memory.assumptions
    });
    memory.security = secResult;
    memory.securityClarified = true;
  }

  console.log('\nClarification complete. Generating roadmap...\n');

  // ============================================
  // PHASE 2: PHASED ROADMAP
  // ============================================
  console.log('=== PHASE 2: PHASED ROADMAP ===\n');

  if (!memory.roadmapApproved) {
    // Generate roadmap as JSON
    if (!memory.roadmap) {
      const roadmapResult = await safeAgent('roadmap-generator', {
        projectDescription: memory.projectDescription,
        scope: memory.scope,
        requirements: memory.requirements,
        assumptions: memory.assumptions,
        security: memory.security
      });
      memory.roadmap = roadmapResult;
    }

    writeMarkdownFile(STATE_DIR, 'roadmap.md', renderRoadmapMarkdown(memory.roadmap));

    // Roadmap approval loop
    let approved = false;
    while (!approved) {
      const reviewResponse = await askHuman(
        `Please review the roadmap in state/roadmap.md\n\nOptions:\n- A: Approve roadmap as-is\n- B: Request changes (describe what to change)\n\nYour choice:`,
        { slug: 'roadmap-review' }
      );

      if (isApproval(reviewResponse)) {
        approved = true;
        memory.roadmapApproved = true;
        console.log('Roadmap approved!\n');
      } else {
        // Regenerate roadmap with feedback
        const updatedRoadmap = await safeAgent('roadmap-generator', {
          projectDescription: memory.projectDescription,
          scope: memory.scope,
          requirements: memory.requirements,
          assumptions: memory.assumptions,
          security: memory.security,
          feedback: reviewResponse
        });
        memory.roadmap = updatedRoadmap;
        writeMarkdownFile(STATE_DIR, 'roadmap.md', renderRoadmapMarkdown(memory.roadmap));
      }
    }
  }

  // ============================================
  // PHASE 3: PHASE EXECUTION
  // ============================================
  console.log('=== PHASE 3: PHASE EXECUTION ===\n');

  // Initialize phase tracking with proper undefined check
  if (memory.currentPhaseIndex === undefined) {
    memory.currentPhaseIndex = 0;
  }

  const phases = memory.roadmap?.phases || [];

  // Sequential phase processing
  for (let i = memory.currentPhaseIndex; i < phases.length; i++) {
    memory.currentPhaseIndex = i;
    const phase = phases[i];
    console.log(`\n--- Processing Phase ${i + 1}: ${phase.title} ---\n`);

    const tasksKey = `phase_${i}_tasks`;
    const tasksApprovedKey = `phase_${i}_tasks_approved`;

    // Generate task list for this phase (as JSON)
    if (!memory[tasksApprovedKey]) {
      if (!memory[tasksKey]) {
        const taskResult = await safeAgent('task-planner', {
          projectDescription: memory.projectDescription,
          scope: memory.scope,
          requirements: memory.requirements,
          phase: phase,
          phaseIndex: i + 1
        });
        memory[tasksKey] = taskResult;
      }

      writeMarkdownFile(STATE_DIR, `phase-${i + 1}-tasks.md`, renderTasksMarkdown(i + 1, phase.title, memory[tasksKey]?.tasks || memory[tasksKey]));

      // Task list approval loop
      let tasksApproved = false;
      while (!tasksApproved) {
        const taskReview = await askHuman(
          `Please review the task list for Phase ${i + 1} in state/phase-${i + 1}-tasks.md\n\nOptions:\n- A: Approve task list\n- B: Request changes (describe what to change)\n\nYour choice:`,
          { slug: `phase-${i + 1}-task-review` }
        );

        if (isApproval(taskReview)) {
          tasksApproved = true;
          memory[tasksApprovedKey] = true;
          console.log(`Phase ${i + 1} task list approved!\n`);
        } else {
          const updatedTasks = await safeAgent('task-planner', {
            projectDescription: memory.projectDescription,
            scope: memory.scope,
            requirements: memory.requirements,
            phase: phase,
            phaseIndex: i + 1,
            feedback: taskReview
          });
          memory[tasksKey] = updatedTasks;
          writeMarkdownFile(STATE_DIR, `phase-${i + 1}-tasks.md`, renderTasksMarkdown(i + 1, phase.title, memory[tasksKey]?.tasks || memory[tasksKey]));
        }
      }
    }

    // ============================================
    // TASK LIFECYCLE WITH IDEMPOTENCY
    // ============================================
    console.log(`\n=== TASK LIFECYCLE: Phase ${i + 1} ===\n`);

    const tasks = memory[tasksKey]?.tasks || memory[tasksKey] || [];
    const taskIndexKey = `phase_${i}_task_index`;

    // Fix: use undefined check instead of falsy check
    if (memory[taskIndexKey] === undefined) {
      memory[taskIndexKey] = 0;
    }

    // Process each task with optimal agent ordering and idempotency
    for (let t = memory[taskIndexKey]; t < tasks.length; t++) {
      memory[taskIndexKey] = t;
      const task = tasks[t];
      const taskId = task.id || t;

      console.log(`\n  Task ${t + 1}/${tasks.length}: ${task.title}\n`);

      // Get current stage for this task
      let stage = getTaskStage(i, taskId);

      // Store any feedback for this task
      const feedback = getTaskData(i, taskId, 'feedback');

      try {
        // 1. Security Review (pre-implementation)
        if (stage === TASK_STAGES.PENDING || stage === TASK_STAGES.SECURITY_PRE) {
          if (!getTaskData(i, taskId, 'security_pre')) {
            console.log('    > Security pre-review...');
            const securityPreReview = await safeAgent('security-reviewer', {
              task: task,
              phase: phase,
              scope: memory.scope,
              stage: 'pre-implementation',
              feedback: feedback
            });
            setTaskData(i, taskId, 'security_pre', securityPreReview);
          }
          setTaskStage(i, taskId, TASK_STAGES.TEST_PLANNING);
          stage = TASK_STAGES.TEST_PLANNING;
        }

        // 2. Test Planning
        if (stage === TASK_STAGES.TEST_PLANNING) {
          if (!getTaskData(i, taskId, 'tests')) {
            console.log('    > Test planning...');
            const testPlan = await safeAgent('test-planner', {
              task: task,
              phase: phase,
              requirements: memory.requirements,
              securityConsiderations: getTaskData(i, taskId, 'security_pre'),
              feedback: feedback
            });
            setTaskData(i, taskId, 'tests', testPlan);
          }
          setTaskStage(i, taskId, TASK_STAGES.IMPLEMENTING);
          stage = TASK_STAGES.IMPLEMENTING;
        }

        // 3. Code Writing
        if (stage === TASK_STAGES.IMPLEMENTING) {
          if (!getTaskData(i, taskId, 'code')) {
            console.log('    > Code implementation...');
            const implementation = await safeAgent('code-writer', {
              task: task,
              phase: phase,
              requirements: memory.requirements,
              testPlan: getTaskData(i, taskId, 'tests'),
              securityConsiderations: getTaskData(i, taskId, 'security_pre'),
              feedback: feedback
            });
            setTaskData(i, taskId, 'code', implementation);
          }
          setTaskStage(i, taskId, TASK_STAGES.CODE_REVIEW);
          stage = TASK_STAGES.CODE_REVIEW;
        }

        // 4. Code Review
        if (stage === TASK_STAGES.CODE_REVIEW) {
          if (!getTaskData(i, taskId, 'review')) {
            console.log('    > Code review...');
            const codeReview = await safeAgent('code-reviewer', {
              task: task,
              implementation: getTaskData(i, taskId, 'code'),
              testPlan: getTaskData(i, taskId, 'tests'),
              feedback: feedback
            });
            setTaskData(i, taskId, 'review', codeReview);
          }
          setTaskStage(i, taskId, TASK_STAGES.SECURITY_POST);
          stage = TASK_STAGES.SECURITY_POST;
        }

        // 5. Final Security Check
        if (stage === TASK_STAGES.SECURITY_POST) {
          if (!getTaskData(i, taskId, 'security_post')) {
            console.log('    > Final security check...');
            const securityPostReview = await safeAgent('security-reviewer', {
              task: task,
              phase: phase,
              implementation: getTaskData(i, taskId, 'code'),
              stage: 'post-implementation',
              feedback: feedback
            });
            setTaskData(i, taskId, 'security_post', securityPostReview);
          }
          setTaskStage(i, taskId, TASK_STAGES.AWAITING_APPROVAL);
          stage = TASK_STAGES.AWAITING_APPROVAL;
        }

        // 6. Sanity check with user
        if (stage === TASK_STAGES.AWAITING_APPROVAL) {
          const sanityCheck = await askHuman(
            `Task ${t + 1} (${task.title}) complete.\n\nDefinition of Done: ${task.doneDefinition || 'Task completed successfully'}\n\nSanity Check: ${task.sanityCheck || 'Review the implementation and confirm it meets requirements.'}\n\nOptions:\n- A: Confirm task completion\n- B: Flag issue (describe the problem)\n\nYour response:`,
            { slug: `phase-${i + 1}-task-${taskId}-sanity` }
          );

          if (isApproval(sanityCheck)) {
            // Mark task complete
            setTaskStage(i, taskId, TASK_STAGES.COMPLETED);
            task.stage = 'completed';
            memory[tasksKey] = tasks; // Persist updated tasks
            writeMarkdownFile(STATE_DIR, `phase-${i + 1}-tasks.md`, renderTasksMarkdown(i + 1, phase.title, tasks));
            console.log(`    Task ${t + 1} confirmed complete!\n`);
          } else {
            // Store feedback and reset task for reprocessing
            console.log('    > Issue flagged, reprocessing task with feedback...');
            setTaskData(i, taskId, 'feedback', sanityCheck);

            // Clear previous outputs to force regeneration
            setTaskData(i, taskId, 'security_pre', null);
            setTaskData(i, taskId, 'tests', null);
            setTaskData(i, taskId, 'code', null);
            setTaskData(i, taskId, 'review', null);
            setTaskData(i, taskId, 'security_post', null);

            // Reset to pending and reprocess same task
            setTaskStage(i, taskId, TASK_STAGES.PENDING);
            t--; // Reprocess this task
          }
        }

      } catch (error) {
        console.error(`    Task ${t + 1} failed: ${error.message}`);
        setTaskStage(i, taskId, TASK_STAGES.FAILED);

        const retry = await askHuman(
          `Task "${task.title}" failed with error: ${error.message}\n\nOptions:\n- A: Retry this task\n- B: Skip and continue\n- C: Abort workflow\n\nYour choice:`,
          { slug: `phase-${i + 1}-task-${taskId}-error` }
        );

        const retryTrimmed = retry.trim().toLowerCase();
        if (retryTrimmed.startsWith('a') || retryTrimmed.startsWith('retry')) {
          setTaskStage(i, taskId, TASK_STAGES.PENDING);
          t--; // Retry this task
        } else if (retryTrimmed.startsWith('c') || retryTrimmed.startsWith('abort')) {
          throw new Error('Workflow aborted by user');
        }
        // Otherwise skip and continue to next task
      }
    }

    // Mark phase complete in roadmap
    phase.completed = true;
    memory.roadmap.phases[i] = phase;
    writeMarkdownFile(STATE_DIR, 'roadmap.md', renderRoadmapMarkdown(memory.roadmap));
    console.log(`\nPhase ${i + 1} completed!\n`);
  }

  console.log('\n=== PROJECT BUILD COMPLETE ===\n');
  memory.projectComplete = true;
}
