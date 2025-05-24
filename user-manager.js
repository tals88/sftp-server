const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const config = require('./config');

class UserManager {
  constructor() {
    this.dbPath = config.users.dbPath;
    this.saltRounds = config.users.saltRounds;
    this.storageBaseDir = config.storage.baseDir;
    this.loginAttempts = new Map(); // Track login attempts
    
    this.ensureDataDirectory();
    this.loadUsers();
  }

  ensureDataDirectory() {
    const dataDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    if (!fs.existsSync(this.storageBaseDir)) {
      fs.mkdirSync(this.storageBaseDir, { recursive: true });
    }
  }

  loadUsers() {
    try {
      if (fs.existsSync(this.dbPath)) {
        const data = fs.readFileSync(this.dbPath, 'utf8');
        this.users = JSON.parse(data);
      } else {
        this.users = {};
        this.saveUsers();
      }
    } catch (error) {
      console.error('Error loading users database:', error);
      this.users = {};
    }
  }

  saveUsers() {
    try {
      fs.writeFileSync(this.dbPath, JSON.stringify(this.users, null, 2));
    } catch (error) {
      console.error('Error saving users database:', error);
      throw error;
    }
  }

  async createUser(username, password, options = {}) {
    if (this.users[username]) {
      throw new Error('User already exists');
    }

    if (!username || username.length < 3) {
      throw new Error('Username must be at least 3 characters long');
    }

    if (!password || password.length < 6) {
      throw new Error('Password must be at least 6 characters long');
    }

    // Validate username (alphanumeric and underscore only)
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      throw new Error('Username can only contain letters, numbers, and underscores');
    }

    const hashedPassword = await bcrypt.hash(password, this.saltRounds);
    const userId = uuidv4();
    const userDir = path.join(this.storageBaseDir, username);

    // Create user directory
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }

    this.users[username] = {
      id: userId,
      username,
      passwordHash: hashedPassword,
      directory: userDir,
      createdAt: new Date().toISOString(),
      lastLogin: null,
      isActive: true,
      permissions: {
        read: options.read !== false,
        write: options.write !== false,
        delete: options.delete !== false,
        createDir: options.createDir !== false
      },
      quota: {
        maxSize: options.maxSize || config.storage.maxFileSize,
        currentSize: 0
      }
    };

    this.saveUsers();
    console.log(`User '${username}' created successfully`);
    return this.users[username];
  }

  async authenticateUser(username, password) {
    const user = this.users[username];
    
    if (!user) {
      return { success: false, reason: 'Invalid credentials' };
    }

    if (!user.isActive) {
      return { success: false, reason: 'Account is disabled' };
    }

    // Check for account lockout
    const attempts = this.loginAttempts.get(username);
    if (attempts && attempts.count >= config.security.maxLoginAttempts) {
      const timeSinceLastAttempt = Date.now() - attempts.lastAttempt;
      if (timeSinceLastAttempt < config.security.lockoutDuration) {
        return { success: false, reason: 'Account temporarily locked due to too many failed attempts' };
      } else {
        // Reset attempts after lockout period
        this.loginAttempts.delete(username);
      }
    }

    try {
      const isValid = await bcrypt.compare(password, user.passwordHash);
      
      if (isValid) {
        // Reset login attempts on successful login
        this.loginAttempts.delete(username);
        
        // Update last login
        user.lastLogin = new Date().toISOString();
        this.saveUsers();
        
        return { 
          success: true, 
          user: {
            id: user.id,
            username: user.username,
            directory: user.directory,
            permissions: user.permissions,
            quota: user.quota
          }
        };
      } else {
        // Track failed attempt
        const currentAttempts = this.loginAttempts.get(username) || { count: 0, lastAttempt: 0 };
        currentAttempts.count++;
        currentAttempts.lastAttempt = Date.now();
        this.loginAttempts.set(username, currentAttempts);
        
        return { success: false, reason: 'Invalid credentials' };
      }
    } catch (error) {
      console.error('Authentication error:', error);
      return { success: false, reason: 'Authentication failed' };
    }
  }

  async updateUserPassword(username, newPassword) {
    const user = this.users[username];
    if (!user) {
      throw new Error('User not found');
    }

    if (!newPassword || newPassword.length < 6) {
      throw new Error('Password must be at least 6 characters long');
    }

    const hashedPassword = await bcrypt.hash(newPassword, this.saltRounds);
    user.passwordHash = hashedPassword;
    this.saveUsers();
    
    console.log(`Password updated for user '${username}'`);
  }

  deleteUser(username) {
    const user = this.users[username];
    if (!user) {
      throw new Error('User not found');
    }

    // Remove user directory (optional - you might want to keep data)
    const userDir = user.directory;
    if (fs.existsSync(userDir)) {
      fs.rmSync(userDir, { recursive: true, force: true });
    }

    delete this.users[username];
    this.saveUsers();
    
    console.log(`User '${username}' deleted successfully`);
  }

  setUserActive(username, isActive) {
    const user = this.users[username];
    if (!user) {
      throw new Error('User not found');
    }

    user.isActive = isActive;
    this.saveUsers();
    
    console.log(`User '${username}' ${isActive ? 'activated' : 'deactivated'}`);
  }

  updateUserPermissions(username, permissions) {
    const user = this.users[username];
    if (!user) {
      throw new Error('User not found');
    }

    user.permissions = { ...user.permissions, ...permissions };
    this.saveUsers();
    
    console.log(`Permissions updated for user '${username}'`);
  }

  listUsers() {
    return Object.values(this.users).map(user => ({
      username: user.username,
      isActive: user.isActive,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin,
      permissions: user.permissions,
      quota: user.quota
    }));
  }

  getUser(username) {
    const user = this.users[username];
    if (!user) {
      return null;
    }

    return {
      username: user.username,
      isActive: user.isActive,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin,
      permissions: user.permissions,
      quota: user.quota,
      directory: user.directory
    };
  }

  updateUserQuota(username, currentSize) {
    const user = this.users[username];
    if (user) {
      user.quota.currentSize = currentSize;
      this.saveUsers();
    }
  }

  checkQuota(username, additionalSize = 0) {
    const user = this.users[username];
    if (!user) {
      return false;
    }

    return (user.quota.currentSize + additionalSize) <= user.quota.maxSize;
  }
}

module.exports = UserManager;
