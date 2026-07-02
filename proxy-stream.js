const { Curl } = require('node-libcurl');
const { DataStream } = require('scramjet');

function handleProxy(req, res) {
  const curl = new Curl();
  
  curl.setOpt('URL', req.url);
  curl.setOpt('CUSTOMREQUEST', req.method);
  curl.setOpt('FOLLOWLOCATION', true);

  // Scramjet pipeline to handle the stream transformation
  const responseStream = new DataStream();
  responseStream.pipe(res);

  // Capture headers from target server
  curl.on('HEADER', (buf, size) => {
    const headerString = buf.toString();
    const match = headerString.match(/^([\w-]+):\s*(.*)\r\n$/);
    if (match) {
      const [_, key, value] = match;
      if (key.toLowerCase() !== 'transfer-encoding') {
        res.setHeader(key, value);
      }
    }
    return size;
  });

  // Push libcurl binary data chunks down the Scramjet pipeline
  curl.on('DATA', (chunk, size) => {
    responseStream.write(chunk);
    return size;
  });

  curl.on('END', () => {
    responseStream.end();
    curl.close();
  });

  curl.on('ERROR', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Bad Gateway: Proxy error.');
    }
    responseStream.end();
    curl.close();
  });

  curl.perform();
}

module.exports = { handleProxy };
