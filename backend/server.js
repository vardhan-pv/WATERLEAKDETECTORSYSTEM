/**
 * Smart Water Leak Detection — Express Backend API
 * Provides REST endpoints and WebSocket for real-time dashboard
 */

import express from "express";
import cors from "cors";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import mqtt from "mqtt";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { Aedes } from "aedes";
import { createServer as createNetServer } from "net";

// ─── MQTT Broker Setup (Local fallback) ──────────────────────────────────────
const MQTT_BROKER    = process.env.MQTT_BROKER   || "mqtt://localhost:1883";
const isAWS = MQTT_BROKER.includes("amazonaws.com");

if (MQTT_BROKER.includes("localhost")) {
  const broker = await Aedes.createBroker();
  const brokerServer = createNetServer(broker.handle);
  const brokerPort = 1883;

  brokerServer.listen(brokerPort, () => {
    console.log(`🚀 Local MQTT Broker running on port ${brokerPort}`);
  });

  broker.on('client', (client) => {
    console.log(`🔌 MQTT Client Connected: ${client ? client.id : 'unknown'}`);
  });
}

// ─── Config ──────────────────────────────────────────────────────────────────
const PORT           = process.env.PORT          || 4000;
const MQTT_TOPIC_SUB = "water/pipeline/#";
const AWS_REGION     = process.env.AWS_REGION    || "us-east-1";
const SENSOR_TABLE   = process.env.SENSOR_TABLE  || "WaterSensorReadings";
const LEAK_TABLE     = process.env.LEAK_TABLE    || "LeakEvents";

// ─── Express + WebSocket Setup ────────────────────────────────────────────────
const app    = express();
const server = createServer(app);
const wss    = new WebSocketServer({ server, path: "/ws" });

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json());

// ─── DynamoDB ────────────────────────────────────────────────────────────────
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region: AWS_REGION }));
const USERS_FILE = path.join(__dirname, "users.json");

// Helper to load/save users
function getUsers() {
  if (!fs.existsSync(USERS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(USERS_FILE)); } catch (e) { return []; }
}
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// ─── In-Memory State (fast reads for dashboard) ───────────────────────────────
const liveReadings = new Map();   // device_id → latest reading
const recentLeaks  = [];          // last 50 leak events
const MAX_LEAKS    = 50;

// ─── WebSocket Broadcast ──────────────────────────────────────────────────────
function broadcast(type, data) {
  const msg = JSON.stringify({ type, data, ts: new Date().toISOString() });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(msg);
  });
}

wss.on("connection", (ws) => {
  console.log("📡 WebSocket client connected");

  // Send current state immediately on connect
  ws.send(JSON.stringify({
    type: "INIT",
    data: {
      readings: Array.from(liveReadings.values()),
      leaks:    recentLeaks.slice(-20),
    },
  }));

  ws.on("close", () => console.log("📡 WebSocket client disconnected"));
});

// ─── MQTT Subscriber ─────────────────────────────────────────────────────────
const activeIncidents = new Map(); // device_id -> { event_id, index in recentLeaks }

const mqttOptions = {
  clientId:      `water-backend-${Date.now()}`,
  reconnectPeriod: 3000,
  connectTimeout:  10000,
};

// If AWS IoT Core, add certificates
if (isAWS) {
  const certDir = path.join(__dirname, "certs");
  try {
    mqttOptions.key = fs.readFileSync(path.join(certDir, "private.pem.key"));
    mqttOptions.cert = fs.readFileSync(path.join(certDir, "device-certificate.pem.crt"));
    mqttOptions.ca = fs.readFileSync(path.join(certDir, "AmazonRootCA1.pem"));
    mqttOptions.protocol = 'mqtts';
  } catch (e) {
    console.warn("⚠️ AWS Certificates not found in backend/certs/ - MQTT might fail to connect.");
  }
}

const mqttClient = mqtt.connect(MQTT_BROKER, mqttOptions);

mqttClient.on("connect", () => {
  console.log(`✅ MQTT connected to ${MQTT_BROKER}`);
  mqttClient.subscribe(MQTT_TOPIC_SUB, { qos: 1 }, (err) => {
    if (err) console.error("MQTT subscribe error:", err);
    else console.log(`📥 Subscribed to ${MQTT_TOPIC_SUB}`);
  });
});

mqttClient.on("error",   (e) => console.error("MQTT error:", e.message));
mqttClient.on("offline", ()  => console.warn("⚠️  MQTT offline"));

mqttClient.on("message", (topic, buffer) => {
  try {
    const payload = JSON.parse(buffer.toString());
    const { device_id, leak_status, leak_severity, timestamp } = payload;
    const previousReading = liveReadings.get(device_id);

    // ─── Incident Detection (Edge Triggered & Deduplicated) ──────────────────
    const wasLeaking = activeIncidents.has(device_id);
    const isNewLeak = leak_status && !wasLeaking;
    const severityChanged = leak_status && wasLeaking && (leak_severity !== previousReading?.leak_severity);

    if (isNewLeak) {
      // Create new incident
      const event_id = `${device_id}#${Date.now()}`;
      const leak = { ...payload, event_id, is_update: false, resolved: false };
      
      recentLeaks.unshift(leak);
      if (recentLeaks.length > MAX_LEAKS) recentLeaks.pop();
      
      activeIncidents.set(device_id, event_id);
      
      console.log(`🚨 [NEW INCIDENT] ${device_id} | ${leak_severity} | ${payload.anomaly_type}`);
      broadcast("LEAK_ALERT", leak);
    } 
    else if (severityChanged) {
      // Update existing incident in-place
      const event_id = activeIncidents.get(device_id);
      const leakIndex = recentLeaks.findIndex(l => l.event_id === event_id);
      
      if (leakIndex !== -1) {
        const updatedLeak = { ...payload, event_id, is_update: true, resolved: false };
        recentLeaks[leakIndex] = updatedLeak;
        
        console.log(`⚡ [ESCALATION] ${device_id} -> ${leak_severity}`);
        broadcast("LEAK_ALERT", updatedLeak);
      }
    }
    else if (!leak_status && wasLeaking) {
      // Clear incident session
      activeIncidents.delete(device_id);
      console.log(`✅ [CLEARED] ${device_id}`);
    }

    // Update live state
    liveReadings.set(device_id, payload);

    // Broadcast simple telemetry update for charts (always)
    broadcast("SENSOR_UPDATE", payload);
  } catch (e) {
    console.error("Message parse error:", e.message);
  }
});

// ─── Frontend & API Routes ────────────────────────────────────────────────────
const frontendPath = path.join(__dirname, "../frontend/dist");
if (fs.existsSync(frontendPath)) {
  console.log(`📂 Serving Frontend UI from: ${frontendPath}`);
  app.use(express.static(frontendPath));
} else {
  app.get("/", (req, res) => {
    res.send(`
      <div style="font-family: sans-serif; padding: 40px; text-align: center; background: #0f172a; color: white; height: 100vh; display: flex; flex-direction: column; justify-content: center; align-items: center;">
        <h1 style="color: #38bdf8; font-size: 3rem; margin-bottom: 1rem;">🌊 Water Leak Detection API</h1>
        <p style="font-size: 1.2rem; color: #94a3b8;">The backend server is running smoothly.</p>
        <div style="margin-top: 2rem; padding: 1rem; background: #1e293b; border-radius: 8px; border: 1px solid #334155;">
          <p>API Health: <a href="/api/health" style="color: #38bdf8; text-decoration: none;">/api/health</a></p>
          <p>WebSocket: <code style="color: #f472b6;">/ws</code></p>
        </div>
        <p style="margin-top: 2rem; color: #64748b; font-size: 0.9rem;">Note: This is the backend API. Usually, you want to access the frontend dashboard.</p>
      </div>
    `);
  });
}

/** GET /api/health */
app.get("/api/health", (req, res) => {
  res.json({
    status:    "ok",
    uptime:    process.uptime(),
    mqtt:      mqttClient.connected ? "connected" : "disconnected",
    devices:   liveReadings.size,
    ws_clients: wss.clients.size,
  });
});

/** GET /api/sensors — all live sensor readings */
app.get("/api/sensors", (req, res) => {
  const data = Array.from(liveReadings.values());
  res.json({ success: true, count: data.length, data });
});

/** GET /api/sensors/:deviceId — single device reading */
app.get("/api/sensors/:deviceId", (req, res) => {
  const reading = liveReadings.get(req.params.deviceId.toUpperCase());
  if (!reading) return res.status(404).json({ success: false, message: "Device not found" });
  res.json({ success: true, data: reading });
});

/** GET /api/leaks — recent in-memory leak events */
app.get("/api/leaks", (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  res.json({ success: true, count: recentLeaks.length, data: recentLeaks.slice(0, limit) });
});

/** GET /api/leaks/history — from DynamoDB */
app.get("/api/leaks/history", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const result = await dynamo.send(new ScanCommand({
      TableName: LEAK_TABLE,
      Limit:     limit,
    }));
    res.json({ success: true, count: result.Count, data: result.Items || [] });
  } catch (e) {
    console.error("DynamoDB scan error:", e);
    // Fallback to in-memory
    res.json({ success: true, count: recentLeaks.length, data: recentLeaks, source: "memory" });
  }
});

/** GET /api/sensors/history/:deviceId — from DynamoDB */
app.get("/api/sensors/history/:deviceId", async (req, res) => {
  try {
    const { deviceId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const result = await dynamo.send(new QueryCommand({
      TableName:              SENSOR_TABLE,
      KeyConditionExpression: "device_id = :d",
      ExpressionAttributeValues: { ":d": deviceId.toUpperCase() },
      Limit:     limit,
      ScanIndexForward: false,  // newest first
    }));
    res.json({ success: true, count: result.Count, data: result.Items || [] });
  } catch (e) {
    console.error("DynamoDB query error:", e);
    res.status(500).json({ success: false, message: e.message });
  }
});

/** GET /api/pipeline/status — summary status of all nodes */
app.get("/api/pipeline/status", (req, res) => {
  const readings = Array.from(liveReadings.values());
  const summary  = {
    total_nodes:   readings.length,
    online:        readings.length,
    leaking:       readings.filter(r => r.leak_status).length,
    critical:      readings.filter(r => r.leak_severity === "CRITICAL").length,
    high:          readings.filter(r => r.leak_severity === "HIGH").length,
    medium:        readings.filter(r => r.leak_severity === "MEDIUM").length,
    healthy:       readings.filter(r => !r.leak_status).length,
    avg_pressure:  readings.length
      ? +(readings.reduce((s, r) => s + (r.pressure || 0), 0) / readings.length).toFixed(2)
      : 0,
    avg_flow:      readings.length
      ? +(readings.reduce((s, r) => s + (r.flow_rate || 0), 0) / readings.length).toFixed(2)
      : 0,
    last_updated:  new Date().toISOString(),
  };
  res.json({ success: true, data: summary });
});

/** PATCH /api/leaks/:eventId/assign — update assignment info */
app.patch("/api/leaks/:eventId/assign", async (req, res) => {
  try {
    const { eventId } = req.params;
    const { assignedRegion, assignedTo } = req.body;

    const idx = recentLeaks.findIndex(l => l.event_id === eventId);
    if (idx !== -1) {
      if (assignedRegion) recentLeaks[idx].assignedRegion = assignedRegion;
      if (assignedTo)     recentLeaks[idx].assignedTo = assignedTo;
    }

    broadcast("LEAK_ASSIGNED", { event_id: eventId, assignedRegion, assignedTo });
    res.json({ success: true, message: "Assignment updated" });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ─── Authentication API ──────────────────────────────────────────────────────
const AUTHORITY_CODE = "Waterleakauthority100281";

app.post("/api/auth/register", (req, res) => {
  const { username, password, authorityCode, name } = req.body;
  
  if (authorityCode !== AUTHORITY_CODE) {
    return res.status(403).json({ success: false, message: "Invalid Authority Code" });
  }

  const users = getUsers();
  if (users.find(u => u.username === username)) {
    return res.status(400).json({ success: false, message: "Username already exists" });
  }

  const newUser = { id: Date.now(), username, password, name, createdAt: new Date().toISOString() };
  users.push(newUser);
  saveUsers(users);

  res.json({ success: true, message: "Registration successful" });
});

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body;
  const users = getUsers();
  const user = users.find(u => u.username === username && u.password === password);

  if (!user) {
    return res.status(401).json({ success: false, message: "Invalid credentials" });
  }

  // In a real app we'd use JWT, here we just return user info
  res.json({ 
    success: true, 
    user: { id: user.id, username: user.username, name: user.name } 
  });
});

/** PATCH /api/leaks/:eventId/resolve — mark leak as resolved */
app.patch("/api/leaks/:eventId/resolve", async (req, res) => {
  try {
    const { eventId } = req.params;
    await dynamo.send(new UpdateCommand({
      TableName: LEAK_TABLE,
      Key:       { event_id: eventId },
      UpdateExpression: "SET resolved = :r, resolved_at = :t",
      ExpressionAttributeValues: {
        ":r": true,
        ":t": new Date().toISOString(),
      },
    }));

    // Update in-memory
    const idx = recentLeaks.findIndex(l => l.event_id === eventId);
    if (idx !== -1) recentLeaks[idx].resolved = true;

    broadcast("LEAK_RESOLVED", { event_id: eventId });
    res.json({ success: true, message: "Leak marked as resolved" });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ─── SPA Fallback ─────────────────────────────────────────────────────────────
if (fs.existsSync(frontendPath)) {
  app.get("*", (req, res) => {
    if (!req.path.startsWith('/api') && !req.path.startsWith('/_/backend')) {
      res.sendFile(path.join(frontendPath, "index.html"));
    } else {
      res.status(404).json({ success: false, message: "Route not found" });
    }
  });
}

// ─── Start Server ─────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n🌊 Water Leak Backend running on http://localhost:${PORT}`);
  console.log(`📡 WebSocket server on ws://localhost:${PORT}/ws`);
  console.log(`🗃️  DynamoDB region: ${AWS_REGION}`);
  console.log(`📥 MQTT: ${MQTT_BROKER}`);
});
