const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

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
      if (list && list.length > 0) {
        list.forEach(item => {
          console.log(`- ${item.filename} (${item.attrs.size} bytes)`);
        });
      } else {
        console.log('No files found');
      }

      // Read test.txt file
      const remoteFile = '/test.txt';
      const localFile = path.join(__dirname, 'downloaded-test.txt');

      console.log(`Downloading ${remoteFile} to ${localFile}...`);

      // Create read stream from remote file
      const readStream = sftp.createReadStream(remoteFile);

      // Create write stream to local file
      const writeStream = fs.createWriteStream(localFile);

      // Handle errors
      readStream.on('error', (err) => {
        console.error(`Error reading ${remoteFile}:`, err);
        client.end();
      });

      writeStream.on('error', (err) => {
        console.error(`Error writing to ${localFile}:`, err);
        client.end();
      });

      // Handle completion
      writeStream.on('finish', () => {
        console.log(`File downloaded successfully to ${localFile}`);

        // Upload a new file
        const newFile = 'uploaded.txt';
        const newContent = 'This is a file uploaded from the SFTP client.';

        console.log(`Uploading ${newFile}...`);

        // Create write stream to remote file
        const uploadStream = sftp.createWriteStream(`/${newFile}`);

        // Handle errors
        uploadStream.on('error', (err) => {
          console.error(`Error uploading ${newFile}:`, err);
          client.end();
        });

        // Handle completion
        uploadStream.on('finish', () => {
          console.log(`File ${newFile} uploaded successfully`);

          // List files again to verify upload
          sftp.readdir('/', (err, list) => {
            if (err) {
              console.error('Error listing directory:', err);
              client.end();
              return;
            }

            console.log('Updated files in root directory:');
            list.forEach(item => {
              console.log(`- ${item.filename} (${item.attrs.size} bytes)`);
            });

            // Close the connection
            console.log('Tests completed successfully');
            client.end();
          });
        });

        // Write content to the upload stream
        uploadStream.write(newContent);
        uploadStream.end();
      });

      // Pipe the data from remote to local
      readStream.pipe(writeStream);
    });
  });
}).on('error', (err) => {
  console.error('Connection error:', err);
}).connect(config);
