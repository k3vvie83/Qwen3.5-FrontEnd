const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const HTML_FILE = path.join(__dirname, 'index.html');
const TARGET_HOST = 'inference.hgx.ngine2.internal';
const TARGET_PORT = 443;
const LOCAL_PORT = 3001;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const server = http.createServer((req, clientRes) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    clientRes.writeHead(204, CORS_HEADERS);
    clientRes.end();
    return;
  }

  // Serve index.html for root path
  if (req.url === '/' || req.url === '/index.html') {
    fs.readFile(HTML_FILE, (err, data) => {
      if (err) {
        clientRes.writeHead(500, { 'Content-Type': 'text/plain' });
        clientRes.end('Cannot read index.html: ' + err.message);
        return;
      }
      clientRes.writeHead(200, { 'Content-Type': 'text/html' });
      clientRes.end(data);
    });
    return;
  }

  // Proxy to inference service - strip incorrect Host headers
  const headers = { ...req.headers };
  delete headers['host'];
  delete headers['connection'];

  const options = {
    hostname: TARGET_HOST,
    port: TARGET_PORT,
    path: req.url,
    method: req.method,
    headers: headers,
    rejectUnauthorized: false,
  };

  const proxyReq = https.request(options, (proxyRes) => {
    const responseHeaders = { ...proxyRes.headers };
    delete responseHeaders['content-length'];
    delete responseHeaders['content-encoding'];
    Object.entries(CORS_HEADERS).forEach(([k, v]) => {
      if (!responseHeaders[k.toLowerCase()]) {
        responseHeaders[k.toLowerCase()] = v;
      }
    });
    clientRes.writeHead(proxyRes.statusCode, responseHeaders);
    proxyRes.on('data', (chunk) => {
      if (!clientRes.write(chunk)) {
        proxyRes.pause();
        clientRes.once('drain', () => proxyRes.resume());
      }
    });
    proxyRes.on('end', () => clientRes.end());
    proxyRes.on('error', (err) => {
      console.error('Proxy upstream error:', err.message);
      if (!clientRes.writableEnded) clientRes.end();
    });
  });

  proxyReq.on('error', (err) => {
    console.error('Proxy request error:', err.message);
    if (!clientRes.writableEnded) {
      clientRes.writeHead(502, { 'Content-Type': 'application/json' });
      clientRes.end(JSON.stringify({ error: { message: 'Proxy error: ' + err.message } }));
    }
  });

  req.pipe(proxyReq);
});

server.on('error', (err) => {
  console.error('Server error:', err.message);
});

server.listen(LOCAL_PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${LOCAL_PORT}`);
});
