# Use Node.js LTS version
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S sftpuser && \
    adduser -S sftpuser -u 1001 -G sftpuser

# Install dependencies first (for better caching)
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy application code
COPY . .

# Create necessary directories
RUN mkdir -p /app/data /app/storage /app/keys /app/logs && \
    chown -R sftpuser:sftpuser /app

# Generate SSH host key if it doesn't exist
RUN if [ ! -f /app/keys/host.key ]; then \
        ssh-keygen -t rsa -b 2048 -f /app/keys/host.key -N "" && \
        chown sftpuser:sftpuser /app/keys/host.key*; \
    fi

# Switch to non-root user
USER sftpuser

# Expose SFTP port
EXPOSE 2222

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "const net = require('net'); const client = net.createConnection(2222, 'localhost'); client.on('connect', () => { client.end(); process.exit(0); }); client.on('error', () => process.exit(1));"

# Start the server
CMD ["npm", "start"]
