/**
 * File: /lib/ui/server.js
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function startServer(workflowDir, initialPort = 3000) {
  const clients = new Set();
  const stateDir = path.join(workflowDir, 'state');

  // Watch for changes in the state directory
  // We debounce slightly to avoid sending multiple events for a single write burst
  let debounceTimer;
  const broadcastUpdate = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const msg = 'data: update\n\n';
      for (const client of clients) {
        try {
          client.write(msg);
        } catch (e) {
          clients.delete(client);
        }
      }
    }, 100);
  };

  try {
    if (fs.existsSync(stateDir)) {
      fs.watch(stateDir, (eventType, filename) => {
        if (filename && (filename === 'history.jsonl' || filename.startsWith('history'))) {
          broadcastUpdate();
        }
      });
    } else {
      console.warn('Warning: State directory does not exist yet. Live updates might not work until it is created.');
    }
  } catch (err) {
    console.warn('Warning: Failed to setup file watcher:', err.message);
  }

  // Request Handler
  const requestHandler = (req, res) => {
    // Serve the main HTML page
    if (req.url === '/' || req.url === '/index.html') {
      const htmlPath = path.join(__dirname, 'index.html');
      fs.readFile(htmlPath, (err, content) => {
        if (err) {
          res.writeHead(500);
          res.end('Error loading UI');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(content);
      });
      return;
    }

    // Server-Sent Events endpoint
    if (req.url === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write('retry: 10000\n\n');

      clients.add(res);

      req.on('close', () => {
        clients.delete(res);
      });
      return;
    }

    // Serve API
    if (req.url === '/api/history') {
      const historyFile = path.join(stateDir, 'history.jsonl');
      
      if (!fs.existsSync(historyFile)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          workflowName: path.basename(workflowDir),
          entries: [] 
        }));
        return;
      }

      try {
        const fileContent = fs.readFileSync(historyFile, 'utf-8');
        const lines = fileContent.trim().split('\n');
        const entries = lines
          .map(line => {
            try { return JSON.parse(line); } catch { return null; }
          })
          .filter(Boolean);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          workflowName: path.basename(workflowDir),
          entries
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // 404
    res.writeHead(404);
    res.end('Not found');
  };

  // Port hunting logic
  let port = initialPort;
  const maxPort = initialPort + 100; // Try up to 100 ports

  const attemptServer = () => {
    const server = http.createServer(requestHandler);

    server.on('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        if (port < maxPort) {
          console.log(`Port ${port} is in use, trying ${port + 1}...`);
          port++;
          attemptServer();
        } else {
          console.error(`Error: Could not find an open port between ${initialPort} and ${maxPort}.`);
        }
      } else {
        console.error('Server error:', e);
      }
    });

    server.listen(port, () => {
      console.log(`\n> Follow UI running at http://localhost:${port}`);
      console.log(`> Viewing history for: ${workflowDir}`);
      console.log(`> Press Ctrl+C to stop`);
    });
  };

  attemptServer();
}
