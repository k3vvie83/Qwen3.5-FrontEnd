import http from 'http';

const PORT = 3000;

const server = http.createServer((req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/v1/chat/completions') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
    });

    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const model = payload.model || 'unknown-model';
        const stream = payload.stream !== false;
        const temperature = payload.temperature !== undefined ? payload.temperature : 0.7;
        const messages = payload.messages || [];

        // Parse last message to check for attachments
        const lastMessage = messages[messages.length - 1] || {};
        let attachmentCount = 0;
        let attachmentTypes = [];

        if (Array.isArray(lastMessage.content)) {
          lastMessage.content.forEach(part => {
            if (part.type === 'image_url') {
              attachmentCount++;
              attachmentTypes.push('Image');
            } else if (part.type === 'video_url') {
              attachmentCount++;
              attachmentTypes.push('Video');
            }
          });
        }

        // Generate response text summarizing parameters
        const responseText = `👋 Hello! This is a streaming response from the **Local Mock API Server**.

### Verification Summary
* **Active Model:** \`${model}\`
* **Temperature Config:** \`${temperature}\`
* **Streaming Enabled:** \`${stream}\`
* **Conversation turns in history:** \`${messages.length}\`

### Multimodal Upload Status
${attachmentCount > 0 
  ? `✅ Successfully received **${attachmentCount} attachment(s)** in the payload: *(${attachmentTypes.join(', ')})*.\n\n*Note: The frontend successfully encoded the files to Base64 data URLs.*` 
  : `ℹ️ No media attachments were sent in the last message.`}

Here is a short paragraph of text to test the formatting and scroll speed of your chat feed:

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.`;

        if (stream) {
          // SSE stream headers
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });

          const chunks = responseText.split(/(\s+)/); // split by words/spaces to animate streaming
          
          let i = 0;
          const sendChunk = () => {
            if (i >= chunks.length) {
              res.write('data: [DONE]\n\n');
              res.end();
              return;
            }

            const chunkText = chunks[i];
            const data = {
              choices: [
                {
                  delta: {
                    content: chunkText
                  }
                }
              ]
            };

            res.write(`data: ${JSON.stringify(data)}\n\n`);
            i++;
            setTimeout(sendChunk, 35); // 35ms delay per word chunk
          };

          sendChunk();

        } else {
          // Non-streaming response
          res.writeHead(200, { 'Content-Type': 'application/json' });
          const responseJson = {
            id: 'mock-chatcmpl-' + Math.random().toString(36).substring(7),
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: model,
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: responseText
                },
                finish_reason: 'stop'
              }
            ]
          };
          res.end(JSON.stringify(responseJson));
        }

      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Failed to parse payload: ' + err.message } }));
      }
    });

  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Not Found' } }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Mock completions server listening on http://0.0.0.0:${PORT}`);
});
