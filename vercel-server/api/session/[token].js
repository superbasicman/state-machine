// /vercel-server/api/session/[token].js
import path from 'path';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';

import { getSession } from '../../lib/redis.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let cachedTemplate = null;
async function getTemplate() {
  if (cachedTemplate) return cachedTemplate;
  // Point to the built template in vercel-server/public/remote/index.html
  const templatePath = path.join(__dirname, '..', '..', 'public', 'remote', 'index.html');
  cachedTemplate = await readFile(templatePath, 'utf8');
  return cachedTemplate;
}

export default async function handler(req, res) {
  const { token } = req.query;

  if (!token) return res.status(400).send('Missing session token');

  const session = await getSession(token);
  if (!session) {
    return res.status(404).send(`<!DOCTYPE html>
<html>
  <head>
    <title>Session Not Found</title>
    <style>body { font-family: system-ui; max-width: 600px; margin: 100px auto; text-align: center; }</style>
  </head>
  <body>
    <h1>Session Not Found</h1>
    <p>This session has expired or does not exist.</p>
    <p>Sessions expire 30 minutes after the last activity.</p>
  </body>
</html>`);
  }

  const template = await getTemplate();

  const html = template
    .replace(/\{\{SESSION_TOKEN\}\}/g, token)
    .replace(/\{\{WORKFLOW_NAME\}\}/g, session.workflowName || 'Workflow');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}
