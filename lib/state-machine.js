/**
 * File: /lib/state-machine.js
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import readline from 'readline';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// State machine states
const States = {
  IDLE: 'IDLE',
  RUNNING: 'RUNNING',
  STEP_EXECUTING: 'STEP_EXECUTING',
  STEP_COMPLETED: 'STEP_COMPLETED',
  STEP_FAILED: 'STEP_FAILED',
  WORKFLOW_COMPLETED: 'WORKFLOW_COMPLETED',
  WORKFLOW_FAILED: 'WORKFLOW_FAILED',
  PAUSED: 'PAUSED'
};

// Built-in agents
const BUILTIN_AGENTS = {
  echo: async (context) => {
    console.log('[Agent: echo] Context:', JSON.stringify(context, null, 2));
    return { ...context, echoed: true };
  },

  transform: async (context) => {
    console.log('[Agent: transform] Processing...');
    return {
      ...context,
      transformed: true,
      transformedAt: new Date().toISOString()
    };
  },

  validate: async (context) => {
    console.log('[Agent: validate] Validating...');
    const isValid = context !== null && typeof context === 'object';
    return { ...context, validated: isValid };
  },

  log: async (context) => {
    console.log('[Agent: log]', JSON.stringify(context, null, 2));
    return context;
  },

  delay: async (context) => {
    const ms = context._delay || 1000;
    console.log(`[Agent: delay] Waiting ${ms}ms...`);
    await new Promise(resolve => setTimeout(resolve, ms));
    return context;
  }
};

class StateMachine {
  constructor(workflowName) {
    this.workflowName = workflowName;
    this.workflowsDir = path.join(process.cwd(), 'workflows');
    this.workflowDir = workflowName 
      ? path.join(this.workflowsDir, workflowName)
      : null;
    this.customAgents = {};
    this.loop = {
      count: 0,
      stepCounts: {}
    };
  }

  get stateDir() {
    return this.workflowDir ? path.join(this.workflowDir, 'state') : null;
  }

  get interactionsDir() {
    return this.workflowDir ? path.join(this.workflowDir, 'interactions') : null;
  }

  get currentStateFile() {
    return this.stateDir ? path.join(this.stateDir, 'current.json') : null;
  }

  get historyFile() {
    return this.stateDir ? path.join(this.stateDir, 'history.jsonl') : null;
  }

  get workflowFile() {
    return this.workflowDir ? path.join(this.workflowDir, 'workflow.js') : null;
  }

  get agentsDir() {
    return this.workflowDir ? path.join(this.workflowDir, 'agents') : null;
  }

  get scriptsDir() {
    return this.workflowDir ? path.join(this.workflowDir, 'scripts') : null;
  }

  get steeringDir() {
    return this.workflowDir ? path.join(this.workflowDir, 'steering') : null;
  }

  /**
   * Ensure workflow exists
   */
  ensureWorkflow() {
    if (!this.workflowName) {
      throw new Error('No workflow name specified');
    }
    if (!fs.existsSync(this.workflowDir)) {
      throw new Error(`Workflow '${this.workflowName}' not found. Run 'state-machine --setup ${this.workflowName}' first.`);
    }
    if (!fs.existsSync(this.workflowFile)) {
      throw new Error(`workflow.js not found in ${this.workflowDir}`);
    }
  }

  /**
   * Load workflow configuration from workflow.js
   */
  loadWorkflowConfig() {
    this.ensureWorkflow();
    // Clear require cache to allow hot reloading
    delete require.cache[require.resolve(this.workflowFile)];
    return require(this.workflowFile);
  }

  /**
   * Load current state
   */
  loadCurrentState() {
    if (fs.existsSync(this.currentStateFile)) {
      return JSON.parse(fs.readFileSync(this.currentStateFile, 'utf-8'));
    }
    return this.createInitialState();
  }

  /**
   * Create initial state
   */
  createInitialState() {
    return {
      status: States.IDLE,
      workflow: null,
      currentStepIndex: 0,
      context: {},
      loop: {
        count: 0,
        stepCounts: {}
      },
      startedAt: null,
      lastUpdatedAt: null,
      error: null,
      pendingInteraction: null
    };
  }

  sanitizeInteractionSlug(slug) {
    const raw = String(slug || '').trim();
    const withoutExt = raw.toLowerCase().endsWith('.md') ? raw.slice(0, -3) : raw;
    const sanitized = withoutExt
      .trim()
      .replace(/[\\/]+/g, '-')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    return sanitized || 'interaction';
  }

  ensureInteractionsDir() {
    if (!this.interactionsDir) return;
    if (!fs.existsSync(this.interactionsDir)) {
      fs.mkdirSync(this.interactionsDir, { recursive: true });
    }
  }

  async promptYesToContinue() {
    if (!process.stdin.isTTY) {
      console.log('stdin is not a TTY; edit the interaction file and run `state-machine resume <workflow>` to continue.');
      return false;
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => new Promise((resolve) => rl.question(q, resolve));
    try {
      while (true) {
        const answer = String(await ask("Type 'y' to continue (or 'q' to stop): ")).trim().toLowerCase();
        if (answer === 'y' || answer === 'yes') return true;
        if (answer === 'q' || answer === 'quit' || answer === 'n' || answer === 'no') return false;
      }
    } finally {
      rl.close();
    }
  }

  async handleInteractionIfNeeded(context, state, workflowName, stepName, stepIndex) {
    const interaction = context?._interaction;
    if (!interaction) return context;

    const slug = this.sanitizeInteractionSlug(interaction.slug || interaction.key || interaction.targetKey || stepName);
    const targetKey = String(interaction.targetKey || interaction.key || slug);
    const initialContent = String(interaction.content ?? '');

    this.ensureInteractionsDir();
    const filePath = path.join(this.interactionsDir, `${slug}.md`);
    const relativePath = path.relative(this.workflowDir, filePath);
    const instructions = `Enter your response here. Its okay to delete all content and leave only your response.`;
    const fileExists = fs.existsSync(filePath);
    const interactionContent = fileExists ? fs.readFileSync(filePath, 'utf-8') : '';

    if (!fileExists || interactionContent.trim() === '') {
      fs.writeFileSync(filePath, initialContent || `# ${slug}\n\n${instructions}\n`);
    } else {
      fs.writeFileSync(filePath, initialContent + '\n\n' + instructions + '\n\n' + interactionContent);
    }

    state.status = States.PAUSED;
    state.pendingInteraction = {
      slug,
      targetKey,
      file: relativePath,
      stepIndex,
      step: stepName
    };
    this.saveCurrentState(state);

    this.prependHistory({
      event: 'INTERACTION_REQUESTED',
      workflow: workflowName,
      step: stepName,
      stepIndex,
      slug,
      file: relativePath,
      targetKey
    });

    console.log(`\n⏸ Interaction required: ${relativePath}`);
    console.log(`The workflow is paused at step ${stepIndex + 1}.`);
    console.log(`After editing, ${targetKey} will be set to the file contents in context.`);
    const continued = await this.promptYesToContinue();

    if (!continued) {
      console.log(`Workflow paused. Resume with: state-machine resume ${this.workflowName}`);
      return context;
    }

    const finalContent = fs.readFileSync(filePath, 'utf-8');
    const nextContext = { ...context, [targetKey]: finalContent };
    delete nextContext._interaction;

    state.context = nextContext;
    state.status = States.RUNNING;
    state.pendingInteraction = null;
    this.saveCurrentState(state);

    this.prependHistory({
      event: 'INTERACTION_RESOLVED',
      workflow: workflowName,
      step: stepName,
      stepIndex,
      slug,
      file: relativePath,
      targetKey
    });

    return nextContext;
  }

  /**
   * Save current state
   */
  saveCurrentState(state) {
    state.lastUpdatedAt = new Date().toISOString();
    state.loop = this.loop;
    fs.writeFileSync(this.currentStateFile, JSON.stringify(state, null, 2));
  }

  /**
   * Prepend to history
   */
  prependHistory(entry) {
    const historyEntry = {
    ...entry,
      timestamp: new Date().toISOString()
    };

    const line = JSON.stringify(historyEntry) + '\n';

    let existing = '';
    if (fs.existsSync(this.historyFile)) {
      existing = fs.readFileSync(this.historyFile, 'utf8');
    }

    fs.writeFileSync(this.historyFile, line + existing, 'utf8');
  }

  /**
   * Load history
   */
  loadHistory() {
    if (!fs.existsSync(this.historyFile)) {
      return [];
    }
    const content = fs.readFileSync(this.historyFile, 'utf-8');
    return content
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line));
  }

  /**
   * Load custom agents from workflow's agents directory
   * Supports both .js (code) and .md (prompt-based) agents
   */
  loadCustomAgents() {
    if (!fs.existsSync(this.agentsDir)) {
      return;
    }

    const files = fs.readdirSync(this.agentsDir);
    for (const file of files) {
      if (file.endsWith('.js')) {
        // JavaScript agent
        const agentName = path.basename(file, '.js');
        const agentPath = path.join(this.agentsDir, file);
        try {
          // Clear require cache
          delete require.cache[require.resolve(agentPath)];
          const agentModule = require(agentPath);
          const handler = agentModule.handler || agentModule.default || agentModule;
          if (typeof handler === 'function') {
            this.customAgents[agentName] = handler;
          }
        } catch (err) {
          console.warn(`Warning: Failed to load agent '${agentName}': ${err.message}`);
        }
      } else if (file.endsWith('.md')) {
        // Markdown prompt agent
        const agentName = path.basename(file, '.md');
        const agentPath = path.join(this.agentsDir, file);
        try {
          const promptContent = fs.readFileSync(agentPath, 'utf-8');
          // Parse frontmatter if present
          const { config, prompt } = this.parseMarkdownAgent(promptContent);
          this.customAgents[agentName] = this.createMarkdownAgentHandler(agentName, prompt, config);
        } catch (err) {
          console.warn(`Warning: Failed to load markdown agent '${agentName}': ${err.message}`);
        }
      }
    }
  }

  /**
   * Parse markdown agent file - supports YAML frontmatter
   */
  parseMarkdownAgent(content) {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    
    if (frontmatterMatch) {
      // Parse simple YAML-like frontmatter
      const frontmatter = frontmatterMatch[1];
      const prompt = frontmatterMatch[2].trim();
      
      const config = {};
      frontmatter.split('\n').forEach(line => {
        const [key, ...valueParts] = line.split(':');
        if (key && valueParts.length) {
          const value = valueParts.join(':').trim();
          // Remove quotes if present
          config[key.trim()] = value.replace(/^["']|["']$/g, '');
        }
      });
      
      return { config, prompt };
    }
    
    return { config: {}, prompt: content.trim() };
  }

  /**
   * Create a handler function for markdown-based agents
   */
  createMarkdownAgentHandler(agentName, promptTemplate, config) {
    const self = this;
    
    return async function markdownAgentHandler(context) {
      const { llm } = require('./llm');
      
      const getByPath = (obj, pathStr) => {
        const trimmed = String(pathStr || '').trim();
        if (!trimmed) return undefined;
        const normalized = trimmed.startsWith('context.') ? trimmed.slice('context.'.length) : trimmed;
        const parts = normalized.split('.').filter(Boolean);
        let current = obj;
        for (const part of parts) {
          if (current == null) return undefined;
          current = current[String(part)];
        }
        return current;
      };

      // Interpolate context variables in prompt using {{path}} syntax (supports dots and hyphens).
      const prompt = promptTemplate.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (match, pathStr) => {
        const value = getByPath(context, pathStr);
        return value !== undefined ? String(value) : match;
      });
      
      const model = config.model || 'fast';
      const outputKey = config.output || 'result';
      
      console.log(`  [MD Agent: ${agentName}] Using model: ${model}`);
      
      const response = await llm(context, {
        model: model,
        prompt: prompt,
        includeContext: config.includeContext !== 'false'
      });
      
      // Parse output based on config
      let output = response.text;
      if (config.format === 'json') {
        try {
          const { parseJSON } = require('./llm');
          output = parseJSON(response.text);
        } catch (e) {
          console.warn(`  [MD Agent: ${agentName}] Failed to parse JSON output`);
        }
      }

      const { parseInteractionRequest } = require('./llm');

      const explicitInteraction =
        config.format === 'interaction' ||
        config.interaction === 'true' ||
        (typeof config.interaction === 'string' && config.interaction.length > 0);

      // Structured interaction detection: LLM responds with { "interact": "question" }
      const parsedInteraction = parseInteractionRequest(response.text);
      const structuredInteraction =
        config.autoInteract !== 'false' && parsedInteraction.isInteraction;

      if (explicitInteraction || structuredInteraction) {
        const slug =
          (typeof config.interaction === 'string' && config.interaction !== 'true' ? config.interaction : null) ||
          config.interactionSlug ||
          config.interactionKey ||
          outputKey ||
          agentName;

        const targetKey = config.interactionKey || outputKey || slug;

        // Use parsed question for content if structured interaction, otherwise full response
        const interactionContent = structuredInteraction
          ? parsedInteraction.question
          : response.text;

        return {
          ...context,
          _interaction: {
            slug,
            targetKey,
            content: interactionContent
          },
          [`_${agentName}_model`]: response.model
        };
      }
      
      return {
        ...context,
        [outputKey]: output,
        [`_${agentName}_model`]: response.model
      };
    };
  }

  /**
   * Load steering configuration and global prompt
   */
  loadSteering() {
    this.steering = {
      enabled: false,
      global: null,
      config: null
    };

    if (!fs.existsSync(this.steeringDir)) {
      return;
    }

    // Load steering config
    const configPath = path.join(this.steeringDir, 'config.json');
    if (fs.existsSync(configPath)) {
      try {
        this.steering.config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        this.steering.enabled = this.steering.config.enabled !== false;
      } catch (err) {
        console.warn(`Warning: Failed to load steering config: ${err.message}`);
      }
    }

    // Load global.md if present
    const globalPath = path.join(this.steeringDir, 'global.md');
    if (fs.existsSync(globalPath)) {
      try {
        this.steering.global = fs.readFileSync(globalPath, 'utf-8');
      } catch (err) {
        console.warn(`Warning: Failed to load global.md: ${err.message}`);
      }
    }
  }

  /**
   * Get agent by name (custom first, then builtin)
   */
  getAgent(name) {
    return this.customAgents[name] || BUILTIN_AGENTS[name];
  }

  /**
   * Parse step definition (string format)
   */
  parseStep(step) {
    if (typeof step !== 'string') {
      return null; // Not a simple step
    }
    if (step.startsWith('agent:')) {
      return { type: 'agent', name: step.slice(6) };
    } else if (step.startsWith('script:')) {
      return { type: 'script', path: step.slice(7) };
    } else {
      // Default to agent if no prefix
      return { type: 'agent', name: step };
    }
  }

  /**
   * Get step name for display
   */
  getStepName(step) {
    if (typeof step === 'string') {
      return step;
    }
    if (step.if) {
      return `conditional`;
    }
    if (step.forEach) {
      return `forEach`;
    }
    return 'unknown';
  }

  /**
   * Resolve goto target to step index
   * Special values: 'end' exits the workflow
   */
  resolveGoto(goto, steps, currentIndex) {
    // Special case: end the workflow
    if (goto === 'end') {
      return steps.length; // Return index past the end to exit
    }
    
    if (typeof goto === 'number') {
      if (goto < 0) {
        // Relative jump backward
        return currentIndex + goto;
      }
      // Absolute index
      return goto;
    }
    
    if (typeof goto === 'string') {
      // Find step by name
      const targetIndex = steps.findIndex(s => {
        if (typeof s === 'string') {
          return s === goto;
        }
        return false;
      });
      
      if (targetIndex === -1) {
        throw new Error(`Goto target not found: "${goto}". Step name does not exist in workflow.`);
      }
      return targetIndex;
    }
    
    throw new Error(`Invalid goto target: ${goto}. Must be a number, step name, or 'end'.`);
  }

  /**
   * Execute an agent
   */
  async executeAgent(agentName, context) {
    console.log(`\n▶ Executing agent: ${agentName}`);

    const agent = this.getAgent(agentName);
    if (!agent) {
      const availableAgents = [
        ...Object.keys(this.customAgents),
        ...Object.keys(BUILTIN_AGENTS)
      ].join(', ');
      throw new Error(`Unknown agent: ${agentName}. Available agents: ${availableAgents}`);
    }

    // Inject steering and loop info into context
    let agentContext = { ...context };
    if (this.steering && this.steering.enabled && this.steering.global) {
      agentContext._steering = {
        global: this.steering.global,
        config: this.steering.config
      };
    }
    agentContext._loop = { ...this.loop };
    
    // Inject config for llm() helper
    agentContext._config = {
      models: this.workflowConfig?.models || {},
      apiKeys: this.workflowConfig?.apiKeys || {},
      workflowDir: this.workflowDir
    };

    const result = await agent(agentContext);
    console.log(`✓ Agent ${agentName} completed`);
    
    // Remove internal props from result
    if (result) {
      delete result._steering;
      delete result._loop;
      delete result._config;
    }
    
    return result;
  }

  /**
   * Execute a script
   */
  async executeScript(scriptPath, context) {
    const resolvedPath = path.join(this.scriptsDir, scriptPath);
    console.log(`\n▶ Executing script: ${scriptPath}`);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Script not found: ${resolvedPath}`);
    }

    // Inject steering into context for scripts too
    let scriptContext = { ...context };
    if (this.steering && this.steering.enabled && this.steering.global) {
      scriptContext._steering = {
        global: this.steering.global,
        config: this.steering.config
      };
    }
    scriptContext._loop = { ...this.loop };
    
    // Inject config for scripts
    scriptContext._config = {
      models: this.workflowConfig?.models || {},
      apiKeys: this.workflowConfig?.apiKeys || {},
      workflowDir: this.workflowDir
    };

    return new Promise((resolve, reject) => {
      const child = spawn('node', [resolvedPath], {
        cwd: this.workflowDir,
        env: {
          ...process.env,
          AGENT_CONTEXT: JSON.stringify(scriptContext),
          AGENT_STEERING: this.steering?.global || '',
          AGENT_LOOP_COUNT: String(this.loop.count),
          WORKFLOW_DIR: this.workflowDir,
          WORKFLOW_NAME: this.workflowName
        },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        process.stdout.write(text);
      });

      child.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        process.stderr.write(text);
      });

      child.on('close', (code) => {
        if (code === 0) {
          console.log(`✓ Script ${scriptPath} completed`);
          // Try to parse last line as JSON result
          const lines = stdout.trim().split('\n');
          const lastLine = lines[lines.length - 1];
          try {
            const result = JSON.parse(lastLine);
            resolve({ ...context, ...result });
          } catch {
            resolve({ ...context, scriptOutput: stdout.trim() });
          }
        } else {
          reject(new Error(`Script exited with code ${code}: ${stderr}`));
        }
      });

      child.on('error', reject);
    });
  }

  /**
   * Execute a simple step (agent or script)
   */
  async executeSimpleStep(step, context) {
    const parsed = this.parseStep(step);

    if (parsed.type === 'agent') {
      return this.executeAgent(parsed.name, context);
    } else if (parsed.type === 'script') {
      return this.executeScript(parsed.path, context);
    }

    throw new Error(`Unknown step type: ${parsed.type}`);
  }

  /**
   * Execute a forEach step
   */
  async executeForEach(step, context, state, workflowName) {
    const items = step.forEach(context);
    const itemName = step.as || 'item';
    const subSteps = step.steps || [];
    const parallel = step.parallel || false;

    if (!Array.isArray(items)) {
      throw new Error(`forEach must return an array, got: ${typeof items}`);
    }

    console.log(`\n▶ forEach: ${items.length} items (${parallel ? 'parallel' : 'sequential'})`);

    let currentContext = { ...context };

    if (parallel) {
      // Parallel execution
      const results = await Promise.all(items.map(async (item, itemIndex) => {
        let itemContext = { ...currentContext, [itemName]: item, [`${itemName}Index`]: itemIndex };
        
        for (const subStep of subSteps) {
          const result = await this.executeStepWithControl(subStep, itemContext, state, workflowName, subSteps, 0);
          itemContext = result.context;
        }
        
        return itemContext;
      }));
      
      // Merge results (last item's context wins for conflicts)
      currentContext = results.reduce((acc, ctx) => ({ ...acc, ...ctx }), currentContext);
    } else {
      // Sequential execution
      for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
        const item = items[itemIndex];
        currentContext[itemName] = item;
        currentContext[`${itemName}Index`] = itemIndex;
        
        console.log(`\n  [${itemIndex + 1}/${items.length}] Processing ${itemName}`);
        
        for (const subStep of subSteps) {
          const result = await this.executeStepWithControl(subStep, currentContext, state, workflowName, subSteps, 0);
          currentContext = result.context;
        }
      }
    }

    // Clean up iteration variables
    delete currentContext[itemName];
    delete currentContext[`${itemName}Index`];

    console.log(`✓ forEach completed`);
    return currentContext;
  }

  /**
   * Execute a step and handle control flow (conditionals, goto, forEach)
   * Returns: { context, goto: number | null }
   */
  async executeStepWithControl(step, context, state, workflowName, steps, currentIndex) {
    // Handle conditional step
    if (step.if && typeof step.if === 'function') {
      console.log(`\n▶ Evaluating conditional...`);
      
      const condition = step.if(context, this.loop);
      console.log(`  Condition result: ${condition}`);
      
      const branch = condition ? step.true : step.false;
      
      if (branch && branch.goto !== undefined) {
        const targetIndex = this.resolveGoto(branch.goto, steps, currentIndex);
        console.log(`  → Jumping to step ${targetIndex}`);
        return { context, goto: targetIndex };
      }
      
      // No goto, just continue
      return { context, goto: null };
    }

    // Handle forEach step
    if (step.forEach && typeof step.forEach === 'function') {
      const newContext = await this.executeForEach(step, context, state, workflowName);
      return { context: newContext, goto: null };
    }

    // Handle simple step (string)
    if (typeof step === 'string') {
      const newContext = await this.executeSimpleStep(step, context);
      return { context: newContext, goto: null };
    }

    throw new Error(`Unknown step format: ${JSON.stringify(step)}`);
  }

  /**
   * Run the workflow
   */
  async run() {
    this.ensureWorkflow();
    
    // Load workflow config
    const config = this.loadWorkflowConfig();
    this.workflowConfig = config;  // Store for access in agents
    const steps = config.steps || [];
    const workflowName = config.name || this.workflowName;

    // Load custom agents
    this.loadCustomAgents();

    // Load steering configuration
    this.loadSteering();
    
    if (this.steering.enabled && this.steering.global) {
      console.log(`Steering: global.md loaded (${this.steering.global.length} chars)`);
    }

    console.log(`\n${'═'.repeat(50)}`);
    console.log(`Starting workflow: ${workflowName}`);
    console.log(`Steps: ${steps.length}`);
    console.log(`${'═'.repeat(50)}`);

    // Initialize state
    let state = this.loadCurrentState();
    state.status = States.RUNNING;
    state.workflow = { name: workflowName, stepCount: steps.length };
    state.currentStepIndex = 0;
    state.context = config.initialContext || {};
    state.startedAt = new Date().toISOString();
    state.error = null;
    
    // Initialize loop tracking
    this.loop = {
      count: 0,
      stepCounts: {}
    };
    
    this.saveCurrentState(state);

    this.prependHistory({
      event: 'WORKFLOW_STARTED',
      workflow: workflowName,
      steps: steps.length
    });

    // Execute steps with goto support
    let i = 0;
    const maxIterations = 10000; // Safety limit
    let iterations = 0;

    while (i < steps.length && iterations < maxIterations) {
      iterations++;
      this.loop.count = iterations;
      
      const step = steps[i];
      const stepName = this.getStepName(step);
      
      // Track step execution count
      this.loop.stepCounts[i] = (this.loop.stepCounts[i] || 0) + 1;
      
      state.currentStepIndex = i;
      state.status = States.STEP_EXECUTING;
      state.context = { ...state.context }; // Ensure we're saving current context
      this.saveCurrentState(state);

      console.log(`\n${'─'.repeat(40)}`);
      console.log(`Step ${i + 1}/${steps.length}: ${stepName} (iteration ${iterations}, step runs: ${this.loop.stepCounts[i]})`);
      console.log(`${'─'.repeat(40)}`);

      this.prependHistory({
        event: 'STEP_STARTED',
        workflow: workflowName,
        step: stepName,
        stepIndex: i,
        loopCount: this.loop.count,
        stepRunCount: this.loop.stepCounts[i]
      });

      try {
        const result = await this.executeStepWithControl(step, state.context, state, workflowName, steps, i);

        state.context = await this.handleInteractionIfNeeded(
          result.context,
          state,
          workflowName,
          stepName,
          i
        );

        if (state.status === States.PAUSED) {
          return state.context;
        }

        state.status = States.STEP_COMPLETED;
        this.saveCurrentState(state);

        this.prependHistory({
          event: 'STEP_COMPLETED',
          workflow: workflowName,
          step: stepName,
          stepIndex: i,
          context: state.context
        });

        // Handle goto
        if (result.goto !== null) {
          if (result.goto < 0 || result.goto > steps.length) {
            throw new Error(`Goto index out of bounds: ${result.goto}. Valid range: 0-${steps.length}`);
          }
          i = result.goto;
        } else {
          i++;
        }

      } catch (error) {
        console.error(`\n✗ Step failed: ${error.message}`);
        state.status = States.STEP_FAILED;
        state.error = {
          step: stepName,
          stepIndex: i,
          message: error.message,
          stack: error.stack
        };
        this.saveCurrentState(state);

        this.prependHistory({
          event: 'STEP_FAILED',
          workflow: workflowName,
          step: stepName,
          stepIndex: i,
          error: error.message
        });

        // Mark workflow as failed
        state.status = States.WORKFLOW_FAILED;
        this.saveCurrentState(state);

        this.prependHistory({
          event: 'WORKFLOW_FAILED',
          workflow: workflowName,
          failedStep: stepName,
          failedStepIndex: i,
          error: error.message
        });

        console.log(`\n${'═'.repeat(50)}`);
        console.log(`✗ Workflow failed at step ${i + 1}`);
        console.log(`${'═'.repeat(50)}\n`);
        
        process.exitCode = 1;
        throw error;
      }
    }

    if (iterations >= maxIterations) {
      const error = new Error(`Workflow exceeded maximum iterations (${maxIterations}). Possible infinite loop.`);
      state.status = States.WORKFLOW_FAILED;
      state.error = { message: error.message };
      this.saveCurrentState(state);
      
      this.prependHistory({
        event: 'WORKFLOW_FAILED',
        workflow: workflowName,
        error: error.message
      });
      
      process.exitCode = 1;
      throw error;
    }

    // Workflow completed
    state.status = States.WORKFLOW_COMPLETED;
    this.saveCurrentState(state);

    this.prependHistory({
      event: 'WORKFLOW_COMPLETED',
      workflow: workflowName,
      finalContext: state.context,
      totalIterations: iterations
    });

    console.log(`\n${'═'.repeat(50)}`);
    console.log(`✓ Workflow completed successfully (${iterations} iterations)`);
    console.log(`${'═'.repeat(50)}`);
    console.log('\nFinal context:');
    console.log(JSON.stringify(state.context, null, 2));

    return state.context;
  }

  /**
   * Show current status
   */
  showStatus() {
    if (!this.workflowName) {
      console.log('\nNo workflow specified. Use: state-machine status <workflow-name>');
      return;
    }

    try {
      this.ensureWorkflow();
    } catch (err) {
      console.error(err.message);
      return;
    }

    const state = this.loadCurrentState();
    console.log(`\nWorkflow: ${this.workflowName}`);
    console.log('Current State:');
    console.log('─'.repeat(40));
    console.log(JSON.stringify(state, null, 2));
  }

  /**
   * Show history
   */
  showHistory(limit = 20) {
    if (!this.workflowName) {
      console.log('\nNo workflow specified. Use: state-machine history <workflow-name>');
      return;
    }

    try {
      this.ensureWorkflow();
    } catch (err) {
      console.error(err.message);
      return;
    }

    const history = this.loadHistory();
    const entries = history.slice(-limit);

    console.log(`\nWorkflow: ${this.workflowName}`);
    console.log(`Execution History (last ${entries.length} entries):`);
    console.log('─'.repeat(60));

    if (entries.length === 0) {
      console.log('No history yet.');
      return;
    }

    entries.forEach((entry) => {
      const time = new Date(entry.timestamp).toLocaleString();
      console.log(`\n[${time}] ${entry.event}`);
      if (entry.step) console.log(`  Step: ${entry.step}`);
      if (entry.loopCount) console.log(`  Loop: ${entry.loopCount}`);
      if (entry.error) console.log(`  Error: ${entry.error}`);
    });
    console.log('');
  }

  /**
   * Reset state
   */
  reset() {
    if (!this.workflowName) {
      console.log('\nNo workflow specified. Use: state-machine reset <workflow-name>');
      return;
    }

    try {
      this.ensureWorkflow();
    } catch (err) {
      console.error(err.message);
      return;
    }

    const state = this.createInitialState();
    this.saveCurrentState(state);
    console.log(`Workflow '${this.workflowName}' state reset to initial values`);
  }

  /**
   * Resume a failed or stopped workflow from where it left off
   */
  async resume() {
    this.ensureWorkflow();
    
    // Load saved state
    const savedState = this.loadCurrentState();
    
    // Check if workflow can be resumed
    if (savedState.status === 'IDLE') {
      console.log('No workflow to resume. Use `state-machine run` to start.');
      return;
    }
    
    if (savedState.status === 'WORKFLOW_COMPLETED') {
      console.log('Workflow already completed. Use `state-machine run` to start fresh.');
      return;
    }
    
    if (!savedState.workflow) {
      console.log('No workflow state found. Use `state-machine run` to start.');
      return;
    }
    
    // Load workflow config
    const config = this.loadWorkflowConfig();
    this.workflowConfig = config;
    const steps = config.steps || [];
    const workflowName = config.name || this.workflowName;
    
    // Load custom agents and steering
    this.loadCustomAgents();
    this.loadSteering();
    
    if (this.steering.enabled && this.steering.global) {
      console.log(`Steering: global.md loaded (${this.steering.global.length} chars)`);
    }

    // If paused for an interaction, finalize it and move on
    if (savedState.status === States.PAUSED && savedState.pendingInteraction) {
      const pending = savedState.pendingInteraction;
      const filePath = path.join(this.workflowDir, pending.file);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        savedState.context = { ...savedState.context, [pending.targetKey]: content };
      }

      savedState.pendingInteraction = null;
      savedState.status = States.STEP_COMPLETED;
      this.saveCurrentState(savedState);

      this.prependHistory({
        event: 'INTERACTION_RESOLVED',
        workflow: workflowName,
        step: pending.step,
        stepIndex: pending.stepIndex,
        slug: pending.slug,
        file: pending.file,
        targetKey: pending.targetKey,
        resumed: true
      });
    }
    
    // Determine resume point
    let resumeIndex = savedState.currentStepIndex;
    
    // If the step failed, retry it; otherwise start from the next one
    if (savedState.status === 'STEP_FAILED' || savedState.status === 'WORKFLOW_FAILED') {
      console.log(`\nResuming from failed step ${resumeIndex + 1}...`);
    } else if (savedState.status === 'STEP_COMPLETED') {
      resumeIndex = savedState.currentStepIndex + 1;
      console.log(`\nResuming from step ${resumeIndex + 1}...`);
    } else {
      console.log(`\nResuming from step ${resumeIndex + 1} (status: ${savedState.status})...`);
    }
    
    // Check if there are steps to run
    if (resumeIndex >= steps.length) {
      console.log('No more steps to run. Workflow complete.');
      savedState.status = States.WORKFLOW_COMPLETED;
      this.saveCurrentState(savedState);
      return savedState.context;
    }
    
    console.log(`\n${'═'.repeat(50)}`);
    console.log(`Resuming workflow: ${workflowName}`);
    console.log(`From step: ${resumeIndex + 1}/${steps.length}`);
    console.log(`Previous context keys: ${Object.keys(savedState.context).filter(k => !k.startsWith('_')).join(', ') || 'none'}`);
    console.log(`${'═'.repeat(50)}`);
    
    // Restore state
    let state = savedState;
    state.status = States.RUNNING;
    state.error = null;
    
    // Restore loop tracking
    this.loop = savedState.loop || {
      count: 0,
      stepCounts: {}
    };
    
    this.saveCurrentState(state);
    
    this.prependHistory({
      event: 'WORKFLOW_RESUMED',
      workflow: workflowName,
      resumeFromStep: resumeIndex,
      previousStatus: savedState.status
    });
    
    // Execute remaining steps
    let i = resumeIndex;
    const maxIterations = 10000;
    let iterations = this.loop.count || 0;
    
    while (i < steps.length && iterations < maxIterations) {
      iterations++;
      this.loop.count = iterations;
      
      const step = steps[i];
      const stepName = this.getStepName(step);
      
      // Track step execution count
      this.loop.stepCounts[i] = (this.loop.stepCounts[i] || 0) + 1;
      
      state.currentStepIndex = i;
      state.status = States.STEP_EXECUTING;
      this.saveCurrentState(state);
      
      console.log(`\n${'─'.repeat(40)}`);
      console.log(`Step ${i + 1}/${steps.length}: ${stepName} (iteration ${iterations}, step runs: ${this.loop.stepCounts[i]})`);
      console.log(`${'─'.repeat(40)}`);
      
      this.prependHistory({
        event: 'STEP_STARTED',
        workflow: workflowName,
        step: stepName,
        stepIndex: i,
        loopCount: this.loop.count,
        stepRunCount: this.loop.stepCounts[i],
        resumed: true
      });
      
      try {
        const result = await this.executeStepWithControl(step, state.context, state, workflowName, steps, i);

        state.context = await this.handleInteractionIfNeeded(
          result.context,
          state,
          workflowName,
          stepName,
          i
        );

        if (state.status === States.PAUSED) {
          return state.context;
        }

        state.status = States.STEP_COMPLETED;
        this.saveCurrentState(state);
        
        this.prependHistory({
          event: 'STEP_COMPLETED',
          workflow: workflowName,
          step: stepName,
          stepIndex: i,
          context: state.context
        });
        
        // Handle goto
        if (result.goto !== null) {
          if (result.goto < 0 || result.goto > steps.length) {
            throw new Error(`Goto index out of bounds: ${result.goto}. Valid range: 0-${steps.length}`);
          }
          i = result.goto;
        } else {
          i++;
        }
        
      } catch (error) {
        console.error(`\n✗ Step failed: ${error.message}`);
        state.status = States.STEP_FAILED;
        state.error = {
          step: stepName,
          stepIndex: i,
          message: error.message,
          stack: error.stack
        };
        this.saveCurrentState(state);
        
        this.prependHistory({
          event: 'STEP_FAILED',
          workflow: workflowName,
          step: stepName,
          stepIndex: i,
          error: error.message
        });
        
        state.status = States.WORKFLOW_FAILED;
        this.saveCurrentState(state);
        
        this.prependHistory({
          event: 'WORKFLOW_FAILED',
          workflow: workflowName,
          failedStep: stepName,
          failedStepIndex: i,
          error: error.message
        });
        
        console.log(`\n${'═'.repeat(50)}`);
        console.log(`✗ Workflow failed at step ${i + 1}`);
        console.log(`Use 'state-machine resume ${this.workflowName}' to retry`);
        console.log(`${'═'.repeat(50)}\n`);
        
        process.exitCode = 1;
        throw error;
      }
    }
    
    if (iterations >= maxIterations) {
      const error = new Error(`Workflow exceeded maximum iterations (${maxIterations}). Possible infinite loop.`);
      state.status = States.WORKFLOW_FAILED;
      state.error = { message: error.message };
      this.saveCurrentState(state);
      
      this.prependHistory({
        event: 'WORKFLOW_FAILED',
        workflow: workflowName,
        error: error.message
      });
      
      process.exitCode = 1;
      throw error;
    }
    
    // Workflow completed
    state.status = States.WORKFLOW_COMPLETED;
    this.saveCurrentState(state);
    
    this.prependHistory({
      event: 'WORKFLOW_COMPLETED',
      workflow: workflowName,
      finalContext: state.context,
      totalIterations: iterations,
      resumed: true
    });
    
    console.log(`\n${'═'.repeat(50)}`);
    console.log(`✓ Workflow completed successfully (${iterations} iterations)`);
    console.log(`${'═'.repeat(50)}`);
    console.log('\nFinal context:');
    console.log(JSON.stringify(state.context, null, 2));
    
    return state.context;
  }
}
export { StateMachine, States, BUILTIN_AGENTS };
