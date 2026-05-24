# On your Mac (internet available)
docker build -t qwen-chat:latest .
docker save qwen-chat:latest | gzip > qwen-chat.tar.gz

# Transfer to CODER (SCP, USB, whatever your air-gap transfer method is)
# Inside CODER:
docker load < qwen-chat.tar.gz
docker run -d -p 3001:3001 --name qwen-chat qwen-chat:latest



# Inside CODER:
docker load < qwen-chat-AMD64-v0.1.tar.gz
docker run -d -p 3001:3001 --name qwen-chat --restart unless-stopped qwen-chat:AMD64-v0.1

# Split into 10 MB parts (default)
node splitter.js split qwen-chat-AMD64-v0.1.tar.gz

# Split into custom size (e.g. 25 MB)
node splitter.js split qwen-chat-AMD64-v0.1.tar.gz --size 25

# Join — just point at part000, it auto-detects the rest
node splitter.js join qwen-chat-AMD64-v0.1.tar.gz.part000

# Join with custom output name
node splitter.js join qwen-chat-AMD64-v0.1.tar.gz.part000 restored.tar.gz

node splitter.js join qwen-chat-AMD64-v0.1.tar.gz.b64.txt.part000
# → qwen-chat-AMD64-v0.1.tar.gz.b64.txt  (61 MB, reassembled)

node b64convert.js decode qwen-chat-AMD64-v0.1.tar.gz.b64.txt
# → qwen-chat-AMD64-v0.1.tar.gz  (46 MB, ready for docker load)

docker load < qwen-chat-AMD64-v0.1.tar.gz
