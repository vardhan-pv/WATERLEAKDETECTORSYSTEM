################################################################################
# AWS SETUP GUIDE — Smart Water Leak Detection System
# Run these commands in order using AWS CLI
################################################################################

# ─── Prerequisites ───────────────────────────────────────────────────────────
# - AWS CLI configured: aws configure
# - Python 3.8+, pip
# - Node.js 18+

export AWS_REGION="us-east-1"
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# ─── 1. DynamoDB Tables ───────────────────────────────────────────────────────

# Sensor readings table (time-series)
aws dynamodb create-table \
  --table-name WaterSensorReadings \
  --attribute-definitions \
    AttributeName=device_id,AttributeType=S \
    AttributeName=timestamp,AttributeType=S \
  --key-schema \
    AttributeName=device_id,KeyType=HASH \
    AttributeName=timestamp,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  --region $AWS_REGION

# Enable TTL (auto-expire old data)
aws dynamodb update-time-to-live \
  --table-name WaterSensorReadings \
  --time-to-live-specification Enabled=true,AttributeName=ttl \
  --region $AWS_REGION

# Leak events table
aws dynamodb create-table \
  --table-name LeakEvents \
  --attribute-definitions \
    AttributeName=event_id,AttributeType=S \
  --key-schema \
    AttributeName=event_id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region $AWS_REGION

aws dynamodb update-time-to-live \
  --table-name LeakEvents \
  --time-to-live-specification Enabled=true,AttributeName=ttl \
  --region $AWS_REGION

echo "✅ DynamoDB tables created"

# ─── 2. SNS Topic ─────────────────────────────────────────────────────────────

SNS_ARN=$(aws sns create-topic \
  --name WaterLeakAlerts \
  --region $AWS_REGION \
  --query TopicArn --output text)

echo "SNS Topic ARN: $SNS_ARN"

# Subscribe your email
aws sns subscribe \
  --topic-arn $SNS_ARN \
  --protocol email \
  --notification-endpoint "your-email@example.com" \
  --region $AWS_REGION

# Subscribe phone for SMS (optional)
# aws sns subscribe \
#   --topic-arn $SNS_ARN \
#   --protocol sms \
#   --notification-endpoint "+919876543210" \
#   --region $AWS_REGION

echo "✅ SNS configured — check email to confirm subscription"

# ─── 3. IAM Role for Lambda ───────────────────────────────────────────────────

# Create trust policy
cat > /tmp/lambda-trust.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "lambda.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}
EOF

ROLE_ARN=$(aws iam create-role \
  --role-name WaterLeakLambdaRole \
  --assume-role-policy-document file:///tmp/lambda-trust.json \
  --query Role.Arn --output text)

# Attach policies
aws iam attach-role-policy --role-name WaterLeakLambdaRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

aws iam attach-role-policy --role-name WaterLeakLambdaRole \
  --policy-arn arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess

aws iam attach-role-policy --role-name WaterLeakLambdaRole \
  --policy-arn arn:aws:iam::aws:policy/AmazonSNSFullAccess

echo "✅ IAM Role: $ROLE_ARN"
sleep 10  # Wait for role propagation

# ─── 4. Deploy Lambda Function ────────────────────────────────────────────────

cd backend/lambda
zip -j leak_processor.zip leak_processor.py

aws lambda create-function \
  --function-name WaterLeakProcessor \
  --runtime python3.11 \
  --role $ROLE_ARN \
  --handler leak_processor.lambda_handler \
  --zip-file fileb://leak_processor.zip \
  --timeout 30 \
  --environment "Variables={SENSOR_TABLE=WaterSensorReadings,LEAK_TABLE=LeakEvents,SNS_TOPIC_ARN=$SNS_ARN}" \
  --region $AWS_REGION

echo "✅ Lambda function deployed"

# ─── 5. AWS IoT Core Setup ────────────────────────────────────────────────────

# Create IoT Thing
aws iot create-thing --thing-name WaterPipelineSimulator --region $AWS_REGION

# Create certificates
aws iot create-keys-and-certificate \
  --set-as-active \
  --certificate-pem-outfile iot-simulator/certs/device-certificate.pem.crt \
  --public-key-outfile iot-simulator/certs/public.pem.key \
  --private-key-outfile iot-simulator/certs/private.pem.key \
  --region $AWS_REGION

# Download Amazon Root CA
curl -o iot-simulator/certs/AmazonRootCA1.pem \
  https://www.amazontrust.com/repository/AmazonRootCA1.pem

# Get certificate ARN
CERT_ARN=$(aws iot list-certificates --region $AWS_REGION \
  --query 'certificates[0].certificateArn' --output text)

# Create IoT Policy
cat > /tmp/iot-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["iot:Connect","iot:Publish","iot:Subscribe","iot:Receive"],
    "Resource": "*"
  }]
}
EOF

aws iot create-policy \
  --policy-name WaterLeakSimulatorPolicy \
  --policy-document file:///tmp/iot-policy.json \
  --region $AWS_REGION

aws iot attach-policy \
  --policy-name WaterLeakSimulatorPolicy \
  --target $CERT_ARN \
  --region $AWS_REGION

aws iot attach-thing-principal \
  --thing-name WaterPipelineSimulator \
  --principal $CERT_ARN \
  --region $AWS_REGION

# Get IoT Endpoint
IOT_ENDPOINT=$(aws iot describe-endpoint \
  --endpoint-type iot:Data-ATS \
  --region $AWS_REGION \
  --query endpointAddress --output text)

echo "✅ IoT Endpoint: $IOT_ENDPOINT"
echo "   → Update AWS_IOT_ENDPOINT in iot-simulator/simulator.py"

# ─── 6. IoT Rule → Lambda ────────────────────────────────────────────────────

LAMBDA_ARN=$(aws lambda get-function \
  --function-name WaterLeakProcessor \
  --region $AWS_REGION \
  --query Configuration.FunctionArn --output text)

# Add IoT permission to invoke Lambda
aws lambda add-permission \
  --function-name WaterLeakProcessor \
  --statement-id IoTCoreInvoke \
  --action lambda:InvokeFunction \
  --principal iot.amazonaws.com \
  --region $AWS_REGION

# Create IoT Rule
cat > /tmp/iot-rule.json << EOF
{
  "sql": "SELECT * FROM 'water/pipeline/#'",
  "description": "Route all pipeline sensor data to Lambda",
  "actions": [{
    "lambda": {
      "functionArn": "$LAMBDA_ARN"
    }
  }],
  "errorAction": {
    "cloudwatchLogs": {
      "logGroupName": "/aws/iot/water-leak",
      "roleArn": "$ROLE_ARN"
    }
  }
}
EOF

aws iot create-topic-rule \
  --rule-name WaterPipelineRule \
  --topic-rule-payload file:///tmp/iot-rule.json \
  --region $AWS_REGION

echo "✅ IoT Rule created — data flows: IoT Core → Lambda → DynamoDB + SNS"

# ─── 7. API Gateway ───────────────────────────────────────────────────────────
# (Optional — use Express backend instead for simplicity)
# The Express backend in /backend already provides all REST + WebSocket APIs.
# Deploy it on EC2 / ECS / Railway / Render.

echo ""
echo "═══════════════════════════════════════════════════"
echo "✅ AWS SETUP COMPLETE"
echo ""
echo "IoT Endpoint  : $IOT_ENDPOINT"
echo "SNS Topic ARN : $SNS_ARN"
echo "Lambda ARN    : $LAMBDA_ARN"
echo ""
echo "Next steps:"
echo "  1. Update iot-simulator/simulator.py with: $IOT_ENDPOINT"
echo "  2. pip install -r iot-simulator/requirements.txt"
echo "  3. python iot-simulator/simulator.py"
echo "  4. cd backend && npm install && node server.js"
echo "  5. cd frontend && npm install && npm run dev"
echo "═══════════════════════════════════════════════════"
