/**
 * File: /lib/config-utils.js
 */

import fs from 'fs';

export function findConfigObjectRange(source) {
  const match = source.match(/export\s+const\s+config\s*=/);
  if (!match) return null;
  const startSearch = match.index + match[0].length;
  const braceStart = source.indexOf('{', startSearch);
  if (braceStart === -1) return null;

  return findObjectLiteralRange(source, braceStart);
}

function findObjectLiteralRange(source, braceStart) {
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

function detectIndent(inner) {
  const indentMatch = inner.match(/\n([ \t]+)\S/);
  return indentMatch ? indentMatch[1] : '  ';
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isValidIdentifier(value) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value);
}

function formatObjectKey(value) {
  if (isValidIdentifier(value)) return value;
  return JSON.stringify(value);
}

function insertPropertyIntoObjectSource(objectSource, propertySource, indent) {
  const inner = objectSource.slice(1, -1);
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
  const insert = `${indent}${propertySource},\n`;
  const newInner = hasContent
    ? `${updatedInner}${needsNewline ? '\n' : ''}${insert}`
    : `\n${insert}`;

  return `{${newInner}}`;
}

export function readRemotePathFromConfig(configFile) {
  const source = fs.readFileSync(configFile, 'utf-8');
  const range = findConfigObjectRange(source);
  if (!range) return null;
  const configSource = source.slice(range.start, range.end + 1);
  const match = configSource.match(/\bremotePath\s*:\s*(['"`])([^'"`]+)\1/);
  return match ? match[2] : null;
}

export function writeRemotePathToConfig(configFile, remotePath) {
  const source = fs.readFileSync(configFile, 'utf-8');
  const range = findConfigObjectRange(source);
  const remoteLine = `remotePath: ${JSON.stringify(remotePath)}`;

  if (!range) {
    const hasConfigExport = /export\s+const\s+config\s*=/.test(source);
    if (hasConfigExport) {
      throw new Error('Config export is not an object literal; add remotePath manually.');
    }
    const trimmed = source.replace(/\s*$/, '');
    const appended = `${trimmed}\n\nexport const config = {\n  ${remoteLine}\n};\n`;
    fs.writeFileSync(configFile, appended);
    return;
  }

  const configSource = source.slice(range.start, range.end + 1);
  const remoteRegex = /\bremotePath\s*:\s*(['"`])([^'"`]*?)\1/;
  let updatedConfigSource;

  if (remoteRegex.test(configSource)) {
    updatedConfigSource = configSource.replace(remoteRegex, remoteLine);
  } else {
    const inner = configSource.slice(1, -1);
    const indent = detectIndent(inner);
    updatedConfigSource = insertPropertyIntoObjectSource(configSource, remoteLine, indent);
  }

  const updatedSource =
    source.slice(0, range.start) +
    updatedConfigSource +
    source.slice(range.end + 1);
  fs.writeFileSync(configFile, updatedSource);
}

function findModelsObjectRange(configSource) {
  const regex = /\bmodels\s*:\s*{/g;
  const match = regex.exec(configSource);
  if (!match) return null;
  const braceStart = configSource.indexOf('{', match.index + match[0].length - 1);
  if (braceStart === -1) return null;
  return findObjectLiteralRange(configSource, braceStart);
}

function buildModelKeyRegex(modelKey) {
  const escaped = escapeRegExp(modelKey);
  const quotedKey = `['"\\\`]${escaped}['"\\\`]`;
  const unquotedKey = isValidIdentifier(modelKey) ? escaped : null;
  const keyPattern = unquotedKey ? `(?:${unquotedKey}|${quotedKey})` : quotedKey;
  return new RegExp(`(^|[,{\\s])(${keyPattern})\\s*:\\s*(['"\\\`])([^'"\\\\\`]*?)\\3`, 'm');
}

export function readModelFromConfig(configFile, modelKey) {
  const source = fs.readFileSync(configFile, 'utf-8');
  const range = findConfigObjectRange(source);
  if (!range) return null;
  const configSource = source.slice(range.start, range.end + 1);
  const modelsRange = findModelsObjectRange(configSource);
  if (!modelsRange) return null;
  const modelsSource = configSource.slice(modelsRange.start, modelsRange.end + 1);
  const keyRegex = buildModelKeyRegex(modelKey);
  const match = modelsSource.match(keyRegex);
  return match ? match[4] : null;
}

export function writeModelToConfig(configFile, modelKey, modelValue) {
  const source = fs.readFileSync(configFile, 'utf-8');
  const range = findConfigObjectRange(source);
  const formattedKey = formatObjectKey(modelKey);
  const serializedValue = JSON.stringify(modelValue);

  if (!range) {
    const hasConfigExport = /export\s+const\s+config\s*=/.test(source);
    if (hasConfigExport) {
      throw new Error('Config export is not an object literal; add models mapping manually.');
    }
    const trimmed = source.replace(/\s*$/, '');
    const appended = `${trimmed}\n\nexport const config = {\n  models: {\n    ${formattedKey}: ${serializedValue}\n  }\n};\n`;
    fs.writeFileSync(configFile, appended);
    return;
  }

  const configSource = source.slice(range.start, range.end + 1);
  const modelsRange = findModelsObjectRange(configSource);
  let updatedConfigSource = configSource;

  if (!modelsRange) {
    const inner = configSource.slice(1, -1);
    const indent = detectIndent(inner);
    const nestedIndent = `${indent}  `;
    const modelsBlock = `models: {\n${nestedIndent}${formattedKey}: ${serializedValue},\n${indent}}`;
    updatedConfigSource = insertPropertyIntoObjectSource(configSource, modelsBlock, indent);
  } else {
    const modelsSource = configSource.slice(modelsRange.start, modelsRange.end + 1);
    const keyRegex = buildModelKeyRegex(modelKey);
    let updatedModelsSource;

    if (keyRegex.test(modelsSource)) {
      updatedModelsSource = modelsSource.replace(
        keyRegex,
        (_match, prefix, keyToken) => `${prefix}${keyToken}: ${serializedValue}`
      );
    } else {
      const inner = modelsSource.slice(1, -1);
      const indent = detectIndent(inner);
      const modelLine = `${formattedKey}: ${serializedValue}`;
      updatedModelsSource = insertPropertyIntoObjectSource(modelsSource, modelLine, indent);
    }

    updatedConfigSource =
      configSource.slice(0, modelsRange.start) +
      updatedModelsSource +
      configSource.slice(modelsRange.end + 1);
  }

  const updatedSource =
    source.slice(0, range.start) +
    updatedConfigSource +
    source.slice(range.end + 1);
  fs.writeFileSync(configFile, updatedSource);
}
