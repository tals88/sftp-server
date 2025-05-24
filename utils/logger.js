const fs = require('fs');
const path = require('path');

// Log levels
const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

class Logger {
  constructor(options = {}) {
    this.level = options.level || LOG_LEVELS.INFO;
    this.logToFile = options.logToFile || false;
    this.logFile = options.logFile || path.join(__dirname, '..', 'logs', 'sftp-server.log');
    this.logToConsole = options.logToConsole !== false; // Default true
    
    // Create logs directory if logging to file
    if (this.logToFile) {
      const logDir = path.dirname(this.logFile);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
    }
  }

  formatMessage(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] ${level.toUpperCase()}: ${message}${metaStr}`;
  }

  writeLog(level, message, meta = {}) {
    const logLevel = LOG_LEVELS[level.toUpperCase()];
    if (logLevel > this.level) return;

    const formattedMessage = this.formatMessage(level, message, meta);

    if (this.logToConsole) {
      console.log(formattedMessage);
    }

    if (this.logToFile) {
      try {
        fs.appendFileSync(this.logFile, formattedMessage + '\n');
      } catch (err) {
        console.error('Failed to write to log file:', err.message);
      }
    }
  }

  error(message, meta = {}) {
    this.writeLog('ERROR', message, meta);
  }

  warn(message, meta = {}) {
    this.writeLog('WARN', message, meta);
  }

  info(message, meta = {}) {
    this.writeLog('INFO', message, meta);
  }

  debug(message, meta = {}) {
    this.writeLog('DEBUG', message, meta);
  }

  // Convenience method for SFTP operations
  log(level, message, meta = {}) {
    this.writeLog(level, message, meta);
  }
}

// Create default logger instance
const defaultLogger = new Logger({
  level: LOG_LEVELS.INFO,
  logToConsole: true,
  logToFile: false
});

module.exports = {
  Logger,
  LOG_LEVELS,
  defaultLogger
};
