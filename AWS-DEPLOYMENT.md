# AWS Deployment Guide

## Quick Deployment Steps

### 1. Clone Repository on AWS Server
```bash
git clone https://github.com/tals88/sftp-server.git
cd sftp-server
```

### 2. Install Dependencies
```bash
npm install --production
```

### 3. Generate SSH Keys
```bash
node generate-keys.js
```

### 4. Create Your First User
```bash
# Create admin user
node cli.js add admin your_secure_password admin

# Create regular user
node cli.js add myuser user_password user

# List users to verify
node cli.js list
```

### 5. Start Server
```bash
# For production with PM2 (recommended)
npm install -g pm2
pm2 start start.js --name "sftp-server"
pm2 startup
pm2 save

# Or run directly
npm start
```

### 6. Configure Firewall
```bash
sudo ufw allow 2222/tcp
sudo ufw status
```

## User Management Commands

```bash
# List all users
node cli.js list

# Add new user
node cli.js add username password role
# Roles: admin, user, readonly

# Remove user (requires confirmation)
node cli.js remove username --confirm

# Update user permissions
node cli.js update username write false
node cli.js update username read true

# Get user information
node cli.js info username

# Server statistics
node cli.js stats
```

## Testing Connection

```bash
# From your local machine
sftp -P 2222 username@your-aws-server-ip

# Example commands in SFTP
sftp> ls
sftp> put localfile.txt
sftp> get remotefile.txt
sftp> mkdir newfolder
sftp> cd newfolder
```

## Monitoring

```bash
# Check server status
pm2 status

# View logs
pm2 logs sftp-server

# Restart server
pm2 restart sftp-server

# Stop server
pm2 stop sftp-server
```

## Security Features

✅ **User Isolation**: Each user confined to their own directory  
✅ **Path Validation**: Prevents directory traversal attacks  
✅ **Secure Authentication**: Timing-safe password comparison  
✅ **Role-based Permissions**: Admin, user, readonly roles  
✅ **No Default Users**: Must create users via CLI  

## File Structure After Deployment

```
sftp-server/
├── storage/
│   ├── users/
│   │   ├── admin/           # Admin user directory
│   │   └── myuser/          # Regular user directory
│   └── users.db.json        # User database
├── keys/
│   ├── host.key             # SSH private key (generated)
│   └── host.key.pub         # SSH public key (generated)
└── logs/                    # Server logs (if enabled)
```

## Troubleshooting

### Server Won't Start
- Check if keys exist: `ls keys/`
- Generate keys: `node generate-keys.js`
- Check port availability: `netstat -tlnp | grep 2222`

### Can't Connect
- Verify firewall: `sudo ufw status`
- Check server status: `pm2 status`
- Test locally: `sftp -P 2222 username@localhost`

### Permission Denied
- Verify user exists: `node cli.js list`
- Check user permissions: `node cli.js info username`
- Verify password is correct

### Memory Usage (1GB RAM Optimization)
- Server uses ~50-100MB RAM
- Database is lightweight JSON file
- No Docker overhead
- Efficient file handling

## Backup

```bash
# Backup user database
cp storage/users.db.json storage/users.db.json.backup

# Backup SSH keys
cp keys/host.key keys/host.key.backup
cp keys/host.key.pub keys/host.key.pub.backup
```

## Updates

```bash
# Pull latest changes
git pull origin main

# Restart server
pm2 restart sftp-server
```

---

🚀 **Your simplified SFTP server is now ready for production use!**

- No complex file type detection
- Simple file operations with original names  
- Secure user management via CLI
- Optimized for 1GB RAM AWS instances
- Easy to maintain and monitor
