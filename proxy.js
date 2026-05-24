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
    // Pass through CORS headers from inference (or add our own)
    const responseHeaders = { ...proxyRes.headers };
    Object.entries(CORS_HEADERS).forEach(([k, v]) => {
      if (!responseHeaders[k.toLowerCase()]) {
        responseHeaders[k.toLowerCase()] = v;
      }
    });
    responseHeaders['cache-control'] = 'no-cache';
    responseHeaders['x-accel-buffering'] = 'no';
    clientRes.writeHead(proxyRes.statusCode, responseHeaders);
    proxyRes.pipe(clientRes);
  });

  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err.message);
    clientRes.writeHead(502, { 'Content-Type': 'application/json' });
    clientRes.end(JSON.stringify({ error: { message: 'Proxy error: ' + err.message } }));
  });

  req.pipe(proxyReq);
});

server.on('error', (err) => {
  console.error('Server error:', err.message);
});

server.listen(LOCAL_PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${LOCAL_PORT}`);
});
