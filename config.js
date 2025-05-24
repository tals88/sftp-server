require('dotenv').config();
const path = require('path');

const config = {
  // Server configuration
  server: {
    port: parseInt(process.env.SFTP_PORT) || 2222,
    host: process.env.SFTP_HOST || '0.0.0.0',
    hostKeyPath: process.env.HOST_KEY_PATH || path.join(__dirname, 'keys', 'host.key')
  },

  // Storage configuration
  storage: {
    baseDir: process.env.STORAGE_BASE_DIR || path.join(__dirname, 'storage'),
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 100 * 1024 * 1024, // 100MB default
    allowedExtensions: process.env.ALLOWED_EXTENSIONS ? process.env.ALLOWED_EXTENSIONS.split(',') : null // null = all allowed
  },

  // User database configuration
  users: {
    dbPath: process.env.USERS_DB_PATH || path.join(__dirname, 'data', 'users.json'),
    saltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12
  },

  // Security configuration
  security: {
    maxLoginAttempts: parseInt(process.env.MAX_LOGIN_ATTEMPTS) || 5,
    lockoutDuration: parseInt(process.env.LOCKOUT_DURATION) || 15 * 60 * 1000, // 15 minutes
    sessionTimeout: parseInt(process.env.SESSION_TIMEOUT) || 30 * 60 * 1000 // 30 minutes
  },

  // Admin configuration
  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'admin123' // Should be changed in production
  },

  // Environment
  env: process.env.NODE_ENV || 'development',
  
  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || null // null = console only
  }
};

// Validation
function validateConfig() {
  const errors = [];

  if (!config.server.port || config.server.port < 1 || config.server.port > 65535) {
    errors.push('Invalid server port');
  }

  if (config.env === 'production' && config.admin.password === 'admin123') {
    errors.push('Admin password must be changed in production');
  }

  if (errors.length > 0) {
    throw new Error('Configuration validation failed: ' + errors.join(', '));
  }
}

// Initialize configuration
try {
  validateConfig();
} catch (error) {
  console.error('Configuration error:', error.message);
  process.exit(1);
}

module.exports = config;
