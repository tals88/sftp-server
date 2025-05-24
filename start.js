#!/usr/bin/env node

/**
 * Simple startup script for the SFTP server
 * Optimized for lightweight deployment on 1GB RAM AWS instances
 */

const SimpleSftpServer = require('./sftp-server');
const { defaultLogger } = require('./utils/logger');

// Configuration from environment variables
const path = require('path');

const config = {
  port: parseInt(process.env.SFTP_PORT) || 2222,
  host: process.env.SFTP_HOST || '0.0.0.0',
  storageDir: path.join(__dirname, 'storage'),
  hostKeyPath: path.join(__dirname, 'keys', 'host.key'),
  debug: process.env.NODE_ENV !== 'production'
};

// Display startup banner
console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    Simple SFTP Server                       ║
║                                                              ║
║  • No complex file type detection                           ║
║  • User directory isolation                                 ║
║  • Lightweight for 1GB RAM deployment                      ║
║  • Secure file operations with original filenames          ║
╚══════════════════════════════════════════════════════════════╝
`);

// Create server instance
const server = new SimpleSftpServer(config);

// Handle graceful shutdown
const gracefulShutdown = (signal) => {
  defaultLogger.info(`Received ${signal}, shutting down gracefully...`);

  server.stop();

  setTimeout(() => {
    defaultLogger.info('Server shutdown complete');
    process.exit(0);
  }, 1000);
};

// Register signal handlers
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  defaultLogger.error('Uncaught exception', { error: err.message, stack: err.stack });
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  defaultLogger.error('Unhandled rejection', { reason, promise });
  gracefulShutdown('UNHANDLED_REJECTION');
});

// Start the server
try {
  server.start();
} catch (err) {
  defaultLogger.error('Failed to start server', { error: err.message });
  process.exit(1);
}
