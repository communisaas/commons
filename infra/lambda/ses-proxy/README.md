# SES Proxy Lambda

Thin Lambda Function URL proxy that accepts scoped STS credentials and sends emails via SES. The Lambda itself has no SES IAM permissions — it uses caller-provided credentials, so authorization is enforced by the STS session policy vended by the SvelteKit server.

## Deployment

1. **Build**: `npx tsc index.ts --outDir dist --module esnext --target es2022 --moduleResolution bundler`
2. **Package**: `cd dist && zip -r ses-proxy.zip . && cd ..`
3. **Deploy**:
   ```bash
   aws lambda create-function \
     --function-name ses-proxy \
     --runtime nodejs20.x \
     --architecture arm64 \
     --handler index.handler \
     --zip-file fileb://dist/ses-proxy.zip \
     --memory-size 128 \
     --timeout 60 \
     --role arn:aws:iam::ACCOUNT:role/ses-proxy-execution-role
   ```

4. **Function URL** (with CORS):
   ```bash
   aws lambda create-function-url-config \
     --function-name ses-proxy \
     --auth-type NONE \
     --cors '{
       "AllowOrigins": ["https://commons.email"],
       "AllowMethods": ["POST", "OPTIONS"],
       "AllowHeaders": ["Content-Type"]
     }'
   ```

## Architecture

- **No API Gateway** — uses Lambda Function URL directly (simpler, cheaper)
- **No VPC** — calls SES public endpoint
- **Auth model** — the STS session policy (inline, scoped to org's fromAddress) is the authorization boundary. If the credentials are valid, the send is authorized.
- **No rate limiting** — the STS token vending endpoint handles rate limiting (1 token / org / 5 min)

## Environment Variables

| Variable     | Required | Default     | Description          |
|-------------|----------|-------------|----------------------|
| `AWS_REGION` | No       | `us-east-1` | SES region           |

The Lambda execution role needs minimal permissions (just CloudWatch Logs). SES permissions come from the caller's STS credentials.
