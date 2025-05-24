const fs = require('fs');
const path = require('path');
const { defaultValidator } = require('./path-validator');
const { DEFAULT_PERMISSIONS } = require('./permissions');
const { SimpleDatabase } = require('./database');

/**
 * User management for SFTP server
 * Handles user authentication, directory creation, and user data
 */
class UserManager {
  constructor(storageDir) {
    this.storageDir = storageDir;
    this.usersDir = path.join(storageDir, 'users');
    this.dbPath = path.join(storageDir, 'users.db.json');

    // Initialize database
    this.db = new SimpleDatabase(this.dbPath);

    // Ensure users directory exists
    defaultValidator.ensureDirectory(this.usersDir);

    // Load users from database
    this.loadUsersFromDatabase();
  }

  /**
   * Load users from database into memory
   */
  loadUsersFromDatabase() {
    this.users = new Map();
    const dbUsers = this.db.getAllUsers();

    for (const user of dbUsers) {
      this.users.set(user.username, user);
      // Ensure user directory exists
      defaultValidator.ensureDirectory(user.directory);
    }
  }

  /**
   * Add a new user
   * @param {string} username - Username
   * @param {string} password - Password
   * @param {string} role - User role (admin, user, readonly)
   * @returns {boolean} - Success status
   */
  addUser(username, password, role = 'user') {
    try {
      // Create user directory
      const userDir = path.join(this.usersDir, username);
      defaultValidator.ensureDirectory(userDir);

      // Get permissions based on role
      const permissions = DEFAULT_PERMISSIONS[role] || DEFAULT_PERMISSIONS.user;

      // Create user object
      const user = {
        username,
        password,
        role,
        directory: userDir,
        permissions: { ...permissions },
        createdAt: new Date().toISOString(),
        lastLogin: null
      };

      // Save to database
      this.db.setUser(username, user);
      this.users.set(username, user);
      return true;
    } catch (err) {
      console.error(`Failed to add user ${username}:`, err.message);
      return false;
    }
  }

  /**
   * Get user by username
   * @param {string} username - Username
   * @returns {object|null} - User object or null if not found
   */
  getUser(username) {
    return this.users.get(username) || null;
  }

  /**
   * Authenticate user with password
   * @param {string} username - Username
   * @param {string} password - Password
   * @returns {object|null} - User object if authenticated, null otherwise
   */
  authenticateUser(username, password) {
    // Use database authentication which handles timing-safe comparison
    const user = this.db.authenticateUser(username, password);
    if (user) {
      // Update in-memory cache
      this.users.set(username, user);
    }
    return user;
  }



  /**
   * Remove a user
   * @param {string} username - Username to remove
   * @returns {boolean} - Success status
   */
  removeUser(username) {
    try {
      if (this.users.has(username)) {
        // Remove from database
        this.db.deleteUser(username);
        // Remove from memory
        this.users.delete(username);
        // Note: We don't delete the user directory to preserve data
        return true;
      }
      return false;
    } catch (err) {
      console.error(`Failed to remove user ${username}:`, err.message);
      return false;
    }
  }

  /**
   * Update user permissions
   * @param {string} username - Username
   * @param {object} newPermissions - New permissions object
   * @returns {boolean} - Success status
   */
  updateUserPermissions(username, newPermissions) {
    const user = this.getUser(username);
    if (!user) {
      return false;
    }

    user.permissions = { ...user.permissions, ...newPermissions };
    // Save to database
    this.db.setUser(username, user);
    // Update in memory
    this.users.set(username, user);
    return true;
  }

  /**
   * Get all users (without passwords)
   * @returns {array} - Array of user objects without passwords
   */
  getAllUsers() {
    return Array.from(this.users.values()).map(user => ({
      username: user.username,
      role: user.role,
      directory: user.directory,
      permissions: user.permissions,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin
    }));
  }

  /**
   * Get user statistics
   * @param {string} username - Username
   * @returns {object} - User statistics
   */
  getUserStats(username) {
    const user = this.getUser(username);
    if (!user) {
      return null;
    }

    try {
      // Calculate directory size (simple implementation)
      const dirSize = this.calculateDirectorySize(user.directory);

      return {
        username: user.username,
        role: user.role,
        directorySize: dirSize,
        lastLogin: user.lastLogin,
        createdAt: user.createdAt
      };
    } catch (err) {
      return {
        username: user.username,
        role: user.role,
        directorySize: 0,
        lastLogin: user.lastLogin,
        createdAt: user.createdAt,
        error: err.message
      };
    }
  }

  /**
   * Calculate directory size recursively
   * @param {string} dirPath - Directory path
   * @returns {number} - Size in bytes
   */
  calculateDirectorySize(dirPath) {
    let totalSize = 0;

    try {
      const items = fs.readdirSync(dirPath);

      for (const item of items) {
        const itemPath = path.join(dirPath, item);
        const stats = fs.statSync(itemPath);

        if (stats.isDirectory()) {
          totalSize += this.calculateDirectorySize(itemPath);
        } else {
          totalSize += stats.size;
        }
      }
    } catch (err) {
      // Directory might not exist or be accessible
    }

    return totalSize;
  }
}

module.exports = {
  UserManager
};
