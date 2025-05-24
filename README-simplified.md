# Simple SFTP Server

A lightweight, secure SFTP server without complex file type detection, optimized for 1GB RAM AWS deployments.

## Features

✅ **Simple & Clean**
- No complex file content detection or extension guessing
- Files are stored with their original names
- Straightforward file operations

✅ **Secure & Isolated**
- Each user has their own isolated directory
- Path validation prevents directory traversal attacks
- Users cannot access other users' data
- Secure password authentication with timing-safe comparison

✅ **Lightweight**
- Optimized for 1GB RAM AWS instances
- No Docker overhead
- Minimal dependencies
- Efficient memory usage

✅ **User Management**
- Role-based permissions (admin, user, readonly)
- JSON database for user storage
- CLI tool for user management
- User directory auto-creation
- Quota support (configurable)

## Quick Start

### 1. Generate SSH Host Keys
```bash
node generate-keys.js
```

### 2. Start the Server
```bash
# Development
npm start

# Production
NODE_ENV=production npm start

# Custom port
SFTP_PORT=2222 npm start
```

### 3. Create Users and Connect
```bash
# Create your first user
node cli.js add myuser mypassword user

# Connect with SFTP client
sftp -P 2222 myuser@localhost
```

## User Management

Use the CLI tool to manage users:
```bash
# List all users
node cli.js list

# Add new user
node cli.js add username password role

# Remove user
node cli.js remove username --confirm

# Update permissions
node cli.js update username write false

# Get user info
node cli.js info username
```

## Directory Structure

```
storage/
├── users/
│   └── username/          # Each user's isolated directory
├── users.db.json         # User database (JSON format)
└── logs/                 # Server logs (if enabled)
```

## Configuration

Environment variables:
- `SFTP_PORT` - Server port (default: 2222)
- `SFTP_HOST` - Bind address (default: 0.0.0.0)
- `NODE_ENV` - Environment (production/development)

## AWS Deployment

### Requirements
- 1GB RAM minimum
- Node.js 16+
- SSH access to server

### Deployment Steps

1. **Upload files to server:**
```bash
scp -r . ubuntu@your-aws-instance:/home/ubuntu/sftp-server/
```

2. **Install dependencies:**
```bash
ssh ubuntu@your-aws-instance
cd /home/ubuntu/sftp-server
npm install --production
```

3. **Generate keys:**
```bash
node generate-keys.js
```

4. **Start with PM2 (recommended):**
```bash
npm install -g pm2
pm2 start start.js --name "sftp-server"
pm2 startup
pm2 save
```

5. **Configure firewall:**
```bash
sudo ufw allow 2222/tcp
```

## Security Features

- **Path Validation**: Prevents directory traversal attacks
- **User Isolation**: Each user confined to their directory
- **Timing-Safe Authentication**: Prevents timing attacks
- **Permission System**: Role-based access control
- **Input Sanitization**: Validates all file paths and names

## File Operations

All standard SFTP operations are supported:
- Upload files (keeps original names)
- Download files
- Create/delete directories
- Rename files/directories
- List directory contents
- File permissions and attributes

## Monitoring

Check server status:
```bash
pm2 status
pm2 logs sftp-server
```

## Troubleshooting

### Common Issues

1. **"Host key not found"**
   - Run `node generate-keys.js` to create SSH keys

2. **"Permission denied"**
   - Check user credentials
   - Verify user directory permissions

3. **"Connection refused"**
   - Check if server is running: `pm2 status`
   - Verify port is open: `sudo ufw status`

### Logs

Server logs include:
- Authentication attempts
- File operations
- Error messages
- Connection statistics

## Performance

Optimized for 1GB RAM:
- Memory usage: ~50-100MB
- Max concurrent connections: 10 (configurable)
- Efficient file handling
- No unnecessary file processing

## License

MIT License - Simple and permissive for your use case.
