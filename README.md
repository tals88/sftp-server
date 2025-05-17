# Secure SFTP Server

A simple SFTP server implementation using Node.js and the SSH2 library. This server allows secure file transfers with a predefined user for testing purposes.

## Features

- Secure SFTP server with password authentication
- Predefined user for testing
- Complete file operations:
  - Upload and download files
  - List directory contents
  - Delete files and directories
  - Create directories
  - Rename files and directories
- Configurable storage location

## Prerequisites

- Node.js (v14 or higher)
- npm (Node Package Manager)

## Installation

1. Clone the repository or download the source code
2. Install dependencies:

```bash
npm install
```

3. Generate SSH host keys:

```bash
node generate-keys.js
```

## Configuration

The server is configured with the following default settings:

- Port: 2222
- Predefined user: testuser
- Password: password123
- Storage directory: ./storage

You can modify these settings in the `server-direct.js` file.

## Usage

### Starting the Server

```bash
node server-direct.js
```

The server will start listening on port 2222 (by default).

### Connecting to the Server

You can connect to the server using any SFTP client (e.g., FileZilla, WinSCP, or the provided test client) with the following credentials:

- Host: localhost (or your server's IP address)
- Port: 2222
- Username: testuser
- Password: password123
- Protocol: SFTP

### Testing with the Provided Client

A test client is included to verify the server's functionality:

```bash
node client.js
```

This will:
1. Connect to the server
2. List files in the root directory
3. Download a test file
4. Upload a new file

## Security Considerations

This implementation is intended for testing purposes only. For production use, consider the following security enhancements:

- Use public key authentication instead of passwords
- Implement proper user management
- Set up file permissions
- Configure IP restrictions
- Enable logging and monitoring

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## AWS Deployment

### Prerequisites
- An AWS account
- AWS CLI installed and configured
- Basic knowledge of AWS EC2

### Deployment Steps

1. **Launch an EC2 Instance**
   - Use Amazon Linux 2 or Ubuntu Server
   - Choose t2.micro for testing (free tier eligible)
   - Configure security group to allow:
     - SSH (port 22) from your IP
     - Custom TCP (port 2222) for SFTP

2. **Connect to Your Instance**
   ```bash
   ssh -i your-key.pem ec2-user@your-instance-public-dns
   ```

3. **Install Node.js**
   ```bash
   # For Amazon Linux 2
   curl -sL https://rpm.nodesource.com/setup_14.x | sudo bash -
   sudo yum install -y nodejs

   # For Ubuntu
   curl -sL https://deb.nodesource.com/setup_14.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```

4. **Clone the Repository**
   ```bash
   git clone https://github.com/yourusername/sftp-server.git
   cd sftp-server
   ```

5. **Install Dependencies**
   ```bash
   npm install
   ```

6. **Generate SSH Keys**
   ```bash
   mkdir -p keys
   ssh-keygen -t rsa -f keys/host.key -N ""
   ```

7. **Start the Server**
   ```bash
   # For testing
   node server.js

   # For production (using PM2)
   npm install -g pm2
   pm2 start server.js
   pm2 startup
   pm2 save
   ```

8. **Test the Connection**
   - Use an SFTP client to connect to your EC2 instance's public IP on port 2222
   - Use the predefined credentials (testuser/password123)

## Acknowledgments

- [SSH2](https://github.com/mscdex/ssh2) - SSH2 client and server modules for Node.js
