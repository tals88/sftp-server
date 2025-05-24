#!/usr/bin/env node

/**
 * CLI tool for SFTP server user management
 * Usage: node cli.js <command> [options]
 */

const path = require('path');
const { UserManager } = require('./utils/user-manager');
const { DEFAULT_PERMISSIONS } = require('./utils/permissions');

// Configuration
const STORAGE_DIR = path.join(__dirname, 'storage');

// Initialize user manager
const userManager = new UserManager(STORAGE_DIR);

// CLI Commands
const commands = {
  'list': listUsers,
  'add': addUser,
  'remove': removeUser,
  'update': updateUser,
  'info': getUserInfo,
  'stats': getStats,
  'help': showHelp
};

/**
 * Main CLI entry point
 */
function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    showHelp();
    return;
  }

  const command = args[0].toLowerCase();
  
  if (!commands[command]) {
    console.error(`❌ Unknown command: ${command}`);
    showHelp();
    process.exit(1);
  }

  try {
    commands[command](args.slice(1));
  } catch (err) {
    console.error(`❌ Error executing command: ${err.message}`);
    process.exit(1);
  }
}

/**
 * List all users
 */
function listUsers() {
  const users = userManager.getAllUsers();
  
  if (users.length === 0) {
    console.log('📝 No users found');
    return;
  }

  console.log('\n👥 SFTP Users:');
  console.log('─'.repeat(80));
  console.log('Username'.padEnd(15) + 'Role'.padEnd(10) + 'Created'.padEnd(20) + 'Last Login');
  console.log('─'.repeat(80));
  
  users.forEach(user => {
    const created = new Date(user.createdAt).toLocaleDateString();
    const lastLogin = user.lastLogin ? new Date(user.lastLogin).toLocaleDateString() : 'Never';
    
    console.log(
      user.username.padEnd(15) + 
      user.role.padEnd(10) + 
      created.padEnd(20) + 
      lastLogin
    );
  });
  console.log('─'.repeat(80));
  console.log(`Total: ${users.length} users\n`);
}

/**
 * Add a new user
 */
function addUser(args) {
  if (args.length < 3) {
    console.error('❌ Usage: node cli.js add <username> <password> <role>');
    console.error('   Roles: admin, user, readonly');
    return;
  }

  const [username, password, role] = args;
  
  // Validate role
  if (!['admin', 'user', 'readonly'].includes(role)) {
    console.error('❌ Invalid role. Must be: admin, user, or readonly');
    return;
  }

  // Check if user already exists
  if (userManager.getUser(username)) {
    console.error(`❌ User '${username}' already exists`);
    return;
  }

  // Add user
  const success = userManager.addUser(username, password, role);
  
  if (success) {
    console.log(`✅ User '${username}' created successfully with role '${role}'`);
    console.log(`📁 User directory: storage/users/${username}/`);
  } else {
    console.error(`❌ Failed to create user '${username}'`);
  }
}

/**
 * Remove a user
 */
function removeUser(args) {
  if (args.length < 1) {
    console.error('❌ Usage: node cli.js remove <username>');
    return;
  }

  const username = args[0];
  
  // Check if user exists
  if (!userManager.getUser(username)) {
    console.error(`❌ User '${username}' not found`);
    return;
  }

  // Confirm deletion
  const confirm = args[1];
  if (confirm !== '--confirm') {
    console.log(`⚠️  To confirm deletion of user '${username}', run:`);
    console.log(`   node cli.js remove ${username} --confirm`);
    console.log('   Note: User directory will be preserved');
    return;
  }

  // Remove user
  const success = userManager.removeUser(username);
  
  if (success) {
    console.log(`✅ User '${username}' removed successfully`);
    console.log('📁 User directory preserved for data safety');
  } else {
    console.error(`❌ Failed to remove user '${username}'`);
  }
}

/**
 * Update user permissions
 */
function updateUser(args) {
  if (args.length < 3) {
    console.error('❌ Usage: node cli.js update <username> <permission> <value>');
    console.error('   Permissions: read, write, delete, createDir, rename');
    console.error('   Values: true, false');
    console.error('   Example: node cli.js update john write false');
    return;
  }

  const [username, permission, value] = args;
  
  // Check if user exists
  const user = userManager.getUser(username);
  if (!user) {
    console.error(`❌ User '${username}' not found`);
    return;
  }

  // Validate permission
  const validPermissions = ['read', 'write', 'delete', 'createDir', 'rename'];
  if (!validPermissions.includes(permission)) {
    console.error(`❌ Invalid permission. Must be one of: ${validPermissions.join(', ')}`);
    return;
  }

  // Validate value
  if (!['true', 'false'].includes(value.toLowerCase())) {
    console.error('❌ Value must be true or false');
    return;
  }

  const boolValue = value.toLowerCase() === 'true';
  
  // Update permission
  const success = userManager.updateUserPermissions(username, {
    [permission]: boolValue
  });
  
  if (success) {
    console.log(`✅ Updated ${username}'s ${permission} permission to ${boolValue}`);
  } else {
    console.error(`❌ Failed to update user permissions`);
  }
}

/**
 * Get user information
 */
function getUserInfo(args) {
  if (args.length < 1) {
    console.error('❌ Usage: node cli.js info <username>');
    return;
  }

  const username = args[0];
  const user = userManager.getUser(username);
  
  if (!user) {
    console.error(`❌ User '${username}' not found`);
    return;
  }

  const stats = userManager.getUserStats(username);
  
  console.log(`\n👤 User Information: ${username}`);
  console.log('─'.repeat(50));
  console.log(`Role:           ${user.role}`);
  console.log(`Directory:      ${user.directory}`);
  console.log(`Created:        ${new Date(user.createdAt).toLocaleString()}`);
  console.log(`Last Login:     ${user.lastLogin ? new Date(user.lastLogin).toLocaleString() : 'Never'}`);
  console.log(`Directory Size: ${formatBytes(stats.directorySize)}`);
  
  console.log('\n🔐 Permissions:');
  console.log('─'.repeat(30));
  Object.entries(user.permissions).forEach(([perm, value]) => {
    if (perm !== 'quota') {
      const status = value ? '✅' : '❌';
      console.log(`${perm.padEnd(12)} ${status}`);
    }
  });
  
  if (user.permissions.quota !== undefined) {
    const quota = user.permissions.quota === -1 ? 'Unlimited' : formatBytes(user.permissions.quota);
    console.log(`Quota:       ${quota}`);
  }
  console.log();
}

/**
 * Get server statistics
 */
function getStats() {
  const users = userManager.getAllUsers();
  const totalUsers = users.length;
  const usersByRole = users.reduce((acc, user) => {
    acc[user.role] = (acc[user.role] || 0) + 1;
    return acc;
  }, {});

  console.log('\n📊 SFTP Server Statistics');
  console.log('─'.repeat(40));
  console.log(`Total Users:    ${totalUsers}`);
  console.log(`Admin Users:    ${usersByRole.admin || 0}`);
  console.log(`Regular Users:  ${usersByRole.user || 0}`);
  console.log(`Readonly Users: ${usersByRole.readonly || 0}`);
  console.log();
}

/**
 * Show help information
 */
function showHelp() {
  console.log(`
🚀 SFTP Server User Management CLI

Usage: node cli.js <command> [options]

Commands:
  list                           List all users
  add <user> <pass> <role>      Add new user (roles: admin, user, readonly)
  remove <user> [--confirm]     Remove user (requires confirmation)
  update <user> <perm> <value>  Update user permission (true/false)
  info <user>                   Show detailed user information
  stats                         Show server statistics
  help                          Show this help message

Examples:
  node cli.js list
  node cli.js add john secret123 user
  node cli.js remove john --confirm
  node cli.js update john write false
  node cli.js info john
  node cli.js stats

For more information, visit: https://github.com/tals88/sftp-server
`);
}

/**
 * Format bytes to human readable format
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Run CLI
if (require.main === module) {
  main();
}

module.exports = { main, commands };
