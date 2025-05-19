const fs = require('fs');
const path = require('path');
const { Server } = require('ssh2');
const { timingSafeEqual } = require('crypto');

// Define SFTP constants
const OPEN_MODE = {
  READ: 0x00000001,
  WRITE: 0x00000002,
  APPEND: 0x00000004,
  CREATE: 0x00000008,
  TRUNCATE: 0x00000010,
  EXCL: 0x00000020
};

const STATUS_CODE = {
  OK: 0,
  EOF: 1,
  NO_SUCH_FILE: 2,
  PERMISSION_DENIED: 3,
  FAILURE: 4,
  BAD_MESSAGE: 5,
  NO_CONNECTION: 6,
  CONNECTION_LOST: 7,
  OP_UNSUPPORTED: 8
};

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

  let username = '';
  let userDir = '';

  // Handle authentication
  client.on('authentication', (ctx) => {
    username = ctx.username;
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

    // Set user directory
    userDir = user.directory;

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

        // Track open files and original filenames
        const openFiles = new Map();
        const originalFilenames = new Map(); // Map to track original filenames for uploads
        let handleCount = 0;

        // Handle SFTP requests
        sftpStream.on('OPEN', (reqid, filename, flags, attrs) => {
          console.log(`OPEN request for ${filename} with flags: ${flags}`);

          // Special handling for root directory
          if (filename === '/' || filename === '') {
            if (flags & OPEN_MODE.WRITE) {
              console.log(`Rejecting write request to root directory`);
              return sftpStream.status(reqid, STATUS_CODE.PERMISSION_DENIED);
            }

            // For read-only access to root, we'll handle it as a directory later
            console.log(`Root directory requested for reading`);
          }

          // Normalize the filename (remove leading slash)
          const normalizedFilename = filename.startsWith('/') ? filename.substring(1) : filename;

          // Resolve the full path
          const fullPath = path.join(userDir, normalizedFilename.replace(/\//g, path.sep));
          console.log(`Resolved path: ${fullPath}`);

          try {
            // Check if the path is within the user's directory
            const relativePath = path.relative(userDir, fullPath);
            if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
              console.log(`Access denied: ${filename} is outside user directory`);
              return sftpStream.status(reqid, STATUS_CODE.PERMISSION_DENIED);
            }

            // Check if this is a directory
            if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
              if (flags & OPEN_MODE.WRITE) {
                console.log(`Rejecting write request to directory: ${filename}`);
                return sftpStream.status(reqid, STATUS_CODE.PERMISSION_DENIED);
              }

              // For directories, we'll use a special marker instead of a file descriptor
              const handle = Buffer.alloc(4);
              handle.writeUInt32BE(handleCount++, 0);
              const handleStr = handle.toString('hex');

              // Store directory info with a null fd to indicate it's a directory
              openFiles.set(handleStr, {
                fd: null,
                path: fullPath,
                isDirectory: true
              });

              console.log(`Directory opened: ${filename}, handle: ${handleStr}`);
              return sftpStream.handle(reqid, handle);
            }

            // Create parent directories if they don't exist (for writing)
            if (flags & OPEN_MODE.WRITE) {
              const dirname = path.dirname(fullPath);
              if (!fs.existsSync(dirname)) {
                fs.mkdirSync(dirname, { recursive: true });
              }
            }

            // Open the file with the appropriate mode
            let mode = 'r'; // Default to read mode

            if (flags & OPEN_MODE.WRITE) {
              if (flags & OPEN_MODE.APPEND) {
                mode = 'a'; // Append mode
              } else if (flags & OPEN_MODE.TRUNCATE) {
                mode = 'w'; // Write mode (truncate)
              } else {
                mode = 'r+'; // Read and write mode (no truncate)

                // Create the file if it doesn't exist and CREATE flag is set
                if ((flags & OPEN_MODE.CREATE) && !fs.existsSync(fullPath)) {
                  fs.writeFileSync(fullPath, ''); // Create empty file
                } else if (!fs.existsSync(fullPath)) {
                  // Special handling for ERP systems that might try to upload to non-existent files
                  if (flags & OPEN_MODE.WRITE) {
                    console.log(`File not found but WRITE flag is set. Creating file: ${filename}`);
                    fs.writeFileSync(fullPath, ''); // Create empty file
                  } else {
                    // If file doesn't exist and CREATE flag is not set, return error
                    console.log(`File not found: ${filename}`);
                    return sftpStream.status(reqid, STATUS_CODE.NO_SUCH_FILE);
                  }
                }
              }
            }

            console.log(`Opening file ${filename} with mode: ${mode}`);
            const fd = fs.openSync(fullPath, mode);

            // Create a handle
            const handle = Buffer.alloc(4);
            handle.writeUInt32BE(handleCount++, 0);
            const handleStr = handle.toString('hex');

            // Store the file descriptor and track the original filename
            openFiles.set(handleStr, {
              fd,
              path: fullPath,
              isDirectory: false
            });

            // Store the original filename for potential use in uploads
            const originalFilename = path.basename(filename);
            if (originalFilename) {
              originalFilenames.set(handleStr, originalFilename);
              console.log(`Tracking original filename for handle ${handleStr}: ${originalFilename}`);
            }

            console.log(`File opened: ${filename}, handle: ${handleStr}`);
            sftpStream.handle(reqid, handle);
          } catch (err) {
            console.error(`Error opening file ${filename}:`, err);
            sftpStream.status(reqid, STATUS_CODE.FAILURE);
          }
        });

        sftpStream.on('READ', (reqid, handle, offset, length) => {
          const handleStr = handle.toString('hex');
          console.log(`READ request for handle: ${handleStr}, offset: ${offset}, length: ${length}`);

          if (!openFiles.has(handleStr)) {
            console.log(`READ: Invalid handle: ${handleStr}`);
            return sftpStream.status(reqid, STATUS_CODE.FAILURE);
          }

          const entry = openFiles.get(handleStr);
          const { fd, path: filePath, isDirectory } = entry;

          // Check if this is a directory handle
          if (isDirectory === true) {
            console.log(`READ: Cannot read from directory handle: ${handleStr}, path: ${filePath}`);
            return sftpStream.status(reqid, STATUS_CODE.PERMISSION_DENIED);
          }

          if (fd === undefined || fd === null) {
            console.log(`READ: Handle ${handleStr} does not have a valid file descriptor`);
            return sftpStream.status(reqid, STATUS_CODE.FAILURE);
          }

          try {
            const buffer = Buffer.alloc(length);
            const bytesRead = fs.readSync(fd, buffer, 0, length, offset);

            console.log(`Read ${bytesRead} bytes from ${filePath} at offset ${offset}`);

            if (bytesRead === 0) {
              return sftpStream.status(reqid, STATUS_CODE.EOF);
            }

            sftpStream.data(reqid, bytesRead === length ? buffer : buffer.slice(0, bytesRead));
          } catch (err) {
            console.error(`Error reading file ${filePath}:`, err);
            sftpStream.status(reqid, STATUS_CODE.FAILURE);
          }
        });

        sftpStream.on('WRITE', (reqid, handle, offset, data) => {
          const handleStr = handle.toString('hex');
          console.log(`WRITE request for handle: ${handleStr}, offset: ${offset}, length: ${data.length}`);

          if (!openFiles.has(handleStr)) {
            console.log(`WRITE: Invalid handle: ${handleStr}`);
            return sftpStream.status(reqid, STATUS_CODE.FAILURE);
          }

          const entry = openFiles.get(handleStr);
          const { fd, path: filePath, isDirectory } = entry;

          // Special handling for directory handles - create a file in the directory
          if (isDirectory === true) {
            console.log(`WRITE: Detected write to directory handle: ${handleStr}, path: ${filePath}`);
            console.log(`WRITE: Creating a file in the directory instead`);

            try {
              // Check if we have an original filename from a previous OPEN operation
              let filename;

              // Look for any original filenames in our tracking map
              for (const [otherHandle, originalName] of originalFilenames.entries()) {
                console.log(`Found original filename for handle ${otherHandle}: ${originalName}`);
                filename = originalName;
                // We'll use the first one we find
                break;
              }

              // If no original filename found, generate one with timestamp
              if (!filename) {
                const timestamp = new Date().getTime();
                filename = `upload_${timestamp}.txt`;
              }

              console.log(`Using filename for upload: ${filename}`);
              const newFilePath = path.join(filePath, filename);
              console.log(`WRITE: Creating file: ${newFilePath}`);

              // Create the file and write the data
              const newFd = fs.openSync(newFilePath, 'w');
              const bytesWritten = fs.writeSync(newFd, data, 0, data.length, 0);
              fs.closeSync(newFd);

              console.log(`Successfully wrote ${bytesWritten} bytes to auto-generated file: ${newFilePath}`);
              return sftpStream.status(reqid, STATUS_CODE.OK);
            } catch (err) {
              console.error(`Error creating file in directory ${filePath}:`, err);
              return sftpStream.status(reqid, STATUS_CODE.FAILURE);
            }
          }

          if (fd === undefined || fd === null) {
            console.log(`WRITE: Handle ${handleStr} does not have a valid file descriptor`);
            return sftpStream.status(reqid, STATUS_CODE.FAILURE);
          }

          try {
            // Ensure the file is large enough for the write at the given offset
            const stats = fs.fstatSync(fd);
            if (offset > stats.size) {
              // If writing beyond the end of the file, fill the gap with zeros
              const buffer = Buffer.alloc(offset - stats.size);
              fs.writeSync(fd, buffer, 0, buffer.length, stats.size);
            }

            // Now write the actual data
            const bytesWritten = fs.writeSync(fd, data, 0, data.length, offset);
            console.log(`Successfully wrote ${bytesWritten} bytes to ${filePath} at offset ${offset}`);
            sftpStream.status(reqid, STATUS_CODE.OK);
          } catch (err) {
            console.error(`Error writing file ${filePath}:`, err);
            sftpStream.status(reqid, STATUS_CODE.FAILURE);
          }
        });

        sftpStream.on('CLOSE', (reqid, handle) => {
          const handleStr = handle.toString('hex');
          console.log(`CLOSE request for handle: ${handleStr}`);

          if (!openFiles.has(handleStr)) {
            console.log(`CLOSE: Invalid handle: ${handleStr}`);
            return sftpStream.status(reqid, STATUS_CODE.FAILURE);
          }

          const entry = openFiles.get(handleStr);

          try {
            // Check if it's a directory or file
            if (entry.isDirectory === true) {
              console.log(`Directory closed: ${entry.path}`);
            } else if (entry.fd !== undefined && entry.fd !== null) {
              // Close the file descriptor
              fs.closeSync(entry.fd);
              console.log(`File closed: ${entry.path}`);
            } else {
              console.log(`Closed handle with no file descriptor: ${handleStr}`);
            }

            // Remove the handle from our tracking
            openFiles.delete(handleStr);

            // Also remove from originalFilenames if it exists
            if (originalFilenames.has(handleStr)) {
              console.log(`Removing original filename tracking for handle ${handleStr}`);
              originalFilenames.delete(handleStr);
            }

            sftpStream.status(reqid, STATUS_CODE.OK);
          } catch (err) {
            console.error(`Error closing handle ${handleStr}:`, err);
            sftpStream.status(reqid, STATUS_CODE.FAILURE);
          }
        });

        sftpStream.on('STAT', (reqid, pathname) => {
          console.log(`STAT request for ${pathname}`);

          // Normalize the pathname (remove leading slash)
          const normalizedPathname = pathname.startsWith('/') ? pathname.substring(1) : pathname;

          // Resolve the full path
          const fullPath = path.join(userDir, normalizedPathname.replace(/\//g, path.sep));

          try {
            // Check if the path is within the user's directory
            const relativePath = path.relative(userDir, fullPath);
            if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
              console.log(`Access denied: ${pathname} is outside user directory`);
              return sftpStream.status(reqid, STATUS_CODE.PERMISSION_DENIED);
            }

            const stats = fs.statSync(fullPath);
            sftpStream.attrs(reqid, {
              mode: stats.mode,
              uid: stats.uid,
              gid: stats.gid,
              size: stats.size,
              atime: stats.atime.getTime() / 1000,
              mtime: stats.mtime.getTime() / 1000
            });
          } catch (err) {
            console.error(`Error getting stats for ${path}:`, err);
            sftpStream.status(reqid, STATUS_CODE.FAILURE);
          }
        });

        sftpStream.on('LSTAT', (reqid, pathname) => {
          console.log(`LSTAT request for ${pathname}`);

          // Normalize the pathname (remove leading slash)
          const normalizedPathname = pathname.startsWith('/') ? pathname.substring(1) : pathname;

          // Resolve the full path
          const fullPath = path.join(userDir, normalizedPathname.replace(/\//g, path.sep));

          try {
            // Check if the path is within the user's directory
            const relativePath = path.relative(userDir, fullPath);
            if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
              console.log(`Access denied: ${pathname} is outside user directory`);
              return sftpStream.status(reqid, STATUS_CODE.PERMISSION_DENIED);
            }

            const stats = fs.lstatSync(fullPath);
            sftpStream.attrs(reqid, {
              mode: stats.mode,
              uid: stats.uid,
              gid: stats.gid,
              size: stats.size,
              atime: stats.atime.getTime() / 1000,
              mtime: stats.mtime.getTime() / 1000
            });
          } catch (err) {
            console.error(`Error getting lstats for ${path}:`, err);
            sftpStream.status(reqid, STATUS_CODE.FAILURE);
          }
        });

        sftpStream.on('OPENDIR', (reqid, pathname) => {
          console.log(`OPENDIR request for ${pathname}`);

          // Normalize the pathname (remove leading slash)
          const normalizedPathname = pathname.startsWith('/') ? pathname.substring(1) : pathname;

          // Handle empty path as root directory
          const dirPath = normalizedPathname === '' ? '' : normalizedPathname;

          // Resolve the full path
          const fullPath = path.join(userDir, dirPath.replace(/\//g, path.sep));

          try {
            // Check if the path is within the user's directory
            const relativePath = path.relative(userDir, fullPath);
            if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
              console.log(`Access denied: ${pathname} is outside user directory`);
              return sftpStream.status(reqid, STATUS_CODE.PERMISSION_DENIED);
            }

            // Check if directory exists
            if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
              return sftpStream.status(reqid, STATUS_CODE.NO_SUCH_FILE);
            }

            // Create a handle
            const handle = Buffer.alloc(4);
            handle.writeUInt32BE(handleCount++, 0);

            // Store the directory path with isDirectory flag
            openFiles.set(handle.toString('hex'), {
              path: fullPath,
              files: null,
              isDirectory: true,
              fd: null
            });

            console.log(`Directory opened: ${path}, handle: ${handle.toString('hex')}`);
            sftpStream.handle(reqid, handle);
          } catch (err) {
            console.error(`Error opening directory ${path}:`, err);
            sftpStream.status(reqid, STATUS_CODE.FAILURE);
          }
        });

        sftpStream.on('READDIR', (reqid, handle) => {
          const handleStr = handle.toString('hex');

          if (!openFiles.has(handleStr)) {
            console.log(`READDIR: Invalid handle: ${handleStr}`);
            return sftpStream.status(reqid, STATUS_CODE.FAILURE);
          }

          const entry = openFiles.get(handleStr);
          console.log(`Reading directory: ${entry.path}`);

          try {
            // If we haven't read the directory yet
            if (!entry.files) {
              // Read the directory contents
              const dirContents = fs.readdirSync(entry.path);
              console.log(`Directory contents: ${dirContents.join(', ')}`);

              // Map the directory contents to SFTP file entries
              entry.files = dirContents.map(name => {
                const fullPath = path.join(entry.path, name);
                const stats = fs.statSync(fullPath);

                // Create a longname format similar to 'ls -l'
                const isDir = stats.isDirectory();
                const permissions = isDir ? 'drwxr-xr-x' : '-rw-r--r--';
                const longname = `${permissions} 1 ${stats.uid} ${stats.gid} ${stats.size} Jan 1 2023 ${name}`;

                return {
                  filename: name,
                  longname: longname,
                  attrs: {
                    mode: stats.mode,
                    uid: stats.uid,
                    gid: stats.gid,
                    size: stats.size,
                    atime: stats.atime.getTime() / 1000,
                    mtime: stats.mtime.getTime() / 1000
                  }
                };
              });
              entry.index = 0;
            }

            // If we've read all files
            if (entry.index >= entry.files.length) {
              entry.files = null; // Reset for next readdir
              return sftpStream.status(reqid, STATUS_CODE.EOF);
            }

            // Return a batch of files
            const files = entry.files.slice(entry.index, entry.index + 10);
            entry.index += files.length;

            console.log(`Sending ${files.length} files`);
            sftpStream.name(reqid, files);
          } catch (err) {
            console.error(`Error reading directory:`, err);
            sftpStream.status(reqid, STATUS_CODE.FAILURE);
          }
        });

        sftpStream.on('REALPATH', (reqid, pathname) => {
          console.log(`REALPATH request for ${pathname}`);

          // Handle root path
          if (pathname === '.' || pathname === '/') {
            return sftpStream.name(reqid, [{
              filename: '/',
              longname: '/',
              attrs: {}
            }]);
          }

          // Normalize the pathname (remove leading slash)
          const normalizedPathname = pathname.startsWith('/') ? pathname.substring(1) : pathname;

          // Resolve the full path
          const fullPath = path.join(userDir, normalizedPathname.replace(/\//g, path.sep));

          try {
            // Check if the path is within the user's directory
            const relativePath = path.relative(userDir, fullPath);
            if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
              console.log(`Access denied: ${pathname} is outside user directory`);
              return sftpStream.status(reqid, STATUS_CODE.PERMISSION_DENIED);
            }

            // Check if path exists
            if (!fs.existsSync(fullPath)) {
              return sftpStream.status(reqid, STATUS_CODE.NO_SUCH_FILE);
            }

            // Return the normalized path
            const normalizedPath = '/' + relativePath.replace(/\\/g, '/');
            sftpStream.name(reqid, [{
              filename: normalizedPath,
              longname: normalizedPath,
              attrs: {}
            }]);
          } catch (err) {
            console.error(`Error resolving path ${path}:`, err);
            sftpStream.status(reqid, STATUS_CODE.FAILURE);
          }
        });

        // Handle file deletion
        sftpStream.on('REMOVE', (reqid, pathname) => {
          console.log(`REMOVE request for ${pathname}`);

          // Normalize the pathname (remove leading slash)
          const normalizedPathname = pathname.startsWith('/') ? pathname.substring(1) : pathname;

          // Resolve the full path
          const fullPath = path.join(userDir, normalizedPathname.replace(/\//g, path.sep));

          try {
            // Check if the path is within the user's directory
            const relativePath = path.relative(userDir, fullPath);
            if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
              console.log(`Access denied: ${pathname} is outside user directory`);
              return sftpStream.status(reqid, STATUS_CODE.PERMISSION_DENIED);
            }

            // Check if file exists
            if (!fs.existsSync(fullPath)) {
              console.log(`File not found: ${pathname}`);
              return sftpStream.status(reqid, STATUS_CODE.NO_SUCH_FILE);
            }

            // Check if it's a file (not a directory)
            const stats = fs.statSync(fullPath);
            if (!stats.isFile()) {
              console.log(`Not a file: ${pathname}`);
              return sftpStream.status(reqid, STATUS_CODE.FAILURE);
            }

            // Delete the file
            fs.unlinkSync(fullPath);
            console.log(`File deleted: ${pathname}`);
            sftpStream.status(reqid, STATUS_CODE.OK);
          } catch (err) {
            console.error(`Error deleting file ${pathname}:`, err);
            sftpStream.status(reqid, STATUS_CODE.FAILURE);
          }
        });

        // Handle directory deletion
        sftpStream.on('RMDIR', (reqid, pathname) => {
          console.log(`RMDIR request for ${pathname}`);

          // Normalize the pathname (remove leading slash)
          const normalizedPathname = pathname.startsWith('/') ? pathname.substring(1) : pathname;

          // Resolve the full path
          const fullPath = path.join(userDir, normalizedPathname.replace(/\//g, path.sep));

          try {
            // Check if the path is within the user's directory
            const relativePath = path.relative(userDir, fullPath);
            if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
              console.log(`Access denied: ${pathname} is outside user directory`);
              return sftpStream.status(reqid, STATUS_CODE.PERMISSION_DENIED);
            }

            // Check if directory exists
            if (!fs.existsSync(fullPath)) {
              console.log(`Directory not found: ${pathname}`);
              return sftpStream.status(reqid, STATUS_CODE.NO_SUCH_FILE);
            }

            // Check if it's a directory
            const stats = fs.statSync(fullPath);
            if (!stats.isDirectory()) {
              console.log(`Not a directory: ${pathname}`);
              return sftpStream.status(reqid, STATUS_CODE.FAILURE);
            }

            // Delete the directory
            fs.rmdirSync(fullPath);
            console.log(`Directory deleted: ${pathname}`);
            sftpStream.status(reqid, STATUS_CODE.OK);
          } catch (err) {
            console.error(`Error deleting directory ${pathname}:`, err);
            sftpStream.status(reqid, STATUS_CODE.FAILURE);
          }
        });

        // Handle directory creation
        sftpStream.on('MKDIR', (reqid, pathname, attrs) => {
          console.log(`MKDIR request for ${pathname}`);

          // Normalize the pathname (remove leading slash)
          const normalizedPathname = pathname.startsWith('/') ? pathname.substring(1) : pathname;

          // Resolve the full path
          const fullPath = path.join(userDir, normalizedPathname.replace(/\//g, path.sep));

          try {
            // Check if the path is within the user's directory
            const relativePath = path.relative(userDir, fullPath);
            if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
              console.log(`Access denied: ${pathname} is outside user directory`);
              return sftpStream.status(reqid, STATUS_CODE.PERMISSION_DENIED);
            }

            // Check if directory already exists
            if (fs.existsSync(fullPath)) {
              console.log(`Directory already exists: ${pathname}`);
              return sftpStream.status(reqid, STATUS_CODE.FAILURE);
            }

            // Create the directory
            fs.mkdirSync(fullPath, { recursive: true });
            console.log(`Directory created: ${pathname}`);
            sftpStream.status(reqid, STATUS_CODE.OK);
          } catch (err) {
            console.error(`Error creating directory ${pathname}:`, err);
            sftpStream.status(reqid, STATUS_CODE.FAILURE);
          }
        });

        // Handle file/directory renaming
        sftpStream.on('RENAME', (reqid, oldPathname, newPathname) => {
          console.log(`RENAME request from ${oldPathname} to ${newPathname}`);

          // Normalize the pathnames (remove leading slash)
          const normalizedOldPathname = oldPathname.startsWith('/') ? oldPathname.substring(1) : oldPathname;
          const normalizedNewPathname = newPathname.startsWith('/') ? newPathname.substring(1) : newPathname;

          // Resolve the full paths
          const oldFullPath = path.join(userDir, normalizedOldPathname.replace(/\//g, path.sep));
          const newFullPath = path.join(userDir, normalizedNewPathname.replace(/\//g, path.sep));

          try {
            // Check if the paths are within the user's directory
            const oldRelativePath = path.relative(userDir, oldFullPath);
            const newRelativePath = path.relative(userDir, newFullPath);

            if (oldRelativePath.startsWith('..') || path.isAbsolute(oldRelativePath) ||
                newRelativePath.startsWith('..') || path.isAbsolute(newRelativePath)) {
              console.log(`Access denied: Path is outside user directory`);
              return sftpStream.status(reqid, STATUS_CODE.PERMISSION_DENIED);
            }

            // Check if source exists
            if (!fs.existsSync(oldFullPath)) {
              console.log(`Source not found: ${oldPathname}`);
              return sftpStream.status(reqid, STATUS_CODE.NO_SUCH_FILE);
            }

            // Create parent directories for destination if they don't exist
            const newDirname = path.dirname(newFullPath);
            if (!fs.existsSync(newDirname)) {
              fs.mkdirSync(newDirname, { recursive: true });
            }

            // Rename the file/directory
            fs.renameSync(oldFullPath, newFullPath);
            console.log(`Renamed from ${oldPathname} to ${newPathname}`);
            sftpStream.status(reqid, STATUS_CODE.OK);
          } catch (err) {
            console.error(`Error renaming from ${oldPathname} to ${newPathname}:`, err);
            sftpStream.status(reqid, STATUS_CODE.FAILURE);
          }
        });

        // Log when the SFTP session ends
        sftpStream.on('end', () => {
          console.log('SFTP session ended');

          // Close any open files
          for (const [handle, entry] of openFiles.entries()) {
            if (entry && entry.fd !== undefined && entry.fd !== null) {
              try {
                fs.closeSync(entry.fd);
                console.log(`Closed file with handle ${handle}`);
              } catch (err) {
                console.error(`Error closing file with handle ${handle}:`, err);
              }
            } else {
              console.log(`Skipping close for directory or null fd handle: ${handle}`);
            }
          }

          openFiles.clear();
          originalFilenames.clear(); // Also clear the originalFilenames map
        });

        // Handle errors on the SFTP stream
        sftpStream.on('error', (err) => {
          console.error('SFTP stream error:', err);

          // Close any open files on error
          for (const [handle, entry] of openFiles.entries()) {
            if (entry && entry.fd !== undefined && entry.fd !== null) {
              try {
                fs.closeSync(entry.fd);
                console.log(`Closed file with handle ${handle} due to error`);
              } catch (closeErr) {
                console.error(`Error closing file with handle ${handle}:`, closeErr);
              }
            } else {
              console.log(`Skipping close for directory or null fd handle: ${handle}`);
            }
          }

          openFiles.clear();
          originalFilenames.clear(); // Also clear the originalFilenames map
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
