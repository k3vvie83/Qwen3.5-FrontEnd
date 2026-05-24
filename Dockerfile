# --- Stage 1: Build the app ---
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package management files
COPY package.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build the production bundle
RUN npm run build

# --- Stage 2: Serve the app using Nginx unprivileged ---
FROM nginxinc/nginx-unprivileged:stable-alpine

# Set custom routing configuration for SPA
RUN echo 'server { \
    listen 8080; \
    server_name localhost; \
    location / { \
        root /usr/share/nginx/html; \
        index index.html index.htm; \
        try_files $uri $uri/ /index.html; \
    } \
    error_page 500 502 503 504 /50x.html; \
    location = /50x.html { \
        root /usr/share/nginx/html; \
    } \
}' > /etc/nginx/conf.d/default.conf

# Copy build output from Stage 1
COPY --from=builder /app/dist /usr/share/nginx/html

# Expose Nginx unprivileged default port
EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
