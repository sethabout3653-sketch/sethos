import express from 'express';
import { createServer } from 'node:http';
import { uvPath } from '@titaniumnetwork-dev/ultraviolet';
import { join } from 'node:path';

const app = express();

// 1. Serve your custom interface files out of the public directory
app.use(express.static('public'));

// 2. Automatically route & serve core Ultraviolet library distribution scripts straight from node_modules
app.use('/uv/', express.static(uvPath));

const port = process.env.PORT || 8080;
const server = createServer(app);

// Simple online status checkpoint
app.get('/health', (req, res) => res.send('Proxy is online.'));

server.listen(port, () => {
  console.log(`Proxy server actively running on port ${port}`);
});
