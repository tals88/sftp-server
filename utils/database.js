const fs = require('fs');
const path = require('path');
const { timingSafeEqual } = require('crypto');

/**
 * Simple JSON-based database for user management
 * Lightweight solution for 1GB RAM deployment
 */
class SimpleDatabase {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.data = {
      users: {},
      metadata: {
        version: '1.0.0',
        created: new Date().toISOString(),
        lastModified: new Date().toISOString()
      }
    };
    
    this.load();
  }

  /**
   * Load database from file
   */
  load() {
    try {
      if (fs.existsSync(this.dbPath)) {
        const rawData = fs.readFileSync(this.dbPath, 'utf8');
        this.data = JSON.parse(rawData);
      } else {
        // Create database file with initial structure
        this.save();
      }
    } catch (err) {
      console.error('Error loading database:', err.message);
      // Use default empty structure
    }
  }

  /**
   * Save database to file
   */
  save() {
    try {
      // Update last modified timestamp
      this.data.metadata.lastModified = new Date().toISOString();
      
      // Ensure directory exists
      const dbDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }
      
      // Write to file with pretty formatting
      fs.writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2), 'utf8');
      return true;
    } catch (err) {
      console.error('Error saving database:', err.message);
      return false;
    }
  }

  /**
   * Add or update a user
   */
  setUser(username, userData) {
    this.data.users[username] = {
      ...userData,
      updatedAt: new Date().toISOString()
    };
    return this.save();
  }

  /**
   * Get a user by username
   */
  getUser(username) {
    return this.data.users[username] || null;
  }

  /**
   * Get all users
   */
  getAllUsers() {
    return Object.keys(this.data.users).map(username => ({
      username,
      ...this.data.users[username]
    }));
  }

  /**
   * Delete a user
   */
  deleteUser(username) {
    if (this.data.users[username]) {
      delete this.data.users[username];
      return this.save();
    }
    return false;
  }

  /**
   * Check if user exists
   */
  userExists(username) {
    return this.data.users.hasOwnProperty(username);
  }

  /**
   * Authenticate user
   */
  authenticateUser(username, password) {
    const user = this.getUser(username);
    if (!user) {
      return null;
    }

    // Use timing-safe comparison
    if (!this.checkPassword(password, user.password)) {
      return null;
    }

    // Update last login
    user.lastLogin = new Date().toISOString();
    this.setUser(username, user);

    return user;
  }

  /**
   * Secure password comparison
   */
  checkPassword(input, stored) {
    const autoReject = (input.length !== stored.length);
    if (autoReject) {
      stored = input;
    }
    const isMatch = timingSafeEqual(Buffer.from(input), Buffer.from(stored));
    return (!autoReject && isMatch);
  }

  /**
   * Get database statistics
   */
  getStats() {
    return {
      totalUsers: Object.keys(this.data.users).length,
      metadata: this.data.metadata,
      dbSize: this.getFileSize()
    };
  }

  /**
   * Get database file size
   */
  getFileSize() {
    try {
      if (fs.existsSync(this.dbPath)) {
        const stats = fs.statSync(this.dbPath);
        return stats.size;
      }
    } catch (err) {
      // Ignore errors
    }
    return 0;
  }

  /**
   * Backup database
   */
  backup(backupPath) {
    try {
      if (!backupPath) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        backupPath = this.dbPath + `.backup.${timestamp}`;
      }
      
      fs.copyFileSync(this.dbPath, backupPath);
      return backupPath;
    } catch (err) {
      console.error('Error creating backup:', err.message);
      return null;
    }
  }

  /**
   * Restore from backup
   */
  restore(backupPath) {
    try {
      if (fs.existsSync(backupPath)) {
        fs.copyFileSync(backupPath, this.dbPath);
        this.load();
        return true;
      }
    } catch (err) {
      console.error('Error restoring backup:', err.message);
    }
    return false;
  }
}

module.exports = {
  SimpleDatabase
};
