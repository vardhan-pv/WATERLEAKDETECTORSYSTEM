"""
AWS Lambda Function: Water Leak Processor
Triggered by AWS IoT Core Rule → processes sensor data → writes DynamoDB → triggers SNS alerts
"""

import json
import os
import boto3
import logging
from datetime import datetime, timezone
from decimal import Decimal

log = logging.getLogger()
log.setLevel(logging.INFO)

# ─── AWS Clients ─────────────────────────────────────────────────────────────
dynamodb = boto3.resource("dynamodb")
sns      = boto3.client("sns")

SENSOR_TABLE  = os.environ.get("SENSOR_TABLE",  "WaterSensorReadings")
LEAK_TABLE    = os.environ.get("LEAK_TABLE",    "LeakEvents")
SNS_TOPIC_ARN = os.environ.get("SNS_TOPIC_ARN", "arn:aws:sns:us-east-1:123456789:WaterLeakAlerts")

# Alert cooldown — prevent duplicate alerts per device (in-memory, per Lambda instance)
_alert_cooldown: dict[str, float] = {}
ALERT_COOLDOWN_SEC = 120  # 2 minutes per device


def float_to_decimal(obj):
    """Recursively convert floats to Decimal for DynamoDB."""
    if isinstance(obj, float):
        return Decimal(str(obj))
    elif isinstance(obj, dict):
        return {k: float_to_decimal(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [float_to_decimal(i) for i in obj]
    return obj


def lambda_handler(event, context):
    log.info(f"Received event: {json.dumps(event)}")

    # IoT Rule passes the full payload as the event
    device_id    = event.get("device_id", "UNKNOWN")
    leak_status  = event.get("leak_status", False)
    timestamp    = event.get("timestamp", datetime.now(timezone.utc).isoformat())
    zone         = event.get("zone", "UNKNOWN")
    severity     = event.get("leak_severity", "NONE")
    anomaly_type = event.get("anomaly_type", "NONE")
    lat          = event.get("latitude", 0)
    lng          = event.get("longitude", 0)

    # ── 1. Store sensor reading in DynamoDB ──────────────────────────────────
    sensor_table = dynamodb.Table(SENSOR_TABLE)
    item = float_to_decimal({
        "device_id":     device_id,
        "timestamp":     timestamp,
        "zone":          zone,
        "flow_rate":     event.get("flow_rate", 0),
        "pressure":      event.get("pressure", 0),
        "temperature":   event.get("temperature", 0),
        "vibration":     event.get("vibration", 0),
        "humidity":      event.get("humidity", 0),
        "leak_status":   leak_status,
        "leak_severity": severity,
        "anomaly_type":  anomaly_type,
        "latitude":      lat,
        "longitude":     lng,
        "battery_level": event.get("battery_level", 0),
        "signal_strength": event.get("signal_strength", 0),
        "ttl":           int(datetime.now().timestamp()) + (7 * 24 * 3600),  # 7-day TTL
    })

    try:
        sensor_table.put_item(Item=item)
        log.info(f"✅ Stored reading for {device_id}")
    except Exception as e:
        log.error(f"❌ DynamoDB write failed: {e}")

    # ── 2. Handle leak detection ─────────────────────────────────────────────
    if leak_status:
        log.warning(f"🚨 LEAK DETECTED: {device_id} | {severity} | {anomaly_type}")

        # Store leak event
        leak_table = dynamodb.Table(LEAK_TABLE)
        leak_item  = float_to_decimal({
            "event_id":    f"{device_id}#{timestamp}",
            "device_id":   device_id,
            "device_name": event.get("device_name", device_id),
            "zone":        zone,
            "timestamp":   timestamp,
            "severity":    severity,
            "anomaly_type": anomaly_type,
            "latitude":    lat,
            "longitude":   lng,
            "pressure":    event.get("pressure", 0),
            "flow_rate":   event.get("flow_rate", 0),
            "resolved":    False,
            "ttl":         int(datetime.now().timestamp()) + (30 * 24 * 3600),  # 30-day TTL
        })
        try:
            leak_table.put_item(Item=leak_item)
            log.info(f"✅ Leak event stored")
        except Exception as e:
            log.error(f"❌ Leak event DynamoDB write failed: {e}")

        # Send SNS alert (with cooldown)
        now = datetime.now().timestamp()
        last_alert = _alert_cooldown.get(device_id, 0)

        if now - last_alert > ALERT_COOLDOWN_SEC:
            _send_sns_alert(event, severity, anomaly_type, lat, lng, timestamp)
            _alert_cooldown[device_id] = now
        else:
            log.info(f"⏳ Alert cooldown active for {device_id}")

    return {"statusCode": 200, "body": "Processed successfully"}


def _send_sns_alert(event: dict, severity: str, anomaly_type: str,
                    lat: float, lng: float, timestamp: str):
    device_id   = event.get("device_id", "UNKNOWN")
    device_name = event.get("device_name", device_id)
    zone        = event.get("zone", "UNKNOWN")
    pressure    = event.get("pressure", 0)
    flow_rate   = event.get("flow_rate", 0)

    severity_emoji = {
        "LOW": "🟡", "MEDIUM": "🟠", "HIGH": "🔴", "CRITICAL": "🆘"
    }.get(severity, "⚠️")

    subject = f"{severity_emoji} [{severity}] Water Leak Detected — Zone {zone} | {device_id}"

    message = f"""
🚰 SMART WATER LEAK DETECTION SYSTEM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{severity_emoji} ALERT LEVEL: {severity}

📍 LOCATION
   Device    : {device_name} ({device_id})
   Zone      : Zone {zone}
   Coordinates: {lat:.6f}, {lng:.6f}
   Maps Link  : https://maps.google.com/?q={lat},{lng}

⏰ TIME
   Detected  : {timestamp}

📊 SENSOR READINGS
   Pressure  : {pressure:.2f} bar (Normal: 2.5–4.5 bar)
   Flow Rate : {flow_rate:.1f} L/min (Normal: 10–50 L/min)
   Anomaly   : {anomaly_type.replace('_', ' ')}

🔧 RECOMMENDED ACTION
   {'IMMEDIATE dispatch required — critical leak!' if severity == 'CRITICAL' else
    'Urgent inspection required.' if severity == 'HIGH' else
    'Schedule inspection within 2 hours.' if severity == 'MEDIUM' else
    'Monitor and log for inspection.'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Smart Water Monitoring System — Automated Alert
"""

    try:
        sns.publish(
            TopicArn = SNS_TOPIC_ARN,
            Subject  = subject,
            Message  = message,
        )
        log.info(f"📨 SNS alert sent for {device_id}")
    except Exception as e:
        log.error(f"❌ SNS publish failed: {e}")
