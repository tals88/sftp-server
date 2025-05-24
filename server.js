const fs = require('fs');
const path = require('path');
const { Server } = require('ssh2');
const config = require('./config');
const UserManager = require('./user-manager');
const { setupSftpHandlers } = require('./sftp-handlers');

// Define SFTP constants
const OPEN_MODE = {
  READ: 0x00000001,
  WRITE: 0x00000002,
  APPEND: 0x00000004,
  CREATE: 0x00000008,
  TRUNCATE: 0x00000010,
  EXCL: 0x00000020
};

const STATUS_CODE = {
  OK: 0,
  EOF: 1,
  NO_SUCH_FILE: 2,
  PERMISSION_DENIED: 3,
  FAILURE: 4,
  BAD_MESSAGE: 5,
  NO_CONNECTION: 6,
  CONNECTION_LOST: 7,
  OP_UNSUPPORTED: 8
};

// Initialize user manager
const userManager = new UserManager();

// Logging helper
function log(level, message, meta = {}) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    message,
    ...meta
  };

  if (config.logging.file) {
    // TODO: Implement file logging
    console.log(JSON.stringify(logEntry));
  } else {
    console.log(`[${timestamp}] ${level.toUpperCase()}: ${message}`, meta.username ? `(user: ${meta.username})` : '');
  }
}

// Utility functions
function validatePath(userDir, requestedPath) {
  const normalizedPath = requestedPath.startsWith('/') ? requestedPath.substring(1) : requestedPath;
  const fullPath = path.join(userDir, normalizedPath.replace(/\//g, path.sep));
  const relativePath = path.relative(userDir, fullPath);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return { valid: false, error: 'Path outside user directory' };
  }

  return { valid: true, fullPath, relativePath };
}

function checkPermission(user, operation) {
  return user.permissions[operation] === true;
}

function checkQuota(username, additionalSize = 0) {
  return userManager.checkQuota(username, additionalSize);
}

// Create SSH server
const server = new Server({
  hostKeys: [fs.readFileSync(config.server.hostKeyPath)]
}, (client) => {
  log('info', 'Client connected', { clientIP: client._sock.remoteAddress });

  let authenticatedUser = null;

  // Handle authentication
  client.on('authentication', async (ctx) => {
    const username = ctx.username;

    log('info', 'Authentication attempt', { username, method: ctx.method });

    // Only allow password authentication
    if (ctx.method !== 'password') {
      log('warn', 'Unsupported authentication method', { username, method: ctx.method });
      return ctx.reject(['password']);
    }

    try {
      const authResult = await userManager.authenticateUser(username, ctx.password);

      if (authResult.success) {
        authenticatedUser = authResult.user;
        log('info', 'Authentication successful', { username });
        ctx.accept();
      } else {
        log('warn', 'Authentication failed', { username, reason: authResult.reason });
        ctx.reject();
      }
    } catch (error) {
      log('error', 'Authentication error', { username, error: error.message });
      ctx.reject();
    }
  });

  // Handle client ready event
  client.on('ready', () => {
    log('info', 'Client authenticated and ready', { username: authenticatedUser.username });

    // Handle session requests
    client.on('session', (accept) => {
      const session = accept();

      // Handle SFTP subsystem requests
      session.on('sftp', (accept) => {
        log('info', 'SFTP subsystem requested', { username: authenticatedUser.username });
        const sftpStream = accept();

        // Track open files
        const openFiles = new Map();
        let handleCount = 0;

        // Helper function to create file handle
        function createHandle() {
          const handle = Buffer.alloc(4);
          handle.writeUInt32BE(handleCount++, 0);
          return handle;
        }

        // Setup SFTP handlers
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
          log('info', 'SFTP session ended', { username: authenticatedUser.username });

          // Close any open files
          for (const [handle, entry] of openFiles.entries()) {
            if (entry && entry.fd !== undefined && entry.fd !== null) {
              try {
                fs.closeSync(entry.fd);
              } catch (err) {
                log('error', 'Error closing file on session end', { username: authenticatedUser.username, handle, error: err.message });
              }
            }
          }
          openFiles.clear();
        });

        // Handle SFTP stream errors
        sftpStream.on('error', (err) => {
          log('error', 'SFTP stream error', { username: authenticatedUser.username, error: err.message });

          // Close any open files on error
          for (const [handle, entry] of openFiles.entries()) {
            if (entry && entry.fd !== undefined && entry.fd !== null) {
              try {
                fs.closeSync(entry.fd);
              } catch (closeErr) {
                log('error', 'Error closing file on stream error', { username: authenticatedUser.username, handle, error: closeErr.message });
              }
            }
          }
          openFiles.clear();
        });
      });
    });
  });

  // Handle client disconnection
  client.on('close', () => {
    log('info', 'Client disconnected', { username: authenticatedUser ? authenticatedUser.username : 'unknown' });
  });

  // Handle errors
  client.on('error', (err) => {
    log('error', 'Client error', { username: authenticatedUser ? authenticatedUser.username : 'unknown', error: err.message });
  });
});

// Start the server
server.listen(config.server.port, config.server.host, () => {
  log('info', `SFTP server listening on ${config.server.host}:${config.server.port}`);
  log('info', `Storage base directory: ${config.storage.baseDir}`);
  log('info', `Environment: ${config.env}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  log('info', 'Received SIGINT, shutting down gracefully');
  server.close(() => {
    log('info', 'Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  log('info', 'Received SIGTERM, shutting down gracefully');
  server.close(() => {
    log('info', 'Server closed');
    process.exit(0);
  });
});
