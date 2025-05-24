/**
 * Permission management for SFTP users
 * Handles user permissions and access control
 */

// Default permissions for different user roles
const DEFAULT_PERMISSIONS = {
  admin: {
    read: true,
    write: true,
    delete: true,
    createDir: true,
    rename: true,
    quota: -1 // Unlimited
  },
  user: {
    read: true,
    write: true,
    delete: true,
    createDir: true,
    rename: true,
    quota: 100 * 1024 * 1024 // 100MB default
  },
  readonly: {
    read: true,
    write: false,
    delete: false,
    createDir: false,
    rename: false,
    quota: 0
  }
};

class PermissionManager {
  constructor() {
    this.userQuotas = new Map(); // Track current usage
  }

  /**
   * Check if user has specific permission
   * @param {object} user - User object with permissions
   * @param {string} action - Action to check (read, write, delete, createDir, rename)
   * @returns {boolean} - Whether user has permission
   */
  checkPermission(user, action) {
    if (!user || !user.permissions) {
      return false;
    }

    return user.permissions[action] === true;
  }

  /**
   * Check if user can write data within quota limits
   * @param {string} username - Username
   * @param {number} dataSize - Size of data to write in bytes
   * @returns {boolean} - Whether write is allowed
   */
  checkQuota(username, dataSize = 0) {
    // For now, always allow writes (quota checking can be enhanced later)
    return true;
  }

  /**
   * Get user permissions based on role
   * @param {string} role - User role (admin, user, readonly)
   * @returns {object} - Permission object
   */
  getPermissionsByRole(role) {
    return DEFAULT_PERMISSIONS[role] || DEFAULT_PERMISSIONS.user;
  }

  /**
   * Update user quota usage
   * @param {string} username - Username
   * @param {number} deltaSize - Change in storage usage (can be negative)
   */
  updateQuotaUsage(username, deltaSize) {
    const currentUsage = this.userQuotas.get(username) || 0;
    this.userQuotas.set(username, Math.max(0, currentUsage + deltaSize));
  }

  /**
   * Get current quota usage for user
   * @param {string} username - Username
   * @returns {number} - Current usage in bytes
   */
  getQuotaUsage(username) {
    return this.userQuotas.get(username) || 0;
  }

  /**
   * Check if path is allowed for user operations
   * @param {object} user - User object
   * @param {string} path - Path to check
   * @returns {boolean} - Whether path access is allowed
   */
  checkPathAccess(user, path) {
    // Basic implementation - can be enhanced with more complex rules
    if (!user || !path) {
      return false;
    }

    // Users can only access their own directory
    return path.startsWith(user.directory);
  }

  /**
   * Validate user permissions object
   * @param {object} permissions - Permissions to validate
   * @returns {object} - Validated permissions with defaults
   */
  validatePermissions(permissions = {}) {
    const validated = {
      read: permissions.read === true,
      write: permissions.write === true,
      delete: permissions.delete === true,
      createDir: permissions.createDir === true,
      rename: permissions.rename === true,
      quota: typeof permissions.quota === 'number' ? permissions.quota : DEFAULT_PERMISSIONS.user.quota
    };

    return validated;
  }
}

// Create default instance
const defaultPermissionManager = new PermissionManager();

module.exports = {
  PermissionManager,
  DEFAULT_PERMISSIONS,
  defaultPermissionManager,
  checkPermission: (user, action) => defaultPermissionManager.checkPermission(user, action),
  checkQuota: (username, dataSize) => defaultPermissionManager.checkQuota(username, dataSize)
};
