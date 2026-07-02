// Reverse proxy using scramjet + node-libcurl
// Usage: set TARGET_URL=http://backend:8080 PORT=3000 node src/server.js

const http = require('http');
const { URL } = require('url');
const { DataStream } = require('scramjet');
const { Curl } = require('node-libcurl');

const DEFAULT_PORT = process.env.PORT || 3000;
const TARGET_URL = process.env.TARGET_URL;

if (!TARGET_URL) {
  console.error('Missing TARGET_URL env var. Example: TARGET_URL=http://localhost:8080');
  process.exit(1);
}

function headersToArray(headers) {
  const out = [];
  for (const [k, v] of Object.entries(headers)) {
    // skip hop-by-hop headers that should not be forwarded
    if ([
      'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
      'te', 'trailers', 'transfer-encoding', 'upgrade'
    ].includes(k.toLowerCase())) continue;

    if (Array.isArray(v)) {
      v.forEach(val => out.push(`${k}: ${val}`));
    } else {
      out.push(`${k}: ${v}`);
    }
  }
  return out;
}

async function bufferRequestBody(req) {
  // Use scramjet to read incoming request into a single buffer.
  // NOTE: This will buffer the entire request body in memory. For very large
  // uploads you should extend this to write to a temp file and use libcurl's
  // read callback to upload from file/stream. This implementation uses
  // buffering to keep the example simple and reliable.
  const ds = DataStream.from(req);
  const chunks = [];
  for await (const chunk of ds) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function buildTargetUrl(reqUrl) {
  // Join TARGET_URL with incoming request path+query
  const base = new URL(TARGET_URL);
  const incoming = new URL(reqUrl, 'http://localhost');
  // replace pathname and search
  base.pathname = (base.pathname.replace(/\/$/, '') || '') + incoming.pathname;
  base.search = incoming.search;
  return base.toString();
}

const server = http.createServer(async (req, res) => {
  const target = buildTargetUrl(req.url);

  let bodyBuffer = Buffer.alloc(0);
  try {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      bodyBuffer = await bufferRequestBody(req);
    }
  } catch (err) {
    console.error('Error buffering request body:', err);
    res.writeHead(400, {'content-type':'text/plain'});
    res.end('Failed to read request body');
    return;
  }

  const curl = new Curl();
  let headersSent = false;
  let respHeaders = {};
  let respStatus = 200;

  // Forward request headers
  const headerArray = headersToArray(req.headers);
  // Ensure host is set to target host
  try {
    const targetUrlObj = new URL(target);
    headerArray.push(`Host: ${targetUrlObj.host}`);
  } catch (e) {}

  curl.setOpt(Curl.option.URL, target);
  curl.setOpt(Curl.option.CUSTOMREQUEST, req.method);
  curl.setOpt(Curl.option.FOLLOWLOCATION, true);
  curl.setOpt(Curl.option.HTTPHEADER, headerArray);
  curl.setOpt(Curl.option.NOBODY, false);
  curl.setOpt(Curl.option.FAILONERROR, false);

  if (bodyBuffer && bodyBuffer.length) {
    curl.setOpt(Curl.option.POSTFIELDS, bodyBuffer);
    curl.setOpt(Curl.option.POSTFIELDSIZE, bodyBuffer.length);
  }

  // Capture headers as they arrive
  curl.setOpt(Curl.option.HEADERFUNCTION, (chunk, size, nmemb) => {
    try {
      const len = size * nmemb;
      const line = chunk.toString('utf8', 0, len);
      const trimmed = line.trim();
      if (!trimmed) return len;

      // status line
      if (/^HTTP\/.+/.test(trimmed)) {
        const parts = trimmed.split(' ');
        if (parts.length >= 2) {
          const status = parseInt(parts[1], 10);
          if (!Number.isNaN(status)) respStatus = status;
        }
        return len;
      }

      const idx = line.indexOf(':');
      if (idx !== -1) {
        const name = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        const lower = name.toLowerCase();
        // collect multiple headers
        if (respHeaders[lower]) {
          if (Array.isArray(respHeaders[lower])) respHeaders[lower].push(value);
          else respHeaders[lower] = [respHeaders[lower], value];
        } else {
          respHeaders[lower] = value;
        }
      }
    } catch (e) {
      // ignore header parse errors
    }
    return size * nmemb;
  });

  // Stream body chunks as they arrive from libcurl to the response
  curl.setOpt(Curl.option.WRITEFUNCTION, (chunk, size, nmemb) => {
    try {
      const len = size * nmemb;
      const data = chunk.slice(0, len);
      if (!headersSent) {
        // map respHeaders keys back to original-case approximations
        const outHeaders = {};
        for (const [k, v] of Object.entries(respHeaders)) {
          outHeaders[k] = v;
        }
        // send status + headers
        res.writeHead(respStatus, outHeaders);
        headersSent = true;
      }
      res.write(data);
      return len;
    } catch (e) {
      return 0; // signal error
    }
  });

  curl.on('end', (statusCode, data, headers) => {
    try {
      if (!headersSent) {
        // fallback: if header function didn't run, use headers from end callback
        const outHeaders = {};
        try {
          for (const h of headers) {
            // headers here are in form 'Name: value' sometimes; node-libcurl may
            // provide parsed headers in an object; handle both
            if (typeof h === 'string') {
              const idx = h.indexOf(':');
              if (idx !== -1) outHeaders[h.slice(0, idx).toLowerCase()] = h.slice(idx + 1).trim();
            } else if (typeof h === 'object' && h.name) {
              outHeaders[h.name.toLowerCase()] = h.value;
            }
          }
        } catch (e) {}
        res.writeHead(statusCode || respStatus || 200, outHeaders);
        headersSent = true;
      }

      if (data && data.length) res.write(Buffer.from(data));
      res.end();
    } catch (e) {
      try { res.end(); } catch (_) {}
    } finally {
      try { curl.close(); } catch (_) {}
    }
  });

  curl.on('error', (err, errCode) => {
    console.error('libcurl error', err, errCode);
    try {
      if (!res.headersSent) res.writeHead(502, {'content-type':'text/plain'});
      res.end('Bad Gateway (libcurl error)');
    } catch (e) {}
    try { curl.close(); } catch (_) {}
  });

  try {
    curl.perform();
  } catch (err) {
    console.error('curl.perform error', err);
    try { curl.close(); } catch (_) {}
    if (!res.headersSent) {
      res.writeHead(500, {'content-type':'text/plain'});
      res.end('Internal Server Error');
    }
  }
});

server.listen(DEFAULT_PORT, () => {
  console.log(`Proxy listening on :${DEFAULT_PORT}, forwarding to ${TARGET_URL}`);
});
