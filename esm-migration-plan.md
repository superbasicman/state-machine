 ESM Migration Plan

 Overview

 Migrate the CLI from CommonJS (require/module.exports) to ES modules (import/export) for modern standards. Since backward
 compatibility is not required, we'll do a clean v2.0.0 migration.

 Technical Challenges to Solve

 1. Hot-Reloading (High Complexity)

 Current: Uses delete require.cache[require.resolve(path)] to reload workflows and agents
 - lib/state-machine.js:120 - workflow hot-reload
 - lib/state-machine.js:324-325 - agent hot-reload

 Solution: Use timestamp-based query parameters with dynamic imports
 const timestamp = Date.now();
 const fileUrl = pathToFileURL(workflowFile).href;
 const module = await import(`${fileUrl}?t=${timestamp}`);
 return module.default;

 2. Synchronous → Async Loading (Medium Complexity)

 Current: loadWorkflowConfig() and loadCustomAgents() are synchronous

 Solution: Make both async and use lazy initialization pattern
 - All public methods that need config become async (already are: run(), resume())
 - Add ensureConfigLoaded() helper to lazy-load config

 3. Runtime Handler Dependencies (Medium Complexity)

 Current: Markdown agents generate handlers with inline require('./llm') (line 383, 419, 426)

 Solution: Dependency injection via closure - import llm helpers at module level and capture in handler closure

 4. Template Generation (Medium Complexity)

 Current: lib/setup.js generates CommonJS templates

 Solution: Update all template strings to use ESM syntax:
 - export default instead of module.exports
 - Named exports for meta/handler

 Migration Steps

 Step 1: Package Configuration

 File: package.json

 Changes:
 - Add "type": "module" to enable ESM
 - Update Node requirement to "node": ">=18.19.0" (stable ESM support)
 - Add "exports" field for better module resolution
 - Bump version to "2.0.0" (breaking change)

 Step 2: Core Library Files (Sequential Order)

 2a. lib/llm.js (470 lines)

 - Change all require() to import statements with .js extensions
 - Change module.exports to named exports
 - Convert SDK lazy loading to async dynamic imports:
 const module = await import('@anthropic-ai/sdk');
 Anthropic = module.default;

 2b. lib/setup.js (351 lines)

 - Change require() to import with .js extensions
 - Change module.exports to export { setup }
 - Critical: Update ALL template strings (8 templates):
   - workflow.js template (line 36-98): export default instead of module.exports
   - JavaScript agent template (line 105-148): export default function handler + export const meta
   - Script templates stay same (run as separate processes)
   - README template (line 204+): Update example import syntax

 2c. lib/state-machine.js (1353 lines - most complex)

 - Change all require() to import with .js extensions
 - Add import { pathToFileURL } from 'url'
 - Make loadWorkflowConfig() async (line 117-122):
   - Use timestamp-based query parameter for cache busting
 - Make loadCustomAgents() async (line 311-346):
   - Use Promise.all() for parallel agent loading
   - Use timestamp parameter for .js agents
 - Refactor createMarkdownAgentHandler() (line 379-469):
   - Import llm, parseJSON, parseInteractionRequest at module level
   - Inject dependencies via closure instead of inline requires
 - Change module.exports to export { StateMachine, States, BUILTIN_AGENTS }

 2d. lib/index.js

 Complete rewrite:
 export { StateMachine, States, BUILTIN_AGENTS } from './state-machine.js';
 export { setup } from './setup.js';
 export { llm, llmText, llmJSON, parseJSON, detectAvailableCLIs } from './llm.js';

 2e. bin/cli.js (180 lines)

 - Keep shebang: #!/usr/bin/env node
 - Change all require() to import with .js extensions
 - Fix listWorkflows() dynamic loading (line ~151):
   - Convert to async with dynamic import using pathToFileURL
 - Main execution already wrapped in async

 Step 3: Existing Workflow Migration

 File: workflows/simple-workflow/workflow.js
 - Change module.exports = { to export default {

 File: workflows/simple-workflow/agents/*.js
 - Change module.exports = handler to export default handler

 Benefits

 1. Parallel Agent Loading: Promise.all() loads multiple agents simultaneously (faster)
 2. True Module Isolation: Each workflow reload gets fresh evaluation (no cache pollution)
 3. Better Error Messages: ESM provides clearer stack traces and import errors
 4. Future-Ready: Top-level await, import assertions, better tooling support
 5. Explicit Dependencies: All imports visible at file top (easier to understand)

 Critical Files to Modify

 1. /Users/isaacrobles/Documents/work/claude-state/package.json - Enable ESM
 2. /Users/isaacrobles/Documents/work/claude-state/lib/llm.js - Convert first (no dependencies)
 3. /Users/isaacrobles/Documents/work/claude-state/lib/setup.js - Update all templates
 4. /Users/isaacrobles/Documents/work/claude-state/lib/state-machine.js - Most complex (async refactoring)
 5. /Users/isaacrobles/Documents/work/claude-state/lib/index.js - Aggregator rewrite
 6. /Users/isaacrobles/Documents/work/claude-state/bin/cli.js - Entry point
 7. /Users/isaacrobles/Documents/work/claude-state/workflows/simple-workflow/workflow.js - Example migration
 8. /Users/isaacrobles/Documents/work/claude-state/workflows/simple-workflow/agents/*.js - Example agents

 Key Technical Details

 Import Extensions

 All imports MUST include .js extension:
 import { llm } from './llm.js';  // ✓ Correct
 import { llm } from './llm';     // ✗ Error in ESM

 Dynamic Imports Need File URLs

 import { pathToFileURL } from 'url';
 const fileUrl = pathToFileURL('/absolute/path/file.js').href;
 const module = await import(fileUrl);

 Default vs Named Exports

 - Workflow configs: export default { steps, models }
 - Agents: export default async function handler(context) { }
 - Libraries: Named exports export { llm, StateMachine }

 Testing Strategy

 1. Convert lib/llm.js → test llm functions work
 2. Convert lib/setup.js → test --setup creates valid ESM templates
 3. Convert lib/state-machine.js → test hot-reload works
 4. Convert lib/index.js + bin/cli.js → test all CLI commands
 5. Run simple-workflow → verify end-to-end execution
 6. Test edge cases: resume, interactions, conditionals, forEach

 Risks & Mitigations

 Risk: Easy to forget .js extensions
 Mitigation: Convert file-by-file and test immediately

 Risk: Async loading adds complexity
 Mitigation: Already have async run()/resume() - fits naturally

 Risk: Breaking existing user workflows
 Mitigation: User confirmed no backward compatibility needed - clean v2.0.0 break

 Implementation Order

 1. package.json (enable ESM)
 2. lib/llm.js (foundation)
 3. lib/setup.js (templates)
 4. lib/state-machine.js (core logic)
 5. lib/index.js (aggregator)
 6. bin/cli.js (entry point)
 7. workflows/simple-workflow/* (example migration)
 8. Test all commands and workflows

 ---
 Estimated Scope: ~300 lines of changes across 8 files
 Complexity: Medium (hot-reload mechanism requires care)
 Breaking Change: Yes - bump to v2.0.0