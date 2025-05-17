const { Client } = require('ssh2');

// Configuration
const config = {
  host: 'localhost',
  port: 2222,
  username: 'testuser',
  password: 'password123'
};

// Create a new SSH client
const client = new Client();

// Connect to the server
client.on('ready', () => {
  console.log('Client connected to server');

  // Start SFTP session
  client.sftp((err, sftp) => {
    if (err) {
      console.error('Error starting SFTP session:', err);
      client.end();
      return;
    }

    console.log('SFTP session started');

    // List files in the root directory
    sftp.readdir('/', (err, list) => {
      if (err) {
        console.error('Error listing directory:', err);
        client.end();
        return;
      }

      console.log('Files in root directory:');
      list.forEach(item => {
        console.log(`- ${item.filename}`);
      });

      // Choose a file to delete (test-delete.txt if it exists)
      const fileToDelete = list.find(item => item.filename === 'test-delete.txt') 
                          ? 'test-delete.txt' 
                          : (list.length > 0 ? list[0].filename : null);

      if (!fileToDelete) {
        console.log('No files to delete');
        client.end();
        return;
      }

      console.log(`Deleting file /${fileToDelete}...`);
      sftp.unlink(`/${fileToDelete}`, (err) => {
        if (err) {
          console.error(`Error deleting /${fileToDelete}:`, err);
        } else {
          console.log(`File /${fileToDelete} deleted successfully`);
        }

        // List files again to verify deletion
        sftp.readdir('/', (err, list) => {
          if (err) {
            console.error('Error listing directory:', err);
          } else {
            console.log('Files after deletion:');
            list.forEach(item => {
              console.log(`- ${item.filename}`);
            });
          }
          
          // Close the connection
          client.end();
        });
      });
    });
  });
}).on('error', (err) => {
  console.error('Connection error:', err);
}).connect(config);
