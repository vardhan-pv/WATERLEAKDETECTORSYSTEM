# AWS SETUP SCRIPT (PowerShell) — Smart Water Leak Detection System
# This script provisions all necessary AWS resources on Windows.

$AWS_REGION = "us-east-1"
$ErrorActionPreference = "Stop"

try {
    Write-Host "🔍 Getting AWS Account ID..." -ForegroundColor Cyan
    $ACCOUNT_ID = (aws sts get-caller-identity --query Account --output text)
    Write-Host "✅ Account ID: $ACCOUNT_ID" -ForegroundColor Green

    # ─── 1. DynamoDB Tables ───────────────────────────────────────────────────
    Write-Host "`n📦 Creating DynamoDB tables..." -ForegroundColor Cyan

    aws dynamodb create-table `
      --table-name WaterSensorReadings `
      --attribute-definitions `
        AttributeName=device_id,AttributeType=S `
        AttributeName=timestamp,AttributeType=S `
      --key-schema `
        AttributeName=device_id,KeyType=HASH `
        AttributeName=timestamp,KeyType=RANGE `
      --billing-mode PAY_PER_REQUEST `
      --region $AWS_REGION

    aws dynamodb update-time-to-live `
      --table-name WaterSensorReadings `
      --time-to-live-specification Enabled=true,AttributeName=ttl `
      --region $AWS_REGION

    aws dynamodb create-table `
      --table-name LeakEvents `
      --attribute-definitions `
        AttributeName=event_id,AttributeType=S `
      --key-schema `
        AttributeName=event_id,KeyType=HASH `
      --billing-mode PAY_PER_REQUEST `
      --region $AWS_REGION

    aws dynamodb update-time-to-live `
      --table-name LeakEvents `
      --time-to-live-specification Enabled=true,AttributeName=ttl `
      --region $AWS_REGION

    Write-Host "✅ DynamoDB tables created." -ForegroundColor Green

    # ─── 2. SNS Topic ─────────────────────────────────────────────────────────
    Write-Host "`n🔔 Configuring SNS..." -ForegroundColor Cyan
    $SNS_ARN = (aws sns create-topic --name WaterLeakAlerts --region $AWS_REGION --query TopicArn --output text)
    Write-Host "✅ SNS Topic ARN: $SNS_ARN" -ForegroundColor Green

    Write-Host "⚠️  Please check the script and replace 'your-email@example.com' with your actual email if you want notifications." -ForegroundColor Yellow

    # ─── 3. IAM Role for Lambda ───────────────────────────────────────────────
    Write-Host "`n🔐 Creating IAM Role..." -ForegroundColor Cyan
    $trustPolicy = '{
      "Version": "2012-10-17",
      "Statement": [{
        "Effect": "Allow",
        "Principal": { "Service": "lambda.amazonaws.com" },
        "Action": "sts:AssumeRole"
      }]
    }'
    $trustPolicy | Out-File -FilePath "$env:TEMP\lambda-trust.json" -Encoding ASCII

    $ROLE_ARN = (aws iam create-role `
      --role-name WaterLeakLambdaRole `
      --assume-role-policy-document "file://$($env:TEMP)\lambda-trust.json" `
      --query Role.Arn --output text)

    aws iam attach-role-policy --role-name WaterLeakLambdaRole --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
    aws iam attach-role-policy --role-name WaterLeakLambdaRole --policy-arn arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess
    aws iam attach-role-policy --role-name WaterLeakLambdaRole --policy-arn arn:aws:iam::aws:policy/AmazonSNSFullAccess

    Write-Host "✅ IAM Role created: $ROLE_ARN" -ForegroundColor Green
    Write-Host "⏳ Waiting for role propagation..." -ForegroundColor Gray
    Start-Sleep -Seconds 10

    # ─── 4. Deploy Lambda Function ───────────────────────────────────────────
    Write-Host "`n⚡ Deploying Lambda Function..." -ForegroundColor Cyan
    
    $lambdaDir = Join-Path (Get-Location) "backend\lambda"
    Push-Location $lambdaDir
    
    if (Test-Path "leak_processor.zip") { Remove-Item "leak_processor.zip" }
    Compress-Archive -Path "leak_processor.py" -DestinationPath "leak_processor.zip"

    aws lambda create-function `
      --function-name WaterLeakProcessor `
      --runtime python3.11 `
      --role $ROLE_ARN `
      --handler leak_processor.lambda_handler `
      --zip-file "fileb://leak_processor.zip" `
      --timeout 30 `
      --environment "Variables={SENSOR_TABLE=WaterSensorReadings,LEAK_TABLE=LeakEvents,SNS_TOPIC_ARN=$SNS_ARN}" `
      --region $AWS_REGION

    Pop-Location
    Write-Host "✅ Lambda function deployed." -ForegroundColor Green

    # ─── 5. AWS IoT Core Setup ────────────────────────────────────────────────
    Write-Host "`n🌐 Configuring AWS IoT Core..." -ForegroundColor Cyan
    aws iot create-thing --thing-name WaterPipelineSimulator --region $AWS_REGION

    $certDir = Join-Path (Get-Location) "iot-simulator\certs"
    if (!(Test-Path $certDir)) { New-Item -ItemType Directory -Path $certDir }

    $iotKeys = (aws iot create-keys-and-certificate `
      --set-as-active `
      --certificate-pem-outfile "iot-simulator\certs\device-certificate.pem.crt" `
      --public-key-outfile "iot-simulator\certs\public.pem.key" `
      --private-key-outfile "iot-simulator\certs\private.pem.key" `
      --region $AWS_REGION --output json | ConvertFrom-Json)

    $CERT_ARN = $iotKeys.certificateArn

    # Download Root CA
    Invoke-WebRequest -Uri "https://www.amazontrust.com/repository/AmazonRootCA1.pem" -OutFile "iot-simulator\certs\AmazonRootCA1.pem"

    # IoT Policy
    $iotPolicy = '{
      "Version": "2012-10-17",
      "Statement": [{
        "Effect": "Allow",
        "Action": ["iot:Connect","iot:Publish","iot:Subscribe","iot:Receive"],
        "Resource": "*"
      }]
    }'
    $iotPolicy | Out-File -FilePath "$env:TEMP\iot-policy.json" -Encoding ASCII

    aws iot create-policy `
      --policy-name WaterLeakSimulatorPolicy `
      --policy-document "file://$($env:TEMP)\iot-policy.json" `
      --region $AWS_REGION

    aws iot attach-policy --policy-name WaterLeakSimulatorPolicy --target $CERT_ARN --region $AWS_REGION
    aws iot attach-thing-principal --thing-name WaterPipelineSimulator --principal $CERT_ARN --region $AWS_REGION

    $IOT_ENDPOINT = (aws iot describe-endpoint --endpoint-type iot:Data-ATS --region $AWS_REGION --query endpointAddress --output text)
    Write-Host "✅ IoT Endpoint: $IOT_ENDPOINT" -ForegroundColor Green

    # ─── 6. IoT Rule → Lambda ────────────────────────────────────────────────
    Write-Host "`n🔗 Connecting IoT Core to Lambda..." -ForegroundColor Cyan

    aws lambda add-permission `
      --function-name WaterLeakProcessor `
      --statement-id IoTCoreInvoke `
      --action lambda:InvokeFunction `
      --principal iot.amazonaws.com `
      --region $AWS_REGION

    $iotRule = @{
      sql = "SELECT * FROM 'water/pipeline/#'"
      description = "Route all pipeline sensor data to Lambda"
      actions = @(
        @{
          lambda = @{
            functionArn = (aws lambda get-function --function-name WaterLeakProcessor --region $AWS_REGION --query Configuration.FunctionArn --output text)
          }
        }
      )
    } | ConvertTo-Json -Depth 10
    $iotRule | Out-File -FilePath "$env:TEMP\iot-rule.json" -Encoding ASCII

    aws iot create-topic-rule --rule-name WaterPipelineRule --topic-rule-payload "file://$($env:TEMP)\iot-rule.json" --region $AWS_REGION

    Write-Host "`n🚀 AWS SETUP COMPLETE!" -ForegroundColor Green
    Write-Host "-------------------------------------------------------"
    Write-Host "IoT Endpoint  : $IOT_ENDPOINT"
    Write-Host "SNS Topic ARN : $SNS_ARN"
    Write-Host "-------------------------------------------------------"
    Write-Host "NEXT STEPS:"
    Write-Host "1. Update 'iot-simulator/simulator.py' with the IoT Endpoint above."
    Write-Host "2. Run 'python iot-simulator/simulator.py' (now sending to AWS!)"
    Write-Host "3. Update your backend .env with the AWS region."

} catch {
    Write-Error "❌ AWS Setup failed: $_"
}
