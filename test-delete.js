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

      // Create a test file to delete
      const testFile = '/test-delete.txt';
      const testContent = 'This file will be deleted.';
      
      console.log(`Creating test file ${testFile}...`);
      
      // Create write stream to remote file
      const uploadStream = sftp.createWriteStream(testFile);
      
      // Handle errors
      uploadStream.on('error', (err) => {
        console.error(`Error creating ${testFile}:`, err);
        client.end();
      });
      
      // Handle completion
      uploadStream.on('finish', () => {
        console.log(`File ${testFile} created successfully`);
        
        // List files again to verify creation
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
          
          // Delete the test file
          console.log(`Deleting file ${testFile}...`);
          sftp.unlink(testFile, (err) => {
            if (err) {
              console.error(`Error deleting ${testFile}:`, err);
              client.end();
              return;
            }
            
            console.log(`File ${testFile} deleted successfully`);
            
            // List files again to verify deletion
            sftp.readdir('/', (err, list) => {
              if (err) {
                console.error('Error listing directory:', err);
                client.end();
                return;
              }
              
              console.log('Files after deletion:');
              list.forEach(item => {
                console.log(`- ${item.filename} (${item.attrs.size} bytes)`);
              });
              
              // Create a test directory
              const testDir = '/test-dir';
              console.log(`Creating directory ${testDir}...`);
              
              sftp.mkdir(testDir, (err) => {
                if (err) {
                  console.error(`Error creating directory ${testDir}:`, err);
                  client.end();
                  return;
                }
                
                console.log(`Directory ${testDir} created successfully`);
                
                // List files again to verify directory creation
                sftp.readdir('/', (err, list) => {
                  if (err) {
                    console.error('Error listing directory:', err);
                    client.end();
                    return;
                  }
                  
                  console.log('Files after directory creation:');
                  list.forEach(item => {
                    console.log(`- ${item.filename}`);
                  });
                  
                  // Delete the test directory
                  console.log(`Deleting directory ${testDir}...`);
                  sftp.rmdir(testDir, (err) => {
                    if (err) {
                      console.error(`Error deleting directory ${testDir}:`, err);
                      client.end();
                      return;
                    }
                    
                    console.log(`Directory ${testDir} deleted successfully`);
                    
                    // List files again to verify directory deletion
                    sftp.readdir('/', (err, list) => {
                      if (err) {
                        console.error('Error listing directory:', err);
                        client.end();
                        return;
                      }
                      
                      console.log('Files after directory deletion:');
                      list.forEach(item => {
                        console.log(`- ${item.filename}`);
                      });
                      
                      // Close the connection
                      console.log('Tests completed successfully');
                      client.end();
                    });
                  });
                });
              });
            });
          });
        });
      });
      
      // Write content to the upload stream
      uploadStream.write(testContent);
      uploadStream.end();
    });
  });
}).on('error', (err) => {
  console.error('Connection error:', err);
}).connect(config);
