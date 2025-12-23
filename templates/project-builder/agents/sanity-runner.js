import { exec, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const DEFAULT_TIMEOUT_MS = 30000;

export default async function sanityRunner(context) {
  const { checks = [], setup, teardown } = context;
  const cwd = context?._config?.workflowDir || process.cwd();
  const results = [];

  let setupError = null;
  if (setup) {
    try {
      await runSetup(setup, cwd);
    } catch (error) {
      setupError = error;
    }
  }

  for (const check of checks) {
    if (setupError) {
      results.push({
        id: check.id,
        status: 'failed',
        error: `Setup failed: ${setupError.message}`
      });
      continue;
    }

    const result = await runCheck(check, cwd);
    results.push(result);
  }

  if (teardown) {
    try {
      await execCommand(teardown, cwd, DEFAULT_TIMEOUT_MS);
    } catch (error) {
      results.push({
        id: 'teardown',
        status: 'failed',
        error: `Teardown failed: ${error.message}`
      });
    }
  }

  const summary = results.reduce((acc, item) => {
    if (item.status === 'passed') acc.passed += 1;
    if (item.status === 'failed') acc.failed += 1;
    return acc;
  }, { passed: 0, failed: 0 });

  return { summary, results };
}

async function runSetup(command, cwd) {
  const trimmed = command.trim();
  if (trimmed.endsWith('&')) {
    const withoutAmp = trimmed.replace(/&\s*$/, '').trim();
    const child = spawn(withoutAmp, {
      cwd,
      shell: true,
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
    return;
  }
  await execCommand(command, cwd, DEFAULT_TIMEOUT_MS);
}

async function runCheck(check, cwd) {
  const timeoutMs = check.timeoutMs || DEFAULT_TIMEOUT_MS;
  const type = check.type || 'shell';
  const id = check.id ?? 'unknown';

  try {
    if (type === 'shell') {
      const output = await execCommand(check.command, cwd, timeoutMs);
      return compareOutput(id, output, check);
    }

    if (type === 'test_suite') {
      await execCommand(check.command || check.testCommand, cwd, timeoutMs);
      return { id, status: 'passed' };
    }

    if (type === 'file_exists') {
      const filePath = path.resolve(cwd, check.path || '');
      if (fs.existsSync(filePath)) {
        return { id, status: 'passed' };
      }
      return { id, status: 'failed', error: `File not found: ${check.path}` };
    }

    if (type === 'file_contains') {
      const filePath = path.resolve(cwd, check.path || '');
      if (!fs.existsSync(filePath)) {
        return { id, status: 'failed', error: `File not found: ${check.path}` };
      }
      const content = fs.readFileSync(filePath, 'utf-8');
      const pattern = check.pattern || check.contains || check.text || '';
      if (!pattern) {
        return { id, status: 'failed', error: 'Missing pattern for file_contains' };
      }
      const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'm');
      if (regex.test(content)) {
        return { id, status: 'passed' };
      }
      return { id, status: 'failed', error: `Pattern not found: ${pattern}` };
    }

    return { id, status: 'failed', error: `Unsupported check type: ${type}` };
  } catch (error) {
    return {
      id,
      status: 'failed',
      error: error.message,
      output: error.output
    };
  }
}

function compareOutput(id, output, check) {
  const expected = check.expected ?? '';
  const comparison = check.comparison || 'equals';
  const trimmed = String(output ?? '').trim();

  if (comparison === 'not_empty') {
    return trimmed.length > 0
      ? { id, status: 'passed', output: trimmed }
      : { id, status: 'failed', error: 'Output was empty', output: trimmed };
  }

  if (comparison === 'contains') {
    return trimmed.includes(String(expected))
      ? { id, status: 'passed', output: trimmed }
      : { id, status: 'failed', error: `Output did not contain: ${expected}`, output: trimmed };
  }

  return trimmed === String(expected)
    ? { id, status: 'passed', output: trimmed }
    : { id, status: 'failed', error: `Expected "${expected}", got "${trimmed}"`, output: trimmed };
}

function execCommand(command, cwd, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (!command) {
      reject(new Error('Missing command'));
      return;
    }
    exec(command, { cwd, timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        error.output = stderr || stdout;
        reject(error);
        return;
      }
      resolve(stdout || stderr || '');
    });
  });
}
