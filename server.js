const fs = require('fs');
const path = require('path');
const { Server } = require('ssh2');
const SftpServer = require('ssh2-sftp-server');
const { timingSafeEqual } = require('crypto');

// Configuration
const PORT = 2222;
const STORAGE_DIR = path.join(__dirname, 'storage');

// Create storage directory if it doesn't exist
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR);
}

// Predefined user credentials
const USERS = {
  'testuser': {
    password: 'password123',
    directory: STORAGE_DIR
  }
};

// Helper function for secure comparison
function checkValue(input, allowed) {
  const autoReject = (input.length !== allowed.length);
  if (autoReject) {
    // Prevent leaking length information by always making a comparison with the
    // same input when lengths don't match what we expect
    allowed = input;
  }
  const isMatch = timingSafeEqual(Buffer.from(input), Buffer.from(allowed));
  return (!autoReject && isMatch);
}

// Create SSH server
const server = new Server({
  hostKeys: [fs.readFileSync(path.join(__dirname, 'keys', 'host.key'))]
}, (client) => {
  console.log('Client connected!');

  // Handle authentication
  client.on('authentication', (ctx) => {
    const username = ctx.username;
    const user = USERS[username];

    // Check if user exists
    if (!user) {
      console.log(`Authentication failed: Unknown user ${username}`);
      return ctx.reject();
    }

    // Only allow password authentication
    if (ctx.method !== 'password') {
      console.log(`Authentication failed: Unsupported method ${ctx.method}`);
      return ctx.reject(['password']);
    }

    // Check password
    if (!checkValue(ctx.password, user.password)) {
      console.log(`Authentication failed: Invalid password for user ${username}`);
      return ctx.reject();
    }

    // Authentication successful
    console.log(`User ${username} authenticated successfully`);
    ctx.accept();
  });

  // Handle client ready event
  client.on('ready', () => {
    console.log('Client authenticated and ready');

    // Handle session requests
    client.on('session', (accept) => {
      const session = accept();

      // Handle SFTP subsystem requests
      session.on('sftp', (accept) => {
        console.log('SFTP subsystem requested');
        const sftpStream = accept();
        
        // Create a new SFTP server instance
        const sftpServer = new SftpServer(sftpStream);
        
        // Log when the SFTP session ends
        sftpStream.on('end', () => {
          console.log('SFTP session ended');
        });
      });
    });
  });

  // Handle client disconnection
  client.on('close', () => {
    console.log('Client disconnected');
  });

  // Handle errors
  client.on('error', (err) => {
    console.error('Client error:', err);
  });
});

// Start the server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`SFTP server listening on port ${PORT}`);
  console.log(`Predefined user: testuser / password123`);
  console.log(`Storage directory: ${STORAGE_DIR}`);
});
