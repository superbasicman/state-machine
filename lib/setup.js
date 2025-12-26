/**
 * File: /lib/setup.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_TEMPLATE = 'starter';

function getTemplatesDir() {
  return path.join(__dirname, '..', 'templates');
}

function listTemplates(templatesDir) {
  if (!fs.existsSync(templatesDir)) return [];
  return fs.readdirSync(templatesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function applyReplacements(content, replacements) {
  let output = content;
  for (const [token, value] of Object.entries(replacements)) {
    output = output.split(token).join(value);
  }
  return output;
}

function copyTemplateDir(srcDir, destDir, replacements, createdPaths) {
  fs.mkdirSync(destDir, { recursive: true });

  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      copyTemplateDir(srcPath, destPath, replacements, createdPaths);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    let written = false;
    try {
      const content = fs.readFileSync(srcPath, 'utf-8');
      const replaced = applyReplacements(content, replacements);
      fs.writeFileSync(destPath, replaced);
      written = true;
    } catch {
      // Fallback for non-text files
    }

    if (!written) {
      fs.copyFileSync(srcPath, destPath);
    }

    createdPaths.push(destPath);
  }
}

/**
 * Setup a new workflow with directory structure
 */
async function setup(workflowName, options = {}) {
  const workflowsDir = path.join(process.cwd(), '.workflows');
  const workflowDir = path.join(workflowsDir, workflowName);
  const templateName = options.template || DEFAULT_TEMPLATE;

  // Check if workflow already exists
  if (fs.existsSync(workflowDir)) {
    console.error(`Error: Workflow '${workflowName}' already exists at ${workflowDir}`);
    process.exit(1);
  }

  const templatesDir = getTemplatesDir();
  const templateDir = path.join(templatesDir, templateName);

  if (!fs.existsSync(templateDir)) {
    const available = listTemplates(templatesDir);
    console.error(`Error: Template '${templateName}' not found.`);
    if (available.length > 0) {
      console.error(`Available templates: ${available.join(', ')}`);
    }
    process.exit(1);
  }

  console.log(`\nCreating workflow: ${workflowName}`);
  console.log(`Using template: ${templateName}`);
  console.log('─'.repeat(40));

  const replacements = {
    '__WORKFLOW_NAME__': workflowName,
    '__NOW_ISO__': new Date().toISOString()
  };

  const createdPaths = [];
  copyTemplateDir(templateDir, workflowDir, replacements, createdPaths);

  for (const createdPath of createdPaths) {
    console.log(`  Created: ${path.relative(process.cwd(), createdPath)}`);
  }

  console.log('─'.repeat(40));
  console.log(`\n✓ Workflow '${workflowName}' created successfully!\n`);
  console.log('Next steps:');
  console.log(`  1. Edit .workflows/${workflowName}/workflow.js to implement your flow`);
  console.log(`  2. Edit .workflows/${workflowName}/config.js to set models/API keys`);
  console.log(`  3. Add custom agents in .workflows/${workflowName}/agents/`);
  console.log(`  4. Run: state-machine run ${workflowName}\n`);
}

export { setup };
