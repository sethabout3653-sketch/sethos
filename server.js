const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const config = require('./config');
const { handleProxy } = require('./proxy-stream');

// Automatically daemonize (run in background) if not already detached
if (!process.env.__BACKGROUND__) {
  process.env.__BACKGROUND__ = 'true';
  
  const out = fs.openSync('./proxy.log', 'a');
  const err = fs.openSync('./proxy.log', 'a');

  const child = spawn(process.argv[0], process.argv.slice(1), {
    detached: true,
    stdio: ['ignore', out, err],
    env: process.env
  });

  child.unref();
  console.log(`Proxy automated. Running in background. PID: ${child.pid}`);
  process.exit(0);
}

// Main Server Logic (Runs silently in the background)
const server = http.createServer((req, res) => {
  const proxyAuth = req.headers['x-proxy-auth'];
  if (config.secretToken && proxyAuth !== config.secretToken) {
    res.writeHead(407, { 'Content-Type': 'text/plain' });
    return res.end('Proxy Authentication Required.');
  }

  handleProxy(req, res);
});

// Auto-restart crash protection
process.on('uncaughtException', (err) => {
  fs.appendFileSync('./proxy.log', `[Crash Protected] ${new Date().toISOString()} - ${err.stack}\n`);
});

server.listen(config.port);
