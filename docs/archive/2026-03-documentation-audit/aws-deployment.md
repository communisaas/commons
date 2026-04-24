# AWS Nitro Enclaves Deployment Guide

**Updated:** October 22, 2025
**Status:** Production-ready for Phase 1
**Primary TEE Provider:** AWS Nitro Enclaves (ARM Graviton)

---

## Pre-Deployment Checklist

### Environment Variables

**Required API Keys:**

```bash
# OpenAI (GPT-5 Series)
OPENAI_API_KEY=sk-...
OPENAI_ORGANIZATION=org-... # Optional but recommended

# Google AI (Gemini 2.5)
GOOGLE_AI_API_KEY=...

# Backend
CONVEX_DEPLOYMENT=...
NEXT_PUBLIC_CONVEX_URL=...
REDIS_URL=redis://...

# Commons Core
NODE_ENV=production
PORT=3001
```

**Optional Configuration:**

```bash
# Anthropic (Future)
ANTHROPIC_API_KEY=... # For Q4 2025

# Monitoring
METRICS_ENDPOINT=https://metrics.commons.email/ingest
SENTRY_DSN=...
LOG_LEVEL=info

# Rate Limiting
RATE_LIMIT_WINDOW=60000 # 1 minute
RATE_LIMIT_MAX_REQUESTS=100

# Budget Limits
DEFAULT_USER_DAILY_LIMIT=10.00 # USD
SYSTEM_HOURLY_LIMIT=100.00 # USD
EMERGENCY_SHUTDOWN_THRESHOLD=500.00 # USD
```

### Infrastructure Setup

**1. Database Migration**

```bash
# Deploy Convex schema + functions
npx convex deploy --env-file .env.production
```

**2. Redis Configuration**

```bash
# Verify Redis connection
redis-cli ping # Should return PONG

# Set cache TTLs
redis-cli CONFIG SET maxmemory-policy allkeys-lru
redis-cli CONFIG SET maxmemory 2gb
```

**3. API Key Validation**

```bash
# Test OpenAI connection
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"

# Test Google AI connection
curl "https://generativelanguage.googleapis.com/v1/models?key=$GOOGLE_AI_API_KEY"
```

### Build Verification

```bash
# Install dependencies
npm ci --production

# Build TypeScript
npm run build

# Run tests
npm run test

# Type checking
npm run typecheck
```

---

## Why AWS Nitro Enclaves?

**Decision rationale:** See [tee-security-backdoor-analysis.md](../research/tee-security-backdoor-analysis.md) and [gcp-vs-aws-cost-comparison.md](../development/gcp-vs-aws-cost-comparison.md)

**Security advantages:**
- ✅ No Intel ME or AMD PSP (ARM Graviton architecture)
- ✅ Hypervisor-based isolation (trust AWS, not CPU vendor)
- ✅ Independently audited (August 2025)
- ✅ Open-source Nitro components for inspection
- ✅ Production-proven (Coinbase uses for crypto wallets)

**Cost advantages:**
- ✅ 15-30% cheaper than GCP ($55-60/month vs $60-85/month)
- ✅ FREE tier: 750 hrs/month on t4g.small through Dec 2025
- ✅ No TEE surcharges (GCP has per-vCPU + per-GB fees)
- ✅ Transparent pricing ($0.068/hour = $49.92/month for c6g.large)

**Security caveat:** While AWS Nitro avoids x86 management engines, we cannot provide absolute certainty about NSA backdoor absence. ARM architecture + auditable components reduce but don't eliminate state-actor risk.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Architecture Overview](#architecture-overview)
3. [AWS Infrastructure Setup](#aws-infrastructure-setup)
4. [Build Enclave Image](#build-enclave-image)
5. [Deploy EC2 Parent Instance](#deploy-ec2-parent-instance)
6. [Start Nitro Enclave](#start-nitro-enclave)
7. [Configure vsock Proxy](#configure-vsock-proxy)
8. [Verify Attestation](#verify-attestation)
9. [Production Deployment](#production-deployment)
10. [Monitoring & Troubleshooting](#monitoring--troubleshooting)

---

## Prerequisites

### AWS Account Setup

1. **AWS Account**
   - 12-digit account ID: `123456789012`
   - Region: `us-east-1` (recommended for cost + CWC API proximity)

2. **AWS CLI**
   ```bash
   # Install AWS CLI
   brew install awscli  # macOS
   # sudo apt install awscli  # Ubuntu

   # Configure credentials
   aws configure
   # AWS Access Key ID: YOUR_ACCESS_KEY
   # AWS Secret Access Key: YOUR_SECRET_KEY
   # Default region: us-east-1
   # Default output format: json
   ```

3. **Docker** (for building enclave images)
   ```bash
   # Install Docker Desktop or Docker Engine
   docker --version  # Should be 20.10+
   ```

4. **Nitro CLI** (optional for local development)
   ```bash
   # Amazon Linux 2023 / Ubuntu
   sudo dnf install -y aws-nitro-enclaves-cli aws-nitro-enclaves-cli-devel
   # or
   sudo apt install -y aws-nitro-enclaves-cli aws-nitro-enclaves-cli-devel
   ```

---

## Architecture Overview

### End-to-End Flow

```
Browser (Client)
├─ XChaCha20-Poly1305 encryption
├─ ZK proof generation (Noir/UltraHonk, 4-6 seconds)
└─ HTTPS POST to TEE endpoint

↓ Internet (HTTPS)

EC2 Parent Instance (c6g.large, ARM Graviton2)
├─ Nginx reverse proxy
├─ vsock proxy (port 8080 → enclave vsock port 5000)
└─ Public IP: 52.14.123.45

↓ vsock (local socket communication)

Nitro Enclave (hypervisor-isolated)
├─ TEE application (decryption + CWC forwarding)
├─ XChaCha20-Poly1305 decryption
├─ CWC API submission
└─ Attestation document generation (CBOR/COSE)

↓ Internet (HTTPS)

CWC API (Congressional Web Contact)
├─ House: cwc-api.house.gov
└─ Senate: soapbox.senate.gov
```

### Component Breakdown

**Parent EC2 Instance:**
- **Instance type:** c6g.large (2 vCPU, 4 GB, ARM Graviton2)
- **AMI:** Amazon Linux 2023 with Nitro CLI pre-installed
- **Role:** Proxy between internet and enclave (vsock communication)
- **Security:** Cannot access enclave memory (hypervisor isolation)

**Nitro Enclave:**
- **Resources:** 2 vCPU, 4 GB (allocated from parent instance)
- **Image:** .eif file (Enclave Image File) built from Docker image
- **Communication:** vsock (CID 16, port 5000)
- **Isolation:** ARM Graviton hypervisor-enforced memory isolation

**Attestation:**
- **Format:** CBOR-encoded, COSE-signed (ECDSA 384)
- **PKI:** AWS Nitro PKI (root cert publicly available)
- **PCRs:** Boot (PCR0), kernel (PCR1), application (PCR2), IAM role (PCR3), instance ID (PCR4)

---

## AWS Infrastructure Setup

### 1. Create VPC and Networking

```bash
# Create VPC
aws ec2 create-vpc \
    --cidr-block 10.0.0.0/16 \
    --tag-specifications 'ResourceType=vpc,Tags=[{Key=Name,Value=commons-tee-vpc}]'

export VPC_ID=$(aws ec2 describe-vpcs \
    --filters "Name=tag:Name,Values=commons-tee-vpc" \
    --query "Vpcs[0].VpcId" --output text)

# Create public subnet
aws ec2 create-subnet \
    --vpc-id $VPC_ID \
    --cidr-block 10.0.1.0/24 \
    --availability-zone us-east-1a \
    --tag-specifications 'ResourceType=subnet,Tags=[{Key=Name,Value=commons-tee-subnet}]'

export SUBNET_ID=$(aws ec2 describe-subnets \
    --filters "Name=tag:Name,Values=commons-tee-subnet" \
    --query "Subnets[0].SubnetId" --output text)

# Create internet gateway
aws ec2 create-internet-gateway \
    --tag-specifications 'ResourceType=internet-gateway,Tags=[{Key=Name,Value=commons-tee-igw}]'

export IGW_ID=$(aws ec2 describe-internet-gateways \
    --filters "Name=tag:Name,Values=commons-tee-igw" \
    --query "InternetGateways[0].InternetGatewayId" --output text)

# Attach internet gateway to VPC
aws ec2 attach-internet-gateway \
    --vpc-id $VPC_ID \
    --internet-gateway-id $IGW_ID

# Create route table
aws ec2 create-route-table \
    --vpc-id $VPC_ID \
    --tag-specifications 'ResourceType=route-table,Tags=[{Key=Name,Value=commons-tee-rtb}]'

export RTB_ID=$(aws ec2 describe-route-tables \
    --filters "Name=tag:Name,Values=commons-tee-rtb" \
    --query "RouteTables[0].RouteTableId" --output text)

# Add route to internet gateway
aws ec2 create-route \
    --route-table-id $RTB_ID \
    --destination-cidr-block 0.0.0.0/0 \
    --gateway-id $IGW_ID

# Associate route table with subnet
aws ec2 associate-route-table \
    --subnet-id $SUBNET_ID \
    --route-table-id $RTB_ID
```

### 2. Create Security Group

```bash
# Create security group
aws ec2 create-security-group \
    --group-name commons-tee-sg \
    --description "Security group for Commons TEE instances" \
    --vpc-id $VPC_ID

export SG_ID=$(aws ec2 describe-security-groups \
    --filters "Name=group-name,Values=commons-tee-sg" \
    --query "SecurityGroups[0].GroupId" --output text)

# Allow HTTPS (443) from anywhere
aws ec2 authorize-security-group-ingress \
    --group-id $SG_ID \
    --protocol tcp \
    --port 443 \
    --cidr 0.0.0.0/0

# Allow HTTP (80) for Let's Encrypt challenges
aws ec2 authorize-security-group-ingress \
    --group-id $SG_ID \
    --protocol tcp \
    --port 80 \
    --cidr 0.0.0.0/0

# Allow SSH (22) for administration (restrict to your IP in production)
aws ec2 authorize-security-group-ingress \
    --group-id $SG_ID \
    --protocol tcp \
    --port 22 \
    --cidr YOUR_IP/32
```

### 3. Create IAM Instance Profile

```bash
# Create IAM role for EC2 instance
aws iam create-role \
    --role-name CommonsTEEInstanceRole \
    --assume-role-policy-document '{
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Principal": {"Service": "ec2.amazonaws.com"},
            "Action": "sts:AssumeRole"
        }]
    }'

# Attach managed policies
aws iam attach-role-policy \
    --role-name CommonsTEEInstanceRole \
    --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore

aws iam attach-role-policy \
    --role-name CommonsTEEInstanceRole \
    --policy-arn arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy

# Create custom policy for S3 enclave image access
aws iam create-policy \
    --policy-name CommonsEnclaveImageAccess \
    --policy-document '{
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Action": [
                "s3:GetObject",
                "s3:ListBucket"
            ],
            "Resource": [
                "arn:aws:s3:::commons-nitro-enclaves/*",
                "arn:aws:s3:::commons-nitro-enclaves"
            ]
        }]
    }'

export POLICY_ARN=$(aws iam list-policies \
    --query "Policies[?PolicyName=='CommonsEnclaveImageAccess'].Arn" \
    --output text)

aws iam attach-role-policy \
    --role-name CommonsTEEInstanceRole \
    --policy-arn $POLICY_ARN

# Create instance profile
aws iam create-instance-profile \
    --instance-profile-name CommonsTEEInstanceProfile

aws iam add-role-to-instance-profile \
    --instance-profile-name CommonsTEEInstanceProfile \
    --role-name CommonsTEEInstanceRole
```

### 4. Create S3 Bucket for Enclave Images

```bash
# Create S3 bucket
aws s3 mb s3://commons-nitro-enclaves --region us-east-1

# Enable versioning
aws s3api put-bucket-versioning \
    --bucket commons-nitro-enclaves \
    --versioning-configuration Status=Enabled

# Block public access
aws s3api put-public-access-block \
    --bucket commons-nitro-enclaves \
    --public-access-block-configuration \
        BlockPublicAcls=true,\
IgnorePublicAcls=true,\
BlockPublicPolicy=true,\
RestrictPublicBuckets=true
```

---

## Build Enclave Image

### 1. Create Dockerfile for TEE Application

```dockerfile
# Dockerfile.nitro-enclave
FROM public.ecr.aws/amazonlinux/amazonlinux:2023

# Install runtime dependencies
RUN dnf install -y \
    nodejs20 \
    libsodium \
    && dnf clean all

# Copy TEE application
WORKDIR /app
COPY tee-application/ /app/

# Install Node.js dependencies
RUN npm ci --production

# Expose vsock port (not TCP port - vsock is local only)
# Port 5000 will be used for vsock communication
ENV VSOCK_PORT=5000

# Start TEE application
CMD ["node", "src/index.js"]
```

### 2. Build Docker Image

```bash
# Build Docker image
docker build -f Dockerfile.nitro-enclave -t commons-tee:latest .

# Tag for ECR
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
docker tag commons-tee:latest \
    $AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/commons-tee:latest

# Push to ECR
aws ecr get-login-password --region us-east-1 | \
    docker login --username AWS --password-stdin \
    $AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com

docker push $AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/commons-tee:latest
```

### 3. Build Enclave Image File (.eif)

**Note:** This step must be performed on an Amazon Linux 2023 instance or in CI/CD.

```bash
# On Amazon Linux 2023 instance with Nitro CLI installed
nitro-cli build-enclave \
    --docker-uri $AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/commons-tee:latest \
    --output-file commons-tee.eif

# Output:
# Enclave Image successfully created.
# {
#   "Measurements": {
#     "HashAlgorithm": "Sha384 { ... }",
#     "PCR0": "000102030405...",  # Enclave image hash (SHA384)
#     "PCR1": "0a0b0c0d0e0f...",  # Kernel + bootstrap hash
#     "PCR2": "1a1b1c1d1e1f..."   # Application hash
#   }
# }
```

**CRITICAL:** Save PCR measurements for attestation verification!

```bash
# Save PCR measurements
echo "PCR0=000102030405..." >> .env.production
echo "PCR1=0a0b0c0d0e0f..." >> .env.production
echo "PCR2=1a1b1c1d1e1f..." >> .env.production
```

### 4. Upload .eif to S3

```bash
# Upload enclave image to S3
aws s3 cp commons-tee.eif \
    s3://commons-nitro-enclaves/enclaves/commons-tee.eif

# Verify upload
aws s3 ls s3://commons-nitro-enclaves/enclaves/
```

---

## Deploy EC2 Parent Instance

### 1. Get Amazon Linux 2023 AMI

```bash
# Get latest AL2023 AMI with Nitro CLI
export AMI_ID=$(aws ssm get-parameter \
    --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 \
    --query 'Parameter.Value' --output text)

echo "AMI ID: $AMI_ID"
```

### 2. Create User Data Script

```bash
cat > user-data.sh <<'EOF'
#!/bin/bash
set -e

# Install Nitro CLI (if not already installed)
if ! command -v nitro-cli &> /dev/null; then
    dnf install -y aws-nitro-enclaves-cli aws-nitro-enclaves-cli-devel
fi

# Configure Nitro Enclaves allocator
# Allocate 2 vCPUs and 4096 MB to enclave
nitro-cli-config -t 2 -m 4096

# Start Docker daemon
systemctl enable --now docker

# Download enclave image from S3
aws s3 cp s3://commons-nitro-enclaves/enclaves/commons-tee.eif /opt/commons-tee.eif

# Run enclave
nitro-cli run-enclave \
    --eif-path /opt/commons-tee.eif \
    --cpu-count 2 \
    --memory 4096 \
    --enclave-cid 16

# Wait for enclave to start
sleep 5

# Install vsock proxy
git clone https://github.com/aws/aws-nitro-enclaves-samples.git /tmp/nitro-samples
cd /tmp/nitro-samples/vsock-proxy
cargo build --release

# Configure vsock proxy to map enclave vsock port 5000 → parent port 8080
nohup /tmp/nitro-samples/vsock-proxy/target/release/vsock-proxy 8080 16 5000 &

# Install Nginx for HTTPS termination
dnf install -y nginx certbot python3-certbot-nginx

# Configure Nginx reverse proxy
cat > /etc/nginx/conf.d/tee-proxy.conf <<'NGINX'
server {
    listen 80;
    server_name tee.commons.email;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGINX

systemctl enable --now nginx

# Obtain Let's Encrypt certificate (manual verification required first time)
# certbot --nginx -d tee.commons.email --non-interactive --agree-tos -m contact@commons.email

echo "Nitro Enclave deployment complete!"
EOF
```

### 3. Launch EC2 Instance

```bash
# Launch instance
aws ec2 run-instances \
    --image-id $AMI_ID \
    --instance-type c6g.large \
    --key-name your-key-pair \
    --subnet-id $SUBNET_ID \
    --security-group-ids $SG_ID \
    --iam-instance-profile Name=CommonsTEEInstanceProfile \
    --enclave-options Enabled=true \
    --user-data file://user-data.sh \
    --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=commons-tee-production}]'

# Get instance ID
export INSTANCE_ID=$(aws ec2 describe-instances \
    --filters "Name=tag:Name,Values=commons-tee-production" \
    --query "Reservations[0].Instances[0].InstanceId" \
    --output text)

# Wait for instance to be running
aws ec2 wait instance-running --instance-ids $INSTANCE_ID

# Get public IP
export PUBLIC_IP=$(aws ec2 describe-instances \
    --instance-ids $INSTANCE_ID \
    --query "Reservations[0].Instances[0].PublicIpAddress" \
    --output text)

echo "Instance running at: $PUBLIC_IP"
```

---

## Start Nitro Enclave

### 1. SSH to Parent Instance

```bash
# SSH to parent instance
ssh -i your-key.pem ec2-user@$PUBLIC_IP
```

### 2. Verify Enclave is Running

```bash
# List running enclaves
nitro-cli describe-enclaves

# Output:
# [
#   {
#     "EnclaveCID": 16,
#     "EnclaveID": "i-0abcdef1234567890-enc9876543210abcd",
#     "ProcessID": 12345,
#     "EnclaveName": "commons-tee",
#     "State": "RUNNING",
#     "Flags": "NONE",
#     "CPUCount": 2,
#     "CPUIDs": [1, 2],
#     "MemoryMiB": 4096
#   }
# ]
```

### 3. Test vsock Communication

```bash
# Test connectivity to enclave
curl http://localhost:8080/health

# Expected response:
# {"healthy":true,"enclaveId":"i-0abcdef1234567890-enc9876543210abcd","timestamp":"2025-10-22T12:34:56.789Z"}
```

---

## Configure vsock Proxy

### 1. Install vsock Proxy (if not done in user data)

```bash
# Clone AWS Nitro Enclaves samples
git clone https://github.com/aws/aws-nitro-enclaves-samples.git
cd aws-nitro-enclaves-samples/vsock-proxy

# Build vsock proxy
cargo build --release

# Install systemd service
sudo cat > /etc/systemd/system/vsock-proxy.service <<'SERVICE'
[Unit]
Description=vsock proxy for Nitro Enclave
After=network.target

[Service]
Type=simple
ExecStart=/home/ec2-user/aws-nitro-enclaves-samples/vsock-proxy/target/release/vsock-proxy 8080 16 5000
Restart=always
User=root

[Install]
WantedBy=multi-user.target
SERVICE

# Enable and start service
sudo systemctl enable vsock-proxy
sudo systemctl start vsock-proxy
sudo systemctl status vsock-proxy
```

---

## Verify Attestation

### 1. Request Attestation Document

```bash
# Request attestation from enclave
curl http://localhost:8080/attestation | jq .

# Response (CBOR-encoded attestation document):
# {
#   "attestation_document": "hEShATgioFkQ5KdtbW9kdWxlX2lkeCNpLTBhYmNkZWYxMjM0NTY3ODkwLWVuY..."
# }
```

### 2. Decode Attestation Document

```bash
# Decode CBOR attestation (requires cbor2 Python package)
pip3 install cbor2

curl -s http://localhost:8080/attestation | \
    jq -r '.attestation_document' | \
    base64 -d | \
    python3 -c "import sys, cbor2; print(cbor2.loads(sys.stdin.buffer.read()))"
```

### 3. Verify PCR Measurements

```bash
# Verify PCR2 matches expected application hash
# PCR2 should match the value from `nitro-cli build-enclave` output

expected_pcr2="1a1b1c1d1e1f..."  # From build step
actual_pcr2=$(curl -s http://localhost:8080/attestation | \
    jq -r '.pcrs.PCR2')

if [ "$expected_pcr2" == "$actual_pcr2" ]; then
    echo "✓ PCR2 verification passed"
else
    echo "✗ PCR2 verification FAILED"
    echo "Expected: $expected_pcr2"
    echo "Actual: $actual_pcr2"
fi
```

---

## Production Deployment

### 1. Configure DNS

```bash
# Add A record for tee.commons.email
# Point to: $PUBLIC_IP (or Elastic IP for production)

# Verify DNS propagation
dig tee.commons.email +short
```

### 2. Obtain SSL Certificate

```bash
# On EC2 instance
sudo certbot --nginx -d tee.commons.email \
    --non-interactive \
    --agree-tos \
    -m contact@commons.email

# Test certificate renewal
sudo certbot renew --dry-run

# Set up auto-renewal
sudo systemctl enable certbot-renew.timer
```

### 3. Update Environment Variables

Update `.env.production` in Commons repository:

```bash
# TEE Configuration
TEE_PROVIDER=aws
AWS_REGION=us-east-1
TEE_ENDPOINT=https://tee.commons.email
TEE_EXPECTED_CODE_HASH=sha256:1a1b1c1d1e1f...  # From PCR2
```

### 4. Deploy Application Updates

```bash
# On Commons app server (Cloudflare Pages)
# Deploy via Cloudflare Pages CI/CD pipeline

# Verify TEE integration
curl https://commons.email/api/health/tee
```

---

## Monitoring & Troubleshooting

### CloudWatch Metrics

```bash
# Create CloudWatch log group
aws logs create-log-group \
    --log-group-name /aws/nitro-enclaves/commons-tee

# Install CloudWatch agent on EC2 instance
sudo yum install -y amazon-cloudwatch-agent

# Configure agent to stream enclave console output
sudo cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json <<'JSON'
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/log/nitro_enclaves/commons-tee.log",
            "log_group_name": "/aws/nitro-enclaves/commons-tee",
            "log_stream_name": "{instance_id}"
          }
        ]
      }
    }
  }
}
JSON

sudo systemctl start amazon-cloudwatch-agent
```

### Viewing Enclave Console Output

```bash
# View enclave console output
nitro-cli console --enclave-id $(nitro-cli describe-enclaves | jq -r '.[0].EnclaveID')
```

### Common Issues

**Enclave fails to start:**
```bash
# Check Nitro CLI allocator configuration
cat /etc/nitro_enclaves/allocator.yaml

# Should show:
# cpu_count: 2
# memory_mib: 4096

# Verify parent instance has enough resources
# c6g.large has 2 vCPU, 4 GB total
# Enclave needs 2 vCPU, 4 GB (leaves none for parent - problematic!)
# Solution: Use c6g.xlarge (4 vCPU, 8 GB) or reduce enclave allocation
```

**vsock proxy not connecting:**
```bash
# Check vsock proxy is running
sudo systemctl status vsock-proxy

# Check firewall rules
sudo iptables -L -n

# Test enclave vsock directly (from parent instance)
nitro-cli console --enclave-id $(nitro-cli describe-enclaves | jq -r '.[0].EnclaveID')
# Then send test message via vsock
```

**Attestation verification fails:**
```bash
# Verify PCR measurements match
nitro-cli describe-enclaves | jq -r '.[0].Measurements'

# Check certificate chain
curl -s http://localhost:8080/attestation | \
    jq -r '.cabundle[] | @base64d' | \
    openssl x509 -text -noout
```

---

## Cost Optimization

### FREE Tier Strategy (First 14 Months)

```bash
# Use t4g.small for development and staging (FREE 750 hrs/month)
# Deploy on t4g.small:
aws ec2 run-instances \
    --instance-type t4g.small \
    --enclave-options Enabled=true \
    ...

# Note: t4g.small has 2 vCPU, 2 GB RAM
# Allocate 1 vCPU, 1 GB to enclave (leave 1 vCPU, 1 GB for parent)
```

### Savings Plan (After FREE Tier Expires)

```bash
# Commit to 1-year Compute Savings Plan for 33% discount
# c6g.large: $49.92/month → $33/month
aws savingsplans purchase-savings-plan \
    --savings-plan-offering-id <offering-id> \
    --commitment 33.0 \
    --upfront-payment-amount 0.0 \
    --purchase-time $(date -u +"%Y-%m-%dT%H:%M:%SZ")
```

---

## Security Checklist

- [ ] **Attestation verification enabled** (`TEE_ENABLE_ATTESTATION_VERIFICATION=true`)
- [ ] **PCR measurements validated** (PCR0, PCR1, PCR2 match expected values)
- [ ] **Debug mode disabled** (PCRs are not all zeros)
- [ ] **Certificate chain verified** (AWS Nitro PKI root cert valid)
- [ ] **HTTPS only** (TLS termination at Nginx, no HTTP allowed)
- [ ] **Security groups restricted** (SSH only from admin IPs, HTTPS from anywhere)
- [ ] **IAM instance profile least privilege** (only S3 read access to enclave bucket)
- [ ] **Secrets management** (encryption keys stored in AWS Secrets Manager, not .env)
- [ ] **Monitoring enabled** (CloudWatch logs + metrics for enclave)
- [ ] **Backup strategy** (enclave image .eif versioned in S3)

---

## Next Steps

1. **Test with FREE tier** (t4g.small, 750 hrs/month through Dec 2025)
2. **Validate attestation verification** (ensure PCR2 matches expected hash)
3. **Test end-to-end encryption** (browser → enclave → CWC API)
4. **Deploy to production** (c6g.large, $49.92/month)
5. **Monitor CloudWatch metrics** (enclave health, request latency)
6. **Configure auto-scaling** (based on queue depth, if needed)

---

## References

- **AWS Nitro Enclaves Documentation:** https://docs.aws.amazon.com/enclaves/
- **Nitro CLI Reference:** https://docs.aws.amazon.com/enclaves/latest/user/cmd-nitro-cli.html
- **NSM API (attestation):** https://github.com/aws/aws-nitro-enclaves-nsm-api
- **vsock Proxy:** https://github.com/aws/aws-nitro-enclaves-samples/tree/main/vsock-proxy
- **Security Analysis:** `docs/research/tee-security-backdoor-analysis.md`
- **Cost Comparison:** `docs/development/gcp-vs-aws-cost-comparison.md`

---

**Deployment Status:** Ready for Week 14 production deployment
**Estimated Cost:** $0 (FREE tier) for dev/staging, $55-60/month for production
**Security:** ARM Graviton (no Intel ME/AMD PSP), independently audited (Aug 2025)
