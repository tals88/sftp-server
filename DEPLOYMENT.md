# Deployment Guide

This guide covers different deployment options for the Secure Multi-User SFTP Server.

## Table of Contents

1. [Local Development](#local-development)
2. [Docker Deployment](#docker-deployment)
3. [AWS ECS Deployment](#aws-ecs-deployment)
4. [Security Considerations](#security-considerations)
5. [Monitoring and Maintenance](#monitoring-and-maintenance)

## Local Development

### Prerequisites
- Node.js 18+
- npm

### Setup
```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your settings

# Generate SSH keys
node generate-keys.js

# Create admin user
npm run admin create-user admin --password your-secure-password

# Start server
npm start
```

## Docker Deployment

### Build and Run Locally

```bash
# Build the Docker image
docker build -t secure-sftp-server .

# Run with Docker Compose
docker-compose up -d

# Create users
docker-compose exec sftp-server npm run admin create-user john_doe
```

### Environment Variables

Set these environment variables in your Docker deployment:

```bash
NODE_ENV=production
SFTP_PORT=2222
ADMIN_PASSWORD=your-secure-password
MAX_FILE_SIZE=104857600
MAX_LOGIN_ATTEMPTS=5
LOCKOUT_DURATION=900000
```

## AWS ECS Deployment

### Prerequisites
- AWS CLI configured
- Docker installed
- AWS account with appropriate permissions

### Step 1: Deploy Infrastructure

```bash
# Deploy CloudFormation stack
aws cloudformation create-stack \
  --stack-name secure-sftp-server \
  --template-body file://aws-cloudformation.yml \
  --parameters \
    ParameterKey=VpcId,ParameterValue=vpc-xxxxxxxx \
    ParameterKey=SubnetIds,ParameterValue="subnet-xxxxxxxx,subnet-yyyyyyyy" \
    ParameterKey=AdminPassword,ParameterValue=your-secure-password \
    ParameterKey=AllowedCidr,ParameterValue=10.0.0.0/8 \
  --capabilities CAPABILITY_IAM
```

### Step 2: Build and Push Docker Image

```bash
# Get ECR repository URI from CloudFormation output
ECR_REPO=$(aws cloudformation describe-stacks \
  --stack-name secure-sftp-server \
  --query 'Stacks[0].Outputs[?OutputKey==`ECRRepository`].OutputValue' \
  --output text)

# Login to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin $ECR_REPO

# Build and tag image
docker build -t secure-sftp-server .
docker tag secure-sftp-server:latest $ECR_REPO:latest

# Push image
docker push $ECR_REPO:latest
```

### Step 3: Update ECS Service

```bash
# Force new deployment
aws ecs update-service \
  --cluster secure-sftp-server-sftp-cluster \
  --service secure-sftp-server-sftp-service \
  --force-new-deployment
```

### Step 4: User Management

```bash
# Connect to running container for user management
TASK_ARN=$(aws ecs list-tasks \
  --cluster secure-sftp-server-sftp-cluster \
  --service-name secure-sftp-server-sftp-service \
  --query 'taskArns[0]' --output text)

# Execute admin commands
aws ecs execute-command \
  --cluster secure-sftp-server-sftp-cluster \
  --task $TASK_ARN \
  --container sftp-server \
  --interactive \
  --command "npm run admin create-user john_doe"
```

## Security Considerations

### Production Checklist

- [ ] Change default admin password
- [ ] Use strong passwords for all users
- [ ] Configure appropriate CIDR blocks for access
- [ ] Enable CloudTrail logging
- [ ] Set up CloudWatch alarms
- [ ] Configure backup strategy for EFS
- [ ] Review and limit IAM permissions
- [ ] Enable VPC Flow Logs
- [ ] Configure security groups with minimal access
- [ ] Set up SSL/TLS certificates if using load balancer

### Network Security

```bash
# Example security group rules (restrictive)
# Allow SFTP only from specific IP ranges
aws ec2 authorize-security-group-ingress \
  --group-id sg-xxxxxxxx \
  --protocol tcp \
  --port 2222 \
  --cidr 10.0.0.0/8
```

### User Security

```bash
# Create users with limited permissions
npm run admin create-user limited_user \
  --no-delete \
  --no-create-dir \
  --max-size 50

# Disable users when needed
npm run admin set-active suspicious_user false
```

## Monitoring and Maintenance

### CloudWatch Metrics

Monitor these key metrics:
- CPU and memory utilization
- Network connections
- Failed authentication attempts
- Storage usage per user

### Log Analysis

```bash
# View logs
aws logs tail /ecs/secure-sftp-server-sftp-server --follow

# Search for failed logins
aws logs filter-log-events \
  --log-group-name /ecs/secure-sftp-server-sftp-server \
  --filter-pattern "Authentication failed"
```

### Backup Strategy

```bash
# Create EFS backup
aws efs create-backup-vault --backup-vault-name sftp-backups
aws efs create-backup-plan --backup-plan file://backup-plan.json
```

### User Maintenance

```bash
# Regular user audit
npm run admin list-users

# Check user storage usage
npm run admin status

# Clean up inactive users
npm run admin delete-user inactive_user --force
```

### Updates and Patches

```bash
# Update dependencies
npm audit fix

# Rebuild and redeploy
docker build -t secure-sftp-server .
docker tag secure-sftp-server:latest $ECR_REPO:latest
docker push $ECR_REPO:latest

# Update ECS service
aws ecs update-service \
  --cluster secure-sftp-server-sftp-cluster \
  --service secure-sftp-server-sftp-service \
  --force-new-deployment
```

## Troubleshooting

### Common Issues

1. **Port already in use**
   ```bash
   # Change port in .env file
   SFTP_PORT=2223
   ```

2. **Permission denied errors**
   ```bash
   # Check user permissions
   npm run admin show-user username
   
   # Update permissions
   npm run admin update-permissions username --read true --write true
   ```

3. **Storage issues**
   ```bash
   # Check disk space
   df -h
   
   # Check user quotas
   npm run admin list-users
   ```

4. **Authentication failures**
   ```bash
   # Check logs for details
   tail -f logs/sftp.log
   
   # Reset user password
   npm run admin update-password username
   ```

### Health Checks

```bash
# Test SFTP connection
sftp -P 2222 username@your-server-ip

# Check server status
npm run admin status

# Verify container health
docker ps
docker logs container_id
```
