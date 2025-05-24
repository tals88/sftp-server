const fs = require('fs');
const path = require('path');
const { Server } = require('ssh2');
const setupSftpHandlers = require('./sftp-handlers');
const { UserManager } = require('./utils/user-manager');
const { defaultLogger } = require('./utils/logger');
const { validatePath } = require('./utils/path-validator');
const { checkPermission, checkQuota } = require('./utils/permissions');

// Configuration
const CONFIG = {
  port: process.env.SFTP_PORT || 2222,
  host: process.env.SFTP_HOST || '0.0.0.0',
  storageDir: path.join(__dirname, 'storage'),
  hostKeyPath: path.join(__dirname, 'keys', 'host.key'),
  maxConnections: 10,
  debug: process.env.NODE_ENV !== 'production'
};

/**
 * Simple, secure SFTP server without complex file type detection
 * Features:
 * - User directory isolation
 * - Simple file operations with original filenames
 * - Good security and permission management
 * - Lightweight for 1GB RAM deployment
 */
class SimpleSftpServer {
  constructor(config = CONFIG) {
    this.config = config;
    this.logger = defaultLogger;
    this.connections = new Map();
    this.connectionCount = 0;

    // Initialize storage directory
    this.initializeStorage();

    // Initialize user manager
    this.userManager = new UserManager(this.config.storageDir);

    // Create SSH server
    this.createServer();
  }

  /**
   * Initialize storage directory structure
   */
  initializeStorage() {
    if (!fs.existsSync(this.config.storageDir)) {
      fs.mkdirSync(this.config.storageDir, { recursive: true });
      this.logger.info('Created storage directory', { path: this.config.storageDir });
    }
  }

  /**
   * Create SSH server with SFTP support
   */
  createServer() {
    // Check if host key exists
    if (!fs.existsSync(this.config.hostKeyPath)) {
      this.logger.error('Host key not found. Please generate keys first.', {
        path: this.config.hostKeyPath
      });
      process.exit(1);
    }

    this.server = new Server({
      hostKeys: [fs.readFileSync(this.config.hostKeyPath)]
    }, (client) => {
      this.handleClient(client);
    });

    this.server.on('error', (err) => {
      this.logger.error('Server error', { error: err.message });
    });
  }

  /**
   * Handle new client connection
   */
  handleClient(client) {
    const clientId = `client_${++this.connectionCount}`;
    let authenticatedUser = null;

    this.logger.info('Client connected', { clientId });

    // Check connection limit
    if (this.connections.size >= this.config.maxConnections) {
      this.logger.warn('Connection limit reached', {
        clientId,
        current: this.connections.size,
        max: this.config.maxConnections
      });
      client.end();
      return;
    }

    this.connections.set(clientId, {
      client,
      connectedAt: new Date(),
      user: null
    });

    // Handle authentication
    client.on('authentication', (ctx) => {
      this.handleAuthentication(ctx, clientId, (user) => {
        authenticatedUser = user;
      });
    });

    // Handle client ready (after successful authentication)
    client.on('ready', () => {
      this.logger.info('Client authenticated and ready', {
        clientId,
        username: authenticatedUser?.username
      });

      // Update connection info
      const connection = this.connections.get(clientId);
      if (connection) {
        connection.user = authenticatedUser;
      }

      // Handle session requests
      client.on('session', (accept) => {
        const session = accept();

        // Handle SFTP subsystem requests
        session.on('sftp', (accept) => {
          this.logger.info('SFTP subsystem requested', {
            clientId,
            username: authenticatedUser?.username
          });

          const sftpStream = accept();
          this.setupSftpSession(sftpStream, authenticatedUser, clientId);
        });
      });
    });

    // Handle client disconnection
    client.on('close', () => {
      this.logger.info('Client disconnected', {
        clientId,
        username: authenticatedUser?.username
      });
      this.connections.delete(clientId);
    });

    // Handle client errors
    client.on('error', (err) => {
      this.logger.error('Client error', {
        clientId,
        username: authenticatedUser?.username,
        error: err.message
      });
    });
  }

  /**
   * Handle user authentication
   */
  handleAuthentication(ctx, clientId, onSuccess) {
    const { username, method, password } = ctx;

    this.logger.debug('Authentication attempt', {
      clientId,
      username,
      method
    });

    // Only allow password authentication
    if (method !== 'password') {
      this.logger.warn('Unsupported authentication method', {
        clientId,
        username,
        method
      });
      return ctx.reject(['password']);
    }

    // Authenticate user
    const user = this.userManager.authenticateUser(username, password);
    if (!user) {
      this.logger.warn('Authentication failed', {
        clientId,
        username
      });
      return ctx.reject();
    }

    this.logger.info('Authentication successful', {
      clientId,
      username,
      role: user.role
    });

    onSuccess(user);
    ctx.accept();
  }

  /**
   * Setup SFTP session with handlers
   */
  setupSftpSession(sftpStream, authenticatedUser, clientId) {
    const openFiles = new Map();
    let handleCount = 0;

    // Create handle generator
    const createHandle = () => {
      const handle = Buffer.alloc(4);
      handle.writeUInt32BE(handleCount++, 0);
      return handle;
    };

    // Create logger function for SFTP handlers
    const log = (level, message, meta = {}) => {
      this.logger.log(level, message, {
        clientId,
        username: authenticatedUser.username,
        ...meta
      });
    };

    // Setup SFTP handlers with our utilities
    setupSftpHandlers(
      sftpStream,
      authenticatedUser,
      openFiles,
      createHandle,
      log,
      validatePath,
      checkPermission,
      checkQuota
    );

    // Handle SFTP session end
    sftpStream.on('end', () => {
      this.logger.info('SFTP session ended', {
        clientId,
        username: authenticatedUser.username
      });

      // Close any remaining open files
      for (const [handleStr, entry] of openFiles.entries()) {
        try {
          if (entry.fd !== null && entry.fd !== undefined) {
            fs.closeSync(entry.fd);
          }
        } catch (err) {
          this.logger.warn('Error closing file on session end', {
            clientId,
            username: authenticatedUser.username,
            handle: handleStr,
            error: err.message
          });
        }
      }
      openFiles.clear();
    });
  }

  /**
   * Start the SFTP server
   */
  start() {
    this.server.listen(this.config.port, this.config.host, () => {
      this.logger.info('SFTP server started', {
        host: this.config.host,
        port: this.config.port,
        storageDir: this.config.storageDir,
        maxConnections: this.config.maxConnections
      });

      // Log available users
      const users = this.userManager.getAllUsers();
      this.logger.info('Available users', {
        count: users.length,
        users: users.map(u => ({ username: u.username, role: u.role }))
      });
    });
  }

  /**
   * Stop the SFTP server
   */
  stop() {
    if (this.server) {
      this.server.close(() => {
        this.logger.info('SFTP server stopped');
      });
    }
  }

  /**
   * Get server statistics
   */
  getStats() {
    return {
      connections: this.connections.size,
      maxConnections: this.config.maxConnections,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      users: this.userManager.getAllUsers().length
    };
  }
}

// Create and start server if this file is run directly
if (require.main === module) {
  const server = new SimpleSftpServer(CONFIG);

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nReceived SIGINT, shutting down gracefully...');
    server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\nReceived SIGTERM, shutting down gracefully...');
    server.stop();
    process.exit(0);
  });

  server.start();
}

module.exports = SimpleSftpServer;
