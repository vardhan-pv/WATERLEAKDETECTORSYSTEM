# 🌊 Smart Water Leak Detection & Pipeline Monitoring System

> **IoT Simulation + AWS + Real-Time Dashboard — Final Year Project**

A complete, production-grade IoT system that simulates water pipeline sensors, detects leaks using anomaly detection logic, streams data via MQTT to AWS IoT Core, stores it in DynamoDB, triggers SMS/Email alerts via SNS, and displays everything in a real-time React dashboard with a live map.

---

## 🏗️ Architecture Overview

```
Simulated IoT Script
        │
        │ MQTT (TLS 8883)
        ▼
AWS IoT Core ──────────────────────── IoT Rule (SQL)
        │                                    │
        │                                    ▼
        │                            AWS Lambda
        │                          (leak_processor.py)
        │                            /         \
        │                       DynamoDB       AWS SNS
        │                   (store readings)  (SMS/Email)
        │
Express Backend (Node.js)
  ├── Subscribes to MQTT broker
  ├── REST APIs (GET /api/sensors, /api/leaks)
  ├── WebSocket server (/ws)
  └── In-memory live state
        │
        │ WebSocket + REST
        ▼
React Dashboard
  ├── Live sensor cards
  ├── Leak alert log
  ├── Real-time map (SVG / Mapbox)
  └── Toast notifications
```

---

## 📁 Project Structure

```
water-leak-system/
├── iot-simulator/
│   ├── simulator.py          # Main IoT device simulator
│   ├── requirements.txt      # Python deps (paho-mqtt)
│   └── certs/                # AWS IoT certificates (gitignored)
│       ├── device-certificate.pem.crt
│       ├── private.pem.key
│       └── AmazonRootCA1.pem
│
├── backend/
│   ├── server.js             # Express + WebSocket + MQTT subscriber
│   ├── package.json
│   ├── .env.example
│   └── lambda/
│       └── leak_processor.py # AWS Lambda function
│
├── frontend/
│   ├── src/
│   │   ├── App.jsx           # Main dashboard
│   │   ├── main.jsx
│   │   └── hooks/
│   │       └── useWebSocket.js
│   ├── index.html
│   ├── package.json
│   └── .env.example
│
├── aws-setup.sh              # Full AWS provisioning script
├── start-local.sh            # Local demo (no AWS needed)
└── README.md
```

---

## 🚀 Quick Start (Local Demo — No AWS Required)

### Option A: Auto Start
```bash
chmod +x start-local.sh
./start-local.sh
```

### Option B: Manual Steps

#### Step 1: Local MQTT Broker
```bash
# macOS
brew install mosquitto && mosquitto -p 1883

# Ubuntu/Linux
sudo apt install mosquitto && mosquitto -p 1883
```

#### Step 2: Backend
```bash
cd backend
cp .env.example .env
npm install
node server.js
# Runs on http://localhost:4000
```

#### Step 3: Frontend
```bash
cd frontend
cp .env.example .env
npm install
npm run dev
# Opens at http://localhost:5173
```

#### Step 4: IoT Simulator
```bash
cd iot-simulator
pip install -r requirements.txt
python simulator.py --local --interval 3
```

---

## ☁️ AWS Production Setup

### Prerequisites
```bash
aws configure  # Set your AWS credentials
```

### Run Setup Script
```bash
chmod +x aws-setup.sh
./aws-setup.sh
```

This provisions:
- ✅ DynamoDB tables (WaterSensorReadings, LeakEvents)
- ✅ SNS topic with email/SMS subscriptions
- ✅ Lambda function (leak_processor.py)
- ✅ IoT Core Thing + certificates + policy
- ✅ IoT Rule → Lambda trigger

### Update Simulator Config
After running `aws-setup.sh`, update `iot-simulator/simulator.py`:
```python
AWS_IOT_ENDPOINT = "your-endpoint.iot.us-east-1.amazonaws.com"  # from setup output
```

### Run Simulator Against AWS
```bash
cd iot-simulator
python simulator.py  # Uses AWS IoT Core (no --local flag)
```

---

## 📡 MQTT Topic Structure

```
water/pipeline/{zone}/{device_id}

Examples:
  water/pipeline/a/node-001
  water/pipeline/b/node-003
  water/pipeline/c/node-005

IoT Rule subscribes to: water/pipeline/#
```

---

## 📋 Sample JSON Payload

```json
{
  "device_id":      "NODE-001",
  "device_name":    "Zone A — Main Junction",
  "zone":           "A",
  "timestamp":      "2025-08-15T10:30:45.123456+00:00",
  "latitude":       12.971634,
  "longitude":      77.594612,
  "flow_rate":      82.4,
  "pressure":       1.87,
  "temperature":    23.5,
  "vibration":      6.2,
  "humidity":       67.3,
  "leak_status":    true,
  "leak_severity":  "HIGH",
  "anomaly_type":   "COMBINED",
  "battery_level":  91.2,
  "signal_strength": -62,
  "sequence_num":   47
}
```

---

## 🧠 Leak Detection Logic

```python
pressure_drop = pressure < 2.5   # bar threshold
flow_surge    = flow > 65         # L/min threshold

if pressure_drop AND flow_surge   → CRITICAL (COMBINED)
elif pressure_drop AND p < 1.7    → HIGH (PRESSURE_DROP)
elif pressure_drop                → MEDIUM (PRESSURE_DROP)
elif flow > 80                    → HIGH (FLOW_SURGE)
elif flow_surge                   → LOW (FLOW_SURGE)
else                              → NONE (normal)
```

---

## 🌐 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET |`/api/health`| System health check |
| GET |`/api/sensors`| All live sensor readings |
| GET | `/api/sensors/:id` | Single device reading |
| GET | `/api/leaks` | Recent leak events (memory) |
| GET | `/api/leaks/history` | Leak history from DynamoDB |
| GET | `/api/pipeline/status` | Pipeline summary stats |
| PATCH | `/api/leaks/:id/resolve` | Mark leak as resolved |
| WS | `/ws` | WebSocket for real-time updates |

---

## 🗂️ WebSocket Message Types

```json
{ "type": "INIT",          "data": { "readings": [...], "leaks": [...] } }
{ "type": "SENSOR_UPDATE", "data": { ...sensorPayload } }
{ "type": "LEAK_ALERT",    "data": { ...leakEvent } }
{ "type": "LEAK_RESOLVED", "data": { "event_id": "..." } }
```

---

## 🚨 Alert System

SNS sends alerts to email/SMS when a leak is detected:

```
🆘 [CRITICAL] Water Leak Detected — Zone A | NODE-001

📍 LOCATION
   Device     : Zone A — Main Junction (NODE-001)
   Zone       : Zone A
   Coordinates: 12.971634, 77.594612
   Maps Link  : https://maps.google.com/?q=12.971634,77.594612

📊 SENSOR READINGS
   Pressure   : 1.05 bar (Normal: 2.5–4.5 bar)
   Flow Rate  : 91.2 L/min (Normal: 10–50 L/min)
   Anomaly    : COMBINED

🔧 ACTION: IMMEDIATE dispatch required — critical leak!
```

---

## 🗺️ Adding Real Maps (Optional)

### Google Maps
```jsx
// In App.jsx, replace the SVG map with:
import { GoogleMap, Marker } from "@react-google-maps/api";

<GoogleMap mapContainerStyle={{width:"100%",height:"100%"}} center={{lat:12.97,lng:77.59}} zoom={14}>
  {sensors.map(s => s.leak_status && (
    <Marker key={s.device_id}
      position={{lat:s.latitude, lng:s.longitude}}
      icon={{ url: "https://maps.google.com/mapfiles/ms/icons/red-dot.png" }}
    />
  ))}
</GoogleMap>
```

### Mapbox
```bash
npm install mapbox-gl react-map-gl
```
Set `VITE_MAPBOX_TOKEN=your_token` in `frontend/.env`

---

## 🔧 Simulated Scenarios

The simulator generates these realistic leak scenarios:

| Scenario | Trigger | Severity | Description |
|----------|---------|----------|-------------|
| Pressure Drop | p < 2.5 bar | MEDIUM | Gradual pipe failure |
| Severe Drop | p < 1.7 bar | HIGH | Major burst |
| Flow Surge | flow > 65 L/m | LOW-HIGH | Abnormal demand |
| Combined | Both | CRITICAL | Full pipe rupture |

Each node has a **3% chance per tick** to trigger a scenario, lasting 8–20 ticks, followed by a 25–60 tick cooldown.

---

## 🎓 Technologies Used

| Layer | Tech |
|-------|------|
| IoT Simulation | Python, paho-mqtt|
| Message Broker | AWS IoT Core (prod) / Mosquitto (dev)|
| Serverless | AWS Lambda (Python 3.11)|
| Database | AWS DynamoDB|
| Alerts | AWS SNS (Email + SMS)|
| Backend | Node.js, Express, WS, MQTT.js|
| Frontend | React 18, Vite|
| Realtime | WebSocket |
| Map | SVG (built-in) / Mapbox / Google Maps|
| Cloud | AWS (IoT Core, Lambda, DynamoDB, SNS, CloudWatch)|

---

*Built for academic demonstration — scalable to production with real IoT hardware.*
