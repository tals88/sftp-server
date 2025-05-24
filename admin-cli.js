#!/usr/bin/env node

const { Command } = require('commander');
const chalk = require('chalk');
const UserManager = require('./user-manager');
const config = require('./config');

const program = new Command();
const userManager = new UserManager();

// Helper function to display user info
function displayUser(user) {
  console.log(chalk.cyan(`Username: ${user.username}`));
  console.log(`  Active: ${user.isActive ? chalk.green('Yes') : chalk.red('No')}`);
  console.log(`  Created: ${user.createdAt}`);
  console.log(`  Last Login: ${user.lastLogin || 'Never'}`);
  console.log(`  Permissions:`);
  console.log(`    Read: ${user.permissions.read ? chalk.green('Yes') : chalk.red('No')}`);
  console.log(`    Write: ${user.permissions.write ? chalk.green('Yes') : chalk.red('No')}`);
  console.log(`    Delete: ${user.permissions.delete ? chalk.green('Yes') : chalk.red('No')}`);
  console.log(`    Create Dir: ${user.permissions.createDir ? chalk.green('Yes') : chalk.red('No')}`);
  console.log(`  Quota: ${(user.quota.currentSize / 1024 / 1024).toFixed(2)}MB / ${(user.quota.maxSize / 1024 / 1024).toFixed(2)}MB`);
  console.log(`  Directory: ${user.directory || 'N/A'}`);
  console.log('');
}

// Helper function to prompt for password (simple version)
function promptPassword(prompt) {
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(prompt, (password) => {
      rl.close();
      resolve(password);
    });
  });
}

program
  .name('sftp-admin')
  .description('SFTP Server Administration CLI')
  .version('2.0.0');

// Create user command
program
  .command('create-user')
  .description('Create a new user')
  .argument('<username>', 'Username for the new user')
  .option('-p, --password <password>', 'Password for the user')
  .option('--no-read', 'Disable read permission')
  .option('--no-write', 'Disable write permission')
  .option('--no-delete', 'Disable delete permission')
  .option('--no-create-dir', 'Disable create directory permission')
  .option('--max-size <size>', 'Maximum storage size in MB', '100')
  .action(async (username, options) => {
    try {
      let password = options.password;
      if (!password) {
        password = await promptPassword(`Enter password for user '${username}': `);
      }

      const maxSize = parseInt(options.maxSize) * 1024 * 1024; // Convert MB to bytes

      const userOptions = {
        read: options.read,
        write: options.write,
        delete: options.delete,
        createDir: options.createDir,
        maxSize: maxSize
      };

      await userManager.createUser(username, password, userOptions);
      console.log(chalk.green(`✓ User '${username}' created successfully`));
    } catch (error) {
      console.error(chalk.red(`✗ Error creating user: ${error.message}`));
      process.exit(1);
    }
  });

// List users command
program
  .command('list-users')
  .description('List all users')
  .action(() => {
    try {
      const users = userManager.listUsers();
      
      if (users.length === 0) {
        console.log(chalk.yellow('No users found'));
        return;
      }

      console.log(chalk.bold(`\nFound ${users.length} user(s):\n`));
      users.forEach(displayUser);
    } catch (error) {
      console.error(chalk.red(`✗ Error listing users: ${error.message}`));
      process.exit(1);
    }
  });

// Show user command
program
  .command('show-user')
  .description('Show detailed information about a user')
  .argument('<username>', 'Username to show')
  .action((username) => {
    try {
      const user = userManager.getUser(username);
      
      if (!user) {
        console.error(chalk.red(`✗ User '${username}' not found`));
        process.exit(1);
      }

      console.log(chalk.bold(`\nUser Information:\n`));
      displayUser(user);
    } catch (error) {
      console.error(chalk.red(`✗ Error showing user: ${error.message}`));
      process.exit(1);
    }
  });

// Delete user command
program
  .command('delete-user')
  .description('Delete a user')
  .argument('<username>', 'Username to delete')
  .option('-f, --force', 'Force deletion without confirmation')
  .action(async (username, options) => {
    try {
      const user = userManager.getUser(username);
      
      if (!user) {
        console.error(chalk.red(`✗ User '${username}' not found`));
        process.exit(1);
      }

      if (!options.force) {
        const confirmation = await promptPassword(`Are you sure you want to delete user '${username}'? This will also delete their files. Type 'yes' to confirm: `);
        if (confirmation.toLowerCase() !== 'yes') {
          console.log(chalk.yellow('Operation cancelled'));
          return;
        }
      }

      userManager.deleteUser(username);
      console.log(chalk.green(`✓ User '${username}' deleted successfully`));
    } catch (error) {
      console.error(chalk.red(`✗ Error deleting user: ${error.message}`));
      process.exit(1);
    }
  });

// Update password command
program
  .command('update-password')
  .description('Update user password')
  .argument('<username>', 'Username to update')
  .option('-p, --password <password>', 'New password')
  .action(async (username, options) => {
    try {
      const user = userManager.getUser(username);
      
      if (!user) {
        console.error(chalk.red(`✗ User '${username}' not found`));
        process.exit(1);
      }

      let password = options.password;
      if (!password) {
        password = await promptPassword(`Enter new password for user '${username}': `);
      }

      await userManager.updateUserPassword(username, password);
      console.log(chalk.green(`✓ Password updated for user '${username}'`));
    } catch (error) {
      console.error(chalk.red(`✗ Error updating password: ${error.message}`));
      process.exit(1);
    }
  });

// Enable/disable user command
program
  .command('set-active')
  .description('Enable or disable a user')
  .argument('<username>', 'Username to modify')
  .argument('<status>', 'Status: true or false')
  .action((username, status) => {
    try {
      const user = userManager.getUser(username);
      
      if (!user) {
        console.error(chalk.red(`✗ User '${username}' not found`));
        process.exit(1);
      }

      const isActive = status.toLowerCase() === 'true';
      userManager.setUserActive(username, isActive);
      console.log(chalk.green(`✓ User '${username}' ${isActive ? 'enabled' : 'disabled'}`));
    } catch (error) {
      console.error(chalk.red(`✗ Error updating user status: ${error.message}`));
      process.exit(1);
    }
  });

// Update permissions command
program
  .command('update-permissions')
  .description('Update user permissions')
  .argument('<username>', 'Username to update')
  .option('--read <value>', 'Read permission: true or false')
  .option('--write <value>', 'Write permission: true or false')
  .option('--delete <value>', 'Delete permission: true or false')
  .option('--create-dir <value>', 'Create directory permission: true or false')
  .action((username, options) => {
    try {
      const user = userManager.getUser(username);
      
      if (!user) {
        console.error(chalk.red(`✗ User '${username}' not found`));
        process.exit(1);
      }

      const permissions = {};
      if (options.read !== undefined) permissions.read = options.read.toLowerCase() === 'true';
      if (options.write !== undefined) permissions.write = options.write.toLowerCase() === 'true';
      if (options.delete !== undefined) permissions.delete = options.delete.toLowerCase() === 'true';
      if (options.createDir !== undefined) permissions.createDir = options.createDir.toLowerCase() === 'true';

      if (Object.keys(permissions).length === 0) {
        console.error(chalk.red('✗ No permissions specified'));
        process.exit(1);
      }

      userManager.updateUserPermissions(username, permissions);
      console.log(chalk.green(`✓ Permissions updated for user '${username}'`));
    } catch (error) {
      console.error(chalk.red(`✗ Error updating permissions: ${error.message}`));
      process.exit(1);
    }
  });

// Server status command
program
  .command('status')
  .description('Show server configuration and status')
  .action(() => {
    console.log(chalk.bold('\nSFTP Server Configuration:\n'));
    console.log(`Host: ${config.server.host}`);
    console.log(`Port: ${config.server.port}`);
    console.log(`Storage Directory: ${config.storage.baseDir}`);
    console.log(`Max File Size: ${(config.storage.maxFileSize / 1024 / 1024).toFixed(2)}MB`);
    console.log(`Environment: ${config.env}`);
    console.log(`Log Level: ${config.logging.level}`);
    
    const users = userManager.listUsers();
    console.log(`\nTotal Users: ${users.length}`);
    console.log(`Active Users: ${users.filter(u => u.isActive).length}`);
    console.log('');
  });

// Parse command line arguments
program.parse();

// If no command provided, show help
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
