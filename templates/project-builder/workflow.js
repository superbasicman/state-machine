/**
 * Project Builder Workflow
 *
 * A comprehensive workflow that guides users through:
 * 1. Project intake and clarification
 * 2. Phased roadmap generation and approval
 * 3. Sequential phase execution with task lists
 * 4. Task lifecycle with optimal agent sequencing
 */

import { agent, memory, askHuman, getCurrentRuntime } from 'agent-state-machine';
import path from 'path';
import { fileURLToPath } from 'url';
import {
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
} from './scripts/workflow-helpers.js';
import {
  createInteraction,
  parseResponse,
  formatInteractionPrompt as formatPrompt
} from './scripts/interaction-helpers.js';

// Derive workflow directory dynamically
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKFLOW_DIR = __dirname;
const STATE_DIR = path.join(WORKFLOW_DIR, 'state');

// ANSI Colors for console output
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m'
};

function applyFixesToImplementation(originalImplementation, fixes) {
  if (!originalImplementation || !Array.isArray(fixes) || fixes.length === 0) {
    return originalImplementation;
  }

  const updated = { ...originalImplementation };
  const container = updated.implementation ? { ...updated.implementation } : updated;
  const files = Array.isArray(container.files) ? [...container.files] : [];

  for (const fix of fixes) {
    if (!fix?.path || !fix?.code) {
      console.warn(`  [Fix] Skipping invalid fix entry: ${JSON.stringify(fix)}`);
      continue;
    }
    if (fix.operation && fix.operation !== 'replace') {
      console.warn(`  [Fix] Unsupported operation "${fix.operation}" for ${fix.path}`);
      continue;
    }

    const existingIndex = files.findIndex((file) => file.path === fix.path);
    const nextFile = {
      ...(existingIndex >= 0 ? files[existingIndex] : {}),
      path: fix.path,
      code: fix.code,
      purpose: fix.purpose || (existingIndex >= 0 ? files[existingIndex].purpose : 'Updated by code-fixer')
    };

    if (existingIndex >= 0) {
      files[existingIndex] = nextFile;
    } else {
      files.push(nextFile);
    }
  }

  if (updated.implementation) {
    updated.implementation = { ...container, files };
    return updated;
  }

  return { ...updated, files };
}

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
    const descriptionInteraction = createInteraction('text', 'project-description', {
      prompt: 'Describe the project you want to build. Include any initial requirements, goals, or constraints you have in mind.',
      placeholder: 'A web app that...',
      validation: { minLength: 20 }
    });
    const descriptionRaw = await askHuman(formatPrompt(descriptionInteraction), {
      slug: descriptionInteraction.slug,
      interaction: descriptionInteraction
    });
    const descriptionParsed = await parseResponse(descriptionInteraction, descriptionRaw);
    memory.projectDescription = descriptionParsed.text || descriptionParsed.raw || descriptionRaw;
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
    const scopeResult = await agent('scope-clarifier', {
      projectDescription: memory.projectDescription
    });
    memory.scope = scopeResult;
    memory.scopeClarified = true;
  }

  // 2. Requirements Clarification
  if (!memory.requirementsClarified) {
    console.log('--- Requirements Clarification ---');
    const reqResult = await agent('requirements-clarifier', {
      projectDescription: memory.projectDescription,
      scope: memory.scope
    });
    memory.requirements = reqResult;
    memory.requirementsClarified = true;
  }

  // 3. Assumptions Clarification
  if (!memory.assumptionsClarified) {
    console.log('--- Assumptions Clarification ---');
    const assumeResult = await agent('assumptions-clarifier', {
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
    const secResult = await agent('security-clarifier', {
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
      const roadmapResult = await agent('roadmap-generator', {
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
      const roadmapInteraction = createInteraction('choice', 'roadmap-review', {
        prompt: 'Please review the roadmap in state/roadmap.md.\nHow would you like to proceed?',
        options: [
          { key: 'approve', label: 'Approve roadmap as-is' },
          { key: 'changes', label: 'Request changes', description: 'Describe what to change' }
        ],
        allowCustom: true
      });

      const reviewRaw = await askHuman(formatPrompt(roadmapInteraction), {
        slug: roadmapInteraction.slug,
        interaction: roadmapInteraction
      });
      const reviewResponse = await parseResponse(roadmapInteraction, reviewRaw);

      if (reviewResponse.selectedKey === 'approve' || isApproval(reviewResponse.raw || reviewRaw)) {
        approved = true;
        memory.roadmapApproved = true;
        console.log('Roadmap approved!\n');
      } else {
        const feedback = reviewResponse.customText || reviewResponse.text || reviewResponse.raw || reviewRaw;
        // Regenerate roadmap with feedback
        const updatedRoadmap = await agent('roadmap-generator', {
          projectDescription: memory.projectDescription,
          scope: memory.scope,
          requirements: memory.requirements,
          assumptions: memory.assumptions,
          security: memory.security,
          feedback
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
        const taskResult = await agent('task-planner', {
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
        const taskReviewInteraction = createInteraction('choice', `phase-${i + 1}-task-review`, {
          prompt: `Please review the task list for Phase ${i + 1} in state/phase-${i + 1}-tasks.md.\nHow would you like to proceed?`,
          options: [
            { key: 'approve', label: 'Approve task list' },
            { key: 'changes', label: 'Request changes', description: 'Describe what to change' }
          ],
          allowCustom: true
        });

        const taskReviewRaw = await askHuman(formatPrompt(taskReviewInteraction), {
          slug: taskReviewInteraction.slug,
          interaction: taskReviewInteraction
        });
        const taskReview = await parseResponse(taskReviewInteraction, taskReviewRaw);

        if (taskReview.selectedKey === 'approve' || isApproval(taskReview.raw || taskReviewRaw)) {
          tasksApproved = true;
          memory[tasksApprovedKey] = true;
          console.log(`Phase ${i + 1} task list approved!\n`);
        } else {
          const feedback = taskReview.customText || taskReview.text || taskReview.raw || taskReviewRaw;
          const updatedTasks = await agent('task-planner', {
            projectDescription: memory.projectDescription,
            scope: memory.scope,
            requirements: memory.requirements,
            phase: phase,
            phaseIndex: i + 1,
            feedback
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

      // Update progress tracking for remote monitoring
      memory.progress = {
        phase: `${i + 1}/${phases.length}`,
        task: `${t + 1}/${tasks.length}`,
        stage: stage,
        currentTask: task.title,
        currentPhase: phase.title
      };

      // Store any feedback for this task
      const feedback = getTaskData(i, taskId, 'feedback');

      try {
        // 1. Security Review (pre-implementation)
        if (stage === TASK_STAGES.PENDING || stage === TASK_STAGES.SECURITY_PRE) {
          if (!getTaskData(i, taskId, 'security_pre')) {
            console.log('    > Security pre-review...');
            const securityPreReview = await agent('security-reviewer', {
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
            const testPlan = await agent('test-planner', {
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
            const implementation = await agent('code-writer', {
              task: task,
              phase: phase,
              requirements: memory.requirements,
              testPlan: getTaskData(i, taskId, 'tests'),
              securityConsiderations: getTaskData(i, taskId, 'security_pre'),
              feedback: feedback
            });
            setTaskData(i, taskId, 'code', implementation);
          }

          // Write implementation files to disk
          const implementation = getTaskData(i, taskId, 'code');
          if (implementation) {
            console.log('    > Writing files to disk...');
            writeImplementationFiles(implementation);
          }

          setTaskStage(i, taskId, TASK_STAGES.CODE_REVIEW);
          stage = TASK_STAGES.CODE_REVIEW;
        }

        // 4. Code Review
        if (stage === TASK_STAGES.CODE_REVIEW) {
          if (!getTaskData(i, taskId, 'review')) {
            console.log('    > Code review...');
            const codeReview = await agent('code-reviewer', {
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
            const securityPostReview = await agent('security-reviewer', {
              task: task,
              phase: phase,
              implementation: getTaskData(i, taskId, 'code'),
              stage: 'post-implementation',
              feedback: feedback
            });
            setTaskData(i, taskId, 'security_post', securityPostReview);
          }
          setTaskStage(i, taskId, TASK_STAGES.SANITY_CHECK);
          stage = TASK_STAGES.SANITY_CHECK;
        }

        // 6. Sanity check generation & execution
        if (stage === TASK_STAGES.SANITY_CHECK) {
          const testFramework = detectTestFramework();
          const executableChecks = await agent('sanity-checker', {
            task: task,
            implementation: getTaskData(i, taskId, 'code'),
            testPlan: getTaskData(i, taskId, 'tests'),
            testFramework
          });
          setTaskData(i, taskId, 'sanity_checks', executableChecks);

          const checksDisplay = (executableChecks.checks || [])
            .map((check) => `  ${check.id}. ${check.description}\n     → ${check.command || check.path || check.testCommand}`)
            .join('\n');

          const sanityChoice = createInteraction('choice', `phase-${i + 1}-task-${taskId}-sanity-choice`, {
            prompt: `Sanity checks for "${task.title}":\n\n${checksDisplay}\n\nHow would you like to proceed?`,
            options: [
              { key: 'auto', label: 'Run automatically', description: 'Agent executes checks and reports results' },
              { key: 'manual', label: 'Run checks manually', description: 'You run the commands and confirm results' },
              { key: 'skip', label: 'Skip verification', description: 'Approve without running checks' }
            ],
            allowCustom: true
          });

          const sanityRaw = await askHuman(formatPrompt(sanityChoice), {
            slug: sanityChoice.slug,
            interaction: sanityChoice
          });
          const sanityResponse = await parseResponse(sanityChoice, sanityRaw);

          if (sanityResponse.isCustom) {
            setTaskData(i, taskId, 'feedback', sanityResponse.customText || sanityResponse.raw || sanityRaw);
            resetQuickFixAttempts(i, taskId);
            setTaskStage(i, taskId, TASK_STAGES.PENDING);
            t--;
            continue;
          }

          const action = sanityResponse.selectedKey;

          if (action === 'auto') {
            const results = await agent('sanity-runner', {
              checks: executableChecks.checks,
              setup: executableChecks.setup,
              teardown: executableChecks.teardown
            });
            setTaskData(i, taskId, 'sanity_results', results);

            if (results.summary?.failed > 0) {
              const failedChecks = results.results
                .filter((r) => r.status === 'failed')
                .map((r) => `  - Check ${r.id}: ${r.error}`)
                .join('\n');

              const quickFixAttempts = getQuickFixAttempts(i, taskId);
              const runtime = getCurrentRuntime();
              const maxAttempts = runtime?.workflowConfig?.maxQuickFixAttempts ?? 10;
              const failOptions = [];
              if (quickFixAttempts < maxAttempts) {
                failOptions.push({
                  key: 'quickfix',
                  label: 'Quick fix',
                  description: `Run targeted fixes (attempt ${quickFixAttempts + 1} of ${maxAttempts})`
                });
              }
              failOptions.push(
                { key: 'partial', label: 'Partial reimplement', description: 'Keep security review and test plan, redo implementation' },
                { key: 'reimplement', label: 'Full reimplement', description: 'Restart task from scratch' },
                { key: 'ignore', label: 'Ignore failures and approve anyway' }
              );

              const failChoice = createInteraction('choice', `phase-${i + 1}-task-${taskId}-sanity-fail`, {
                prompt: `${results.summary.failed} sanity check(s) failed:\n\n${failedChecks}\n\nHow would you like to proceed?`,
                options: failOptions,
                allowCustom: true
              });

              const failRaw = await askHuman(formatPrompt(failChoice), {
                slug: failChoice.slug,
                interaction: failChoice
              });
              const failResponse = await parseResponse(failChoice, failRaw);

              if (failResponse.isCustom) {
                const customFeedback = failResponse.customText || failResponse.text || failResponse.raw || failRaw;
                const combinedFeedback = `${customFeedback}\n\nSanity check failures:\n${failedChecks}`;
                setTaskData(i, taskId, 'feedback', combinedFeedback);
                clearPartialTaskData(i, taskId);
                resetQuickFixAttempts(i, taskId);
                setTaskStage(i, taskId, TASK_STAGES.PENDING);
                t--;
                continue;
              }

              if (failResponse.selectedKey === 'quickfix') {
                console.log('    > Running quick fix...');
                const fixerResult = await agent('code-fixer', {
                  task: task,
                  originalImplementation: getTaskData(i, taskId, 'code'),
                  sanityCheckResults: {
                    summary: results.summary,
                    results: results.results,
                    checks: executableChecks.checks
                  },
                  testPlan: getTaskData(i, taskId, 'tests'),
                  previousAttempts: quickFixAttempts
                });

                const fixes = fixerResult?.fixes || [];
                const fixFiles = fixes
                  .filter((fix) => fix?.path && fix?.code && (!fix.operation || fix.operation === 'replace'))
                  .map((fix) => ({ path: fix.path, code: fix.code }));

                if (fixFiles.length > 0) {
                  console.log('    > Applying fixes to disk...');
                  writeImplementationFiles({ files: fixFiles });
                }

                const updatedImplementation = applyFixesToImplementation(getTaskData(i, taskId, 'code'), fixes);
                setTaskData(i, taskId, 'code', updatedImplementation);
                incrementQuickFixAttempts(i, taskId);
                setTaskData(i, taskId, 'sanity_checks', null);
                setTaskData(i, taskId, 'sanity_results', null);
                setTaskStage(i, taskId, TASK_STAGES.SANITY_CHECK);
                t--;
                continue;
              }

              if (failResponse.selectedKey === 'partial') {
                setTaskData(i, taskId, 'feedback', `Sanity check failures:\n${failedChecks}`);
                clearPartialTaskData(i, taskId, ['security_pre', 'tests']);
                resetQuickFixAttempts(i, taskId);
                setTaskStage(i, taskId, TASK_STAGES.IMPLEMENTING);
                t--;
                continue;
              }

              if (failResponse.selectedKey === 'reimplement') {
                setTaskData(i, taskId, 'feedback', `Sanity check failures:\n${failedChecks}`);
                clearPartialTaskData(i, taskId);
                resetQuickFixAttempts(i, taskId);
                setTaskStage(i, taskId, TASK_STAGES.PENDING);
                t--;
                continue;
              }
            }

            resetQuickFixAttempts(i, taskId);
            setTaskStage(i, taskId, TASK_STAGES.COMPLETED);
            stage = TASK_STAGES.COMPLETED;
            task.stage = 'completed';
            memory[tasksKey] = tasks;
            writeMarkdownFile(STATE_DIR, `phase-${i + 1}-tasks.md`, renderTasksMarkdown(i + 1, phase.title, tasks));
            console.log(`    Task ${t + 1} confirmed complete!\n`);
          } else if (action === 'skip') {
            resetQuickFixAttempts(i, taskId);
            setTaskStage(i, taskId, TASK_STAGES.COMPLETED);
            stage = TASK_STAGES.COMPLETED;
            task.stage = 'completed';
            memory[tasksKey] = tasks;
            writeMarkdownFile(STATE_DIR, `phase-${i + 1}-tasks.md`, renderTasksMarkdown(i + 1, phase.title, tasks));
            console.log(`    Task ${t + 1} confirmed complete!\n`);
          } else {
            setTaskStage(i, taskId, TASK_STAGES.AWAITING_APPROVAL);
            stage = TASK_STAGES.AWAITING_APPROVAL;
          }
        }

        // 7. Manual approval (for when user runs checks)
        if (stage === TASK_STAGES.AWAITING_APPROVAL) {
          const approvalInteraction = createInteraction('choice', `phase-${i + 1}-task-${taskId}-approval`, {
            prompt: `Task ${t + 1} (${task.title}) complete.\n\nDefinition of Done: ${task.doneDefinition || 'Task completed successfully'}`,
            options: [
              { key: 'approve', label: 'Confirm task completion' },
              { key: 'issue', label: 'Flag issue', description: 'Describe the problem' }
            ],
            allowCustom: true
          });

          const approvalRaw = await askHuman(formatPrompt(approvalInteraction), {
            slug: approvalInteraction.slug,
            interaction: approvalInteraction
          });
          const approvalResponse = await parseResponse(approvalInteraction, approvalRaw);

          if (approvalResponse.selectedKey === 'approve' || isApproval(approvalResponse.raw || approvalRaw)) {
            setTaskStage(i, taskId, TASK_STAGES.COMPLETED);
            resetQuickFixAttempts(i, taskId);
            task.stage = 'completed';
            memory[tasksKey] = tasks;
            writeMarkdownFile(STATE_DIR, `phase-${i + 1}-tasks.md`, renderTasksMarkdown(i + 1, phase.title, tasks));
            console.log(`    Task ${t + 1} confirmed complete!\n`);
          } else {
            console.log('    > Issue flagged, reprocessing task with feedback...');
            const feedbackText = approvalResponse.customText || approvalResponse.text || approvalResponse.raw || approvalRaw;
            setTaskData(i, taskId, 'feedback', feedbackText);

            setTaskData(i, taskId, 'security_pre', null);
            setTaskData(i, taskId, 'tests', null);
            setTaskData(i, taskId, 'code', null);
            setTaskData(i, taskId, 'review', null);
            setTaskData(i, taskId, 'security_post', null);
            setTaskData(i, taskId, 'sanity_checks', null);
            setTaskData(i, taskId, 'sanity_results', null);
            resetQuickFixAttempts(i, taskId);

            setTaskStage(i, taskId, TASK_STAGES.PENDING);
            t--;
          }
        }

      } catch (error) {
        console.error(`    Task ${t + 1} failed: ${error.message}`);
        setTaskStage(i, taskId, TASK_STAGES.FAILED);

        const retryInteraction = createInteraction('choice', `phase-${i + 1}-task-${taskId}-error`, {
          prompt: `Task "${task.title}" failed with error: ${error.message}\n\nHow would you like to proceed?`,
          options: [
            { key: 'retry', label: 'Retry this task' },
            { key: 'skip', label: 'Skip and continue' },
            { key: 'abort', label: 'Abort workflow' }
          ],
          allowCustom: true
        });

        const retryRaw = await askHuman(formatPrompt(retryInteraction), {
          slug: retryInteraction.slug,
          interaction: retryInteraction
        });
        const retryResponse = await parseResponse(retryInteraction, retryRaw);
        const retryValue = (retryResponse.raw || retryRaw).trim().toLowerCase();

        if (retryResponse.selectedKey === 'retry' || retryValue.startsWith('a') || retryValue.startsWith('retry')) {
          setTaskStage(i, taskId, TASK_STAGES.PENDING);
          t--; // Retry this task
        } else if (retryResponse.selectedKey === 'abort' || retryValue.startsWith('c') || retryValue.startsWith('abort')) {
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
