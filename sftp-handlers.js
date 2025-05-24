const fs = require('fs');
const path = require('path');

// SFTP constants
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

function setupSftpHandlers(sftpStream, authenticatedUser, openFiles, createHandle, log, validatePath, checkPermission, checkQuota) {
  
  // OPEN handler - simplified without complex file type logic
  sftpStream.on('OPEN', (reqid, filename, flags, attrs) => {
    log('debug', 'OPEN request', { username: authenticatedUser.username, filename, flags });

    const pathValidation = validatePath(authenticatedUser.directory, filename);
    if (!pathValidation.valid) {
      log('warn', 'Path validation failed', { username: authenticatedUser.username, filename, error: pathValidation.error });
      return sftpStream.status(reqid, STATUS_CODE.PERMISSION_DENIED);
    }

    const { fullPath } = pathValidation;

    try {
      // Check if this is a directory
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
        if (flags & OPEN_MODE.WRITE) {
          log('warn', 'Write request to directory rejected', { username: authenticatedUser.username, filename });
          return sftpStream.status(reqid, STATUS_CODE.PERMISSION_DENIED);
        }

        // Handle directory open
        const handle = createHandle();
        const handleStr = handle.toString('hex');

        openFiles.set(handleStr, {
          fd: null,
          path: fullPath,
          isDirectory: true
        });

        log('debug', 'Directory opened', { username: authenticatedUser.username, filename, handle: handleStr });
        return sftpStream.handle(reqid, handle);
      }

      // Handle file operations
      if (flags & OPEN_MODE.WRITE) {
        if (!checkPermission(authenticatedUser, 'write')) {
          log('warn', 'Write permission denied', { username: authenticatedUser.username, filename });
          return sftpStream.status(reqid, STATUS_CODE.PERMISSION_DENIED);
        }

        // Create parent directories if they don't exist
        const dirname = path.dirname(fullPath);
        if (!fs.existsSync(dirname)) {
          fs.mkdirSync(dirname, { recursive: true });
        }
      } else {
        if (!checkPermission(authenticatedUser, 'read')) {
          log('warn', 'Read permission denied', { username: authenticatedUser.username, filename });
          return sftpStream.status(reqid, STATUS_CODE.PERMISSION_DENIED);
        }
      }

      // Determine file mode
      let mode = 'r';
      if (flags & OPEN_MODE.WRITE) {
        if (flags & OPEN_MODE.APPEND) {
          mode = 'a';
        } else if (flags & OPEN_MODE.TRUNCATE) {
          mode = 'w';
        } else {
          mode = 'r+';
          if ((flags & OPEN_MODE.CREATE) && !fs.existsSync(fullPath)) {
            fs.writeFileSync(fullPath, '');
          } else if (!fs.existsSync(fullPath)) {
            if (flags & OPEN_MODE.WRITE) {
              fs.writeFileSync(fullPath, '');
            } else {
              log('warn', 'File not found', { username: authenticatedUser.username, filename });
              return sftpStream.status(reqid, STATUS_CODE.NO_SUCH_FILE);
            }
          }
        }
      }

      const fd = fs.openSync(fullPath, mode);
      const handle = createHandle();
      const handleStr = handle.toString('hex');

      openFiles.set(handleStr, {
        fd,
        path: fullPath,
        isDirectory: false
      });

      log('debug', 'File opened', { username: authenticatedUser.username, filename, handle: handleStr, mode });
      sftpStream.handle(reqid, handle);
    } catch (err) {
      log('error', 'Error opening file', { username: authenticatedUser.username, filename, error: err.message });
      sftpStream.status(reqid, STATUS_CODE.FAILURE);
    }
  });

  // READ handler
  sftpStream.on('READ', (reqid, handle, offset, length) => {
    const handleStr = handle.toString('hex');
    log('debug', 'READ request', { username: authenticatedUser.username, handle: handleStr, offset, length });

    if (!openFiles.has(handleStr)) {
      log('warn', 'Invalid handle for READ', { username: authenticatedUser.username, handle: handleStr });
      return sftpStream.status(reqid, STATUS_CODE.FAILURE);
    }

    const entry = openFiles.get(handleStr);
    const { fd, isDirectory } = entry;

    if (isDirectory) {
      log('warn', 'Cannot read from directory handle', { username: authenticatedUser.username, handle: handleStr });
      return sftpStream.status(reqid, STATUS_CODE.PERMISSION_DENIED);
    }

    if (fd === null || fd === undefined) {
      log('warn', 'Invalid file descriptor for READ', { username: authenticatedUser.username, handle: handleStr });
      return sftpStream.status(reqid, STATUS_CODE.FAILURE);
    }

    try {
      const buffer = Buffer.alloc(length);
      const bytesRead = fs.readSync(fd, buffer, 0, length, offset);

      if (bytesRead === 0) {
        return sftpStream.status(reqid, STATUS_CODE.EOF);
      }

      sftpStream.data(reqid, bytesRead === length ? buffer : buffer.slice(0, bytesRead));
    } catch (err) {
      log('error', 'Error reading file', { username: authenticatedUser.username, handle: handleStr, error: err.message });
      sftpStream.status(reqid, STATUS_CODE.FAILURE);
    }
  });

  // WRITE handler - simplified without complex file type logic
  sftpStream.on('WRITE', (reqid, handle, offset, data) => {
    const handleStr = handle.toString('hex');
    log('debug', 'WRITE request', { username: authenticatedUser.username, handle: handleStr, offset, length: data.length });

    if (!openFiles.has(handleStr)) {
      log('warn', 'Invalid handle for WRITE', { username: authenticatedUser.username, handle: handleStr });
      return sftpStream.status(reqid, STATUS_CODE.FAILURE);
    }

    const entry = openFiles.get(handleStr);
    const { fd, isDirectory } = entry;

    if (isDirectory) {
      log('warn', 'Cannot write to directory handle', { username: authenticatedUser.username, handle: handleStr });
      return sftpStream.status(reqid, STATUS_CODE.PERMISSION_DENIED);
    }

    if (fd === null || fd === undefined) {
      log('warn', 'Invalid file descriptor for WRITE', { username: authenticatedUser.username, handle: handleStr });
      return sftpStream.status(reqid, STATUS_CODE.FAILURE);
    }

    // Check quota before writing
    if (!checkQuota(authenticatedUser.username, data.length)) {
      log('warn', 'Quota exceeded', { username: authenticatedUser.username, handle: handleStr });
      return sftpStream.status(reqid, STATUS_CODE.FAILURE);
    }

    try {
      const bytesWritten = fs.writeSync(fd, data, 0, data.length, offset);
      log('debug', 'Data written successfully', { username: authenticatedUser.username, handle: handleStr, bytesWritten });
      sftpStream.status(reqid, STATUS_CODE.OK);
    } catch (err) {
      log('error', 'Error writing file', { username: authenticatedUser.username, handle: handleStr, error: err.message });
      sftpStream.status(reqid, STATUS_CODE.FAILURE);
    }
  });

  // CLOSE handler
  sftpStream.on('CLOSE', (reqid, handle) => {
    const handleStr = handle.toString('hex');
    log('debug', 'CLOSE request', { username: authenticatedUser.username, handle: handleStr });

    if (!openFiles.has(handleStr)) {
      log('warn', 'Invalid handle for CLOSE', { username: authenticatedUser.username, handle: handleStr });
      return sftpStream.status(reqid, STATUS_CODE.FAILURE);
    }

    const entry = openFiles.get(handleStr);

    try {
      if (entry.fd !== null && entry.fd !== undefined) {
        fs.closeSync(entry.fd);
      }
      openFiles.delete(handleStr);
      log('debug', 'Handle closed successfully', { username: authenticatedUser.username, handle: handleStr });
      sftpStream.status(reqid, STATUS_CODE.OK);
    } catch (err) {
      log('error', 'Error closing handle', { username: authenticatedUser.username, handle: handleStr, error: err.message });
      sftpStream.status(reqid, STATUS_CODE.FAILURE);
    }
  });

  // STAT handler
  sftpStream.on('STAT', (reqid, pathname) => {
    log('debug', 'STAT request', { username: authenticatedUser.username, pathname });

    const pathValidation = validatePath(authenticatedUser.directory, pathname);
    if (!pathValidation.valid) {
      log('warn', 'Path validation failed for STAT', { username: authenticatedUser.username, pathname });
      return sftpStream.status(reqid, STATUS_CODE.PERMISSION_DENIED);
    }

    try {
      const stats = fs.statSync(pathValidation.fullPath);
      sftpStream.attrs(reqid, {
        mode: stats.mode,
        uid: stats.uid,
        gid: stats.gid,
        size: stats.size,
        atime: stats.atime.getTime() / 1000,
        mtime: stats.mtime.getTime() / 1000
      });
    } catch (err) {
      log('error', 'Error getting file stats', { username: authenticatedUser.username, pathname, error: err.message });
      sftpStream.status(reqid, STATUS_CODE.FAILURE);
    }
  });

  // LSTAT handler
  sftpStream.on('LSTAT', (reqid, pathname) => {
    log('debug', 'LSTAT request', { username: authenticatedUser.username, pathname });

    const pathValidation = validatePath(authenticatedUser.directory, pathname);
    if (!pathValidation.valid) {
      log('warn', 'Path validation failed for LSTAT', { username: authenticatedUser.username, pathname });
      return sftpStream.status(reqid, STATUS_CODE.PERMISSION_DENIED);
    }

    try {
      const stats = fs.lstatSync(pathValidation.fullPath);
      sftpStream.attrs(reqid, {
        mode: stats.mode,
        uid: stats.uid,
        gid: stats.gid,
        size: stats.size,
        atime: stats.atime.getTime() / 1000,
        mtime: stats.mtime.getTime() / 1000
      });
    } catch (err) {
      log('error', 'Error getting file lstats', { username: authenticatedUser.username, pathname, error: err.message });
      sftpStream.status(reqid, STATUS_CODE.FAILURE);
    }
  });

  // OPENDIR handler
  sftpStream.on('OPENDIR', (reqid, pathname) => {
    log('debug', 'OPENDIR request', { username: authenticatedUser.username, pathname });

    const pathValidation = validatePath(authenticatedUser.directory, pathname);
    if (!pathValidation.valid) {
      log('warn', 'Path validation failed for OPENDIR', { username: authenticatedUser.username, pathname });
      return sftpStream.status(reqid, STATUS_CODE.PERMISSION_DENIED);
    }

    const { fullPath } = pathValidation;

    try {
      if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
        return sftpStream.status(reqid, STATUS_CODE.NO_SUCH_FILE);
      }

      const handle = createHandle();
      const handleStr = handle.toString('hex');

      openFiles.set(handleStr, {
        path: fullPath,
        files: null,
        isDirectory: true,
        fd: null
      });

      log('debug', 'Directory opened for listing', { username: authenticatedUser.username, pathname, handle: handleStr });
      sftpStream.handle(reqid, handle);
    } catch (err) {
      log('error', 'Error opening directory', { username: authenticatedUser.username, pathname, error: err.message });
      sftpStream.status(reqid, STATUS_CODE.FAILURE);
    }
  });

  // READDIR handler
  sftpStream.on('READDIR', (reqid, handle) => {
    const handleStr = handle.toString('hex');

    if (!openFiles.has(handleStr)) {
      log('warn', 'Invalid handle for READDIR', { username: authenticatedUser.username, handle: handleStr });
      return sftpStream.status(reqid, STATUS_CODE.FAILURE);
    }

    const entry = openFiles.get(handleStr);

    try {
      if (!entry.files) {
        const dirContents = fs.readdirSync(entry.path);
        entry.files = dirContents.map(name => {
          const fullPath = path.join(entry.path, name);
          const stats = fs.statSync(fullPath);
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

      if (entry.index >= entry.files.length) {
        entry.files = null;
        return sftpStream.status(reqid, STATUS_CODE.EOF);
      }

      const files = entry.files.slice(entry.index, entry.index + 10);
      entry.index += files.length;

      sftpStream.name(reqid, files);
    } catch (err) {
      log('error', 'Error reading directory', { username: authenticatedUser.username, handle: handleStr, error: err.message });
      sftpStream.status(reqid, STATUS_CODE.FAILURE);
    }
  });

  // REALPATH handler
  sftpStream.on('REALPATH', (reqid, pathname) => {
    log('debug', 'REALPATH request', { username: authenticatedUser.username, pathname });

    if (pathname === '.' || pathname === '/') {
      return sftpStream.name(reqid, [{
        filename: '/',
        longname: '/',
        attrs: {}
      }]);
    }

    const pathValidation = validatePath(authenticatedUser.directory, pathname);
    if (!pathValidation.valid) {
      log('warn', 'Path validation failed for REALPATH', { username: authenticatedUser.username, pathname });
      return sftpStream.status(reqid, STATUS_CODE.PERMISSION_DENIED);
    }

    try {
      if (!fs.existsSync(pathValidation.fullPath)) {
        return sftpStream.status(reqid, STATUS_CODE.NO_SUCH_FILE);
      }

      const normalizedPath = '/' + pathValidation.relativePath.replace(/\\/g, '/');
      sftpStream.name(reqid, [{
        filename: normalizedPath,
        longname: normalizedPath,
        attrs: {}
      }]);
    } catch (err) {
      log('error', 'Error resolving path', { username: authenticatedUser.username, pathname, error: err.message });
      sftpStream.status(reqid, STATUS_CODE.FAILURE);
    }
  });

  // REMOVE handler
  sftpStream.on('REMOVE', (reqid, pathname) => {
    log('debug', 'REMOVE request', { username: authenticatedUser.username, pathname });

    if (!checkPermission(authenticatedUser, 'delete')) {
      log('warn', 'Delete permission denied', { username: authenticatedUser.username, pathname });
      return sftpStream.status(reqid, STATUS_CODE.PERMISSION_DENIED);
    }

    const pathValidation = validatePath(authenticatedUser.directory, pathname);
    if (!pathValidation.valid) {
      log('warn', 'Path validation failed for REMOVE', { username: authenticatedUser.username, pathname });
      return sftpStream.status(reqid, STATUS_CODE.PERMISSION_DENIED);
    }

    try {
      if (!fs.existsSync(pathValidation.fullPath)) {
        return sftpStream.status(reqid, STATUS_CODE.NO_SUCH_FILE);
      }

      const stats = fs.statSync(pathValidation.fullPath);
      if (!stats.isFile()) {
        return sftpStream.status(reqid, STATUS_CODE.FAILURE);
      }

      fs.unlinkSync(pathValidation.fullPath);
      log('info', 'File deleted', { username: authenticatedUser.username, pathname });
      sftpStream.status(reqid, STATUS_CODE.OK);
    } catch (err) {
      log('error', 'Error deleting file', { username: authenticatedUser.username, pathname, error: err.message });
      sftpStream.status(reqid, STATUS_CODE.FAILURE);
    }
  });

  // RMDIR handler
  sftpStream.on('RMDIR', (reqid, pathname) => {
    log('debug', 'RMDIR request', { username: authenticatedUser.username, pathname });

    if (!checkPermission(authenticatedUser, 'delete')) {
      log('warn', 'Delete permission denied', { username: authenticatedUser.username, pathname });
      return sftpStream.status(reqid, STATUS_CODE.PERMISSION_DENIED);
    }

    const pathValidation = validatePath(authenticatedUser.directory, pathname);
    if (!pathValidation.valid) {
      log('warn', 'Path validation failed for RMDIR', { username: authenticatedUser.username, pathname });
      return sftpStream.status(reqid, STATUS_CODE.PERMISSION_DENIED);
    }

    try {
      if (!fs.existsSync(pathValidation.fullPath)) {
        return sftpStream.status(reqid, STATUS_CODE.NO_SUCH_FILE);
      }

      const stats = fs.statSync(pathValidation.fullPath);
      if (!stats.isDirectory()) {
        return sftpStream.status(reqid, STATUS_CODE.FAILURE);
      }

      fs.rmdirSync(pathValidation.fullPath);
      log('info', 'Directory deleted', { username: authenticatedUser.username, pathname });
      sftpStream.status(reqid, STATUS_CODE.OK);
    } catch (err) {
      log('error', 'Error deleting directory', { username: authenticatedUser.username, pathname, error: err.message });
      sftpStream.status(reqid, STATUS_CODE.FAILURE);
    }
  });

  // MKDIR handler
  sftpStream.on('MKDIR', (reqid, pathname, attrs) => {
    log('debug', 'MKDIR request', { username: authenticatedUser.username, pathname });

    if (!checkPermission(authenticatedUser, 'createDir')) {
      log('warn', 'Create directory permission denied', { username: authenticatedUser.username, pathname });
      return sftpStream.status(reqid, STATUS_CODE.PERMISSION_DENIED);
    }

    const pathValidation = validatePath(authenticatedUser.directory, pathname);
    if (!pathValidation.valid) {
      log('warn', 'Path validation failed for MKDIR', { username: authenticatedUser.username, pathname });
      return sftpStream.status(reqid, STATUS_CODE.PERMISSION_DENIED);
    }

    try {
      if (fs.existsSync(pathValidation.fullPath)) {
        return sftpStream.status(reqid, STATUS_CODE.FAILURE);
      }

      fs.mkdirSync(pathValidation.fullPath, { recursive: true });
      log('info', 'Directory created', { username: authenticatedUser.username, pathname });
      sftpStream.status(reqid, STATUS_CODE.OK);
    } catch (err) {
      log('error', 'Error creating directory', { username: authenticatedUser.username, pathname, error: err.message });
      sftpStream.status(reqid, STATUS_CODE.FAILURE);
    }
  });

  // RENAME handler
  sftpStream.on('RENAME', (reqid, oldPathname, newPathname) => {
    log('debug', 'RENAME request', { username: authenticatedUser.username, oldPathname, newPathname });

    if (!checkPermission(authenticatedUser, 'write')) {
      log('warn', 'Write permission denied for RENAME', { username: authenticatedUser.username, oldPathname, newPathname });
      return sftpStream.status(reqid, STATUS_CODE.PERMISSION_DENIED);
    }

    const oldPathValidation = validatePath(authenticatedUser.directory, oldPathname);
    const newPathValidation = validatePath(authenticatedUser.directory, newPathname);

    if (!oldPathValidation.valid || !newPathValidation.valid) {
      log('warn', 'Path validation failed for RENAME', { username: authenticatedUser.username, oldPathname, newPathname });
      return sftpStream.status(reqid, STATUS_CODE.PERMISSION_DENIED);
    }

    try {
      if (!fs.existsSync(oldPathValidation.fullPath)) {
        return sftpStream.status(reqid, STATUS_CODE.NO_SUCH_FILE);
      }

      const newDirname = path.dirname(newPathValidation.fullPath);
      if (!fs.existsSync(newDirname)) {
        fs.mkdirSync(newDirname, { recursive: true });
      }

      fs.renameSync(oldPathValidation.fullPath, newPathValidation.fullPath);
      log('info', 'File/directory renamed', { username: authenticatedUser.username, oldPathname, newPathname });
      sftpStream.status(reqid, STATUS_CODE.OK);
    } catch (err) {
      log('error', 'Error renaming file/directory', { username: authenticatedUser.username, oldPathname, newPathname, error: err.message });
      sftpStream.status(reqid, STATUS_CODE.FAILURE);
    }
  });
}

module.exports = { setupSftpHandlers };
