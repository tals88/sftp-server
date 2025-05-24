const path = require('path');
const fs = require('fs');

/**
 * Validates and resolves file paths to ensure they stay within user directories
 * Prevents directory traversal attacks and unauthorized access
 */
class PathValidator {
  constructor() {
    // Dangerous path patterns to block
    this.dangerousPatterns = [
      /\.\./,           // Parent directory traversal
      /\/\//,           // Double slashes
      /\0/,             // Null bytes
      /[<>:"|?*]/,      // Windows invalid characters
      /^\/etc\//,       // System directories
      /^\/proc\//,
      /^\/sys\//,
      /^\/dev\//,
      /^\/root\//,
      /^\/home\/(?!.*\/storage\/)/  // Home directories except storage
    ];
  }

  /**
   * Validates and resolves a path within a user's directory
   * @param {string} userDirectory - The user's base directory
   * @param {string} requestedPath - The path requested by the user
   * @returns {object} - { valid: boolean, fullPath: string, relativePath: string, error?: string }
   */
  validatePath(userDirectory, requestedPath) {
    try {
      // Normalize the requested path
      let normalizedPath = requestedPath || '';
      
      // Remove leading slash if present
      if (normalizedPath.startsWith('/')) {
        normalizedPath = normalizedPath.substring(1);
      }

      // Check for dangerous patterns
      for (const pattern of this.dangerousPatterns) {
        if (pattern.test(normalizedPath) || pattern.test(requestedPath)) {
          return {
            valid: false,
            error: 'Path contains dangerous patterns'
          };
        }
      }

      // Convert forward slashes to system path separators
      normalizedPath = normalizedPath.replace(/\//g, path.sep);

      // Resolve the full path
      const fullPath = path.resolve(userDirectory, normalizedPath);

      // Ensure the resolved path is within the user directory
      const relativePath = path.relative(userDirectory, fullPath);
      
      // Check if path escapes user directory
      if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        return {
          valid: false,
          error: 'Path is outside user directory'
        };
      }

      return {
        valid: true,
        fullPath,
        relativePath: relativePath || '',
        normalizedPath
      };

    } catch (err) {
      return {
        valid: false,
        error: `Path validation error: ${err.message}`
      };
    }
  }

  /**
   * Checks if a path exists and returns its type
   * @param {string} fullPath - The full path to check
   * @returns {object} - { exists: boolean, isFile: boolean, isDirectory: boolean, error?: string }
   */
  checkPath(fullPath) {
    try {
      if (!fs.existsSync(fullPath)) {
        return { exists: false };
      }

      const stats = fs.statSync(fullPath);
      return {
        exists: true,
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
        size: stats.size,
        mtime: stats.mtime
      };
    } catch (err) {
      return {
        exists: false,
        error: `Path check error: ${err.message}`
      };
    }
  }

  /**
   * Ensures a directory exists, creating it if necessary
   * @param {string} dirPath - The directory path to ensure
   * @returns {boolean} - Success status
   */
  ensureDirectory(dirPath) {
    try {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
      return true;
    } catch (err) {
      return false;
    }
  }
}

// Create default instance
const defaultValidator = new PathValidator();

module.exports = {
  PathValidator,
  defaultValidator,
  validatePath: (userDir, reqPath) => defaultValidator.validatePath(userDir, reqPath)
};
